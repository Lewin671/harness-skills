// Provider: the OpenAI codex CLI. Native `codex exec review` for reviews, a
// real read-only sandbox for review and consult, isolated review snapshots,
// a pinned model+effort pair, and capacity retries.

import { die, EXIT, flat, readText, shellQuote } from '../lib/core.mjs'
import { contextFence } from '../lib/scope.mjs'

const DEFAULT_MODEL = 'gpt-6.1-sol'
const DEFAULT_EFFORT = 'high'
const MODEL_ENV = 'PEER_CODEX_MODEL'
const EFFORT_ENV = 'PEER_CODEX_EFFORT'

const CAPACITY_ERROR = /Selected model is at capacity\. Please try a different model\./i

// A retired or entitlement-blocked model fails with a message naming the
// model plus a denial phrase; require both so an unrelated failure is not
// misdiagnosed as a model problem.
const MODEL_DENIAL = /not supported when using Codex|does not exist or you do not have access|not available (?:for|to) (?:this|your) account|model_not_found|unsupported_model/i

// KNOWN, ACCEPTED GAP — do not re-add MCP switch-off here. Codex runs with
// whatever standalone MCP servers the user's own configuration enables, and
// such tools can mutate external systems from inside an otherwise read-only
// run. Adjudicated 2026-08-14: enabling a server in the user's own config is
// the authorization to use it. Treat "MCP tools may mutate external systems"
// findings against this file as adjudicated.
function safetyArgs(mode, policy, out) {
  const common = [
    // An unrecognized config key fails the run instead of silently dropping
    // a safety setting.
    '--strict-config',
    '--json',
    '-m', policy.model,
    '-c', `model_reasoning_effort="${policy.effort}"`,
    '-o', out,
  ]
  // A delegated task is meant to change things and runs in the user's normal
  // codex environment: full access without approvals (it may need the
  // network, e.g. ssh), and none of the read-only switches. Never
  // --ephemeral: feedback resumes the session.
  if (mode === 'task') {
    return ['-c', 'sandbox_mode="danger-full-access"', '-c', 'approval_policy="never"', ...common]
  }
  return [
    '-c', 'sandbox_mode="read-only"',
    '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins',
    // Cross-session memories would feed an earlier session's context into a
    // nominally blind first pass, and let a second-opinion run write into
    // the user's memory store. A codex that does not know the feature fails
    // with "Unknown feature flag"; once codex marks it "removed", --disable is
    // accepted silently, so re-check `codex features list` when upgrading.
    '--disable', 'memories',
    '-c', 'notify=[]',
    // Review never resumes a session, so it does not persist one.
    ...(mode === 'review' ? ['--ephemeral'] : []),
    ...common,
  ]
}

function scopeSentence(scope) {
  if (scope.scopeFlag === '--uncommitted') {
    return 'Review the uncommitted changes in this repository: staged, unstaged, and untracked files. Use `git --no-optional-locks status --porcelain --untracked-files=normal` together with `git diff`, `git diff --cached`, and the contents of any untracked files.'
  }
  if (scope.scopeFlag === '--base') {
    return `Review the changes on the current branch against base branch ${shellQuote(scope.scopeValue)}: the diff from merge base ${scope.resolvedBase} to the working tree, i.e. \`git diff ${scope.resolvedBase}\`. Do not review anything already contained in ${scope.resolvedBase}.`
  }
  if (scope.resolvedParent) {
    return `Review only the changes introduced by commit ${scope.resolvedCommit} (given as ${shellQuote(scope.scopeValue)}): \`git diff ${scope.resolvedParent} ${scope.resolvedCommit}\`. Do not review unrelated code.`
  }
  return `Review only the changes introduced by root commit ${scope.resolvedCommit} (given as ${shellQuote(scope.scopeValue)}): \`git show ${scope.resolvedCommit}\`. Do not review unrelated code.`
}

export default {
  id: 'codex',
  name: 'Codex',
  prefix: 'codex> ',
  binary: { name: 'codex', envVar: 'CODEX_BIN' },
  snapshot: true,
  reviewDiff: false,
  retryDelays: [15000, 30000, 60000],
  options: {},

  // Review runs --ephemeral, so only consult and task leave a session.
  resumeMode(mode) {
    return mode === 'review' ? '' : mode
  },

  configure(policy) {
    const envModel = process.env[MODEL_ENV] || ''
    const envEffort = process.env[EFFORT_ENV] || ''
    if (Boolean(envModel) !== Boolean(envEffort)) {
      die(EXIT.usage,
        `error: ${MODEL_ENV} and ${EFFORT_ENV} must be set together.`,
        "hint: set both, or unset both and pass '--model M --effort L' for a single run.")
    }
    if (Boolean(policy.model) !== Boolean(policy.effort)) {
      die(EXIT.usage, 'error: for codex, --model and --effort must be given together, as an explicit pair.')
    }
    policy.modelSource = policy.model ? 'flag' : envModel ? 'env' : 'default'
    if (!policy.model) {
      policy.model = envModel || DEFAULT_MODEL
      policy.effort = envEffort || DEFAULT_EFFORT
    }
  },

  invocation({ mode, policy, review, scope, text, sessionId, continuing, artifacts, env }) {
    const safety = safetyArgs(mode, policy, artifacts.out)
    if (mode === 'review') {
      const args = ['exec', 'review']
      let prompt = null
      if (review.scopeFlag === '--custom') {
        prompt = review.scopeValue
      } else if (review.context) {
        // codex exec review refuses a scope flag and a prompt together, so
        // with --context the scope travels as prose inside the prompt.
        prompt = `${scopeSentence(scope)}\n\n${contextFence(review.context)}\n`
      } else {
        args.push(review.scopeFlag)
        if (review.scopeFlag === '--base') args.push(scope.resolvedBase)
        else if (review.scopeFlag === '--commit') args.push(scope.resolvedCommit)
      }
      return { args: [...args, ...safety], prompt, via: 'argv' }
    }
    const args = sessionId ? ['exec', 'resume', sessionId, ...safety] : ['exec', ...safety]
    // codex refuses to start outside a git work tree unless told to skip the
    // check; consult and task promise repository-free runs.
    if (!env.repoRoot) args.push('--skip-git-repo-check')
    return { args, prompt: continuing ? 'Continue' : text, via: 'argv' }
  },

  resumeArgs(policy) {
    // The model flags do not travel with the session; pin the pair that
    // answered.
    return ['--model', policy.model, '--effort', policy.effort]
  },

  decoder({ policy, artifacts }) {
    const state = { sessionId: '', model: policy.model, workdir: '' }
    let text = ''
    let capacity = false
    let workStarted = false
    return {
      state,
      push(stream, line) {
        text += `${line}\n`
        if (stream === 'stdout') {
          try {
            const event = JSON.parse(line)
            if (event?.type === 'thread.started' && typeof event.thread_id === 'string') {
              state.sessionId = event.thread_id.toLowerCase()
            }
            if (event?.type?.startsWith('item.')) workStarted = true
            if (event?.type === 'error' || event?.type === 'turn.failed') {
              const message = event.message ?? event.error?.message
              if (typeof message === 'string' && CAPACITY_ERROR.test(message)) capacity = true
            }
          } catch {}
        } else if (CAPACITY_ERROR.test(line)) {
          capacity = true
        }
        return line
      },
      finish({ status }) {
        const output = readText(artifacts.out)
        const usable = status === 0 && Boolean(output.trim())
        const hints = []
        if (!usable && status !== 0) {
          if (text.includes('unknown configuration field') || text.includes('Unknown feature flag')) {
            hints.push('codex rejected a configuration key or feature flag this script sets (--strict-config is deliberate); the installed codex CLI may have drifted from the keys in providers/codex.mjs.')
          } else if (text.includes(policy.model) && MODEL_DENIAL.test(text)) {
            hints.push(`codex rejected the selected model '${flat(policy.model)}' on this run; no fallback was attempted. Such a rejection has proved transient, so rerun once unchanged; if it is rejected again, the model is unavailable to this codex login (retired, renamed, not entitled, or newer than the installed codex CLI — try upgrading it).`)
            hints.push({
              flag: 'rerun with a supported --model M --effort L pair.',
              env: `update ${MODEL_ENV} and ${EFFORT_ENV} together to a supported model.`,
              default: `the pinned default in providers/codex.mjs may have been retired; pass --model M --effort L for one run, or set ${MODEL_ENV} and ${EFFORT_ENV} together.`,
            }[policy.modelSource])
            if (policy.sessionId) hints.push('do not resume this session under a different model; start a fresh consultation and restate the context.')
          }
        }
        return {
          ...state,
          output,
          usable,
          transient: capacity && !usable ? 'model at capacity' : '',
          workStarted: workStarted || Boolean(output.trim()),
          warnings: [],
          errors: [],
          hints,
          usageLine: '',
        }
      },
    }
  },
}
