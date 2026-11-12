// Provider: the Antigravity CLI (`agy`). Headless print mode with the
// stream-json event stream, a pinned model+effort pair, and `--conversation`
// to continue a session. agy has no review command, so a review is a prompt:
// the scope as prose plus the report contract. Every mode runs with
// permissions skipped, like codex runs without a sandbox; review and consult
// carry the shared investigation note instead.

import { configurePair, flat } from '../lib/core.mjs'
import { contextFence, investigationNote, REPORT_CONTRACT, scopeSentence } from '../lib/prompt.mjs'

const DEFAULT_MODEL = 'gemini-4-hydrogen'
const DEFAULT_EFFORT = 'high'
const MODEL_ENV = 'PEER_AGY_MODEL'
const EFFORT_ENV = 'PEER_AGY_EFFORT'

// agy refuses an unknown model or an effort the model lacks before it starts
// a conversation, with this phrase in the result event's error.
const MODEL_REJECTED = /invalid model selection/i

// KNOWN GAP: agy has no documented switch for its hooks, plugins, skills or
// cross-session memories, so a review or consult runs in the user's normal
// agy setup. Only the prompt is kept blind; say so when labelling a result
// independent matters.
function baseArgs(policy, sessionId) {
  const args = [
    '--output-format', 'stream-json',
    // Headless: no one is there to approve a tool call.
    '--dangerously-skip-permissions',
    // The prompt is data; a leading `/word` must not run a command or skill.
    '--disable-slash-commands',
    '--model', policy.model,
    '--effort', policy.effort,
  ]
  if (sessionId) args.push('--conversation', sessionId)
  return args
}

export default {
  id: 'agy',
  name: 'agy',
  prefix: 'agy> ',
  binary: { name: 'agy', envVar: 'AGY_BIN' },
  // agy reads the prompt only from -p/--print or stdin, never after `--`.
  promptFlag: '--print',
  // No failure is known to be transient yet, so nothing is retried.
  retryDelays: [],

  // A review leaves a conversation in agy's history, but review mode has no
  // follow-up: discuss a finding in a consult.
  resumeMode(mode) {
    return mode === 'review' ? '' : mode
  },

  configure(policy) {
    configurePair(policy, { id: 'agy', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, modelEnv: MODEL_ENV, effortEnv: EFFORT_ENV })
  },

  invocation({ mode, policy, review, scope, text, sessionId, continuing, artifacts }) {
    const args = baseArgs(policy, sessionId)
    if (mode === 'review') {
      const parts = [review.scopeFlag === '--custom' ? review.scopeValue : scopeSentence(scope)]
      if (review.context) parts.push(contextFence(review.context))
      parts.push(REPORT_CONTRACT, investigationNote(artifacts.scratch))
      return { args, prompt: `${parts.join('\n\n')}\n` }
    }
    // A task gets no note: it is meant to change things.
    let prompt = text
    if (continuing) prompt = 'Continue'
    else if (mode === 'consult') prompt = `${text}\n\n${investigationNote(artifacts.scratch)}\n`
    return { args, prompt }
  },

  resumeArgs(policy) {
    // The model flags do not travel with the conversation; pin the pair that
    // answered.
    return ['--model', policy.model, '--effort', policy.effort]
  },

  decoder({ policy }) {
    const state = { sessionId: '', model: policy.model }
    let result = null
    let workStarted = false
    return {
      state,
      push(stream, line) {
        if (stream !== 'stdout') return line
        let event
        try { event = JSON.parse(line) } catch { return line }
        const session = event?.conversation_id ?? event?.[event?.event]?.conversation_id
        if (typeof session === 'string' && session) state.sessionId = session.toLowerCase()
        if (event?.event === 'init' && typeof event.init?.model === 'string') state.model = event.init.model
        if (event?.event === 'result' && event.result && typeof event.result === 'object') result = event.result
        const step = event?.step_update
        if (step && step.step_type !== 'user_input') workStarted = true
        // Streamed answer text arrives a few words per event; the log keeps
        // it, the progress stream would only repeat the result body.
        if (step?.step_type === 'agent_response' && step.state === 'ACTIVE') return ''
        return line
      },
      finish({ status }) {
        const output = typeof result?.response === 'string' ? result.response : ''
        // finished_reason is set only when a turn ended early: a partial
        // answer is not an answer.
        const usable = status === 0 && result?.status === 'SUCCESS' && !result.finished_reason && Boolean(output.trim())
        const errors = []
        const hints = []
        if (!usable) {
          const message = typeof result?.error === 'string' ? result.error : ''
          if (message) errors.push(message.length > 300 ? `${message.slice(0, 300)}...` : message)
          if (result?.finished_reason) errors.push(`agy ended the turn early: ${result.finished_reason}`)
          if (MODEL_REJECTED.test(message)) {
            hints.push(`agy rejected the model selection '${flat(policy.model)}' with effort '${flat(policy.effort)}'; no fallback was attempted. \`agy models\` lists the models this login can use (an id ending in -low/-medium/-high names the model plus its effort).`)
            hints.push({
              flag: 'rerun with a supported --model M --effort L pair.',
              env: `update ${MODEL_ENV} and ${EFFORT_ENV} together to a supported pair.`,
              default: `the pinned default in providers/agy.mjs may have been retired; pass --model M --effort L for one run, or set ${MODEL_ENV} and ${EFFORT_ENV} together.`,
            }[policy.modelSource])
          }
        }
        return {
          ...state,
          output,
          usable,
          transient: '',
          workStarted: workStarted || Boolean(output.trim()),
          errors,
          hints,
        }
      },
    }
  },
}
