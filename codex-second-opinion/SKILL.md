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

Two modes, one local boundary:

- **review** — a prioritised defect list for a code change, via
  `codex exec review`. Changed code goes here.
- **consult** — a reasoned position on an open question — a plan, a
  design choice, "should we do X or Y" — via `codex exec`, with
  a blind first pass and resumable follow-up deliberation. Everything
  that is not a diff goes here.

**Start here:** pick the mode, then read that mode's reference before
composing the command — each carries scope or question-writing rules,
the output contract, and reporting duties that this file does not
repeat.

- [references/review.md](./references/review.md) — scope selection,
  passing context, reading the `[P<n>]` report, per-finding reporting
  duties.
- [references/consult.md](./references/consult.md) — writing a
  standalone question, the multi-turn discussion loop and its rules,
  reporting duties.

## Boundary

Model-generated commands run read-only. Hooks, apps, plugins and the
legacy `notify` callback act *outside* that sandbox, so all four are
disabled and verified fail-closed before the run starts. Standalone MCP
servers sit outside it too and are switched off, with the switch-off
confirmed; a listing that cannot be read is never treated as an empty
one. Any of those checks failing refuses the run.

Two flags invert a boundary, and neither is yours to add: `--allow-mcp`
leaves MCP servers reachable, `--allow-git-filters` lets a
repo-configured clean/process filter run during the wrapper's own git
prechecks. Both require the user to have explicitly accepted that risk.
A request for a second opinion is not that acceptance — report and ask.
**Never use this skill to apply fixes.**

What the boundary does *not* do is stop disclosure. Scope is a request
for what to focus on, not an access boundary: Codex gets the whole
repository as its working directory and may read any of it — untracked
secrets included — whatever scope you pass. Do not point this skill at a
repository holding material that must not reach the model provider;
narrowing scope does not create that boundary.

A run that reaches Codex leaves an event log (path always printed), a
result file (kept on `0`, removed on `4`/`5`), and possibly a Codex
session on disk — for **both** modes, so a review's prompt, diff and
findings persist too. `references/internals.md` covers artifact
lifecycle, storage placement and the git-precheck guarantees in full.

## Independence Contract

Keep the first pass independent. Only material from these sources belongs
in the first prompt:

- **User-stated requirements** — what the user asked for, in their words.
- **Repository content** — file paths, documentation, code the question
  is about. Name the files; do not summarise their content through
  Claude's interpretation.
- **Mechanically observed facts** — the scope flag, the branch name, the
  commit SHA, the file count. Things a script could produce.
- **Evaluation criteria** — what a useful answer looks like, what
  dimensions to assess.

Anything Claude inferred, diagnosed, suspected, ranked, or concluded is
not one of those sources. If it entered the prompt it would seed Codex
and destroy the independence this skill exists to provide — even when
disguised as a "fact" or "constraint" (e.g. "the retry path must
preserve ordering" is a constraint only if the user said so; if Claude
inferred it, it is Claude's analysis).

Those travel in the question body in consult mode, and through
`--context` in review mode — a plain scope flag carries the diff and
nothing else, so a review that needs to know the intended behaviour has
to say so there. Do **not** include Claude's preferred answer, ranking,
suspected defect, or argument unless evaluating that exact claim is what
the user asked for.
For a targeted claim, label the run as a cross-check rather than a blind
opinion.

After Codex answers, there is one order of operations, and it does not
branch on how interesting the disagreement is:

1. Relay the first result, always, before anything else.
2. Continue the session (`--continue`) only if the user asked for a
   discussion or approves one after seeing step 1. A follow-up is
   another multi-minute, billable call — do not launch it to settle a
   disagreement on your own initiative. Label every resumed answer
   **deliberation**, never a fresh independent sample: the session has
   now seen both sides' reasoning.
3. Editing code is a separate authorization. Proceed only if the user's
   current request already asked for the fix as well as the review;
   otherwise present and ask.

## Command Synopsis

```
run-codex-second-opinion review --repo DIR [SCOPE] [OPTIONS]
run-codex-second-opinion consult --repo DIR [OPTIONS] [--] QUESTION
run-codex-second-opinion consult --repo DIR --continue ID [OPTIONS] [--] QUESTION
```

**Review scopes** (mutually exclusive; default `--uncommitted`):
`--uncommitted` | `--base BRANCH` | `--commit SHA` | `--custom "TEXT"`

**Common options** (both modes):
`--model MODEL --effort LEVEL` (must be a pair) | `--inherit` |
`--allow-mcp` | `--timeout SECONDS`

**Review-only:** `--context "TEXT"` (cannot combine with `--custom`) |
`--allow-git-filters`

**Consult-only:** `--continue SESSION_UUID`

Flags that the user has not explicitly approved: `--allow-mcp`,
`--allow-git-filters`. Do not add them to overcome an exit `3`.

## Usage

Run the `run-codex-second-opinion` script that sits next to this
SKILL.md — usually
`~/.claude/skills/codex-second-opinion/run-codex-second-opinion`. The
first argument selects the mode. If that path does not exist, locate
the script beside this file rather than reconstructing the command by
hand. The runner requires Node.js 18 or newer, runs on macOS or Linux
only, and has no package-install step or third-party runtime
dependencies. An unsupported platform refuses immediately (exit `3`)
rather than run with unverified process-cleanup and permission-check
behavior.

Every run prints `note: using codex binary: <path>` naming the exact
binary about to run. `CODEX_BIN` and `PATH` handling, and why a
repository-internal entry is refused, are in
[references/internals.md](./references/internals.md), "Codex binary
trust boundary".

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

# Follow up in the same consult session: paste the previous run's
# `resume:` line (minus that prefix) after `consult`, then the question.
# It is an ARGUMENT TAIL, not a command. consult.md explains why copying
# it beats rebuilding it from the session id.
```

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

- New `codex> ...item.started` / `item.completed` lines → working;
  Codex is reading files and running commands.
- Nothing new for several minutes → likely stalled on the model side.
  It will not hang forever: `--timeout` (default 3000s, 1-86400; 0 is
  rejected rather than disabling the watchdog)
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

`log: <path>` names the untruncated stream; tail it rather than reading
the whole file.

Telling the wrapper's own lines from Codex's is mechanical, not
positional: **every line of Codex output echoed to stderr is prefixed
`codex> `, and no line the wrapper writes about itself ever is.** So on
stderr, an unprefixed line is the wrapper speaking. Do not use position
for this — the wrapper's `warning:`, `note:` and `hint:` lines are
emitted throughout the run, including after `running:` (a stale-model
fallback, an event-schema warning, a drift warning, a timeout hint), and
a Codex event can carry text that looks exactly like any of them.

Codex's actual result arrives on **stdout**, never stderr. `report:` /
`answer:`, `log:`, `session:` and `resume:` are additionally re-emitted
after that body, so in a merged stream the last of each kind is the
authoritative one.

**Relay every unprefixed `warning:` line**, not just the drift one — the
wrapper emits them for a stale-model fallback, a disabled-MCP override
that could not be confirmed, a `CODEX_HOME` entry resolving into the
repo, an unreadable working tree, and event-format drift. Each one
qualifies the result you are about to report.

A `--json` stream with no recognizable event still warns, without
gating stdout: the report or answer stands, but treat any fallback,
model, or session note in that run as unconfirmed and recheck
internals.md against the installed codex-cli version.

## Model

The script pins a high-capability model at the `high` reasoning tier.
**Pass no model flags** unless the user explicitly asked to move: raise
to `--model <MODEL> --effort xhigh` for genuinely high-stakes work,
lower or switch family on a stated cost, latency, or model-diversity
preference.

Settings are a closed three-way choice — nothing, an explicit
`--model M --effort L` **pair**, or `--inherit` — and anything else is
refused before a token is spent. Naming a model also turns off the
stale-default fallback, which is why the pair must be complete.

If the pinned default has gone stale the script retries once on the
user's config (never on a consult follow-up) and says so. Relay that
warning: the result came, but not from the tier it promised.
`references/internals.md` covers `CODEX_SECOND_OPINION_MODEL`/`_EFFORT`
and the fallback's exact rules.

## Exit Codes

The exit code is the verdict on *the run*, never on the code:

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read stdout and relay it. |
| `2` | (review only) Nothing in scope | Tell the user the scope was empty. This is **not** a clean bill of health. |
| `3` | Bad arguments, model policy, or environment problem | Read stderr; report the unsafe or invalid setup — this covers usage errors (`--model` without `--effort`, a malformed `--continue` id) as much as an unsafe environment. Do not substitute a Claude answer. |
| `4` | The invocation did not produce a usable result | Read stderr. Usually Codex ran and failed, but also covers `codex` never starting at all (spawn failure), an unresumable follow-up, or a rejected configuration key. |
| `5` | Hung and was killed | Report where it stalled from the log tail; rerun with a larger `--timeout` only if it was genuinely progressing. |
| `129` / `130` / `143` | The wrapper itself was signalled (`HUP`/`INT`/`TERM`) | Not a Codex or environment verdict — something outside the run interrupted it; Codex may still have been mid-invocation. |

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
