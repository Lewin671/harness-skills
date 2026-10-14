---
name: command-code-second-opinion
description: >-
  Claude Code, Codex and Kiro harnesses — not Command Code itself, which
  has its own /review. Get an independent second opinion from the Command
  Code CLI. Requires an explicit user request for one; every trigger below
  is conditional on that. Use review mode when the user asks Command Code
  to review or cross-check a code change — a diff, the working tree, a
  branch, or a commit ("让 command code 审一下", "cross-check with command
  code") — or asks it to adjudicate a contested finding from the host's
  own review. Use consult mode when they ask Command Code to weigh in on a
  design, plan, decision, trade-off, or open question ("ask command code
  what it thinks", "which option would command code pick"). Do not trigger
  on a review or question the host should answer itself, on a disagreement
  the user has not asked Command Code to settle, or when the `cmd` CLI is
  not installed. Never use it to apply fixes.
harnesses: [claude-code, codex, kiro]  # not command-code: that harness has its own /review
---

# Command Code Second Opinion

Get an independent second opinion from Command Code, from inside another
harness. The value is model diversity: a reviewer or adviser that did not write
the code and does not share the host's blind spots.

> **Loading this skill does NOT start Command Code.** Run the script below via
> the **Bash tool**. Do not claim Command Code is running until Bash output shows
> the `running:` line — a preflight failure is not that.

Two modes:

- **review** — a prioritised defect list for a code change. Changed code goes
  here.
- **consult** — a reasoned position on an open question — a plan, a design
  choice, "should we do X or Y" — with a blind first pass and resumable
  follow-up deliberation.

**Start here:** pick the mode, then read that mode's reference before composing
the command:

- [references/review.md](./references/review.md) — scope selection, the
  wrapper-supplied diff, reading the `[P<n>]` report.
- [references/consult.md](./references/consult.md) — writing a standalone
  question, the discussion loop.

## Boundary

The wrapper passes **no permission flag**. The run inherits whatever permission
mode the user has configured in `cmd`, and it never receives `--yolo`,
`--accept-edits`, `--dangerously-skip-permissions` or a permission mode — those
are the flags that would widen its authority.

Command Code's print mode refuses file writes, edits and shell for the **main
loop**. That is not the whole story, and this skill must not pretend otherwise:

- The `agent` tool is an unconditional exception to the deny/ask/allow lists, and
  a delegated sub-agent auto-allows what the main loop would prompt on. Measured
  on cmd 1.82.1 (2026-10-14): a headless run created a file by delegating the
  write to a sub-agent. **Treat the run as not sandboxed**: do not point it at a
  tree whose bytes must not change, and check the reviewed paths afterwards.
- Because a run can mutate the tree, the wrapper fingerprints the reviewed paths
  before and after and prints `identity:` both times. When they differ it adds a
  `warning:` — that is a **detector, not a lock**: drift is reported after the
  fact, and an answer qualified that way is not identity-verified. The digest
  covers the reviewed paths and the working-tree status, ignored paths included,
  so a file created or deleted anywhere in the tree changes it. It does **not**
  cover an in-place rewrite of an existing ignored file, or any write under
  `.git/`; hashing ignored file contents would make every run proportional to
  `node_modules`. Never present an unflagged `identity:` as proof the tree was
  left alone.
- The wrapper's own git calls are read-only (`--no-optional-locks`, no external
  diff or textconv, no lazy fetch).

What is loaded whether or not anyone wants it: the reviewed project's
`AGENTS.md`, the user's `~/.commandcode/AGENTS.md` and taste profile, and any MCP
server the user configured. `--no-skills` deliberately disables skill discovery
so the reviewed repository's own skills cannot steer a nominally blind pass.
Mention an MCP server if the output shows one was used.

## Independence Contract

Keep the first pass independent. What enters the prompt must come from the
user's own words, the repository itself, or mechanical scope facts (paths,
branch names, hashes, the wrapper's diff). Do **not** include anything derived
from the host's own analysis: suspected defects, inferred constraints, preferred
approaches, rankings. When in doubt, omit it. If the user explicitly wants a
host claim challenged, include it but label the run a cross-check, not a blind
opinion.

Independence also holds across sessions: a fresh run carries no conversation
history, so it holds neither host-derived analysis nor another session's
context. A resumed consult keeps its own session history — that is exactly what
makes it deliberation.

After Command Code answers:

1. Relay the first result, always, before anything else.
2. Continue the session (`--resume`, consult only) only if the user asked for a
   discussion or approves one after seeing step 1. Label every resumed answer
   **deliberation** — the session has seen both sides. To discuss a review
   finding further, start a consult carrying the finding — also labelled
   **deliberation** — or run a `--custom` cross-check.
3. Editing code is a separate authorization. Present and ask unless the user's
   request already covered the fix.

## Command Synopsis

```
run-command-code-second-opinion.mjs review [--repo DIR] [SCOPE] [OPTIONS]
run-command-code-second-opinion.mjs consult [--repo DIR] [OPTIONS] [--] QUESTION
run-command-code-second-opinion.mjs consult [--repo DIR] --resume ID [OPTIONS] [--] QUESTION
```

`--repo` defaults to the current directory. Review requires a git work tree;
consult runs in any directory.

| Flags | Rule |
|-------|------|
| `--uncommitted` / `--base B` / `--commit S` / `--custom T` | Review only. At most one; omission means `--uncommitted`. |
| `--context TEXT` | Review only. Cannot combine with `--custom`. |
| `--model M --effort L` | Always a pair, or omit both to use the CLI's configured model. |
| `--max-turns N` | Cap the conversation turns for one run. |
| `--timeout N` | 1–86400 seconds; default 3000. Covers the CLI run only — the wrapper's own git preflight has a separate fixed budget. |
| `--resume ID` | Consult only. Do not rebuild the command from the id alone — copy the previous run's `resume:` line and append the question (see consult.md). |

## Usage

Run the `run-command-code-second-opinion.mjs` script that sits next to this
SKILL.md. Each harness links this skill elsewhere — usually
`~/.claude/skills/`, `~/.codex/skills/` or `~/.kiro/skills/`, so resolve the
path relative to the directory this SKILL.md was loaded from. It needs Node.js
18+, macOS or Linux, no dependencies, and a `cmd` CLI that is already
authenticated — an unauthenticated CLI fails the run with exit `3`. Every run
that gets as far as validating its arguments prints
`note: using cmd binary: <path>` naming the binary about to run; a `cmd` or
`COMMAND_CODE_BIN` that resolves inside the repository under review is refused.

```bash
# Review the uncommitted changes (also: --base REF, --commit SHA, --custom "TEXT")
~/.claude/skills/command-code-second-opinion/run-command-code-second-opinion.mjs \
  review --repo /path/to/repo --uncommitted

# Same scope, with neutral background — intended behaviour and constraints,
# never a suspected defect
~/.claude/skills/command-code-second-opinion/run-command-code-second-opinion.mjs \
  review --repo /path/to/repo --uncommitted \
  --context "Extracts the retry loop into retry(); behaviour must be unchanged."

# Consult on an open question
~/.claude/skills/command-code-second-opinion/run-command-code-second-opinion.mjs \
  consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: feasibility risks,
      missing edge cases, conflicts with the current architecture"
```

**Prefer `run_in_background: true`.** A run can legitimately take minutes and
cost real tokens — a trivial headless call already spends roughly 13k input
tokens on system prompt and project memory, and a real review has run to a dozen
model requests. The wrapper reads the live tree, so hold edits to the reviewed
paths for the whole run. If nothing useful remains, end the turn and wait for
completion. Never `sleep`-poll.

The script streams progress to stderr — `cmd> ` prefixed lines are CLI output,
unprefixed lines are the wrapper — and the result arrives on **stdout** plus a
file. The normal path needs two rules: trust the exit code, and on exit `0` read
the result from the file named by the last `report:`/`answer:` line rather than
parsing the body out of the stream (this also survives tool output truncation).
Unprefixed `note:` lines are operational facts about the run; **relay every
unprefixed `warning:` line** — those are the ones that qualify the result. For a
follow-up, copy the last `resume:` line verbatim (consult only). When the stream
itself must be interpreted — merged background output with marker-shaped lines
in the body, duplicates, truncation — authenticate markers by
[references/output-protocol.md](./references/output-protocol.md).

## Model

Nothing is pinned: the run uses whatever model the CLI is configured to use, and
the wrapper reports which model actually answered on the `model:` line. Pass
`--model M --effort L` as a **pair** only when the user explicitly asks to move
— that is also how you deliberately buy model diversity. A selection the CLI
rejects fails the run rather than silently falling back.
`COMMAND_CODE_SECOND_OPINION_MODEL` and `COMMAND_CODE_SECOND_OPINION_EFFORT`
override both together (set both or neither). A `--resume` follow-up carries the
pair only when one was in force.

## Exit Codes

The wrapper passes Command Code's own documented codes through rather than
inventing a parallel vocabulary. Only `2`, `11`, `124` and `127` are its own;
`129`/`130`/`143` come from its signal handlers.

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read the file the last `report:`/`answer:` line names and relay it. |
| `2` | (review only) Nothing in scope | Tell the user the scope was empty. This is **not** a clean bill of health. |
| `3` | Not authenticated | The user needs to run `cmd login`. |
| `4` | A tool was refused by the permission engine | Report it; a partially refused run explains a thin answer. |
| `5` / `10` | Rate limited / insufficient credits | Wait, or move to a model the account can run. |
| `6` / `7` | Network failure / API server error | Rerunning unchanged is reasonable. |
| `8` | Max turns reached | Reported as a truncated result: the body is emitted with a `warning:` and the wrapper still exits `0`. |
| `9` | The model produced no response | Report it; there is no body. |
| `11` | The wrapper refused to run, or produced no usable result | Read stderr. Never substitute a host-written answer. |
| `124` | The run exceeded `--timeout` and was killed | Report the timeout and the log tail. |
| `127` | The `cmd` binary could not be started | Check the `note:` line naming the binary and `COMMAND_CODE_BIN`. |
| `129`/`130`/`143` | Signalled (`HUP`/`INT`/`TERM`) | Something outside the run interrupted it. |

`0` means a usable result, never approval: an exit `0` carrying a drift or
truncation `warning:` is information, not a verification.

## Reporting

1. Relay Command Code's output faithfully — every finding with its priority in
   review mode, the position plus its load-bearing arguments in consult mode. Do
   not silently drop a conclusion or disagreement.
2. Add a host-side stance: agree, disagree with reason, or needs-checking.
3. Flag disagreements between the two models explicitly rather than averaging
   them away — a genuine split is the most useful output this skill produces.
4. State the scope or question, the model that answered, and the `identity:`
   value the result is tied to.
5. Label a first-pass answer **independent** only when its prompt held no
   host-derived analysis; everything after is **deliberation**.
6. Stop there. Applying fixes is a separate, user-authorized step.

## Boundaries

- Not a replacement for `adversarial-code-review` (a main review plus one
  subagent's independent review in isolated context); review mode here is a
  single strong reviewer from a different model family. Running both on a
  high-stakes change is reasonable.
- Never pass `--yolo`, `--accept-edits`, `--dangerously-skip-permissions` or a
  permission mode to this script, and never use it to apply fixes.
- If Command Code returns nothing usable twice, say so honestly instead of
  paraphrasing a weak result into confidence.
