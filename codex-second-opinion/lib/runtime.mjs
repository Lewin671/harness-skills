import { appendFileSync, readFileSync, rmSync, statSync, truncateSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { die, flat, hasLineBreak, shellQuote } from './util.mjs'

export const ATTEMPT_MARKER = '=== codex-second-opinion attempt boundary ==='

// Phrases that only ever describe a rejected model or reasoning tier.
const REJECTED_MODEL_PATTERN = /reasoning[._]effort|unsupported_value|unknown model|model_not_found/i
// "is not supported" on its own is not one of them: it is ordinary English
// that a top-level error about an unsupported request feature, provider
// capability, or account tier can carry just as easily. Treating any of those
// as a stale pinned model spent a second full invocation and then attributed
// the answer to "your configured model" in a note that was simply wrong. It
// now only counts when the same message also names what this script would be
// falling back over.
const MODEL_CONTEXT_PATTERN = /\bmodels?\b|reasoning[._]effort|\beffort\b/i
const UNSUPPORTED_PATTERN = /is not supported|not supported when/i

function namesRejectedModel(message) {
  if (REJECTED_MODEL_PATTERN.test(message)) return true
  return UNSUPPORTED_PATTERN.test(message) && MODEL_CONTEXT_PATTERN.test(message)
}

export function createState(mode) {
  const envModel = process.env.CODEX_SECOND_OPINION_MODEL || ''
  const envEffort = process.env.CODEX_SECOND_OPINION_EFFORT || ''
  return {
    mode,
    runNoun: mode === 'review' ? 'review' : 'consultation',
    resultNoun: mode === 'review' ? 'report' : 'answer',
    defaultModel: envModel || 'gpt-5.6-sol',
    defaultEffort: envEffort || 'high',
    envModelSet: Boolean(envModel),
    envEffortSet: Boolean(envEffort),
    model: envModel || 'gpt-5.6-sol',
    effort: envEffort || 'high',
    pinned: true,
    modelSet: 0,
    effortSet: 0,
    inheritSet: 0,
    usedFallback: false,
    allowMcp: false,
    repo: '.',
    timeout: null,
    sessionId: '',
  }
}

export function validateModelState(state) {
  if (hasLineBreak(state.model) || hasLineBreak(state.effort)) {
    die(3, 'error: the model and effort must not contain line breaks')
  }
  if (state.envModelSet !== state.envEffortSet) {
    die(3,
      'error: CODEX_SECOND_OPINION_MODEL and CODEX_SECOND_OPINION_EFFORT must be set together.',
      "hint: the pair replaces the pinned defaults wholesale; setting one half pairs your value with this script's other half, which is the combination the --model/--effort rules exist to refuse.",
      "hint: set both, or unset both and pass '--model M --effort L' for a single run.")
  }
  if (state.modelSet > 1 || state.effortSet > 1 || state.inheritSet > 1) {
    die(3,
      'error: --model, --effort, and --inherit may each be given only once.',
      'hint: repeating one makes the effective setting depend on flag order.')
  }
  if (state.inheritSet && (state.modelSet || state.effortSet)) {
    die(3,
      'error: --inherit cannot be combined with --model or --effort.',
      "hint: pick one — no flags for the pinned defaults, '--model M --effort L' for an explicit pair, or --inherit for your codex config.")
  }
  if (state.modelSet && !state.effortSet) {
    die(3,
      'error: --model needs an explicit --effort.',
      `hint: the pinned default effort ('${state.defaultEffort}') is not a tier every model accepts, and naming a model already turns off the automatic fallback that would rescue the run.`)
  }
  if (state.effortSet && !state.modelSet) {
    die(3,
      'error: --effort needs an explicit --model.',
      'hint: naming an effort turns off the automatic fallback that rescues a stale pinned model, so the model has to be named too.')
  }
}

function lastAttempt(log) {
  const index = log.lastIndexOf(`${ATTEMPT_MARKER}\n`)
  return index < 0 ? log : log.slice(index + ATTEMPT_MARKER.length + 1)
}

function jsonEvents(log) {
  const events = []
  for (const line of lastAttempt(log).split(/\r?\n/)) {
    try { events.push(JSON.parse(line)) } catch {}
  }
  return events
}

// A successful --json run should always yield at least one typed event
// (thread.started, at minimum); zero across the whole log usually means
// codex's JSONL event format drifted, not that nothing happened.
export function hasRecognizedEvent(log) {
  return jsonEvents(log).some((event) => typeof event?.type === 'string')
}

export function effectiveModel(log) {
  let model = ''
  for (const event of jsonEvents(log)) {
    if (typeof event?.model === 'string') model = event.model
  }
  return model
}

export function lastThreadId(log) {
  let id = ''
  for (const event of jsonEvents(log)) {
    if (event?.type === 'thread.started' && typeof event.thread_id === 'string') id = event.thread_id
  }
  return id
}

// hasRecognizedEvent alone cannot catch a schema change that keeps `type`
// strings intact but renames or moves `thread_id`: a run with only
// item.started/item.completed events, and no thread.started at all, is
// already an anticipated, legitimate shape (see consult.md's "no session"
// case) -- but a thread.started event that carries no readable thread_id is
// not, and emitResume (lib/consult.mjs) uses this to tell the two apart
// before deciding whether a resumed session "expired" or the parser did.
export function hasThreadStartedEvent(log) {
  return jsonEvents(log).some((event) => event?.type === 'thread.started')
}

// The codex child of whichever Runtime currently has one running. Module
// scope rather than an instance field because the entry point's
// uncaughtException/unhandledRejection net has no reference to the Runtime,
// and a detached process group with nobody left to signal it is precisely
// what that net exists to prevent.
let activeChild = null

export function terminateActiveChild(signal) {
  if (!activeChild?.pid) return
  try { process.kill(-activeChild.pid, signal) } catch {
    try { activeChild.kill(signal) } catch {}
  }
}

export class Runtime {
  constructor(state, environment, artifacts) {
    this.state = state
    this.environment = environment
    this.out = artifacts.out
    this.outDir = artifacts.outDir
    this.log = artifacts.log
    this.currentChild = null
    this.timedOut = false
    this.interruptedCode = null
    this.signalHandlers = new Map()
  }

  // An accessor pair rather than a plain field, so every existing assignment
  // site keeps the module-level `activeChild` in step without any of them
  // having to remember to. Missing one would be silent: the process group
  // would simply survive a crash.
  get currentChild() { return this.child }

  set currentChild(child) {
    this.child = child
    activeChild = child
  }

  safetyArgs(model, effort) {
    const args = [
      '-c', 'sandbox_mode="read-only"',
      '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins',
      '-c', 'notify=[]',
      '--strict-config',
      ...this.environment.mcpArgs,
      '--json',
    ]
    if (model) args.push('-m', model)
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`)
    args.push('-o', this.out)
    return args
  }

  installSignalHandlers() {
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
      const handler = () => {
        this.interruptedCode = code
        // Forward the signal that actually arrived, rather than rewriting all
        // three to TERM. A child can and does distinguish them -- INT is the
        // interactive interrupt, HUP says the terminal went away, TERM is a
        // plain request to stop -- and codex may well run different cleanup
        // for each. Sending TERM for an INT also made internals.md's word
        // "forwarded" untrue. KILL still follows if the group ignores it.
        this.terminateChild(signal)
        setTimeout(() => this.terminateChild('SIGKILL'), 2000).unref()
        process.exitCode = code
      }
      this.signalHandlers.set(signal, handler)
      process.once(signal, handler)
    }
  }

  removeSignalHandlers() {
    for (const [signal, handler] of this.signalHandlers) process.removeListener(signal, handler)
    this.signalHandlers.clear()
  }

  terminateChild(signal) {
    const child = this.currentChild
    if (!child?.pid) return
    try { process.kill(-child.pid, signal) } catch {
      try { child.kill(signal) } catch {}
    }
  }

  async execute(command, args, diagnostic) {
    process.stderr.write(`${flat(diagnostic)}\n`)
    appendFileSync(this.log, `${ATTEMPT_MARKER}\n`)
    // One buffer PER STREAM, not one shared by both. stdout carries the JSONL
    // event stream; stderr carries codex's own free text. Sharing a single
    // buffer meant a stderr chunk arriving between two halves of a split
    // stdout event spliced itself into the middle of that JSON line, so the
    // line no longer parsed and the event vanished -- silently, because
    // hasRecognizedEvent is satisfied by any other well-formed event in the
    // log. The events lost that way are exactly the ones this script draws
    // conclusions from: model rejection, session id, model attribution.
    const buffers = new Map([['stdout', ''], ['stderr', '']])
    // A failed write here used to throw straight out of an EventEmitter
    // callback -- outside the promise below and outside the entry point's
    // try/catch -- so Node printed a raw stack trace, exited 1 (a code this
    // skill does not document), and left the DETACHED codex process group
    // running with nothing left to reap it. Reproduced by pointing the log at
    // an unwritable path. It is now recorded, the child is torn down, and the
    // run ends through the ordinary refusal path.
    let archiveError = null
    const archive = (stream) => (chunk) => {
      if (archiveError) return
      try {
        appendFileSync(this.log, chunk)
        let pending = buffers.get(stream) + chunk
        for (;;) {
          const newline = pending.indexOf('\n')
          if (newline < 0) break
          const line = pending.slice(0, newline).replace(/\r$/, '')
          pending = pending.slice(newline + 1)
          process.stderr.write(`${line.length > 180 ? `${line.slice(0, 180)}...` : line}\n`)
        }
        buffers.set(stream, pending)
      } catch (error) {
        archiveError = error
        this.terminateChild('SIGTERM')
      }
    }

    this.timedOut = false
    this.interruptedCode = null
    this.installSignalHandlers()
    let child
    try {
      child = spawn(command, args, {
        cwd: this.environment.cwd,
        env: this.environment.baseEnv,
        detached: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        // command is codexBin, already resolved to a safe, dereferenced
        // path (Environment.resolveCodexBin); argv0 keeps the identity a
        // symlink-dispatching or multicall install may still expect to see
        // itself invoked under -- see Environment.codexArgv0.
        argv0: this.environment.codexArgv0,
      })
    } catch (error) {
      this.removeSignalHandlers()
      return { status: 127, error }
    }
    this.currentChild = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', archive('stdout'))
    child.stderr.on('data', archive('stderr'))

    let timeoutTimer = null
    let killTimer = null
    if (this.state.timeout > 0) {
      timeoutTimer = setTimeout(() => {
        this.timedOut = true
        this.terminateChild('SIGTERM')
        killTimer = setTimeout(() => this.terminateChild('SIGKILL'), 1000)
      }, this.state.timeout * 1000)
    }

    const result = await new Promise((resolve) => {
      child.once('error', (error) => resolve({ status: 127, error }))
      child.once('close', (code, signal) => resolve({ status: code ?? (signal ? 1 : 0), signal }))
    })
    if (timeoutTimer) clearTimeout(timeoutTimer)
    if (killTimer) {
      clearTimeout(killTimer)
      // The Codex parent may exit on TERM while a detached descendant closes
      // the pipes and stays alive. The process group still exists under the
      // original pgid, so finish the promised group-wide termination before
      // returning even though the direct child has already closed.
      if (this.timedOut || this.interruptedCode !== null) this.terminateChild('SIGKILL')
    }
    for (const pending of buffers.values()) {
      if (pending) process.stderr.write(`${pending.length > 180 ? `${pending.slice(0, 180)}...` : pending}\n`)
    }
    this.removeSignalHandlers()
    if (this.interruptedCode !== null) {
      this.terminateChild('SIGKILL')
      this.currentChild = null
      die(this.interruptedCode)
    }
    if (archiveError) {
      // Before currentChild is cleared, so the group-wide kill still has a
      // pid to aim at: the direct child closing its pipes does not mean the
      // commands codex spawned are gone.
      this.terminateChild('SIGKILL')
      this.currentChild = null
      this.discardResult()
      die(4,
        `error: could not write the progress log at ${this.log} (${flat(archiveError.message)}).`,
        `error: the ${this.state.runNoun} was stopped, because a log this script cannot append to can no longer be trusted to hold the attempt it reports on.`,
        'hint: check free space and that TMPDIR still exists, then rerun.')
    }
    this.currentChild = null
    return result
  }

  // Removes the result file AND the private directory holding it. Exit 4 and
  // exit 5 both mean no usable result exists, and leaving the mkdtemp
  // directory behind littered TMPDIR with an empty `codex-<mode>-*` per
  // failed run. The log directory is deliberately not touched: the log is the
  // artifact those exits tell the caller to go read.
  discardResult() {
    rmSync(this.out, { force: true })
    if (this.outDir) rmSync(this.outDir, { recursive: true, force: true })
  }

  readLog() {
    try { return readFileSync(this.log, 'utf8') } catch { return '' }
  }

  tailLog() {
    const lines = this.readLog().split(/\r?\n/).slice(-21).filter((line) => line !== '')
    for (const line of lines) process.stderr.write(`${line.length > 180 ? `${line.slice(0, 180)}...` : line}\n`)
  }

  rejectedModel() {
    // Only top-level `error`/`turn.failed` events count: a command_execution
    // item can legitimately echo a reviewed file's own error-handling text
    // (a raised "X is not supported" message, say), and that text must not
    // be mistaken for Codex rejecting the model.
    for (const event of jsonEvents(this.readLog())) {
      if (event?.type !== 'error' && event?.type !== 'turn.failed') continue
      const messages = [event.message, event.error?.message].filter((value) => typeof value === 'string')
      if (messages.some(namesRejectedModel)) return true
    }
    return false
  }

  strictConfigHint() {
    if (!this.readLog().includes('unknown configuration field')) return
    process.stderr.write('hint: codex rejected an unrecognized configuration field. --strict-config is deliberate: it stops a renamed config key from silently disabling the read-only sandbox.\n')
    process.stderr.write("hint: the error line names the field. A key this script sets — sandbox_mode, notify, model_reasoning_effort, or an mcp_servers.<id>.enabled override — means the codex CLI drifted and the safety keys need updating; any other field is your own config.toml.\n")
  }

  timeoutExit() {
    process.stderr.write(`error: ${this.state.runNoun} exceeded ${this.state.timeout}s and was terminated\n`)
    process.stderr.write(`hint: raise --timeout, or check the log for where it stalled: ${this.log}\n`)
    this.tailLog()
    this.discardResult()
    die(5)
  }

  async runWithFallback(buildCommand, blockRetry = () => false) {
    let invocation = buildCommand(this.state.model, this.state.effort)
    let result = await this.execute(invocation.command, invocation.args, invocation.diagnostic)
    if (this.timedOut) this.timeoutExit()

    if (result.status !== 0) {
      const rejected = this.rejectedModel()
      if (rejected && blockRetry()) {
        this.strictConfigHint()
        this.tailLog()
        this.discardResult()
        die(4)
      }
      if (this.state.pinned && rejected) {
        if (this.state.envModelSet) {
          process.stderr.write(`warning: '${this.state.model}' at effort '${this.state.effort}' was rejected — that pair came from CODEX_SECOND_OPINION_MODEL/_EFFORT, not from this script.\n`)
        } else {
          process.stderr.write(`warning: '${this.state.model}' at effort '${this.state.effort}' was rejected — these pinned defaults look stale.\n`)
        }
        process.stderr.write('warning: retrying once with the model and effort from your codex config.\n')
        truncateSync(this.out, 0)
        invocation = buildCommand('', '')
        result = await this.execute(invocation.command, invocation.args, invocation.diagnostic)
        if (this.timedOut) this.timeoutExit()
        if (result.status !== 0) {
          process.stderr.write(`error: codex ${this.state.runNoun} failed on both the pinned defaults and your config; raw output at ${this.log}\n`)
          this.strictConfigHint()
          this.tailLog()
          this.discardResult()
          die(4)
        }
        this.state.usedFallback = true
        const model = effectiveModel(this.readLog())
        process.stderr.write(`note: the ${this.state.resultNoun} below came from your configured model${model ? ` (${model})` : ''}, not '${this.state.model}'.\n`)
      } else {
        process.stderr.write(`error: codex ${this.state.runNoun} failed; raw output at ${this.log}\n`)
        this.strictConfigHint()
        this.tailLog()
        this.discardResult()
        die(4)
      }
    }

    let output = ''
    try { output = readFileSync(this.out, 'utf8') } catch {}
    if (!output.trim()) {
      process.stderr.write(`error: codex produced no ${this.state.resultNoun}; raw output at ${this.log}\n`)
      this.tailLog()
      this.discardResult()
      die(4)
    }
    let logSize = -1
    try { logSize = statSync(this.log).size } catch {}
    if (logSize <= 0) {
      process.stderr.write(`warning: progress log ${this.log} is missing or empty; session and diagnostic details may be lost\n`)
    } else if (!hasRecognizedEvent(this.readLog())) {
      process.stderr.write(`warning: codex's --json event stream at ${this.log} has no line this script recognizes as a JSON event.\n`)
      process.stderr.write('warning: this usually means the installed codex-cli changed its event format; model/session metadata reported below may be silently wrong -- recheck references/internals.md against the version in use.\n')
    }
    if (!this.state.model) {
      const model = effectiveModel(this.readLog())
      if (model) process.stderr.write(`note: inherited model in effect: ${model}\n`)
      else process.stderr.write('note: the model was inherited from your codex config; the event stream did not name it, so report it as inherited rather than naming a tier\n')
    }
  }

  emitResult() {
    const output = readFileSync(this.out, 'utf8')
    process.stdout.write(output)
    if (!output.endsWith('\n')) process.stdout.write('\n')
    process.stderr.write(`${this.state.resultNoun}: ${this.out}\n`)
    process.stderr.write(`log: ${this.log}\n`)
  }
}

export function commonOption(state, args, index) {
  const option = args[index]
  const value = args[index + 1]
  switch (option) {
    case '--model':
      if (value === undefined || value === '') die(3, "error: --model needs a non-empty value (use --inherit for your config's model)")
      state.model = value; state.pinned = false; state.modelSet += 1; return index + 2
    case '--effort':
      if (value === undefined || value === '') die(3, 'error: --effort needs a non-empty value')
      state.effort = value; state.pinned = false; state.effortSet += 1; return index + 2
    case '--inherit':
      state.model = ''; state.effort = ''; state.pinned = false; state.inheritSet += 1; return index + 1
    case '--allow-mcp':
      state.allowMcp = true; return index + 1
    case '--repo':
      if (value === undefined) die(3, 'error: --repo needs a value')
      state.repo = value; return index + 2
    default:
      return null
  }
}

export function resumeFlags(state) {
  if (state.usedFallback || !state.model) return ' --inherit'
  return ` --model ${shellQuote(state.model)} --effort ${shellQuote(state.effort)}`
}
