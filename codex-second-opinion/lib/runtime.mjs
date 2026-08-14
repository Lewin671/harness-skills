import { appendFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { assertVerifiedLaunchPlan } from './capability-profile.mjs'
import { die, flat } from './util.mjs'

// Every line of codex-controlled text this script echoes to stderr carries
// this prefix; no line this script writes about itself ever does. Positional
// rules cannot separate the two -- the streamed event feed is interleaved
// with the wrapper's own `warning:`/`note:`/`hint:` lines throughout the run
// (an event-schema warning, a drift warning and a timeout hint are all emitted
// after `running:`), and a codex event can
// carry text that looks exactly like any of them. Prefixing the echoed side
// makes the distinction mechanical instead: on stderr, an unprefixed line is
// the wrapper speaking.
export const CHILD_LINE_PREFIX = 'codex> '

function streamChildLine(line) {
  const text = line.length > 180 ? `${line.slice(0, 180)}...` : line
  process.stderr.write(`${CHILD_LINE_PREFIX}${text}\n`)
}

function jsonEvents(log) {
  const events = []
  for (const line of log.split(/\r?\n/)) {
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
  constructor(launchPlan, environment, artifacts) {
    assertVerifiedLaunchPlan(launchPlan)
    this.plan = launchPlan
    this.state = launchPlan.policy
    this.environment = environment
    this.out = artifacts.out
    this.outDir = artifacts.outDir
    this.log = artifacts.log
    this.currentChild = null
    this.timedOut = false
    this.interruptedCode = null
    this.signalHandlers = new Map()
    this.stdoutEventBuffer = ''
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

  safetyArgs() {
    const selection = this.state.modelSelection
    const args = [
      '-c', 'sandbox_mode="read-only"',
      '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins',
      '-c', 'notify=[]',
      '--strict-config',
      // Removes a write channel instead of checking where it points. Codex
      // writes this run's transcript under CODEX_HOME/sessions on every
      // ordinary invocation, which is why resolveScratchAndCodexHome refuses
      // a CODEX_HOME that lands in the repository. Review never reads that
      // transcript back -- it has no --continue -- so for review the file is
      // a pure by-product, and not writing it beats placing it correctly.
      // The frozen capability profile enables it only for review and only
      // after confirming the installed Codex accepts the flag.
      ...(this.plan.capabilities.ephemeral ? ['--ephemeral'] : []),
      ...this.plan.capabilities.mcpArgs,
      '--json',
    ]
    if (selection.kind !== 'inherit') {
      args.push('-m', selection.model)
      args.push('-c', `model_reasoning_effort="${selection.effort}"`)
    }
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
    // One buffer PER STREAM, not one shared by both, and -- just as
    // importantly -- the LOG is written a whole line at a time out of those
    // buffers rather than raw chunk by raw chunk. stdout carries the JSONL
    // event stream; stderr carries codex's own free text. Appending raw
    // chunks let a stderr chunk arriving between two halves of a split stdout
    // event splice itself into the middle of that JSON line *in the log
    // file*, so the line no longer parsed and the event vanished -- silently,
    // because hasRecognizedEvent is satisfied by any other well-formed event
    // in the same log. The events lost that way are exactly the ones this
    // script draws conclusions from: model rejection, session id, model
    // attribution. Separating the echoed view alone did not fix that; the log
    // is what jsonEvents() actually parses, so the framing has to hold there.
    // Byte content is still untruncated -- only the interleaving granularity
    // changes, from arbitrary chunk boundaries to line boundaries.
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
        let pending = buffers.get(stream) + chunk
        let complete = ''
        for (;;) {
          const newline = pending.indexOf('\n')
          if (newline < 0) break
          const line = pending.slice(0, newline).replace(/\r$/, '')
          pending = pending.slice(newline + 1)
          complete += `${line}\n`
          streamChildLine(line)
        }
        if (complete) appendFileSync(this.log, complete)
        if (stream === 'stdout' && complete) this.stdoutEventBuffer += complete
        buffers.set(stream, pending)
      } catch (error) {
        archiveError = error
        this.terminateChild('SIGTERM')
      }
    }

    this.stdoutEventBuffer = ''
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
    // Whatever never terminated with a newline still belongs in the log, or a
    // final unterminated event would be echoed but not recorded.
    for (const [stream, pending] of buffers.entries()) {
      if (!pending) continue
      streamChildLine(pending)
      try { appendFileSync(this.log, `${pending}\n`) } catch { /* reported below if it also broke the stream writes */ }
      if (stream === 'stdout') this.stdoutEventBuffer += `${pending}\n`
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
        `error: the ${this.state.runNoun} was stopped, because a log this script cannot append to can no longer be trusted to hold the invocation it reports on.`,
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

  readStdoutEvents() {
    return this.stdoutEventBuffer
  }

  tailLog() {
    const lines = this.readLog().split(/\r?\n/).slice(-21)
      .filter((line) => line !== '')
    for (const line of lines) streamChildLine(line)
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

  async run(invocation) {
    const result = await this.execute(invocation.command, invocation.args, invocation.diagnostic)
    if (this.timedOut) this.timeoutExit()

    if (result.status !== 0) {
      process.stderr.write(`error: codex ${this.state.runNoun} failed; raw output at ${this.log}\n`)
      this.strictConfigHint()
      this.tailLog()
      this.discardResult()
      die(4)
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
    } else if (!hasRecognizedEvent(this.readStdoutEvents())) {
      process.stderr.write(`warning: codex's --json event stream at ${this.log} has no line this script recognizes as a JSON event.\n`)
      process.stderr.write('warning: this usually means the installed codex-cli changed its event format; model/session metadata reported below may be silently wrong -- recheck references/internals.md against the version in use.\n')
    }
    if (this.state.modelSelection.kind === 'inherit') {
      const model = effectiveModel(this.readStdoutEvents())
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
