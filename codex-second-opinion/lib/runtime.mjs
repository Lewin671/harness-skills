// Process and environment layer for run-codex-second-opinion.mjs:
// environment sanitization, storage placement, the MCP switch-off and its
// confirmation, subprocess streaming with timeout/signal handling, and
// JSONL session parsing. The entry point owns argument parsing, scope
// checks, prompt construction and exit mapping.

import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

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

export function parseTimeout(value, source) {
  const raw = String(value)
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 86400) {
    die(3, `error: ${source} must be a whole number of seconds between 1 and 86400, got '${flat(raw)}'`)
  }
  return Number(raw)
}

function isInside(candidate, root) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${'/'}`) && !isAbsolute(rel))
}

// realpath of the path, or of its nearest existing ancestor with the missing
// remainder appended lexically — enough to decide "would this land inside the
// repository?" for a path codex may be about to create.
function bestRealpath(path) {
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

// Preflight probes (git, `codex mcp list`) get a fixed budget independent of
// --timeout, so a stalled probe cannot block the wrapper for the whole model
// budget before the caller even sees `running:`.
const PREFLIGHT_TIMEOUT_MS = 120000

export function createEnvironment(repo, { requireWorkTree = true } = {}) {
  const baseEnv = { ...process.env }
  // Redirection variables an outer git/node process may have exported; any of
  // them could point a child's reads or writes somewhere this run never
  // checked. NODE_* also covers codex itself, which ships as a node script.
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
  // repository under review, below — for every child and for anything a
  // child execs in turn (codex is an env-shebang node script).
  baseEnv.PATH = String(baseEnv.PATH || '')
    .split(delimiter)
    .filter((dir) => dir && isAbsolute(dir))
    .join(delimiter)
  baseEnv.GIT_NO_LAZY_FETCH = '1'

  try {
    process.chdir(repo)
  } catch {
    die(3, `error: cannot enter ${flat(repo)}`)
  }
  const cwd = realpathSync(process.cwd())
  process.chdir(cwd)

  const env = {
    cwd,
    baseEnv,
    repoRoot: null,
    codexBin: null,
    scratch: null,
    command(command, args, options = {}) {
      const result = spawnSync(command, args, {
        cwd,
        env: baseEnv,
        encoding: 'utf8',
        input: options.input,
        maxBuffer: 64 * 1024 * 1024,
        timeout: PREFLIGHT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      })
      if (result.error) return { status: 127, stdout: '', stderr: result.error.message }
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    git(args) {
      return this.command('git', args)
    },
    codex(args) {
      return this.command(this.codexBin, args)
    },
  }

  // Review needs a work tree — its scopes are defined in git terms. Consult
  // does not: a question can stand on its own, so outside a repository it
  // simply runs with the directory (and no repoRoot-based checks).
  const workTree = env.git(['rev-parse', '--is-inside-work-tree'])
  if (workTree.status === 0 && workTree.stdout.trim() === 'true') {
    const top = env.git(['rev-parse', '--show-toplevel'])
    if (top.status !== 0 || !top.stdout.trim()) die(3, 'error: could not resolve the repository root')
    env.repoRoot = realpathSync(top.stdout.trim())
  } else if (requireWorkTree) {
    die(3, `error: ${flat(repo)} is not a git work tree`)
  }

  resolveCodexBin(env)
  resolveStorage(env)
  return env
}

function resolveCodexBin(env) {
  const raw = process.env.CODEX_BIN
  if (raw) {
    if (!isAbsolute(raw)) {
      die(3,
        `error: CODEX_BIN (${flat(raw)}) must be an absolute path; this script runs from inside the repository under review, so a relative one would resolve against its content.`,
        'hint: use the output of `command -v codex` from an interactive shell.')
    }
    env.codexBin = raw
  } else {
    // spawn() would search the same absolute-only PATH, but resolving here
    // lets the `note:` line name the binary before anything runs.
    for (const dir of env.baseEnv.PATH.split(delimiter)) {
      const candidate = join(dir, 'codex')
      try {
        accessSync(candidate, constants.X_OK)
        if (statSync(candidate).isFile()) {
          env.codexBin = candidate
          break
        }
      } catch {}
    }
    if (!env.codexBin) {
      die(3,
        "error: could not find 'codex' on an absolute PATH entry.",
        'hint: install the codex CLI, or set CODEX_BIN to its absolute path.')
    }
  }
  if (env.repoRoot && isInside(bestRealpath(env.codexBin), env.repoRoot)) {
    die(3,
      `error: the codex binary (${flat(env.codexBin)}) resolves inside the repository under review, which could control it; refusing to execute it.`,
      'hint: use a codex installed outside the repository.')
  }
  process.stderr.write(`note: using codex binary: ${flat(env.codexBin)}\n`)
}

// Only the wrapper's own artifacts are placed here; codex manages its own
// session storage (CODEX_HOME) untouched.
//
// KNOWN, ACCEPTED GAP — do not re-add a CODEX_HOME placement check here.
// Codex writes a session file under CODEX_HOME/sessions on every consult
// (review passes --ephemeral and writes none). If that store resolves
// inside the consulted repository — a project-local `export CODEX_HOME`,
// a ~/.codex symlinked into a repo, or a home directory that is itself a
// git repository — the consult drops a session file into the tree it is
// reading: visible as an untracked file, polluting the next --uncommitted
// scope, and a disclosure risk if committed. The maintainer reviewed this
// on 2026-08-14 and accepted it: the failure is loud and recoverable, the
// trigger requires an unusual configuration, and the previous defence
// (symlink-resolving placement checks plus injecting a resolved CODEX_HOME
// into the child environment) altered codex's own behaviour for everyone
// to protect that corner case.
function resolveStorage(env) {
  let scratch = bestRealpath(process.env.TMPDIR || tmpdir())
  if (env.repoRoot && isInside(scratch, env.repoRoot)) {
    process.stderr.write('warning: TMPDIR is inside the repository; using /tmp instead\n')
    scratch = bestRealpath('/tmp')
    if (isInside(scratch, env.repoRoot)) die(3, 'error: no temporary directory outside the repository; set TMPDIR elsewhere')
  }
  try {
    accessSync(scratch, constants.R_OK | constants.W_OK | constants.X_OK)
  } catch {
    die(3, `error: cannot write scratch files under ${flat(scratch)}`)
  }
  env.baseEnv.TMPDIR = scratch
  env.scratch = scratch
}

export function createArtifacts(env, mode) {
  try {
    const dir = mkdtempSync(join(env.scratch, `codex-${mode}-`))
    const out = join(dir, 'result.md')
    const log = join(dir, 'events.jsonl')
    closeSync(openSync(out, 'wx', 0o600))
    closeSync(openSync(log, 'wx', 0o600))
    process.stderr.write(`log: ${log}\n`)
    return { out, log }
  } catch {
    die(3, `error: cannot create scratch files under ${flat(env.scratch)}`)
  }
}

// KNOWN, ACCEPTED GAP — do not re-add MCP switch-off here. Codex runs with
// whatever standalone MCP servers the user's own configuration enables, and
// such tools can mutate external systems from inside an otherwise read-only
// run. An earlier version disabled every enabled server per run and
// confirmed the switch-off with a second listing; the maintainer removed
// that on 2026-08-14 as a deliberate decision: the servers come from the
// user's own config — enabling one there is the authorization to use it —
// and the per-run disable cost two preflight invocations to protect against
// a choice the user already made. Treat "MCP tools may mutate external
// systems" findings against this file as adjudicated.
export function safetyArgs(mode, policy, out) {
  return [
    '-c', 'sandbox_mode="read-only"',
    '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins',
    '-c', 'notify=[]',
    // Turns a renamed or unrecognized config key into a hard failure instead
    // of a silently ignored safety setting.
    '--strict-config',
    // Review never resumes a session, so it does not persist one. An older
    // codex that rejects --ephemeral fails the run (exit 4).
    ...(mode === 'review' ? ['--ephemeral'] : []),
    '--json',
    '-m', policy.model,
    '-c', `model_reasoning_effort="${policy.effort}"`,
    '-o', out,
  ]
}

// Every line of codex-controlled text echoed to stderr carries this prefix;
// no line this script writes about itself does. On stderr, an unprefixed
// line is the wrapper speaking.
const CHILD_LINE_PREFIX = 'codex> '

// The codex child currently running, at module scope so the entry point's
// uncaughtException net can kill the detached process group even without a
// reference into runCodex's scope.
let activeChild = null

export function terminateActiveChild(signal) {
  if (!activeChild?.pid) return
  try {
    process.kill(-activeChild.pid, signal)
  } catch {
    try { activeChild.kill(signal) } catch {}
  }
}

function readLogFile(log) {
  try { return readFileSync(log, 'utf8') } catch { return '' }
}

export function lastThreadId(events) {
  let id = ''
  for (const line of events.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line)
      if (event?.type === 'thread.started' && typeof event.thread_id === 'string') id = event.thread_id
    } catch {}
  }
  return id
}

// Runs codex to completion. Returns { output, events, discard, tail } on
// success; dies with 4 (failed), 5 (timed out) or 129/130/143 (signalled)
// otherwise, discarding the result file but keeping the event log.
export async function runCodex(env, invocation, options) {
  const { out, log, timeout, runNoun, resultNoun } = options
  process.stderr.write(`${flat(invocation.diagnostic)}\n`)

  const discard = () => rmSync(out, { force: true })
  const tail = () => {
    for (const line of readLogFile(log).split(/\r?\n/).slice(-21).filter(Boolean)) {
      process.stderr.write(`${CHILD_LINE_PREFIX}${line.length > 180 ? `${line.slice(0, 180)}...` : line}\n`)
    }
  }

  let logBroken = false
  let stdoutEvents = ''
  const emitLine = (stream, line) => {
    process.stderr.write(`${CHILD_LINE_PREFIX}${line.length > 180 ? `${line.slice(0, 180)}...` : line}\n`)
    if (stream === 'stdout') stdoutEvents += `${line}\n`
    if (logBroken) return
    try {
      appendFileSync(log, `${line}\n`)
    } catch {
      logBroken = true
      process.stderr.write(`warning: could not append to the progress log at ${log}; continuing without it\n`)
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
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
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
    child = spawn(env.codexBin, invocation.args, {
      cwd: env.cwd,
      env: env.baseEnv,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    cleanupHandlers()
    discard()
    die(4, `error: could not start ${flat(env.codexBin)}: ${flat(error.message)}`)
  }
  activeChild = child
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', archive('stdout'))
  child.stderr.on('data', archive('stderr'))

  let killTimer = null
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    terminateActiveChild('SIGTERM')
    killTimer = setTimeout(() => terminateActiveChild('SIGKILL'), 1000)
  }, timeout * 1000)

  const result = await new Promise((resolvePromise) => {
    child.once('error', () => resolvePromise({ status: 127 }))
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

  if (interruptedCode !== null) {
    discard()
    die(interruptedCode)
  }
  if (timedOut) {
    process.stderr.write(`error: ${runNoun} exceeded ${timeout}s and was terminated\n`)
    process.stderr.write(`hint: raise --timeout, or check the log for where it stalled: ${log}\n`)
    tail()
    discard()
    die(5)
  }
  if (result.status !== 0) {
    process.stderr.write(`error: codex ${runNoun} failed; raw output at ${log}\n`)
    if (readLogFile(log).includes('unknown configuration field')) {
      process.stderr.write('hint: codex rejected a configuration key this script sets (--strict-config is deliberate); the installed codex CLI may have drifted from the keys in lib/runtime.mjs.\n')
    }
    tail()
    discard()
    die(4)
  }
  let output = ''
  try {
    output = readFileSync(out, 'utf8')
  } catch {}
  if (!output.trim()) {
    process.stderr.write(`error: codex produced no ${resultNoun}; raw output at ${log}\n`)
    tail()
    discard()
    die(4)
  }
  return { output, events: stdoutEvents, discard, tail }
}

export function emitResult(run, artifacts, resultNoun) {
  const body = run.output.endsWith('\n') ? run.output : `${run.output}\n`
  // The trailing markers wait for stdout to flush: when both fds feed one
  // merged pipe, a body larger than the pipe buffer would otherwise still be
  // queued when the stderr markers land, splicing them into the model text.
  return new Promise((resolvePromise) => {
    process.stdout.write(body, () => {
      process.stderr.write(`${resultNoun}: ${artifacts.out}\n`)
      process.stderr.write(`log: ${artifacts.log}\n`)
      resolvePromise()
    })
  })
}
