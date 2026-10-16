#!/usr/bin/env node
// Run a peer coding-agent CLI headlessly from another harness:
//   peer.mjs <provider> review  — a prioritised defect list over a code change (read-only)
//   peer.mjs <provider> consult — a reasoned position on one question (read-only)
//   peer.mjs <provider> task    — delegated work, allowed to write (delegate-to-peer)
// Providers live in providers/; the process layer in lib/core.mjs; the run
// loop in lib/run.mjs; scope and identity in lib/scope.mjs.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  createArtifacts,
  createEnvironment,
  die,
  emitBody,
  EXIT,
  ExitError,
  flat,
  parseWhole,
  shellQuote,
  terminateActiveChild,
  UUID,
} from './lib/core.mjs'
import { runAgent } from './lib/run.mjs'
import { consultScope, fingerprintScope, resolveScope } from './lib/scope.mjs'
import { createReviewSnapshot } from './lib/snapshot.mjs'
import { PROVIDERS } from './providers/index.mjs'

const MODES = ['review', 'consult', 'task']
const DEFAULT_TIMEOUT = { review: 3000, consult: 3000, task: 7200 }

const TOP_USAGE = `Usage: peer.mjs <provider> <review|consult|task> [ARGS]

Providers: ${[...PROVIDERS.keys()].join(', ')}

  review   a prioritised defect list over a code change (read-only)
  consult  one free-form question, answered with the repo as context (read-only)
  task     delegated work; the peer may edit files and run any command

Run peer.mjs <provider> <mode> --help for that mode's arguments.`

const COMMON_OPTIONS = `  --model <MODEL>      run on a specific model (provider rules apply)
  --effort <LEVEL>     reasoning effort (provider rules apply)
  --repo <DIR>         working directory (default: current directory)
  --timeout <SECONDS>  abort a hung run (default: 3000, task 7200; 1-86400)`

function modeUsage(provider, mode) {
  const extra = Object.entries(provider.options)
    .filter(([, option]) => option.modes.includes(mode))
    .map(([flag, option]) => `  ${`${flag}${option.value ? ` <${option.value}>` : ''}`.padEnd(20)} ${option.help}`)
  const options = [COMMON_OPTIONS, ...extra].join('\n')
  if (mode === 'review') {
    return `Usage: peer.mjs ${provider.id} review [SCOPE] [OPTIONS]

Scope (at most one, default --uncommitted):
  --uncommitted        staged + unstaged + untracked changes
  --base <REF>         commits since the merge base with REF plus tracked
                       working changes
  --commit <SHA>       the changes introduced by one commit
  --custom <TEXT>      free-form instructions that name their own scope

Options:
  --context <TEXT>     neutral background for the reviewer
${options}`
  }
  const noun = mode === 'task' ? 'TASK' : 'QUESTION'
  return `Usage: peer.mjs ${provider.id} ${mode} [OPTIONS] [--] ${noun}

The ${noun} is one argument; put it after -- when it starts with a dash. It
must stand alone: a fresh run carries no conversation history.

Options:
  --resume <SESSION>   continue a session with a follow-up ${noun}
${options}`
}

function parse(argv) {
  const [providerId, mode, ...args] = argv
  if (!providerId || providerId === '-h' || providerId === '--help') {
    process.stderr.write(`${TOP_USAGE}\n`)
    if (!providerId) die(EXIT.usage)
    die(EXIT.ok)
  }
  const provider = PROVIDERS.get(providerId)
  if (!provider) die(EXIT.usage, `error: unknown provider: ${flat(providerId)}`, ...TOP_USAGE.split('\n'))
  if (mode === '-h' || mode === '--help') {
    process.stderr.write(`${TOP_USAGE}\n`)
    die(EXIT.ok)
  }
  if (!MODES.includes(mode)) {
    die(EXIT.usage, mode ? `error: unknown mode: ${flat(mode)}` : 'error: a mode is required', ...TOP_USAGE.split('\n'))
  }

  const usage = modeUsage(provider, mode)
  const fail = (message) => die(EXIT.usage, message, ...usage.split('\n'))
  const policy = { model: '', effort: '', repo: '.', timeout: DEFAULT_TIMEOUT[mode], sessionId: '' }
  const review = { scopeFlag: '--uncommitted', scopeValue: '', context: '' }
  let scopeSet = false
  let text = null
  const valueOf = (i) => {
    if (!args[i + 1]) die(EXIT.usage, `error: ${args[i]} needs a non-empty value`)
    return args[i + 1]
  }

  for (let i = 0; i < args.length;) {
    const option = args[i]
    if (option === '-h' || option === '--help') {
      process.stderr.write(`${usage}\n`)
      die(EXIT.ok)
    }
    if (mode === 'review' && ['--uncommitted', '--base', '--commit', '--custom'].includes(option)) {
      if (scopeSet) die(EXIT.usage, 'error: scopes are mutually exclusive; pick one of --uncommitted, --base, --commit, --custom')
      scopeSet = true
      review.scopeFlag = option
      if (option === '--uncommitted') {
        i += 1
      } else {
        review.scopeValue = valueOf(i)
        i += 2
      }
      continue
    }
    if (mode === 'review' && option === '--context') {
      if (review.context) die(EXIT.usage, 'error: --context may be given only once; pass the whole background as one argument')
      review.context = valueOf(i)
      i += 2
      continue
    }
    if (mode !== 'review' && option === '--resume') {
      const value = valueOf(i)
      if (!UUID.test(value)) die(EXIT.usage, 'error: --resume needs the session id (a UUID) printed by the previous run')
      policy.sessionId = value.toLowerCase()
      i += 2
      continue
    }
    if (option === '--model' || option === '--effort' || option === '--repo') {
      policy[option.slice(2)] = valueOf(i)
      i += 2
      continue
    }
    if (option === '--timeout') {
      policy.timeout = parseWhole(valueOf(i), '--timeout', 86400)
      i += 2
      continue
    }
    const extra = provider.options[option]
    if (extra && extra.modes.includes(mode)) {
      if (extra.value) {
        extra.apply(policy, valueOf(i))
        i += 2
      } else {
        extra.apply(policy)
        i += 1
      }
      continue
    }
    if (mode !== 'review' && option === '--') {
      if (args.length - i - 1 !== 1) fail(`error: expected exactly one argument after --`)
      if (text !== null) fail('error: expected exactly one prompt; quote it as one argument')
      text = args[i + 1]
      break
    }
    if (mode !== 'review' && !option.startsWith('-')) {
      if (text !== null) fail('error: expected exactly one prompt; quote it as one argument')
      text = option
      i += 1
      continue
    }
    fail(`error: unknown argument: ${flat(option)}`)
  }

  if (mode === 'review' && review.context && review.scopeFlag === '--custom') {
    die(EXIT.usage, 'error: --context cannot be combined with --custom; custom instructions already carry their own context')
  }
  if (mode !== 'review' && !text) fail(`error: a non-empty ${mode === 'task' ? 'TASK' : 'QUESTION'} is required`)
  provider.configure(policy, mode)
  if (/[\r\n]/.test(policy.model)) die(EXIT.usage, 'error: the model must not contain line breaks')
  // The effort reaches a CLI as a plain token or inside a quoted config
  // value; anything else would arrive as syntax instead of failing here.
  if (policy.effort && !/^[A-Za-z0-9._-]+$/.test(policy.effort)) {
    die(EXIT.usage, `error: the effort may contain only letters, digits, '.', '_' and '-', got '${flat(policy.effort)}'`)
  }
  return { provider, mode, policy, review, text }
}

// The session:/resume: pair, printed whenever a run ends with something to
// continue — as real values or as unavailable sentinels, so a model-written
// line cannot pose as them in a merged stream.
function writeResume({ provider, mode, policy }, state, dir) {
  const resumeMode = provider.resumeMode(mode)
  const session = state.sessionId
  if (!session) {
    process.stderr.write('session: unavailable — the stream carried no session id\n')
    process.stderr.write('resume: unavailable — no session id in the stream; start a fresh run\n')
    return
  }
  process.stderr.write(`session: ${session}\n`)
  if (!dir) {
    process.stderr.write('resume: unavailable — the session lives in the unreported worktree; run the resume from inside it\n')
    return
  }
  // A complete follow-up command except for the prompt, so the caller
  // appends `-- "..."` and runs it instead of reassembling an argument tail.
  const parts = [
    shellQuote(fileURLToPath(import.meta.url)), provider.id, resumeMode, '--resume', session,
    ...provider.resumeArgs(policy, state).map(shellQuote),
  ]
  if (policy.timeout !== DEFAULT_TIMEOUT[resumeMode]) parts.push('--timeout', String(policy.timeout))
  parts.push('--repo', shellQuote(dir))
  process.stderr.write(`resume: ${parts.join(' ')}\n`)
}

// Where a task worked: a worktree the CLI created when it reports one,
// otherwise the run's own directory — never a guess for an unreported
// worktree, where the session actually lives.
function workdirOf(run, env, state) {
  return state.workdir || (run.policy.worktree ? '' : env.cwd)
}

async function main(argv) {
  if (Number(process.versions.node.split('.')[0]) < 18) die(EXIT.usage, 'error: this script needs Node.js 18 or newer.')
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    die(EXIT.usage,
      `error: this skill supports macOS and Linux only (detected: '${flat(process.platform)}').`,
      'hint: run it from a macOS or Linux host -- WSL works on Windows.')
  }
  const run = parse(argv)
  const { provider, mode, policy, review, text } = run
  const env = createEnvironment(policy.repo, provider, { requireWorkTree: mode === 'review' })

  // Read-only runs are tied to the bytes they saw: an isolated snapshot where
  // the provider supports one, otherwise a before/after fingerprint of the
  // live tree. A task is meant to change the tree, so it gets neither.
  let scope = null
  if (mode === 'review') scope = resolveScope(review, env, { diff: provider.reviewDiff })
  else if (mode === 'consult' && env.repoRoot) scope = consultScope(env)
  const snapshot = mode === 'review' && provider.snapshot && ['--uncommitted', '--base'].includes(review.scopeFlag)
    ? createReviewSnapshot(scope, env)
    : null
  const before = scope && !snapshot ? fingerprintScope(env, scope) : ''

  const artifacts = createArtifacts(env, provider.id, mode)
  const runEnv = snapshot?.env || env
  let outcome
  try {
    outcome = await runAgent({
      provider, env: runEnv, mode, policy, artifacts,
      build: (sessionId, continuing) => provider.invocation({
        mode, policy, review, scope, text, sessionId, continuing, artifacts, env: runEnv,
      }),
      onTimeout: (state) => {
        if (mode === 'task') {
          const dir = workdirOf(run, env, state)
          process.stderr.write(dir ? `workdir: ${flat(dir)}\n` : 'workdir: unavailable — the CLI did not report the worktree it created\n')
        }
        if (!provider.resumeMode(mode)) return
        writeResume(run, state, mode === 'task' ? workdirOf(run, env, state) : env.cwd)
        if (state.sessionId) {
          process.stderr.write('hint: the session survives the timeout; resume it, but have it check the current state first — it cannot tell how far the interrupted step got.\n')
        }
      },
    })
  } finally {
    snapshot?.cleanup()
  }

  // Paths inside the snapshot mean nothing to the caller; report the
  // source repository's instead.
  const output = snapshot ? outcome.output.replaceAll(snapshot.env.repoRoot, env.repoRoot) : outcome.output
  try {
    writeFileSync(artifacts.out, output.endsWith('\n') ? output : `${output}\n`, { mode: 0o600 })
  } catch (error) {
    die(EXIT.failed, `error: could not write the result file: ${flat(error.message)}`)
  }
  const after = before ? fingerprintScope(env, scope) : ''

  // Everything that qualifies the result prints before `body: begin`.
  if (before) process.stderr.write(`identity: ${before}\n`)
  else if (mode === 'consult') process.stderr.write('identity: unavailable — not a git work tree, so the bytes read cannot be fingerprinted\n')
  for (const warning of outcome.warnings) process.stderr.write(`warning: ${flat(warning)}\n`)
  if (before && after !== before) {
    process.stderr.write(`warning: the tree changed while this run was in progress (identity ${before} is not ${after}); the answer describes no single stable state. Check ${flat(env.repoRoot)} for edits the run may have made.\n`)
  }
  if (outcome.sessionId && !UUID.test(outcome.sessionId)) {
    process.stderr.write('warning: the stream reported a session id that is not a UUID; not advertising a resume command for it\n')
    outcome.sessionId = ''
  }
  const workdir = mode === 'task' ? workdirOf(run, env, outcome) : ''
  if (mode === 'task' && !workdir) {
    process.stderr.write('warning: the worktree path was not reported; find it with `git worktree list` and resume from inside it.\n')
  }
  if (outcome.model) process.stderr.write(`model: ${flat(outcome.model)}\n`)
  if (outcome.usageLine) process.stderr.write(`usage: ${outcome.usageLine}\n`)

  await emitBody(output)

  // Trailing markers: in a merged stream the last marker of each kind is the
  // wrapper's, never model text.
  process.stderr.write(`result: ${artifacts.out}\n`)
  process.stderr.write(`log: ${artifacts.log}\n`)
  if (mode === 'task') process.stderr.write(workdir ? `workdir: ${flat(workdir)}\n` : 'workdir: unavailable — the CLI did not report the worktree it created\n')
  if (provider.resumeMode(mode)) writeResume(run, outcome, mode === 'task' ? workdir : env.cwd)
  if (snapshot) process.stderr.write(`snapshot: ready ${snapshot.fingerprint}\n`)
  if (after) process.stderr.write(`identity: ${after}\n`)
}

// Anything thrown outside the awaited path (a stream callback, a timer)
// would otherwise exit 1 with a raw stack trace and leave the detached CLI
// process group running with nothing to reap it.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    terminateActiveChild('SIGKILL')
    process.stderr.write(`error: internal failure (${event}): ${flat(error?.stack || error)}\n`)
    process.stderr.write('error: this is a bug in the wrapper, not a verdict on the code under review.\n')
    process.exit(EXIT.failed)
  })
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  if (error instanceof ExitError) {
    for (const line of error.lines) process.stderr.write(`${line}\n`)
    process.exitCode = error.code
  } else {
    process.stderr.write(`error: internal failure: ${flat(error?.stack || error)}\n`)
    process.exitCode = EXIT.failed
  }
}
