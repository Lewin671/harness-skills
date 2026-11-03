// Provider: the OpenAI codex CLI. Native `codex exec review` for reviews, a
// pinned model+effort pair, and capacity retries. Every mode runs without a sandbox; review and consult carry the
// shared investigation note instead.

import { configurePair, flat, readText } from '../lib/core.mjs'
import { contextFence, investigationNote, scopeSentence } from '../lib/prompt.mjs'

const DEFAULT_MODEL = 'gpt-6.1-sol'
const DEFAULT_EFFORT = 'high'
const MODEL_ENV = 'PEER_CODEX_MODEL'
const EFFORT_ENV = 'PEER_CODEX_EFFORT'

const CAPACITY_ERROR = /Selected model is at capacity\. Please try a different model\./i

// Failures no rerun fixes soon; matched on the CLI's error events and stderr,
// never on model text.
const USAGE_LIMIT = /hit your usage limit/i
const CONTENT_FLAG = /flagged for possible/i

// A retired or entitlement-blocked model fails with a message naming the
// model plus a denial phrase; require both so an unrelated failure is not
// misdiagnosed as a model problem.
const MODEL_DENIAL = /not supported when using Codex|does not exist or you do not have access|not available (?:for|to) (?:this|your) account|model_not_found|unsupported_model/i

// KNOWN, ACCEPTED GAP — do not re-add MCP switch-off here. Codex runs with
// whatever standalone MCP servers the user's own configuration enables, and
// such tools can mutate external systems from inside a second opinion.
// Adjudicated 2026-08-14: enabling a server in the user's own config is
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
  // Every mode runs with full access and no approvals. Decided by the user on
  // 2026-10-30, replacing the read-only sandbox for review and consult: a
  // sandbox cannot give a reviewer the environment a build or test needs
  // (writable caches and temp, ignored dependencies, services, network), and
  // per-ecosystem exceptions do not generalise. Do not re-add a sandbox here.
  const access = ['-c', 'sandbox_mode="danger-full-access"', '-c', 'approval_policy="never"']
  // A delegated task runs in the user's normal codex environment. Never
  // --ephemeral: feedback resumes the session.
  if (mode === 'task') return [...access, ...common]
  return [
    ...access,
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

export default {
  id: 'codex',
  name: 'Codex',
  prefix: 'codex> ',
  binary: { name: 'codex', envVar: 'CODEX_BIN' },
  retryDelays: [15000, 30000, 60000],

  // Review runs --ephemeral, so only consult and task leave a session.
  resumeMode(mode) {
    return mode === 'review' ? '' : mode
  },

  configure(policy) {
    configurePair(policy, { id: 'codex', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, modelEnv: MODEL_ENV, effortEnv: EFFORT_ENV })
  },

  invocation({ mode, policy, review, scope, text, sessionId, continuing, artifacts, env }) {
    const safety = safetyArgs(mode, policy, artifacts.out)
    if (mode === 'review') {
      const parts = [review.scopeFlag === '--custom' ? review.scopeValue : scopeSentence(scope)]
      if (review.context) parts.push(contextFence(review.context))
      parts.push(investigationNote(artifacts.scratch))
      return { args: ['exec', 'review', ...safety], prompt: `${parts.join('\n\n')}\n` }
    }
    const args = sessionId ? ['exec', 'resume', sessionId, ...safety] : ['exec', ...safety]
    // codex refuses to start outside a git work tree unless told to skip the
    // check; consult and task promise repository-free runs.
    if (!env.repoRoot) args.push('--skip-git-repo-check')
    // A task gets no note: it is meant to change things.
    let prompt = text
    if (continuing) prompt = 'Continue'
    else if (mode === 'consult') prompt = `${text}\n\n${investigationNote(artifacts.scratch)}\n`
    return { args, prompt }
  },

  resumeArgs(policy) {
    // The model flags do not travel with the session; pin the pair that
    // answered.
    return ['--model', policy.model, '--effort', policy.effort]
  },

  decoder({ policy, artifacts }) {
    const state = { sessionId: '', model: policy.model }
    let text = ''
    let capacity = false
    let workStarted = false
    let turnFailed = false
    // The CLI's own failure messages, deduplicated, for the error: lines.
    const failures = []
    const diagnostics = []
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
              if (event.type === 'turn.failed') turnFailed = true
              const message = event.message ?? event.error?.message
              if (typeof message === 'string') {
                if (CAPACITY_ERROR.test(message)) capacity = true
                const short = message.length > 300 ? `${message.slice(0, 300)}...` : message
                if (!failures.includes(short)) failures.push(short)
                diagnostics.push(message)
              }
            }
          } catch {}
        } else {
          if (CAPACITY_ERROR.test(line)) capacity = true
          diagnostics.push(line)
        }
        return line
      },
      finish({ status }) {
        const output = readText(artifacts.out)
        // A failed turn is not an answer, even beside a zero exit and partial
        // output.
        const usable = status === 0 && Boolean(output.trim()) && !turnFailed
        const hints = []
        const said = diagnostics.join('\n')
        if (!usable && USAGE_LIMIT.test(said)) {
          hints.push('the codex account hit its usage limit; not transient — do not rerun codex before the reset time the CLI reported. Start the run fresh with `peer.mjs agy` instead, and report that agy answered.')
        } else if (!usable && CONTENT_FLAG.test(said)) {
          hints.push('codex refused the content; not transient — do not rerun or reword the request to get past it. Report the reason to the user.')
        }
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
          errors: usable ? [] : failures,
          hints,
        }
      },
    }
  },
}
