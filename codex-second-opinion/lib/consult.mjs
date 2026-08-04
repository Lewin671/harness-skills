import { Environment } from './environment.mjs'
import { commonOption, hasThreadStartedEvent, lastThreadId, resumeFlags, Runtime, validateModelState } from './runtime.mjs'
import { die, flat, parseTimeout, shellQuote } from './util.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const USAGE = `Usage: run-codex-second-opinion consult [OPTIONS] QUESTION

The QUESTION is one free-form argument. Name the files or documents Codex
should read; it answers with the repository as context.

Options:
  --continue <SESSION> resume a session UUID with a follow-up QUESTION
  --model <MODEL>      override the pinned model (requires --effort)
  --effort <LEVEL>     override reasoning effort (requires --model)
  --inherit            use model and effort from the codex config
  --allow-mcp          keep standalone MCP servers reachable
  --repo <DIR>         repository for context (default: current directory)
  --timeout <SECONDS>  abort a hung run (default: 3000; 1-86400)`

function usage() { process.stderr.write(`${USAGE}\n`) }

function parseConsultArgs(state, args) {
  let question = ''
  let questionSet = false
  for (let i = 0; i < args.length;) {
    const option = args[i]
    if (option === '--continue') {
      const value = args[i + 1]
      if (value === undefined) die(3, 'error: --continue needs a session id')
      if (!UUID.test(value)) {
        const suffix = /^[A-Za-z0-9-]+$/.test(value) ? `, got '${flat(value)}'` : ''
        die(3, `error: --continue needs the session UUID printed by the previous run${suffix}`)
      }
      // Normalized here, once, because the UUID pattern above accepts
      // uppercase hex while codex reports the thread id in canonical
      // lowercase. Storing the caller's spelling made emitResume's
      // `session !== state.sessionId` compare two spellings of the SAME
      // session, so a perfectly good continuation started with an uppercase
      // id was always discarded as "the session likely expired" -- exit 4 on
      // a session that had in fact resumed correctly.
      state.sessionId = value.toLowerCase(); i += 2; continue
    }
    if (option === '--timeout') {
      if (args[i + 1] === undefined) die(3, 'error: --timeout needs a value')
      state.timeout = parseTimeout(args[i + 1], '--timeout'); i += 2; continue
    }
    if (option === '-h' || option === '--help') { usage(); throw { code: 0, lines: [] } }
    if (option === '--') {
      if (args.length - i - 1 !== 1) die(3, 'error: expected exactly one QUESTION after --')
      if (questionSet) die(3, 'error: expected exactly one QUESTION; quote the whole question as one argument')
      question = args[i + 1]; questionSet = true; i = args.length; continue
    }
    const next = commonOption(state, args, i)
    if (next !== null) { i = next; continue }
    if (option.startsWith('-')) {
      usage(); die(3, `error: unknown argument: ${flat(option)}`)
    }
    if (questionSet) die(3, 'error: expected exactly one QUESTION; quote the whole question as one argument')
    question = option; questionSet = true; i += 1
  }
  if (!questionSet || !question) {
    usage(); die(3, 'error: a non-empty QUESTION is required')
  }
  return question
}

function buildCommand(state, env, runtime, question, model, effort) {
  const args = state.sessionId ? ['exec', 'resume', state.sessionId] : ['exec']
  args.push(...runtime.safetyArgs(model, effort))
  const diagnostic = `running: ${env.codexBin} ${args.join(' ')} -- <question: ${question.length} chars>`
  args.push('--', question)
  return { command: env.codexBin, args, diagnostic }
}

function blockFollowupRetry(state) {
  if (!state.sessionId) return false
  process.stderr.write('error: the model/effort was rejected on a follow-up; not retrying automatically.\n')
  process.stderr.write('hint: treat this session as contaminated — the question may already be recorded in it.\n')
  process.stderr.write('hint: start a fresh consultation (restating context), with the model flags the session was started with.\n')
  return true
}

function emitResume(state, env, runtime) {
  const log = runtime.readLog()
  let session = lastThreadId(log)
  if (state.sessionId && session.toLowerCase() !== state.sessionId) {
    if (!session && hasThreadStartedEvent(log)) {
      // A thread.started event exists, so codex did report *something* --
      // this script just could not read a thread_id out of it. That is
      // schema drift, not an expired session, and saying "expired" here
      // would misdirect anyone debugging it.
      process.stderr.write('error: codex reported a thread.started event, but this script could not read a thread_id from it.\n')
      process.stderr.write(`error: this usually means the installed codex-cli changed its event format -- recheck references/internals.md against the version in use -- not that session ${state.sessionId} expired.\n`)
    } else {
      process.stderr.write(`error: codex did not resume session ${state.sessionId} (stream reported '${session || 'no thread id'}').\n`)
      process.stderr.write('error: the session likely expired, so the answer lacked the prior discussion and was discarded.\n')
    }
    process.stderr.write('hint: start a fresh consultation and restate the context.\n')
    runtime.tailLog()
    runtime.discardResult()
    die(4)
  }

  runtime.emitResult()
  if (session && !UUID.test(session)) {
    process.stderr.write('warning: the stream reported a thread id that is not a session UUID; not advertising a resume command for it\n')
    session = ''
  }
  if (!session) {
    process.stderr.write('session: unavailable — the stream carried no thread id\n')
    process.stderr.write('resume: unavailable — no session id in the stream; start a fresh consultation\n')
    return
  }

  process.stderr.write(`session: ${session}\n`)
  const mcp = state.allowMcp ? ' --allow-mcp' : ''
  const timeout = state.timeout !== 3000 ? ` --timeout ${state.timeout}` : ''
  if (process.env.CODEX_HOME) {
    // env.codexHome, not the raw variable: the run handed codex the resolved
    // path, so that -- not the spelling it was derived from -- is the value a
    // replay has to reproduce to find this session again.
    process.stderr.write(`note: this consultation used CODEX_HOME=${shellQuote(env.codexHome)}; set it the same way before replaying the line below\n`)
  }
  process.stderr.write(`resume: --continue ${session}${resumeFlags(state)}${mcp}${timeout} --repo ${shellQuote(env.cwd)}\n`)
}

export async function runConsult(state, args) {
  const question = parseConsultArgs(state, args)
  validateModelState(state)
  const env = new Environment(state)
  env.initialize()
  const artifacts = env.createArtifacts('consult')
  const runtime = new Runtime(state, env, artifacts)
  await runtime.runWithFallback(
    (model, effort) => buildCommand(state, env, runtime, question, model, effort),
    () => blockFollowupRetry(state),
  )
  emitResume(state, env, runtime)
}

export const consultInternals = { parseConsultArgs }
