// Provider-neutral process and environment layer for peer.mjs: environment
// sanitization, binary resolution, storage placement, subprocess streaming
// with timeout/signal handling, and the result emitter. Providers never spawn
// processes or print markers; they build argv and decode output lines.

import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Wrapper exit codes, the same for every provider. A provider's own exit
// code travels in the `provider-exit:` marker instead.
export const EXIT = { ok: 0, empty: 2, usage: 3, failed: 4, timeout: 5 }

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ExitError extends Error {
  constructor(code, lines = []) {
    super(lines[0] || `exit ${code}`)
    this.code = code
    this.lines = lines
  }
}

export function die(code, ...lines) {
  throw new ExitError(code, lines)
}

// Caller-controlled text goes through flat() before it lands on stderr, so a
// value holding a newline cannot forge a second marker-shaped line.
export function flat(value) {
  return String(value).replace(/[\r\n]/g, ' ')
}

export function shellQuote(value) {
  const text = String(value)
  return text && /^[A-Za-z0-9._/-]+$/.test(text)
    ? text
    : `'${text.replaceAll("'", `'\\''`)}'`
}

export function parseWhole(value, flag, max = 99999) {
  const raw = String(value)
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
    die(EXIT.usage, `error: ${flag} must be a whole number between 1 and ${max}, got '${flat(raw)}'`)
  }
  return Number(raw)
}

export function isInside(candidate, root) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${'/'}`) && !isAbsolute(rel))
}

// realpath of the path, or of its nearest existing ancestor with the missing
// remainder appended lexically — enough to decide "would this land inside the
// repository?" for a path that may not exist yet.
export function bestRealpath(path) {
  let probe = resolve(path)
  const pending = []
  for (;;) {
    try {
      const real = realpathSync(probe)
      return pending.length ? join(real, ...pending) : real
    } catch {}
    const parent = dirname(probe)
    if (parent === probe) return resolve(path)
    pending.unshift(basename(probe))
    probe = parent
  }
}

// Preflight git probes get a fixed budget independent of --timeout, so a
// stalled probe cannot block the wrapper for the whole model budget before
// the caller even sees `running:`.
const PREFLIGHT_TIMEOUT_MS = 120000

export function createEnvironment(repo, provider, { requireWorkTree = true } = {}) {
  const baseEnv = { ...process.env }
  // Redirection variables an outer git/node process may have exported; any of
  // them could point a child's reads or writes somewhere this run never
  // checked. NODE_* also covers CLIs that ship as node programs.
  for (const key of Object.keys(baseEnv)) {
    if (key.startsWith('GIT_TRACE')) delete baseEnv[key]
  }
  for (const key of [
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE',
    'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    'CDPATH', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE',
    'NODE_COMPILE_CACHE', 'NODE_REDIRECT_WARNINGS',
  ]) delete baseEnv[key]
  // A relative PATH entry resolves against this process's cwd — the
  // repository under review, below — for every child and anything it execs.
  baseEnv.PATH = String(baseEnv.PATH || '')
    .split(delimiter)
    .filter((dir) => dir && isAbsolute(dir))
    .join(delimiter)
  baseEnv.GIT_NO_LAZY_FETCH = '1'

  try {
    process.chdir(repo)
  } catch {
    die(EXIT.usage, `error: cannot enter ${flat(repo)}`)
  }
  const cwd = realpathSync(process.cwd())
  process.chdir(cwd)

  const env = {
    cwd,
    baseEnv,
    repoRoot: null,
    bin: null,
    scratch: null,
    // `this`, not the closure, so a copy with another cwd (the review
    // snapshot) runs its git calls there.
    command(command, args, options = {}) {
      const result = spawnSync(command, args, {
        cwd: this.cwd,
        env: this.baseEnv,
        encoding: 'utf8',
        input: options.input,
        maxBuffer: 64 * 1024 * 1024,
        timeout: PREFLIGHT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      })
      if (result.error) return { status: 127, stdout: '', stderr: result.error.message }
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    git(args, options) {
      return this.command('git', args, options)
    },
  }

  // Review needs a work tree — its scopes are defined in git terms. Consult
  // and task do not: outside a repository they run with the directory alone.
  const workTree = env.git(['rev-parse', '--is-inside-work-tree'])
  if (workTree.status === 0 && workTree.stdout.trim() === 'true') {
    const top = env.git(['rev-parse', '--show-toplevel'])
    if (top.status !== 0 || !top.stdout.trim()) die(EXIT.usage, 'error: could not resolve the repository root')
    env.repoRoot = realpathSync(top.stdout.trim())
  } else if (requireWorkTree) {
    // Pass git's own reason through: "dubious ownership" and friends would
    // otherwise masquerade as "not a work tree".
    const detail = workTree.stderr.trim() ? ` (git: ${flat(workTree.stderr.trim())})` : ''
    die(EXIT.usage, `error: ${flat(repo)} is not a git work tree${detail}`)
  }

  resolveBin(env, provider.binary)
  resolveStorage(env)
  return env
}

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function findOnPath(path, name) {
  return String(path || '').split(delimiter)
    .filter((dir) => dir && isAbsolute(dir))
    .map((dir) => join(dir, name)).find(isExecutableFile) || null
}

// Whether resolveBin would find a binary to try: its variable is set (resolveBin
// still validates it) or it is on an absolute PATH entry. Used by `auto`.
export function binaryAvailable(binary) {
  return Boolean(process.env[binary.envVar]) || Boolean(findOnPath(process.env.PATH, binary.name))
}

function resolveBin(env, binary) {
  const raw = process.env[binary.envVar]
  const hint = `hint: use the output of \`command -v ${binary.name}\` from an interactive shell.`
  if (raw) {
    if (!isAbsolute(raw)) {
      die(EXIT.usage,
        `error: ${binary.envVar} (${flat(raw)}) must be an absolute path; this script runs from inside the repository under review, so a relative one would resolve against its content.`,
        hint)
    }
    if (!isExecutableFile(raw)) die(EXIT.usage, `error: ${binary.envVar} (${flat(raw)}) is not an executable file.`, hint)
    env.bin = raw
  } else {
    // spawn() would search the same absolute-only PATH, but resolving here
    // lets the `note:` line name the binary before anything runs.
    env.bin = findOnPath(env.baseEnv.PATH, binary.name)
    if (!env.bin) {
      die(EXIT.usage,
        `error: could not find '${binary.name}' on an absolute PATH entry.`,
        `hint: install it, or set ${binary.envVar} to its absolute path.`,
        `hint: if \`${binary.name}\` works in your terminal, it may be a shell function or alias, which non-interactive shells do not load; export ${binary.envVar} (and any environment the function sets, such as a proxy) where non-interactive shells see it.`)
    }
  }
  if (env.repoRoot && isInside(bestRealpath(env.bin), env.repoRoot)) {
    die(EXIT.usage,
      `error: the ${binary.name} binary (${flat(env.bin)}) resolves inside the repository under review, which could control it; refusing to execute it.`,
      `hint: use a ${binary.name} installed outside the repository.`)
  }
  process.stderr.write(`note: using ${binary.name} binary: ${flat(env.bin)}\n`)
}

// Only the wrapper's own artifacts are placed here; each CLI manages its own
// session storage untouched.
//
// KNOWN, ACCEPTED GAP — do not re-add a CODEX_HOME placement check. A CLI
// whose session store resolves inside the consulted repository drops a
// session file into the tree it is reading. Adjudicated 2026-08-14: loud,
// recoverable, needs an unusual configuration; the previous defence altered
// codex's own behaviour for everyone to protect that corner case.
function resolveStorage(env) {
  let scratch = bestRealpath(process.env.TMPDIR || tmpdir())
  if (env.repoRoot && isInside(scratch, env.repoRoot)) {
    process.stderr.write('note: TMPDIR is inside the repository; using /tmp instead\n')
    scratch = bestRealpath('/tmp')
    if (isInside(scratch, env.repoRoot)) die(EXIT.usage, 'error: no temporary directory outside the repository; set TMPDIR elsewhere')
  }
  try {
    accessSync(scratch, constants.R_OK | constants.W_OK | constants.X_OK)
  } catch {
    die(EXIT.usage, `error: cannot write scratch files under ${flat(scratch)}`)
  }
  env.baseEnv.TMPDIR = scratch
  env.scratch = scratch
}

export function createArtifacts(env, providerId, mode) {
  try {
    const dir = mkdtempSync(join(env.scratch, `peer-${providerId}-${mode}-`))
    const out = join(dir, 'result.md')
    const log = join(dir, 'events.jsonl')
    // Where a read-only run may put reproduction scripts and other scratch
    // files, so it has no reason to write into the repository.
    const scratch = join(dir, 'scratch')
    closeSync(openSync(out, 'wx', 0o600))
    closeSync(openSync(log, 'wx', 0o600))
    mkdirSync(scratch)
    process.stderr.write(`log: ${log}\n`)
    return { out, log, scratch }
  } catch {
    die(EXIT.usage, `error: cannot create scratch files under ${flat(env.scratch)}`)
  }
}

export function readText(path) {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}

const SIGNALS = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]

// The child currently running, at module scope so the entry point's
// uncaughtException net can kill the detached process group even without a
// reference into runProcess's scope.
let activeChild = null

export function terminateActiveChild(signal) {
  if (!activeChild?.pid) return
  try {
    process.kill(-activeChild.pid, signal)
  } catch {
    try { activeChild.kill(signal) } catch {}
  }
}

function clip(line, max) {
  return line.length > max ? `${line.slice(0, max)}...` : line
}

export function tailLog(log, prefix) {
  for (const line of readText(log).split(/\r?\n/).slice(-21).filter(Boolean)) {
    process.stderr.write(`${prefix}${clip(line, 180)}\n`)
  }
}

// Runs one child to completion. Every line goes to the log and to
// decoder.push(stream, line); whatever text push returns is echoed on stderr
// with the provider's prefix, so an unprefixed stderr line is always the
// wrapper's. Returns { status, spawnError, timedOut }; dies with 129/130/143
// when this process is signalled.
export async function runProcess(env, { args, stdin, timeoutSeconds, log, prefix, decoder }) {
  let logBroken = false
  const emitLine = (stream, line) => {
    const shown = decoder.push(stream, line)
    if (shown) process.stderr.write(`${prefix}${clip(shown, 200)}\n`)
    if (logBroken) return
    try {
      appendFileSync(log, `${line}\n`)
    } catch {
      logBroken = true
      process.stderr.write(`note: could not append to the progress log at ${log}; continuing without it\n`)
    }
  }
  // One buffer per stream, flushed whole lines at a time, so a stderr chunk
  // cannot splice itself into the middle of a stdout JSON event in the log.
  const buffers = new Map([['stdout', ''], ['stderr', '']])
  const archive = (stream) => (chunk) => {
    let pending = buffers.get(stream) + chunk
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      emitLine(stream, pending.slice(0, newline).replace(/\r$/, ''))
      pending = pending.slice(newline + 1)
    }
    buffers.set(stream, pending)
  }

  let timedOut = false
  let interruptedCode = null
  const handlers = new Map()
  for (const [signal, code] of SIGNALS) {
    const handler = () => {
      interruptedCode = code
      terminateActiveChild(signal)
      setTimeout(() => terminateActiveChild('SIGKILL'), 2000).unref()
      process.exitCode = code
    }
    handlers.set(signal, handler)
    process.once(signal, handler)
  }
  const cleanupHandlers = () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
  }

  let child
  try {
    child = spawn(env.bin, args, {
      cwd: env.cwd,
      env: env.baseEnv,
      detached: true,
      shell: false,
      // Without a prompt on stdin the child gets a closed stdin: a CLI that
      // waits on it would otherwise look busy forever in a background shell.
      stdio: [stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    cleanupHandlers()
    return { status: 127, spawnError: error.message, timedOut: false }
  }
  activeChild = child
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', archive('stdout'))
  child.stderr.on('data', archive('stderr'))
  if (stdin != null) {
    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  }

  let killTimer = null
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    terminateActiveChild('SIGTERM')
    killTimer = setTimeout(() => terminateActiveChild('SIGKILL'), 1000)
  }, timeoutSeconds * 1000)

  const result = await new Promise((resolvePromise) => {
    // spawn reports ENOENT/EACCES asynchronously; keep the reason, or the
    // failure surfaces as a bare failure with an empty log.
    child.once('error', (error) => resolvePromise({ status: 127, spawnError: error?.message }))
    child.once('close', (code, signal) => resolvePromise({ status: code ?? (signal ? 1 : 0) }))
  })
  clearTimeout(timeoutTimer)
  if (killTimer) clearTimeout(killTimer)
  for (const [stream, pending] of buffers) {
    if (pending) emitLine(stream, pending)
  }
  cleanupHandlers()
  // The direct child closing its pipes does not mean the detached group is
  // gone; finish the promised group-wide termination.
  if (timedOut || interruptedCode !== null) terminateActiveChild('SIGKILL')
  activeChild = null
  if (interruptedCode !== null) die(interruptedCode)
  return { ...result, timedOut }
}

// A wait that stays interruptible even with no child running. onReady runs
// once the signal handlers are installed, so a caller that announces the
// wait cannot be signalled in a window where nothing would catch it.
export async function interruptibleWait(delayMs, onReady = () => {}) {
  await new Promise((resolvePromise, reject) => {
    const handlers = new Map()
    const cleanup = () => {
      clearTimeout(timer)
      for (const [signal, handler] of handlers) process.removeListener(signal, handler)
    }
    const timer = setTimeout(() => { cleanup(); resolvePromise() }, delayMs)
    for (const [signal, code] of SIGNALS) {
      const handler = () => { cleanup(); reject(new ExitError(code)) }
      handlers.set(signal, handler)
      process.once(signal, handler)
    }
    onReady()
  })
}

// `body: begin` on stderr, then the body on stdout, then the caller's
// trailing markers. Each step waits for the previous write to flush: when
// both fds feed one merged pipe, an unflushed body would otherwise splice the
// markers into the model text. Genuine warning:/note: lines all precede
// `body: begin`; a warning-shaped line after it is model text.
export function emitBody(output) {
  const body = output.endsWith('\n') ? output : `${output}\n`
  return new Promise((resolvePromise) => {
    process.stderr.write('body: begin\n', () => {
      process.stdout.write(body, () => resolvePromise())
    })
  })
}
