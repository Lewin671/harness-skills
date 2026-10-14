// Process and environment layer for run-command-code-second-opinion.mjs:
// environment sanitization, storage placement, subprocess streaming with
// timeout/signal handling, and NDJSON result extraction. The entry point owns
// argument parsing, scope checks, prompt construction and exit mapping.

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
  writeFileSync,
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
    die(11, `error: ${source} must be a whole number of seconds between 1 and 86400, got '${flat(raw)}'`)
  }
  return Number(raw)
}

export function parseMaxTurns(value, source) {
  const raw = String(value)
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1) {
    die(11, `error: ${source} must be a positive whole number of turns, got '${flat(raw)}'`)
  }
  return Number(raw)
}

function isInside(candidate, root) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${'/'}`) && !isAbsolute(rel))
}

// realpath of the path, or of its nearest existing ancestor with the missing
// remainder appended lexically — enough to decide "would this land inside the
// repository?" for a path the CLI may be about to create.
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

// Preflight git probes get a fixed budget independent of --timeout, so a
// stalled probe cannot block the wrapper for the whole model budget before the
// caller even sees `running:`.
const PREFLIGHT_TIMEOUT_MS = 120000

export function createEnvironment(repo, { requireWorkTree = true } = {}) {
  const baseEnv = { ...process.env }
  // Redirection variables an outer git/node process may have exported; any of
  // them could point a child's reads or writes somewhere this run never
  // checked. NODE_* also covers the CLI itself, which ships as a node program.
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
  // A relative PATH entry resolves against this process's cwd — the repository
  // under review, below — for every child and for anything a child execs.
  baseEnv.PATH = String(baseEnv.PATH || '')
    .split(delimiter)
    .filter((dir) => dir && isAbsolute(dir))
    .join(delimiter)
  baseEnv.GIT_NO_LAZY_FETCH = '1'

  try {
    process.chdir(repo)
  } catch {
    die(11, `error: cannot enter ${flat(repo)}`)
  }
  const cwd = realpathSync(process.cwd())
  process.chdir(cwd)

  const env = {
    cwd,
    baseEnv,
    repoRoot: null,
    cmdBin: null,
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
  }

  // Review needs a work tree — its scopes are defined in git terms. Consult
  // does not: a question can stand on its own, so outside a repository it runs
  // with the directory alone and no repoRoot-based checks.
  const workTree = env.git(['rev-parse', '--is-inside-work-tree'])
  if (workTree.status === 0 && workTree.stdout.trim() === 'true') {
    const top = env.git(['rev-parse', '--show-toplevel'])
    if (top.status !== 0 || !top.stdout.trim()) die(11, 'error: could not resolve the repository root')
    env.repoRoot = realpathSync(top.stdout.trim())
  } else if (requireWorkTree) {
    // Pass git's own reason through: "dubious ownership" and friends would
    // otherwise masquerade as "not a work tree".
    const detail = workTree.stderr.trim() ? ` (git: ${flat(workTree.stderr.trim())})` : ''
    die(11, `error: ${flat(repo)} is not a git work tree${detail}`)
  }

  resolveCmdBin(env)
  resolveStorage(env)
  return env
}

function resolveCmdBin(env) {
  const raw = process.env.COMMAND_CODE_BIN
  if (raw) {
    if (!isAbsolute(raw)) {
      die(11,
        `error: COMMAND_CODE_BIN (${flat(raw)}) must be an absolute path; this script runs from inside the repository under review, so a relative one would resolve against its content.`,
        'hint: use the output of `command -v cmd` from an interactive shell.')
    }
    try {
      accessSync(raw, constants.X_OK)
      if (!statSync(raw).isFile()) throw new Error('not a file')
    } catch {
      die(11,
        `error: COMMAND_CODE_BIN (${flat(raw)}) is not an executable file.`,
        'hint: use the output of `command -v cmd` from an interactive shell.')
    }
    env.cmdBin = raw
  } else {
    // spawn() would search the same absolute-only PATH, but resolving here
    // lets the `note:` line name the binary before anything runs.
    for (const dir of env.baseEnv.PATH.split(delimiter)) {
      const candidate = join(dir, 'cmd')
      try {
        accessSync(candidate, constants.X_OK)
        if (statSync(candidate).isFile()) {
          env.cmdBin = candidate
          break
        }
      } catch {}
    }
    if (!env.cmdBin) {
      die(11,
        "error: could not find 'cmd' on an absolute PATH entry.",
        'hint: install Command Code, or set COMMAND_CODE_BIN to its absolute path.')
    }
  }
  if (env.repoRoot && isInside(bestRealpath(env.cmdBin), env.repoRoot)) {
    die(11,
      `error: the cmd binary (${flat(env.cmdBin)}) resolves inside the repository under review, which could control it; refusing to execute it.`,
      'hint: use a Command Code installation outside the repository.')
  }
  process.stderr.write(`note: using cmd binary: ${flat(env.cmdBin)}\n`)
}

function resolveStorage(env) {
  let scratch = bestRealpath(process.env.TMPDIR || tmpdir())
  if (env.repoRoot && isInside(scratch, env.repoRoot)) {
    // A note, not a warning: nothing about the result is in doubt. Warnings are
    // reserved for lines that qualify the answer, so the relay-every-warning
    // rule stays meaningful.
    process.stderr.write('note: TMPDIR is inside the repository; using /tmp instead\n')
    scratch = bestRealpath('/tmp')
    if (isInside(scratch, env.repoRoot)) {
      die(11, 'error: no temporary directory outside the repository; set TMPDIR elsewhere')
    }
  }
  try {
    accessSync(scratch, constants.R_OK | constants.W_OK | constants.X_OK)
  } catch {
    die(11, `error: cannot write scratch files under ${flat(scratch)}`)
  }
  env.baseEnv.TMPDIR = scratch
  env.scratch = scratch
}

export function createArtifacts(env, mode) {
  try {
    const dir = mkdtempSync(join(env.scratch, `cmd-${mode}-`))
    const out = join(dir, 'result.md')
    const log = join(dir, 'events.jsonl')
    closeSync(openSync(out, 'wx', 0o600))
    closeSync(openSync(log, 'wx', 0o600))
    process.stderr.write(`log: ${log}\n`)
    return { out, log }
  } catch {
    die(11, `error: cannot create scratch files under ${flat(env.scratch)}`)
  }
}

// The invocation carries no permission flag on purpose: the run inherits
// whatever permission mode the user has configured, and Command Code's print
// mode blocks mutating tools for the main loop on its own.
//
// KNOWN, DISCLOSED GAP — do not "fix" this by adding --yolo, --accept-edits or
// a permission-mode flag. Verified on cmd 1.82.1 (2026-10-14): that print-mode
// guard binds the MAIN LOOP only. The `agent` tool is an unconditional
// exception to the deny/ask/allow lists, and a sub-agent "auto-allows where the
// main loop would draw an interactive prompt", so a model that wants shell or a
// file write can delegate and get it — a headless run created a file this way.
// The run is therefore NOT a sandbox, and SKILL.md must not claim it is; the
// fingerprint guard in lib/identity.mjs is what makes the reviewed bytes
// identifiable afterwards, and drift is reported rather than prevented.
export function buildArgs(policy, mode) {
  const args = ['-p']
  if (policy.sessionId) args.push('--resume', policy.sessionId)
  args.push(
    '--output-format', 'json',
    // Interactive-only surfaces have no meaning in a one-shot run, and skipping
    // onboarding keeps an automated run from waiting on a first-run prompt.
    '--skip-onboarding',
    // Skill discovery is off so the reviewed repository's own skills cannot
    // steer a nominally blind pass.
    '--no-skills',
  )
  // A review never resumes and must not leave a resumable session behind, the
  // same reason the codex wrapper passes --ephemeral for reviews.
  if (mode === 'review') args.push('--no-session')
  if (policy.maxTurns) args.push('--max-turns', String(policy.maxTurns))
  // Only an explicit pair moves the run off the configured default model.
  if (policy.model && policy.effort) args.push('--model', policy.model, '--effort', policy.effort)
  return args
}

// Every line of CLI-controlled text echoed to stderr carries this prefix; no
// line this script writes about itself does. On stderr, an unprefixed line is
// the wrapper speaking.
const CHILD_LINE_PREFIX = 'cmd> '

// A blocked tool is not a failure — the CLI returns guidance and the turn
// continues — but it means part of the work was refused, which qualifies the
// result and is worth counting for the report.
function extractFrame(line, state) {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (frame?.type === 'event') {
    const event = frame.event
    if (!event || typeof event !== 'object') return
    // run_start names the session before any model work happens.
    if (typeof event.sessionId === 'string' && !state.sessionId) state.sessionId = event.sessionId
    if (typeof event.model === 'string' && (event.type === 'model_request_start' || event.type === 'model_request_end')) {
      state.model = event.model
    }
    if (event.type === 'tool_hook_blocked') state.blocked += 1
    return
  }
  if (frame?.type === 'result') {
    state.result = frame
    if (typeof frame.sessionId === 'string') state.sessionId = frame.sessionId
  }
}

// The CLI child currently running, at module scope so the entry point's
// uncaughtException net can kill the detached process group even without a
// reference into runCmd's scope.
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

export async function runCmd(env, invocation, options) {
  const { out, log, timeout, runNoun, resultNoun } = options
  // An empty prompt is a wrapper bug, and it would surface as the CLI's bare
  // "No query provided" on exit 1 — a message that points nowhere near here.
  if (!invocation.prompt.trim()) {
    die(11, `error: refusing to run the ${flat(runNoun)} with an empty prompt (wrapper bug, not a verdict on the code)`)
  }
  process.stderr.write(`${flat(invocation.diagnostic)}\n`)

  const discard = () => rmSync(out, { force: true })
  const tail = () => {
    for (const line of readLogFile(log).split(/\r?\n/).slice(-21).filter(Boolean)) {
      process.stderr.write(`${CHILD_LINE_PREFIX}${line.length > 180 ? `${line.slice(0, 180)}...` : line}\n`)
    }
  }

  let logBroken = false
  const state = { result: null, sessionId: '', model: '', blocked: 0 }
  const emitLine = (line) => {
    // Extract from the whole line, display a bounded slice: one NDJSON frame
    // can carry a whole conversation, and the terminal only needs the gist.
    extractFrame(line, state)
    process.stderr.write(`${CHILD_LINE_PREFIX}${line.length > 180 ? `${line.slice(0, 180)}...` : line}\n`)
    if (logBroken) return
    try {
      appendFileSync(log, `${line}\n`)
    } catch {
      logBroken = true
      process.stderr.write(`note: could not append to the progress log at ${log}; continuing without it\n`)
    }
  }
  // One buffer per stream, flushed whole lines at a time, so a stderr chunk
  // cannot splice itself into the middle of a stdout JSON frame in the log.
  const buffers = new Map([['stdout', ''], ['stderr', '']])
  const archive = (stream) => (chunk) => {
    let pending = buffers.get(stream) + chunk
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      emitLine(pending.slice(0, newline).replace(/\r$/, ''))
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
    child = spawn(env.cmdBin, invocation.args, {
      cwd: env.cwd,
      env: env.baseEnv,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    cleanupHandlers()
    discard()
    die(11, `error: could not start ${flat(env.cmdBin)}: ${flat(error.message)}`)
  }
  activeChild = child
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', archive('stdout'))
  child.stderr.on('data', archive('stderr'))
  // The prompt travels on stdin rather than argv: a scope diff can run to
  // megabytes, and a single oversized argv element fails at the OS limit while
  // a pipe has no such ceiling. `-p` with no query argument reads stdin.
  child.stdin.on('error', () => {})
  child.stdin.end(invocation.prompt)

  let killTimer = null
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    terminateActiveChild('SIGTERM')
    killTimer = setTimeout(() => terminateActiveChild('SIGKILL'), 1000)
  }, timeout * 1000)

  const result = await new Promise((resolvePromise) => {
    // spawn reports ENOENT/EACCES asynchronously; keep the reason, or the
    // failure surfaces as "cmd failed" with an empty log.
    child.once('error', (error) => resolvePromise({ status: 127, spawnError: error?.message }))
    child.once('close', (code, signal) => resolvePromise({ status: code ?? (signal ? 1 : 0) }))
  })
  clearTimeout(timeoutTimer)
  if (killTimer) clearTimeout(killTimer)
  for (const [stream, pending] of buffers) {
    if (pending) emitLine(pending)
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
    die(124)
  }

  const frame = state.result
  const finalText = typeof frame?.finalText === 'string' ? frame.finalText : ''
  // Usable means the CLI produced an answer: subtype `success`, or `max_turns`,
  // which returns a truncated-but-real response. A `result` frame with an empty
  // finalText, or no frame at all, is not a verdict on the code.
  const usable = finalText.trim() && (frame.subtype === 'success' || frame.subtype === 'max_turns')

  if (!usable) {
    if (result.status !== 0) {
      if (result.spawnError) {
        process.stderr.write(`error: could not start ${flat(env.cmdBin)}: ${flat(result.spawnError)}\n`)
      }
      if (typeof frame?.error === 'string' && frame.error.trim()) {
        process.stderr.write(`error: ${flat(frame.error.trim())}\n`)
      }
      process.stderr.write(`error: ${runNoun} failed (exit ${result.status}); raw output at ${log}\n`)
      hintsFor(result.status, frame, log)
    } else {
      process.stderr.write(`error: ${runNoun} produced no ${resultNoun} (subtype: ${flat(frame?.subtype) || 'none'}); raw output at ${log}\n`)
    }
    tail()
    discard()
    die(result.status === 0 ? 11 : result.status)
  }

  try {
    writeFileSync(out, finalText.endsWith('\n') ? finalText : `${finalText}\n`, { mode: 0o600 })
  } catch (error) {
    die(11, `error: could not write the ${resultNoun} file: ${flat(error.message)}`)
  }

  return {
    output: finalText,
    subtype: frame.subtype,
    exitStatus: result.status,
    sessionId: state.sessionId,
    model: state.model,
    usage: frame.usage,
    durationMs: frame.durationMs,
    blocked: state.blocked,
    discard,
    tail,
  }
}

// Exit codes are Command Code's own, passed through rather than replaced, so a
// caller can consult the CLI's documented table. Only 2 (empty scope), 11
// (wrapper refusal or no usable result), 124 (timeout) and 127 (the CLI could
// not be started) are the wrapper's; 129/130/143 also come from this process
// when it is signalled.
function hintsFor(code, frame, log) {
  const message = typeof frame?.error === 'string' ? frame.error : ''
  if (code === 3) {
    process.stderr.write('hint: not authenticated — run `cmd login`, then retry.\n')
  } else if (code === 4) {
    process.stderr.write('hint: a tool was refused by the permission engine; the run inherited your configured permission mode.\n')
  } else if (code === 5) {
    process.stderr.write('hint: rate limited; wait and rerun, or move to a less loaded model.\n')
  } else if (code === 10) {
    process.stderr.write('hint: insufficient credits for the selected model; the account needs a top-up or a cheaper model.\n')
  } else if (code === 6 || code === 7) {
    process.stderr.write('hint: a transport or upstream failure; rerunning unchanged is reasonable.\n')
  } else if (code === 127) {
    process.stderr.write('hint: the cmd binary could not be started — check `note: using cmd binary:` above and COMMAND_CODE_BIN.\n')
  }
  if (/No session .* found to resume/i.test(message)) {
    process.stderr.write('hint: the session to resume no longer exists; start a fresh consultation and restate the context.\n')
  }
  if (/Unknown config setting/i.test(message)) {
    process.stderr.write(`hint: the installed cmd rejected a setting this script passes (see ${log}); the CLI may have drifted from the flags in lib/runtime.mjs.\n`)
  }
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

export function usageNote(run) {
  const usage = run.usage || {}
  const parts = [
    `input=${flat(usage.inputTokens ?? 0)}`,
    `output=${flat(usage.outputTokens ?? 0)}`,
    `cacheRead=${flat(usage.cacheReadTokens ?? 0)}`,
  ]
  if (typeof run.durationMs === 'number') parts.push(`durationMs=${run.durationMs}`)
  if (run.blocked) parts.push(`blockedTools=${run.blocked}`)
  return `usage: ${parts.join(' ')}\n`
}
