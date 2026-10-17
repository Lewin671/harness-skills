// Provider: the Command Code CLI (`cmd`). No sandbox: every run passes
// --yolo, and review/consult are kept read-only by a prompt note plus the
// live-tree fingerprint. Reviews are prompt-built around the wrapper's own
// diff; runs are turn-capped; tasks can run in a worktree the CLI creates.

import { die, EXIT, flat, parseWhole } from '../lib/core.mjs'
import { reviewPrompt } from '../lib/review-prompt.mjs'

// Twice the CLI's own default of 100 (cmd 1.82.3), which a real delegated
// task hit mid-work on 2026-10-15; always passed, so a CLI default change
// cannot move it.
const DEFAULT_MAX_TURNS = 200

// Review and consult run with shell access (--yolo) so the model can
// investigate, which leaves this note as the only thing asking it not to
// write. Measured 2026-10-14: without it, 4/4 "fix it"-style consults tried
// to edit the repository; with it, 0/4.
function readOnlyNote(scratch) {
  return `---
This is a read-only second opinion, run headlessly. You may run commands to investigate — tests, git log/show/diff, small reproduction scripts — but write scratch files only under ${scratch}. Do not modify files in the repository, do not change git state (no commit, checkout, reset, stash or push), do not install anything, and do not offer to make changes.`
}

// One line per tool call — what the model actually ran or read — is all of
// the event stream worth showing live; the full frames go to the log.
function toolSummary(event) {
  const input = event.input && typeof event.input === 'object' ? event.input : {}
  const detail = [input.command, input.file_path, input.path, input.pattern, input.query]
    .find((value) => typeof value === 'string' && value)
    ?? JSON.stringify(input)
  return `tool: ${event.toolName} ${detail}`.replace(/\s+/g, ' ').trim()
}

// The CLI's documented exit codes, as remedies. The wrapper exits 4 for all
// of them and reports the raw code as `provider-exit:`.
const EXIT_HINTS = {
  1: 'the CLI rejected the invocation (unknown model or effort, a bad flag, a missing session); fix the arguments rather than rerunning unchanged.',
  3: 'not authenticated — run `cmd login`, then retry.',
  4: 'a tool was refused by the permission engine despite --yolo; check ~/.commandcode/settings.json for a deny rule.',
  5: 'rate limited; wait and rerun, or move to a less loaded model.',
  6: 'a transport or upstream failure; rerunning unchanged is reasonable.',
  7: 'a transport or upstream failure; rerunning unchanged is reasonable.',
  9: 'the model returned no response.',
  10: 'insufficient credits for the selected model; the account needs a top-up or a cheaper model.',
  127: 'the cmd binary could not be started — check `note: using cmd binary:` above and COMMAND_CODE_BIN.',
}

export default {
  id: 'command-code',
  name: 'Command Code',
  prefix: 'cmd> ',
  binary: { name: 'cmd', envVar: 'COMMAND_CODE_BIN' },
  snapshot: false,
  reviewDiff: true,
  retryDelays: [],
  options: {
    '--max-turns': {
      value: 'N',
      help: `cap the conversation turns (default: ${DEFAULT_MAX_TURNS})`,
      modes: ['review', 'consult', 'task'],
      apply(policy, raw) { policy.maxTurns = parseWhole(raw, '--max-turns') },
    },
    '--worktree': {
      value: '',
      help: 'work in a fresh git worktree the CLI creates (fresh tasks only)',
      modes: ['task'],
      apply(policy) { policy.worktree = true },
    },
  },

  // Every mode leaves a session; a review is followed up as a consult — same
  // session, same read-only note, no scope to re-resolve.
  resumeMode(mode) {
    return mode === 'review' ? 'consult' : mode
  },

  // Model and effort are independent and both optional: without them the run
  // uses the CLI's configured model at that model's own effort.
  configure(policy) {
    policy.maxTurns ??= DEFAULT_MAX_TURNS
    // A resumed session already lives in its working directory; --worktree
    // would make a second worktree the session was never in.
    if (policy.worktree && policy.sessionId) die(EXIT.usage, 'error: --worktree starts a new session; drop it when resuming')
  },

  // Every mode runs with --yolo: print mode otherwise refuses shell to the
  // main loop, and a reviewer that cannot run a test or `git log` cannot
  // investigate. Adjudicated by the user on 2026-10-14 — do not re-raise it.
  // Before that, no permission flag was never a boundary either: the `agent`
  // tool is exempt from the permission lists (re-measured on cmd 1.82.3).
  invocation({ mode, policy, review, scope, text, sessionId, artifacts }) {
    const args = ['-p']
    if (sessionId) args.push('--resume', sessionId)
    // Skipping onboarding keeps an automated run from waiting on a prompt.
    args.push('--yolo', '--output-format', 'json', '--skip-onboarding')
    // The reviewed repository's own skills cannot steer a read-only pass; a
    // delegated task may well want them.
    if (mode !== 'task') args.push('--no-skills')
    if (mode === 'task' && policy.worktree) args.push('--worktree')
    args.push('--max-turns', String(policy.maxTurns))
    if (policy.model) args.push('--model', policy.model)
    // The CLI stores an explicit effort as that model's default in the
    // user's config, so it is passed only when a caller asked for one.
    if (policy.effort) args.push('--effort', policy.effort)
    let prompt = text
    if (mode === 'review') prompt = reviewPrompt(review, scope, readOnlyNote(artifacts.scratch))
    else if (mode === 'consult') prompt = `${text}\n\n${readOnlyNote(artifacts.scratch)}\n`
    // The prompt travels on stdin: a scope diff can run to megabytes, past
    // the OS limit for one argv element. `-p` with no query reads stdin.
    return { args, prompt, via: 'stdin' }
  },

  resumeArgs(policy, outcome) {
    // A session does not remember its model (measured on cmd 1.82.3), so the
    // model that actually answered always travels. Effort does not need to:
    // the CLI already stored an explicit one as that model's default.
    const args = []
    const model = outcome.model || policy.model
    if (model) args.push('--model', model)
    if (policy.maxTurns !== DEFAULT_MAX_TURNS) args.push('--max-turns', String(policy.maxTurns))
    return args
  },

  decoder() {
    const state = { sessionId: '', model: '', workdir: '' }
    let result = null
    let blocked = 0
    // The CLI's last plain-text lines: a rejected invocation exits before any
    // result frame, and this is the only place its reason appears.
    const plain = []
    return {
      state,
      push(stream, line) {
        if (!line.trimStart().startsWith('{')) {
          if (line.trim()) {
            plain.push(line.trim())
            if (plain.length > 3) plain.shift()
          }
          return line
        }
        // NDJSON frames are not echoed — one can carry a whole conversation —
        // only a summary of each tool call.
        let frame
        try { frame = JSON.parse(line) } catch { return line }
        if (frame?.type === 'result') {
          result = frame
          if (typeof frame.sessionId === 'string') state.sessionId = frame.sessionId.toLowerCase()
          return null
        }
        const event = frame?.type === 'event' ? frame.event : null
        if (!event || typeof event !== 'object') return null
        // run_start names the session before any model work happens.
        if (typeof event.sessionId === 'string' && !state.sessionId) state.sessionId = event.sessionId.toLowerCase()
        if (typeof event.model === 'string' && (event.type === 'model_request_start' || event.type === 'model_request_end')) {
          state.model = event.model
        }
        // A blocked tool is not a failure — the turn continues — but part of
        // the work was refused, which qualifies the result.
        if (event.type === 'tool_hook_blocked') blocked += 1
        // run_end reports the workspace the run actually used — the only
        // place a --worktree run names the worktree the CLI created.
        const cwd = event.type === 'run_end' ? event.result?.nextState?.modState?.workspace?.cwd : undefined
        if (typeof cwd === 'string' && cwd) state.workdir = cwd
        return event.type === 'tool_queued' && typeof event.toolName === 'string' ? toolSummary(event) : null
      },
      finish({ status }) {
        const finalText = typeof result?.finalText === 'string' ? result.finalText : ''
        // `success`, or `max_turns`, which returns a truncated-but-real
        // response. An empty finalText, or no frame at all, is no verdict.
        const usable = Boolean(finalText.trim()) && (result.subtype === 'success' || result.subtype === 'max_turns')
        const warnings = []
        // Keyed on either signal: a pairing that reports one without the
        // other is still flagged rather than passed off as complete.
        if (status === 8 || result?.subtype === 'max_turns') {
          warnings.push('the run hit its turn cap, so this result is truncated; treat it as partial.')
        }
        if (blocked) warnings.push(`the permission engine refused ${blocked} tool call(s) during this run; part of the work was not done.`)
        const errors = []
        const hints = []
        const message = typeof result?.error === 'string' ? result.error.trim() : ''
        if (!usable) {
          // Relayed verbatim rather than matched: the CLI already names the
          // problem and the remedy, and its wording is not ours to track.
          if (message) errors.push(message)
          else if (!result && status !== 0) errors.push(...plain.map((line) => `cmd: ${line.length > 300 ? `${line.slice(0, 300)}...` : line}`))
          if (EXIT_HINTS[status]) hints.push(EXIT_HINTS[status])
          if (/No session .* found to resume/i.test(message)) hints.push('the session to resume no longer exists; start a fresh consultation and restate the context.')
          if (/Unknown config setting/i.test(message)) hints.push('the installed cmd rejected a setting this script passes; the CLI may have drifted from the flags in providers/command-code.mjs.')
        }
        const usage = result?.usage || {}
        const parts = [
          `input=${flat(usage.inputTokens ?? 0)}`,
          `output=${flat(usage.outputTokens ?? 0)}`,
          `cacheRead=${flat(usage.cacheReadTokens ?? 0)}`,
        ]
        if (typeof result?.durationMs === 'number') parts.push(`durationMs=${result.durationMs}`)
        if (blocked) parts.push(`blockedTools=${blocked}`)
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
