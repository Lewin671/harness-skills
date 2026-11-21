// Provider: the Antigravity CLI (`agy`). Headless print mode with the
// stream-json event stream, a pinned model+effort pair, and `--conversation`
// to continue a session. agy has no review command, so a review is a prompt:
// the scope as prose plus a report contract enforced with --json-schema, and
// the structured answer is rendered back into the `[P<n>]` shape review.md
// reads. A failed turn's `AGY_ERROR: {...}` stderr line names the status and
// whether agy considers it retryable. Every mode runs with
// permissions skipped, like codex runs without a sandbox; review and consult
// carry the shared investigation note instead.

import { configurePair, flat } from '../lib/core.mjs'
import { contextFence, investigationNote, REVIEW_DUTY, scopeSentence } from '../lib/prompt.mjs'

const DEFAULT_MODEL = 'gemini-4-neon'
const DEFAULT_EFFORT = 'high'
const MODEL_ENV = 'PEER_AGY_MODEL'
const EFFORT_ENV = 'PEER_AGY_EFFORT'

// agy refuses an unknown model or an effort the model lacks before it starts
// a conversation, with this phrase in the result event's error.
const MODEL_REJECTED = /invalid model selection/i

// agy 1.5.x prints one `AGY_ERROR: {...}` line on stderr when a headless turn
// ends on an agent or model API failure, and exits 3. Seen on 1.5.9:
// {"short_error":"...","status":"DEADLINE_EXCEEDED","retryable":false,"reason":"print_timeout"};
// http_status, status_code and error_id appear when the API supplied them.
const AGY_ERROR = /^AGY_ERROR:\s*(\{.*\})\s*$/

// agy 1.5.x ends a turn with this error when the model emits an empty tool
// call. The error is the retry message agy means to send back to the model
// ("... Please retry with a properly formatted function call / Retries
// remaining: 3"), but headless mode reports it instead of sending it: in 36
// runs (2026-11) the count never went below 3. Mostly it comes right after
// the final report (kept as the answer); a few times mid-task, where the
// wrapper does what agy meant to: sends that message back in the same
// conversation, up to three times, with no wait so the prompt cache holds.
const MALFORMED_CALL = /malformed function call/i
const RETRIES_LINE = /\n?Retries remaining: \d+\.?\s*$/i
const MALFORMED_RETRY = 'Your previous response contained an improperly formatted function call. Please retry with a properly formatted function call.'

// The account's quota for the model is used up until a reset agy names, e.g.
// "Individual quota reached. ... Resets in 35m50s."
const QUOTA = /quota (?:reached|exceeded|exhausted)|usage limit/i
const RESETS_IN = /resets? in ([0-9][0-9hms ]*[0-9hms])/i

// The review report as a JSON schema. agy rejects a schema whose root is not
// an object, and returns the parsed answer as result.structured_output.
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: 'One paragraph: the overall verdict. If there is nothing to report, say so here.' },
    findings: {
      type: 'array',
      description: 'One entry per defect, most severe first; empty when there is nothing to report.',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          title: { type: 'string' },
          path: { type: 'string', description: 'Repository-relative path of the file.' },
          start_line: { type: 'integer' },
          end_line: { type: 'integer' },
          body: { type: 'string', description: 'What is wrong, the input or state that triggers it, and the consequence.' },
        },
        required: ['priority', 'title', 'path', 'start_line', 'end_line', 'body'],
      },
    },
    verification: { type: 'string', description: 'The commands run and their outcomes, the checks skipped or impossible and why; for each failure, code or environment.' },
  },
  required: ['verdict', 'findings', 'verification'],
}

const REVIEW_CONTRACT = `${REVIEW_DUTY} Your answer is checked against a JSON schema: put the overall verdict in \`verdict\`, one entry per defect in \`findings\` (priority P0 most severe through P3, ordered by priority, each anchored to a repository-relative \`path\` and a \`start_line\`-\`end_line\` range), and the Verification paragraph described below in \`verification\`. If there is nothing to report, say so in the verdict and leave \`findings\` empty — never invent a finding to fill the list.`

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')
const lineNo = (value) => (Number.isInteger(value) && value > 0 ? value : 0)

// structured_output -> the Markdown review.md reads, or '' when the object
// does not have the schema's shape.
export function renderReview(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.findings) || !trimmed(report.verdict)) return ''
  const bullets = []
  for (const finding of report.findings) {
    if (!finding || !/^P[0-3]$/.test(finding.priority) || !trimmed(finding.title)) return ''
    const start = lineNo(finding.start_line)
    const end = Math.max(lineNo(finding.end_line), start)
    const range = !start ? '' : end > start ? `:${start}-${end}` : `:${start}`
    const anchor = trimmed(finding.path) ? ` — ${trimmed(finding.path)}${range}` : ''
    const body = trimmed(finding.body).split('\n').map((row) => (row ? `  ${row}` : '')).join('\n')
    bullets.push(`- [${finding.priority}] ${trimmed(finding.title).replace(/\s*\n\s*/g, ' ')}${anchor}${body ? `\n${body}` : ''}`)
  }
  const parts = [trimmed(report.verdict)]
  parts.push(bullets.length ? bullets.join('\n\n') : 'No findings: the structured report listed none.')
  const verification = trimmed(report.verification)
  if (verification) parts.push(/^verification:/i.test(verification) ? verification : `Verification: ${verification}`)
  return `${parts.join('\n\n')}\n`
}

function readAgyError(stderrLine) {
  const match = AGY_ERROR.exec(stderrLine)
  if (!match) return null
  try {
    const value = JSON.parse(match[1])
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}

// KNOWN GAP: agy has no documented switch for its hooks, plugins, skills or
// cross-session memories, so a review or consult runs in the user's normal
// agy setup. Only the prompt is kept blind; say so when labelling a result
// independent matters.
// Some agy models (the orchestrators) take no effort and reject the flag;
// `--effort none` names such a model's pair and omits the flag.
function modelArgs(policy) {
  return policy.effort === 'none' ? ['--model', policy.model] : ['--model', policy.model, '--effort', policy.effort]
}

function baseArgs(mode, policy, sessionId) {
  const args = [
    '--output-format', 'stream-json',
    // Headless: no one is there to approve a tool call.
    '--dangerously-skip-permissions',
    // The prompt is data; a leading `/word` must not run a command or skill.
    '--disable-slash-commands',
    ...modelArgs(policy),
  ]
  if (mode === 'review') args.push('--json-schema', JSON.stringify(REVIEW_SCHEMA))
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
  // Only a mid-turn malformed tool call is transient (see MALFORMED_CALL):
  // three retries, as agy's own message promises.
  retryDelays: [500, 500, 500],

  // A review leaves a conversation in agy's history, but review mode has no
  // follow-up: discuss a finding in a consult.
  resumeMode(mode) {
    return mode === 'review' ? '' : mode
  },

  configure(policy) {
    configurePair(policy, { id: 'agy', model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, modelEnv: MODEL_ENV, effortEnv: EFFORT_ENV })
  },

  invocation({ mode, policy, review, scope, text, sessionId, continuing, artifacts }) {
    const args = baseArgs(mode, policy, sessionId)
    if (mode === 'review') {
      const parts = [review.scopeFlag === '--custom' ? review.scopeValue : scopeSentence(scope)]
      if (review.context) parts.push(contextFence(review.context))
      parts.push(REVIEW_CONTRACT, investigationNote(artifacts.scratch))
      return { args, prompt: `${parts.join('\n\n')}\n` }
    }
    // A task gets no note: it is meant to change things.
    let prompt = text
    if (continuing) prompt = typeof continuing === 'string' ? continuing : 'Continue'
    else if (mode === 'consult') prompt = `${text}\n\n${investigationNote(artifacts.scratch)}\n`
    return { args, prompt }
  },

  resumeArgs(policy) {
    // The model flags do not travel with the conversation; pin the pair that
    // answered.
    return modelArgs(policy)
  },

  decoder({ mode, policy }) {
    const state = { sessionId: '', model: policy.model }
    let result = null
    let agyError = null
    let workStarted = false
    // Answer text per agent_response step, in order: result.response is
    // these joined, progress notes first and the final message last.
    const segments = new Map()
    let lastDone = ''
    let lastDoneIndex = -1
    return {
      state,
      push(stream, line) {
        if (stream !== 'stdout') {
          agyError = readAgyError(line) ?? agyError
          return line
        }
        let event
        try { event = JSON.parse(line) } catch { return line }
        const session = event?.conversation_id ?? event?.[event?.event]?.conversation_id
        if (typeof session === 'string' && session) state.sessionId = session.toLowerCase()
        if (event?.event === 'init' && typeof event.init?.model === 'string') state.model = event.init.model
        if (event?.event === 'result' && event.result && typeof event.result === 'object') result = event.result
        const step = event?.step_update
        if (step && step.step_type !== 'user_input') workStarted = true
        if (step?.step_type === 'agent_response' && typeof step.text_delta === 'string') {
          segments.set(step.step_index, (segments.get(step.step_index) ?? '') + step.text_delta)
        }
        if (step?.state === 'DONE' && typeof step.step_type === 'string') {
          lastDone = step.step_type
          lastDoneIndex = step.step_index
        }
        // Streamed answer text arrives a few words per event; the log keeps
        // it, the progress stream would only repeat the result body.
        if (step?.step_type === 'agent_response' && step.state === 'ACTIVE') return ''
        return line
      },
      finish({ status }) {
        let output = typeof result?.response === 'string' ? result.response : ''
        const warnings = []
        if (mode === 'review' && result?.status === 'SUCCESS' && output.trim()) {
          const rendered = renderReview(result.structured_output)
          if (rendered) output = rendered
          else warnings.push('agy returned no usable structured_output for the review schema; the body is its free text, so check it for the [P<n>] shape before counting findings.')
        }
        const message = typeof result?.error === 'string' ? result.error : ''
        // finished_reason is set only when a turn ended early: a partial
        // answer is not an answer.
        const complete = status === 0 && result?.status === 'SUCCESS' && !result.finished_reason && Boolean(output.trim())
        // The one early end that still carries an answer: the empty tool call
        // after a turn whose last finished step was the final message. A last
        // agent_response with no text of its own is the empty call itself,
        // mid-task: the response is only progress notes then.
        const malformed = !complete && result?.status === 'ERROR' && MALFORMED_CALL.test(message)
        const finalText = lastDone === 'agent_response' ? (segments.get(lastDoneIndex) ?? '') : ''
        const salvaged = malformed && mode !== 'review' && Boolean(finalText.trim()) && Boolean(output.trim())
        const usable = complete || salvaged
        // Mid-task, retry in the same conversation with agy's own message.
        const retry = malformed && !salvaged && mode !== 'review' && Boolean(state.sessionId)
        if (salvaged) {
          warnings.push(`agy ended with "${flat(message.split('\n')[0])}" after its final message, a known agy glitch; that message is kept as the result. Check what it claims against the working tree before relying on it, and do not resume just to redo the work.`)
        }
        // result.response joins every agent_response of the turn: in a long
        // task, a dozen "running X, waiting" notes before the report. Keep
        // only the final message when the response provably ends with it;
        // the notes stay in the log.
        const texts = [...segments.values()].filter((text) => text.trim())
        if (usable && mode !== 'review' && texts.length > 1) {
          const last = texts.at(-1).trim()
          if (output.trimEnd().endsWith(last)) {
            output = `${last}\n`
            warnings.push(`kept agy's final message only; ${texts.length - 1} earlier progress note(s) of the same turn are in the log.`)
          }
        }
        const errors = []
        const hints = []
        if (!usable) {
          const clip = (value) => (value.length > 300 ? `${value.slice(0, 300)}...` : value)
          if (message) errors.push(clip(message))
          const short = trimmed(agyError?.short_error)
          if (short && short !== message.trim()) errors.push(clip(short))
          if (result?.finished_reason) errors.push(`agy ended the turn early: ${result.finished_reason}`)
          if (agyError) {
            const facts = [
              agyError.status && `status ${agyError.status}`,
              agyError.reason && `reason ${agyError.reason}`,
              agyError.http_status && `HTTP ${agyError.http_status}`,
              agyError.status_code && `code ${agyError.status_code}`,
              agyError.error_id && `error id ${agyError.error_id}`,
            ].filter(Boolean).map(flat).join(', ')
            if (facts) errors.push(`agy reported ${facts}`)
            if (agyError.retryable === true) hints.push('agy marked this failure retryable: transient — rerun once unchanged.')
            else if (agyError.retryable === false) hints.push('agy marked this failure not retryable: not transient — do not rerun unchanged; report it.')
          }
          const quotaText = [message, trimmed(agyError?.short_error)].find((text) => QUOTA.test(text))
          if (quotaText || agyError?.status === 'RESOURCE_EXHAUSTED') {
            const reset = RESETS_IN.exec(quotaText ?? '')?.[1]
            hints.push(`agy's quota for this model is used up${reset ? ` (resets in ${reset})` : ''}: not transient — do not rerun now. Once it resets, resume the session to finish; otherwise hand the work on as the host's fallback policy says, passing on what partial.md and the working tree show is done.`)
          }
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
          transient: retry ? 'agy sent a malformed tool call mid-turn' : '',
          retryPrompt: retry ? (message.replace(RETRIES_LINE, '').trim() || MALFORMED_RETRY) : '',
          workStarted: workStarted || Boolean(output.trim()),
          errors,
          hints,
          warnings: usable ? warnings : [],
        }
      },
    }
  },
}
