---
name: codex-second-opinion
description: >-
  Claude Code ONLY — do not use in Codex itself, which has its own
  /review. Use this skill when the user explicitly wants an independent
  second opinion from Codex (OpenAI models). Use review mode when they
  ask Codex to review or cross-check a code change — a diff, the
  working tree, a branch, or a commit ("let codex review this",
  "cross-check with codex") — or when a contested Claude-side review
  needs an independent reviewer. Use consult mode when they ask Codex
  to weigh in on a design, plan, decision, trade-off, or open question
  ("ask codex what it thinks", "which option would codex pick");
  consult supports multi-turn follow-ups in the same session. Both
  modes run read-only: model-generated commands run in a read-only
  sandbox, command hooks and notify callbacks are disabled; only
  write-capable MCP servers from the user's own codex config sit
  outside that boundary. Do not trigger for reviews or advice Claude
  should give itself, and not when the `codex` CLI is not installed.
harnesses: [claude-code]
---

# Codex Second Opinion

Get an independent second opinion from OpenAI's Codex, from inside
Claude Code. The value is model diversity: a reviewer or adviser that
did not write the code and does not share Claude's blind spots.

Two modes, one boundary:

- **review** — a prioritised defect list for a code change, via
  `codex exec review`. Changed code goes here.
- **consult** — a reasoned position on an open question — a plan, a
  design choice, "should we do X or Y" — via `codex exec`, with
  resumable multi-turn sessions. Everything that is not a diff goes
  here.

Read-only by design: model-generated local commands run under
`sandbox_mode="read-only"`; command hooks — which run *outside* that
sandbox once trusted — are disabled and verified fail-closed before
the run starts; the legacy `notify` callback is cleared. The boundary
does not extend to external MCP servers from the user's codex config —
a write-capable MCP server stays reachable, so do not pick this skill
where strict isolation from those is required. Never use this skill to
apply fixes.

## Usage

Run the `run-codex-second-opinion` script that sits next to this
SKILL.md — usually
`~/.claude/skills/codex-second-opinion/run-codex-second-opinion`. The
first argument selects the mode. If that path does not exist, locate
the script beside this file rather than reconstructing the command by
hand.

```bash
# Review the uncommitted changes (also: --base BRANCH, --commit SHA,
# --custom "TEXT")
run-codex-second-opinion review --repo /path/to/repo --uncommitted

# Consult on an open question
run-codex-second-opinion consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: feasibility risks,
      missing edge cases, conflicts with the current architecture"

# Follow up in the same consult session (id from the `session:` line)
run-codex-second-opinion consult --repo /path/to/repo --continue <ID> \
  -- "You ranked option B last — but doesn't db/schema.sql make its
      migration cheaper than A's?"
```

Mode details live beside this file:

- [references/review.md](./references/review.md) — scope selection,
  reading the `[P<n>]` report, per-finding reporting duties.
- [references/consult.md](./references/consult.md) — writing a
  standalone question, the multi-turn discussion loop and its rules,
  reporting duties.

**Always run it with `run_in_background: true`, then end the turn.**
The default is the strongest model at xhigh reasoning effort and
legitimately runs for minutes — a two-file, 374-line review diff blew
past the Bash tool's 10-minute ceiling, and a tiny one still took
100s. Start it in the background, then do other work or stop and
wait — the completion notification resumes the conversation the moment
the run finishes. Never `sleep`-poll: a guessed sleep usually
overshoots the actual finish time and wastes the difference.

### Is it still running, or hung?

The script streams a bounded progress feed to stderr — one truncated
line per Codex event — so the background task's output file grows in
real time and stays small:

- New `item.started` / `item.completed` lines → working; Codex is
  reading files and running commands.
- Nothing new for several minutes → likely stalled on the model side.
  It will not hang forever: `--timeout` (default 3000s, max 86400)
  kills the whole process group and exits `5`.
- `report:` (review) or `answer:` (consult) line → finished; the
  result is on stdout.
- `session: <ID>` line (consult) → the id to pass with `--continue`.

The script also prints `log: <path>` at startup. That file holds the
same stream **untruncated**, so `tail` it for diagnostics; never read
it whole — single JSON lines can carry tens of KB.

## Model

The script defaults to the strongest available model at xhigh
reasoning effort, and **you should normally leave that alone**. A
second opinion that is weaker than the first opinion is not worth the
round trip; latency is the wrong thing to optimise here.

Override only on an explicit request:

- `--model <MODEL> --effort <LEVEL>` — always pass both. A weaker
  model rejects the default `xhigh` effort and the run dies a minute
  in.
- `--inherit` — use the user's own codex config instead.

If the pinned default model has gone stale, the script says so and
retries once on the user's configured model — but never on a consult
follow-up (see [references/consult.md](./references/consult.md)).
Relay the fallback warning when it fires: the result still came, but
not from the tier it promised.

## Exit Codes

The exit code is the verdict on *the run*, never on the code:

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read stdout and relay it. |
| `2` | (review only) Nothing in scope | Tell the user the scope was empty. This is **not** a clean bill of health. |
| `3` | Environment problem | No `codex`, not a git tree (bare repos included), bad flags or mode, or hooks that managed policy keeps enabled. Report it; do not silently substitute a Claude answer. |
| `4` | Codex ran and failed | Read stderr. Also covers a consult follow-up whose session could not be resumed (the un-continued answer is discarded). |
| `5` | Hung and was killed | Report where it stalled from the log tail; rerun with a larger `--timeout` only if it was genuinely progressing. |

Codex's own exit code is `0` for both a P1 finding and a clean review,
so never gate on it directly. That is why this script exists.

## Reporting

Both modes end the same way:

1. Relay Codex's output faithfully — every finding with its priority
   in review mode, the position *and* its load-bearing arguments in
   consult mode. Do not compress or silently drop anything.
2. Add a Claude-side stance: agree, disagree with reason, or
   needs-checking. You have context Codex lacks; Codex has distance
   Claude lacks.
3. Flag disagreements between the two models explicitly rather than
   averaging them away — a genuine split is the most useful output
   this skill produces.
4. State the scope or question and the model used, so it is
   reproducible.
5. Stop there. The decision belongs to the user, and applying fixes is
   a separate, user-authorized step.

## Boundaries

- Not a replacement for `adversarial-code-review`: that is a deep
  multi-agent Claude review with skeptics and red teams; review mode
  here is a single strong reviewer from a different model family. They
  are complementary — running both on a high-stakes change is
  reasonable.
- Never invoke `codex apply`, and never pass any
  `--dangerously-bypass-*` flag. Both routes can write.
- If Codex returns nothing usable twice, say so honestly instead of
  paraphrasing a weak result into confidence.
- The rationale for every non-obvious script decision is in
  [references/internals.md](./references/internals.md); recheck it
  against new codex-cli releases before changing the script.
