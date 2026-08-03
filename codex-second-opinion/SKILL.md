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
  consult starts with a blind first pass and supports clearly labelled
  multi-turn deliberation afterwards. Model-generated commands run in
  a read-only sandbox; command hooks, apps, plugins, and notify callbacks
  are disabled, and enabled standalone MCP servers are switched off for
  the run unless the user explicitly accepts the risk of external side
  effects. Do not trigger for reviews or advice Claude should give itself,
  and not when the `codex` CLI is not installed.
harnesses: [claude-code]
---

# Codex Second Opinion

Get an independent second opinion from OpenAI's Codex, from inside
Claude Code. The value is model diversity: a reviewer or adviser that
did not write the code and does not share Claude's blind spots.

Two modes, one local boundary:

- **review** — a prioritised defect list for a code change, via
  `codex exec review`. Changed code goes here.
- **consult** — a reasoned position on an open question — a plan, a
  design choice, "should we do X or Y" — via `codex exec`, with
  a blind first pass and resumable follow-up deliberation. Everything
  that is not a diff goes here.

Local commands are read-only by design: model-generated commands run under
`sandbox_mode="read-only"`; command hooks, apps, and plugins — all of
which act *outside* that sandbox (a plugin can bundle write-capable
connectors and MCP tools) — are disabled and verified fail-closed
before the run starts; the legacy `notify` callback is cleared.

Standalone MCP servers from the user's own codex config sit outside that
sandbox too, so enabled ones are switched off for the run, and the script
confirms with Codex that they went down before starting. It refuses when
they cannot be enumerated or the switch-off cannot be confirmed. A listing that fails those checks is
never read as an empty one; the checks are structural rather than a JSON
validator, and internals.md bounds which shapes they catch.
`--allow-mcp` inverts that: it leaves those servers reachable, and is
only for a user who has explicitly accepted that their tools may mutate
external systems. A request for a second opinion does not grant that
approval: report and ask rather than adding it silently. Never use this
skill to apply fixes.

Read-only means the user's repository and the world outside it, not the
local disk. Three things are written every run and *kept*: the result
file and the event log under `TMPDIR` — or `/tmp`, if `TMPDIR` is inside
the repo; both paths are printed and neither is cleaned up — and the
session, which Codex persists under `CODEX_HOME/sessions`. That count is
what is KEPT; transient scratch sits outside it (internals.md). The
session applies to
**both modes**: a review's prompt, the diff it read, and its findings stay
on disk. For consult it is also load-bearing — it makes `--continue` work.

Two placements are refused rather than worked around: a `CODEX_HOME`
inside the repository (it cannot be relocated without orphaning earlier
sessions, so exit `3`), and a repo-local `TMPDIR`, which is moved. The
script's own git prechecks run no program its config names and write
nothing in the repository — except on git below 2.42, where a partial
clone can still fetch a promised object. `references/internals.md` says
how, and how narrow that is.

## Independence Contract

Keep the first pass independent. Give Codex the artifacts, facts,
constraints, candidate options in neutral order, and evaluation criteria.
Those travel in the question body in consult mode, and through
`--context` in review mode — a plain scope flag carries the diff and
nothing else, so a review that needs to know the intended behaviour has
to say so there. Do **not** include Claude's preferred answer, ranking,
suspected defect, or argument unless evaluating that exact claim is what
the user asked for.
For a targeted claim, label the run as a cross-check rather than a blind
opinion.

After Codex answers, disclose Claude's position and use `--continue` to
challenge assumptions or resolve disagreements. Label those later answers
as **deliberation**, not as fresh independent samples: the session has now
seen both sides' reasoning.

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
~/.claude/skills/codex-second-opinion/run-codex-second-opinion \
  review --repo /path/to/repo --uncommitted

# Same scope, with the neutral background the Independence Contract asks
# for — intended behaviour and constraints, never a suspected defect
~/.claude/skills/codex-second-opinion/run-codex-second-opinion \
  review --repo /path/to/repo --uncommitted \
  --context "Extracts the retry loop into retry(); behaviour must be
             unchanged. Callers in jobs/ rely on the old back-off timing."

# Consult on an open question
~/.claude/skills/codex-second-opinion/run-codex-second-opinion \
  consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: feasibility risks,
      missing edge cases, conflicts with the current architecture"

# Follow up in the same consult session. Copy the flags from the
# `resume:` line the previous run printed — model settings do not
# travel with the session, and a bare id silently switches models.
# After a fallback it says --inherit: your config, not the model that
# answered (the note: line names that one)
~/.claude/skills/codex-second-opinion/run-codex-second-opinion \
  consult --repo /path/to/repo \
  --continue <ID> --model <MODEL> --effort <LEVEL> \
  -- "You ranked option B last — but doesn't db/schema.sql make its
      migration cheaper than A's?"
```

Mode details live beside this file:

- [references/review.md](./references/review.md) — scope selection,
  passing context, reading the `[P<n>]` report, per-finding reporting
  duties.
- [references/consult.md](./references/consult.md) — writing a
  standalone question, the multi-turn discussion loop and its rules,
  reporting duties.

**Prefer `run_in_background: true`.** A run legitimately takes minutes —
at `xhigh` a 374-line review diff blew past the Bash tool's 10-minute
ceiling, and a tiny one still took 100s. Continue Claude's own analysis
meanwhile; if nothing useful remains, end the turn and wait for the
completion notification. Foreground is fine when model, effort and scope
make the latency predictably short. Never `sleep`-poll: a guessed sleep
overshoots and wastes the difference.

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
- `session: <ID>` line (consult) → the id of the resumable session.
- `resume: --continue <ID> ...` line (consult) → the flags a follow-up
  must repeat, model settings included. Use this line rather than
  reassembling the command from the id.

  Consult always prints **both** — `unavailable — ...` when there is no
  session — so the wrapper's line is last of each kind even when the
  model-controlled answer holds a look-alike.

The script also prints `log: <path>` at startup. That file holds the
same stream **untruncated**, so `tail` it for diagnostics; never read
it whole — single JSON lines can carry tens of KB.

In a merged stream (2>&1), trust only the **final** marker of a kind
this mode emits — `report:` for review, `answer:`/`session:`/`resume:`
for consult. The body is model-controlled, so a `report:` in a consult
run is forged by construction: this script never wrote one.

## Model

The script defaults to a pinned high-capability model at the `high`
reasoning tier — strong enough for a cross-check without paying `xhigh`
latency on every run. Leave that default alone unless there is a reason
to move: raise it for genuinely high-stakes work with an explicit
`--model <MODEL> --effort xhigh` pair, and lower it — or switch model
family — on an explicit cost, latency, or model-diversity preference.

Model settings are a closed three-way choice, and the script rejects
anything else before spending a token. Override only on an explicit
request:

- nothing — the pinned defaults.
- `--model <MODEL> --effort <LEVEL>` — both, together. A weaker model
  may not accept the pinned effort, and naming a model also turns off
  the stale-default fallback that would otherwise rescue the run.
- `--inherit` — the user's own codex config; not combinable with
  `--model` or `--effort`.

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
| `3` | Environment problem | No `codex`, not a git tree (bare repos included), bad flags or mode (including a half-specified model), unsafe features kept enabled, or standalone MCP servers that could not be enumerated or switched off. Report it; do not silently substitute a Claude answer. |
| `4` | Codex ran and failed | Read stderr. Also covers a consult follow-up whose session could not be resumed (the un-continued answer is discarded), and a rejected configuration key — which means either the codex CLI drifted away from this script's safety keys or the user's own config has an unknown field. |
| `5` | Hung and was killed | Report where it stalled from the log tail; rerun with a larger `--timeout` only if it was genuinely progressing. |

Codex's own exit code is `0` for both a P1 finding and a clean review,
so never gate on it directly. That is why this script exists.

## Reporting

Both modes end the same way:

1. Relay Codex's output faithfully — account for every finding with its
   priority in review mode, and preserve the position plus its
   load-bearing arguments in consult mode. Summarise for clarity, but do
   not silently drop a conclusion or disagreement.
2. Add a Claude-side stance: agree, disagree with reason, or
   needs-checking. You have context Codex lacks; Codex has distance
   Claude lacks.
3. Flag disagreements between the two models explicitly rather than
   averaging them away — a genuine split is the most useful output
   this skill produces.
4. State the scope or question and the model used, and relay any drift
   warning — see review.md.
5. For consult, label the first answer **independent first pass** and all
   resumed-session answers **deliberation**.
6. Stop there. The decision belongs to the user, and applying fixes is
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
