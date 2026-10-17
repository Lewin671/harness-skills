// Provider: DeepSeek Harness (`dsh`), run through its `headless` profile.
// A real sandbox: review and consult run read-only, a task with full access.
// No review command, so reviews are prompt-built around the wrapper's own
// diff. Model and effort reach the CLI as a --patch overlay, since the
// headless profile has no flags for them.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { die, EXIT, flat } from '../lib/core.mjs'
import { reviewPrompt } from '../lib/review-prompt.mjs'

// `deepseek-flash` is DeepSeek-V4.1-Flash on the official API (its /models
// listing, 2026-10-17); efforts there are low, high and max.
const DEFAULT_MODEL = 'deepseek-flash'
const DEFAULT_EFFORT = 'max'
// The route the overlay names. An overlay replaces the whole config entry, so
// it cannot inherit the profile's own provider and must restate one.
const ROUTE = 'deepseek-official'

// dsh prints session ids as `session-<uuid>`; the wrapper's resume contract
// is a bare UUID.
const SESSION_PREFIX = 'session-'

// The sandbox already refuses writes and, headless, every escalation; the
// note keeps the model from spending turns trying.
const READ_ONLY_NOTE = `---
This is a read-only second opinion, run headlessly in a read-only sandbox: commands that write fail, and requests for wider sandbox permissions are refused. Investigate with commands that only read — git log/show/diff, searches, reading files — and do not try to modify files, change git state, request wider permissions, or offer to make changes.`

function overlay(policy) {
  // JSON strings are valid YAML scalars, so no value can turn into syntax.
  return `- id: agent-default-model
  config:
    provider: ${JSON.stringify(ROUTE)}
    model: ${JSON.stringify(policy.model)}
    reasoningEffort: ${JSON.stringify(policy.effort)}
`
}

function toolSummary(event) {
  const input = event.input && typeof event.input === 'object' ? event.input : {}
  const detail = [input.command, input.path, input.file_path, input.pattern, input.query, input.url]
    .find((value) => typeof value === 'string' && value)
    ?? JSON.stringify(input)
  return `tool: ${event.tool} ${detail}`.replace(/\s+/g, ' ').trim()
}

export default {
  id: 'dsh',
  name: 'DeepSeek Harness',
  prefix: 'dsh> ',
  binary: { name: 'dsh', envVar: 'DSH_BIN' },
  snapshot: false,
  reviewDiff: true,
  retryDelays: [],
  options: {},

  // Every mode leaves a session; a review is followed up as a consult.
  resumeMode(mode) {
    return mode === 'review' ? 'consult' : mode
  },

  configure(policy) {
    policy.model ||= DEFAULT_MODEL
    policy.effort ||= DEFAULT_EFFORT
  },

  invocation({ mode, policy, review, scope, text, sessionId, continuing, artifacts }) {
    const patch = join(dirname(artifacts.out), 'dsh.patch.yml')
    try {
      writeFileSync(patch, overlay(policy), { mode: 0o600 })
    } catch (error) {
      die(EXIT.usage, `error: could not write the dsh model overlay: ${flat(error.message)}`)
    }
    const args = ['headless', '--patch', patch, '--json']
    if (sessionId) args.push('--session-id', `${SESSION_PREFIX}${sessionId}`)
    // `-` reads the task from stdin: a scope diff can run to megabytes, past
    // the OS limit for one argv element.
    args.push('-')
    let prompt = continuing ? 'Continue' : text
    if (mode === 'review') prompt = reviewPrompt(review, scope, READ_ONLY_NOTE)
    else if (mode === 'consult' && !continuing) prompt = `${text}\n\n${READ_ONLY_NOTE}\n`
    // A delegated task runs like the user's own dsh with approvals off: it
    // may need to write anywhere or reach the network.
    const env = { DSH_PERMISSION_MODE: mode === 'task' ? 'danger-full-access' : 'read-only' }
    return { args, prompt, via: 'stdin', env }
  },

  resumeArgs(policy) {
    // The overlay is per run, not part of the session: pin what answered.
    return ['--model', policy.model, '--effort', policy.effort]
  },

  decoder({ policy }) {
    const state = { sessionId: '', model: policy.model, workdir: '' }
    let finalText = ''
    let reason = null
    const eventErrors = []
    const usage = { input: 0, output: 0, cacheRead: 0 }
    let tools = 0
    // dsh's own diagnostics: a rejected invocation (unknown session, a
    // session recorded elsewhere) says why only here.
    const plain = []
    return {
      state,
      push(stream, line) {
        let event = null
        if (stream === 'stdout' && line.trimStart().startsWith('{')) {
          try { event = JSON.parse(line) } catch {}
        }
        if (!event || typeof event !== 'object') {
          if (stream === 'stderr' && line.trim()) {
            plain.push(line.trim())
            if (plain.length > 3) plain.shift()
          }
          return line
        }
        if (event.type === 'session' && typeof event.sessionId === 'string') {
          state.sessionId = event.sessionId.replace(SESSION_PREFIX, '').toLowerCase()
        } else if (event.type === 'final' && typeof event.text === 'string') {
          finalText = event.text
        } else if (event.type === 'error' && typeof event.message === 'string') {
          eventErrors.push(event.message)
        } else if (event.type === 'status' && event.phase === 'turn_end') {
          reason = event.reason ?? null
        } else if (event.type === 'status' && event.phase === 'step_end' && event.usage) {
          usage.input += Number(event.usage.inputTokens) || 0
          usage.output += Number(event.usage.outputTokens) || 0
          usage.cacheRead += Number(event.usage.cacheReadTokens) || 0
        } else if (event.type === 'tool_call' && typeof event.tool === 'string') {
          tools += 1
          return toolSummary(event)
        }
        // Thinking, text and tool results go to the log only.
        return null
      },
      finish({ status }) {
        const kind = reason?.kind
        const usable = status === 0 && Boolean(finalText.trim()) && kind !== 'error'
        const warnings = []
        if (usable && kind !== 'completed') {
          warnings.push(`the run ended with reason '${flat(kind ?? 'none')}' rather than completing; treat this result as partial.`)
        }
        const errors = []
        const hints = []
        if (!usable) {
          const error = reason?.error
          if (typeof error?.message === 'string') errors.push(error.code ? `${error.code}: ${error.message}` : error.message)
          else if (eventErrors.length) errors.push(...eventErrors)
          else errors.push(...plain.map((line) => (line.length > 300 ? `${line.slice(0, 300)}...` : line)))
          const all = [...errors, ...plain].join('\n')
          if (/supported API model names/i.test(all)) {
            hints.push(`the API rejected model '${flat(policy.model)}'; the error lists the supported names — pass one with --model, or omit --model for the default ${DEFAULT_MODEL}.`)
          } else if (error?.code === 'UNSUPPORTED_REASONING_EFFORT') {
            // dsh checks the effort itself, before any request: no HTTP status.
            hints.push(`dsh rejected effort '${flat(policy.effort)}'; DeepSeek's official models take low, high or max.`)
          }
          if (/was recorded in/.test(all)) hints.push('the session belongs to another directory; rerun the resume with --repo set to the directory it was recorded in.')
          if (/does not exist; omit --session-id/.test(all)) hints.push('the session to resume no longer exists; start a fresh consultation and restate the context.')
          if (error?.status === 401 || error?.status === 403) hints.push('not authenticated — dsh reads DEEPSEEK_API_KEY from the environment or $DSH_HOME/.env.')
          if (error?.status === 429) hints.push('rate limited or out of balance; wait and rerun, or check the DeepSeek account.')
          if (error?.status >= 500) hints.push('an upstream failure; rerunning unchanged is reasonable.')
          if (status === 127) hints.push('the dsh binary could not be started — check `note: using dsh binary:` above and DSH_BIN.')
        }
        const parts = [`input=${usage.input}`, `output=${usage.output}`, `cacheRead=${usage.cacheRead}`, `tools=${tools}`]
        return {
          ...state,
          output: finalText,
          usable,
          transient: '',
          workStarted: true,
          warnings,
          errors,
          hints,
          usageLine: parts.join(' '),
        }
      },
    }
  },
}
