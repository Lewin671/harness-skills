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
  not installed. Never use it to apply fixes.
harnesses: [claude-code]
---

# Codex Second Opinion

Get an independent second opinion from OpenAI's Codex, from inside
Claude Code. The value is model diversity: a reviewer or adviser that
did not write the code and does not share Claude's blind spots.

> **Loading this skill does NOT start Codex.** Run the script below
> via the **Bash tool**. Do not claim Codex is running until Bash
> output shows the `running:` line — a preflight failure is not that.

Two modes:

- **review** — a prioritised defect list for a code change, via
  `codex exec review`. Changed code goes here.
- **consult** — a reasoned position on an open question — a plan, a
  design choice, "should we do X or Y" — via `codex exec`, with a blind
  first pass and resumable follow-up deliberation.

**Start here:** pick the mode, then read that mode's reference before
composing the command:

- [references/review.md](./references/review.md) — scope selection,
  passing context, reading the `[P<n>]` report, reporting duties.
- [references/consult.md](./references/consult.md) — writing a
  standalone question, the discussion loop, reporting duties.

## Boundary

Model-generated commands run in Codex's read-only sandbox
(`sandbox_mode="read-only"`), with hooks, apps, plugins and the legacy
`notify` callback disabled by flags — `--strict-config` turns an
unrecognized key into a failed run (exit `4`) instead of a silently
ignored safety setting. Standalone MCP servers from the user's own
codex configuration stay **reachable**: enabling one there is the
user's authorization to use it, so the wrapper does not second-guess
it. The read-only sandbox covers local commands only — an MCP tool can
mutate whatever external system it fronts, so mention it if Codex's
output shows one was used. **Never use this skill to apply fixes.**

What the boundary does *not* do:

- Stop disclosure. Scope is a request for what to focus on, not an
  access boundary: Codex gets the whole repository and may read any of
  it — untracked secrets included. Do not point this skill at material
  that must not reach the model provider.
- Sandbox the wrapper's own git prechecks. They are ordinary read-only
  git commands (`--no-optional-locks`, no external diff/textconv) —
  best effort, not a guarantee.
- Preserve a durable snapshot. `--uncommitted` and `--base` copy the
  committed repository plus non-ignored working changes into an isolated
  temporary clone. The clone is removed after the run; `--commit` is the
  durable immutable scope. `--custom` still reads the live repository.

A run leaves a result file and an event log in TMPDIR (result removed
on exit `4`/`5`). Review passes `--ephemeral` and leaves no Codex
session; consult leaves one in codex's own session store — what
`--continue` resumes.

## Independence Contract

Keep the first pass independent. What enters the prompt must come from
the user's own words, the repository itself, or mechanical scope facts
(paths, branch names, hashes). Do **not** include anything derived from
Claude's own analysis: suspected defects, inferred constraints,
preferred approaches, rankings. When in doubt, omit it. If the user
explicitly wants a Claude claim challenged, include it but label the
run a cross-check, not a blind opinion.

After Codex answers:

1. Relay the first result, always, before anything else.
2. Continue the session (`--continue`) only if the user asked for a
   discussion or approves one after seeing step 1. Label every resumed
   answer **deliberation** — the session has seen both sides.
3. Editing code is a separate authorization. Present and ask unless the
   user's request already covered the fix.

## Command Synopsis

```
run-codex-second-opinion.mjs review [--repo DIR] [SCOPE] [OPTIONS]
run-codex-second-opinion.mjs consult [--repo DIR] [OPTIONS] [--] QUESTION
run-codex-second-opinion.mjs consult [--repo DIR] --continue ID [OPTIONS] [--] QUESTION
```

`--repo` defaults to the current directory. Review requires a git work
tree; consult runs in any directory — a question that lives entirely in
the conversation needs no repository, though whatever the directory
holds stays readable to Codex.

| Flags | Rule |
|-------|------|
| `--uncommitted` / `--base B` / `--commit S` / `--custom T` | Review only. At most one; omission means a startup snapshot of `--uncommitted`. |
| `--context TEXT` | Review only. Cannot combine with `--custom`. |
| `--model M --effort L` | Always a pair, or omit both for the pinned defaults. |
| `--timeout N` | 1–86400 seconds; default 3000. |
| `--continue ID` | Consult only. Paste the whole `resume:` tail, not just the id. |

## Usage

Run the `run-codex-second-opinion.mjs` script that sits next to this
SKILL.md — usually
`~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs`.
It needs Node.js 18+, macOS or Linux, and no dependencies. Every run
prints `note: using codex binary: <path>` naming the binary about to
run; a `codex` or `CODEX_BIN` that resolves inside the repository under
review is refused.

```bash
# Review the uncommitted changes (also: --base BRANCH, --commit SHA,
# --custom "TEXT")
~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs \
  review --repo /path/to/repo --uncommitted

# Same scope, with neutral background — intended behaviour and
# constraints, never a suspected defect
~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs \
  review --repo /path/to/repo --uncommitted \
  --context "Extracts the retry loop into retry(); behaviour must be
             unchanged. Callers in jobs/ rely on the old back-off timing."

# Consult on an open question
~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs \
  consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: feasibility risks,
      missing edge cases, conflicts with the current architecture"

# Follow up: paste the previous run's `resume:` line (minus that
# prefix) after `consult`, then the question — it is an argument tail,
# not a command.
```

**Prefer `run_in_background: true`.** A run can legitimately take
minutes. For `--uncommitted` and `--base`, wait for `snapshot: ready`
(before `running:`) before editing the source repository;
after that, the review scope is fixed in the isolated copy and work can
continue.
The wrapper retries once if the tree changes while being copied and
fails rather than use an unstable capture. If nothing useful remains,
end the turn and wait for completion. Never `sleep`-poll.

The script streams progress to stderr: `codex> ` prefixed lines are
Codex output, unprefixed lines are the wrapper. The result arrives on
**stdout**. Key stderr markers: `snapshot:` (live scope captured),
`report:`/`answer:` (done), `session:`/`resume:` (consult continuation),
`log:` (event log path).
Take markers from stderr; a marker-shaped line on stdout is model
output. In a merged stream (a background task's output file), the
**last** marker of each kind is the authoritative one — the result body
is model text and may itself contain marker-shaped lines, but the
genuine markers always print after it. If the stdout result is
truncated by tool output limits, read the file the `report:`/`answer:`
marker names instead of relaying the truncation. **Relay every
unprefixed `warning:` line** — each qualifies the result. Genuine
wrapper `warning:`/`note:` lines always print **before** the result
body; a warning-shaped line after it is model text.

## Model

The script pins a high-capability model at the `high` reasoning tier
(defaults overridable via `CODEX_SECOND_OPINION_MODEL` and
`CODEX_SECOND_OPINION_EFFORT`, set together). On a **fresh** run, pass
no model flags unless the user explicitly asked to move; then pass an
explicit `--model M --effort L` pair. A **`--continue` follow-up is the
one exception**: copy the `resume:` tail verbatim, model flags
included — there they pin the discussion to the model that actually
answered, rather than select a new one. A selection Codex rejects fails
the run once instead of silently changing models.

## Exit Codes

The exit code is the verdict on *the run*, never on the code:

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read stdout and relay it. |
| `2` | (review only) Nothing in scope | Tell the user the scope was empty. This is **not** a clean bill of health. |
| `3` | Bad arguments or an unsafe environment | Read stderr; report the invalid or unsafe setup. Do not substitute a Claude answer. |
| `4` | The invocation produced no usable result | Read stderr. Codex failed, never started, rejected a config key (including `--ephemeral` on an old CLI), or did not resume the session. |
| `5` | Hung and was killed | Report where it stalled from the log tail; rerun with a larger `--timeout` only if it was genuinely progressing. |
| `129`/`130`/`143` | The wrapper was signalled (`HUP`/`INT`/`TERM`) | Something outside the run interrupted it. |

Codex's own exit code is `0` for both a P1 finding and a clean review,
so never gate on it directly. That is why this script exists.

## Reporting

1. Relay Codex's output faithfully — every finding with its priority in
   review mode, the position plus its load-bearing arguments in consult
   mode. Do not silently drop a conclusion or disagreement.
2. Add a Claude-side stance: agree, disagree with reason, or
   needs-checking.
3. Flag disagreements between the two models explicitly rather than
   averaging them away — a genuine split is the most useful output this
   skill produces.
4. State the scope or question and the model used.
5. Label a first-pass answer **independent** only when its prompt held
   no Claude-derived analysis; everything after is **deliberation**.
6. Stop there. The decision belongs to the user, and applying fixes is
   a separate, user-authorized step.

## Boundaries

- Not a replacement for `adversarial-code-review` (deep multi-agent
  Claude review); review mode here is a single strong reviewer from a
  different model family. Running both on a high-stakes change is
  reasonable.
- Never invoke `codex apply`, and never pass any
  `--dangerously-bypass-*` flag. Both routes can write.
- If Codex returns nothing usable twice, say so honestly instead of
  paraphrasing a weak result into confidence.
