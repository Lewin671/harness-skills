---
name: codex-second-opinion
description: >-
  Claude Code ONLY — do not use in Codex itself, which has its own
  /review. Get an independent second opinion from Codex (OpenAI
  models). Requires an explicit user request for one; every trigger
  below is conditional on that. Use review mode when the user asks
  Codex to review or cross-check a code change — a diff, the working
  tree, a branch, or a commit ("let codex review this", "cross-check
  with codex"), or asks Codex to adjudicate a contested finding from
  Claude's own review. Use consult mode when they ask Codex to weigh in
  on a design, plan, decision, trade-off, or open question ("ask codex
  what it thinks", "which option would codex pick"). Do not trigger on
  a review or question Claude should answer itself, on a disagreement
  the user has not asked Codex to settle, or when the `codex` CLI is
  not installed. Never use review or consult to apply fixes; to hand
  Codex the work itself, use delegate-to-codex.
harnesses: [claude-code]
---

# Codex Second Opinion

Get an independent second opinion from OpenAI's Codex — a reviewer or
adviser from a different model family that did not write the code.

> **Loading this skill does NOT start Codex.** Run the script below
> via the **Bash tool**. Do not claim Codex is running until Bash
> output shows the `running:` line — a preflight failure is not that.

Two modes, both read-only:

- **review** — a prioritised defect list for a code change, via
  `codex exec review`. Changed code goes here.
- **consult** — a reasoned position on an open question — a plan, a
  design choice, "should we do X or Y" — via `codex exec`, with a blind
  first pass and resumable follow-up deliberation.

The same script also has a full-access `task` mode for delegated work;
it belongs to [delegate-to-codex](../delegate-to-codex/SKILL.md), and
nothing in this file about read-only runs applies to it.

**Start here:** pick the mode, then read that mode's reference before
composing the command:

- [references/review.md](./references/review.md) — scope selection,
  snapshots, passing context, reading the `[P<n>]` report.
- [references/consult.md](./references/consult.md) — writing a
  standalone question, the discussion loop.

## Boundary

Review and consult run in Codex's read-only sandbox
(`sandbox_mode="read-only"`), with hooks, apps, plugins, cross-session
memories and the `notify` callback disabled; `--strict-config` turns an
unrecognized key into a failed run (exit `4`) instead of a silently
ignored safety setting. Standalone MCP servers from the user's own
codex configuration stay **reachable** — enabling one there is the
user's authorization — and the sandbox covers local commands only, so
mention it if Codex's output shows an MCP tool was used.

- The sandbox covers Codex's commands, not the wrapper's own git
  prechecks — ordinary read-only git commands, best effort.
- Scope is focus, not access: Codex may read the whole repository,
  untracked secrets included. Do not point it at material that must
  not reach the model provider.
- `--uncommitted` and `--base` review an isolated temporary snapshot;
  `--commit` and `--custom` read the live repository, so hold edits
  until the run ends when a stable reading matters.
- A run leaves a result file and an event log in TMPDIR. Review passes
  `--ephemeral`; consult leaves a session in codex's own store — what
  `--continue` resumes.
- **Never use review or consult to apply fixes.** Never invoke
  `codex apply` or a `--dangerously-bypass-*` flag.

This is a single strong reviewer from another model family, not a
replacement for `adversarial-code-review`; running both on a
high-stakes change is reasonable.

## Independence Contract

What enters a first-pass prompt must come from the user's own words,
the repository, or mechanical scope facts (paths, branch names,
hashes) — never from Claude's own analysis: suspected defects, inferred
constraints, preferred approaches, rankings. When in doubt, omit it. If
the user explicitly wants a Claude claim challenged, include it and
label the run a **cross-check**. Every run disables codex's
cross-session memories, so a first pass carries no other session's
context either.

After Codex answers:

1. Relay the result faithfully, before anything else — every finding
   with its priority (review), or the position plus its load-bearing
   arguments (consult). State the scope or question and the model.
2. Add a Claude-side stance — agree, disagree with reason, or
   needs-checking — and flag splits between the models explicitly
   rather than averaging them away.
3. Label a first-pass answer **independent** only when its prompt held
   no Claude-derived analysis; everything after is **deliberation**.
4. Continue a consult (`--continue`) only if the user asked for a
   discussion or approves one after step 1. Review leaves no session;
   to discuss a finding, start a consult carrying it or run a
   `--custom` cross-check, both **deliberation**.
5. Stop there. Editing code is a separate, user-authorized step. If
   Codex returns nothing usable twice, say so rather than paraphrasing
   a weak result into confidence.

## Command Synopsis

```
run-codex-second-opinion.mjs review [--repo DIR] [SCOPE] [OPTIONS]
run-codex-second-opinion.mjs consult [--repo DIR] [OPTIONS] [--] QUESTION
run-codex-second-opinion.mjs consult [--repo DIR] --continue ID [OPTIONS] [--] QUESTION
```

`--repo` defaults to the current directory. Review requires a git work
tree; consult runs in any directory.

| Flags | Rule |
|-------|------|
| `--uncommitted` / `--base B` / `--commit S` / `--custom T` | Review only. At most one; omission means `--uncommitted`. |
| `--context TEXT` | Review only. Cannot combine with `--custom`. |
| `--model M --effort L` | Always a pair, or omit both for the pinned defaults (see Model). |
| `--timeout N` | 1–86400 seconds; default 3000. |
| `--continue ID` | Consult only. Copy the previous run's `resume:` line and append `-- QUESTION`; never rebuild it from the id. |

## Usage

Run the `run-codex-second-opinion.mjs` script next to this SKILL.md —
usually `~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs`.
Prerequisites and binary resolution are in
[references/execution.md](./references/execution.md).

```bash
~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs \
  review --repo /path/to/repo --uncommitted

~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs \
  consult --repo /path/to/repo -- "Evaluate the plan in docs/plan.md"
```

**Prefer `run_in_background: true`** and end the turn; a run can take
minutes. Never `sleep`-poll. For `--uncommitted` and `--base`, edit the
source repository only after `snapshot: ready`.

Progress streams to stderr — `codex> ` lines are Codex, unprefixed
lines are the wrapper — and the result arrives on stdout plus a file.
Trust the exit code; on exit `0` read the file named by the last
`report:`/`answer:` line. **Relay every unprefixed `warning:` line.**
When the stream itself must be interpreted (merged output, truncation,
marker-shaped text in the body), follow
[references/output-protocol.md](./references/output-protocol.md).

## Model

The script pins a high-capability model at the `high` reasoning tier
(overridable together via `CODEX_SECOND_OPINION_MODEL` and
`CODEX_SECOND_OPINION_EFFORT`). On a fresh run pass no model flags
unless the user asked to move; then pass an explicit `--model M
--effort L` pair. A `--continue` follow-up copies the `resume:` line
verbatim, model flags included — there they pin the model that already
answered. A rejected model fails without falling back; "model at
capacity" is retried automatically with the same model — relay the
retry notes and let it finish (details in references/execution.md).

## Exit Codes

The exit code is the verdict on *the run*, never on the code — codex
itself exits `0` for both a P1 finding and a clean review:

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read the file the last `report:`/`answer:` line names and relay it. |
| `2` | (review only) Nothing in scope | Tell the user the scope was empty. This is **not** a clean bill of health. |
| `3` | Bad arguments or an unsafe environment | Report the stderr reason. Do not substitute a Claude answer. |
| `4` | No usable result | Codex failed, was not authenticated, rejected a config key, flag or model (report its message), exhausted capacity retries, or did not resume the session. |
| `5` | Timed out, or no time left for a capacity retry | Report the timeout and log tail. After a capacity retry could not fit, stop; otherwise rerun with a larger `--timeout` only if it was genuinely progressing. |
| `129`/`130`/`143` | The wrapper was signalled | Something outside the run interrupted it. |
