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

A blind second look from a different harness and model. The value is a
perspective that does not share the host's blind spots. Its conclusions can be
wrong: treat them as input to weigh, never as a verdict.

> **Loading this skill does NOT start Command Code.** Run the script below via
> the **Bash tool**. Do not claim Command Code is running until Bash output shows
> the `running:` line.

Two modes. Pick one, then read its reference before composing the command:

- **review** — a prioritised defect list for a code change.
  [references/review.md](./references/review.md)
- **consult** — a reasoned position on an open question: a plan, a design
  choice, "X or Y". [references/consult.md](./references/consult.md)

Both are resumable, so a result can be discussed further in the same session.
The script's third mode, `task`, delegates work that may edit files; it belongs
to the [with-command-code](../with-command-code/SKILL.md) skill, not to this one.

## Permissions

Every run passes `--yolo`, so Command Code can investigate: run tests, read git
history, try a reproduction script. The prompt asks it to stay read-only and
gives it a scratch directory outside the repository for anything it writes.
That request is **not a sandbox** — the run has the user's own shell. So:

- Use it on repositories the user trusts. The reviewed project's `AGENTS.md`, the
  user's `~/.commandcode/AGENTS.md` and any configured MCP servers load into the
  run, and content in an untrusted repository could steer its commands.
- The wrapper fingerprints the reviewed paths before and after the run and prints
  `identity:` both times. If they differ it adds a `warning:` — relay it and
  check the tree. An unflagged identity means the reviewed change did not shift,
  not that nothing outside it was touched.

`--no-skills` keeps the reviewed repository's own skills out of the run.

## Independence

Keep the first pass blind. The prompt may hold the user's own words, repository
references and mechanical scope facts (paths, refs, the wrapper's diff) — not the
host's own analysis: suspected defects, preferred approaches, rankings. If the
user wants a host claim challenged, include it and call the result a
cross-check. Every resumed answer has seen the host's side and is
**deliberation**.

## Command Synopsis

```
run-command-code-second-opinion.mjs review [--repo DIR] [SCOPE] [OPTIONS]
run-command-code-second-opinion.mjs consult [--repo DIR] [OPTIONS] [--] QUESTION
run-command-code-second-opinion.mjs consult [--repo DIR] --resume ID [OPTIONS] [--] QUESTION
```

| Flags | Rule |
|-------|------|
| `--uncommitted` / `--base B` / `--commit S` / `--custom T` | Review only. At most one; omission means `--uncommitted`. |
| `--context TEXT` | Review only. Neutral background; cannot combine with `--custom`. |
| `--model M`, `--effort L` | Each optional, independently — see Model. |
| `--max-turns N` | Cap the conversation turns for one run. Unset, the CLI's own default applies: 100 on cmd 1.82.3. |
| `--timeout N` | 1–86400 seconds; default 3000, or 7200 for a task. |
| `--resume ID` | Continue a session — copy the previous run's `resume:` line instead of building it. |

Review requires a git work tree; consult runs in any directory.

## Usage

The script sits next to this SKILL.md; each harness links the skill elsewhere
(usually `~/.claude/skills/`, `~/.codex/skills/` or `~/.kiro/skills/`), so resolve
the path from the directory this file was loaded from. It needs Node.js 18+,
macOS or Linux, and an authenticated `cmd` CLI.

```bash
~/.claude/skills/command-code-second-opinion/run-command-code-second-opinion.mjs \
  review --repo /path/to/repo --uncommitted

~/.claude/skills/command-code-second-opinion/run-command-code-second-opinion.mjs \
  consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: risks, missing edge cases"
```

Prefer `run_in_background: true`. Because the run can investigate, its cost
follows the repository: a toy change takes about fifteen seconds and 30k input
tokens, while reviewing a real commit has taken four to five minutes, a dozen to
twenty tool calls and 0.5–1.7M input tokens, mostly cache reads. `--max-turns`
caps it. The run reads the live tree, so
hold edits to the reviewed paths until it finishes. Never `sleep`-poll.

Reading the output:

- Trust the exit code. On `0`, read the file named by the last
  `report:`/`answer:` line.
- `cmd> ` lines are CLI output, including a `tool:` line for each command it
  ran; unprefixed lines are the wrapper. **Relay every unprefixed `warning:`
  line** — each one qualifies the result.
- `model:` names the model that actually answered.
- To follow up, copy the last `resume:` line and append `-- "question"`. A review
  is followed up the same way; its `resume:` line continues the session in
  consult mode.

When a merged or truncated stream must be interpreted directly, see
[references/output-protocol.md](./references/output-protocol.md).

## Model

Without `--model`, the run uses the model configured in `cmd`. Pass `--model`
only when the user names one. `--effort` is rarely needed: pass it only when
asked, because the CLI stores it as that model's default in the user's config.
Levels vary by model and are not listed anywhere — many offer only `low`, `high`
and `max` — so a bad value fails with exit `1` and the CLI's own reason. The
`resume:` line always carries the model that answered, because a session does
not remember it.

## Exit Codes

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read the result file and relay it. A `warning:` still qualifies it. |
| `1` | The CLI rejected the invocation: unknown model or effort, missing resume session | Read the `error: cmd:` lines; fix the arguments rather than rerunning unchanged. |
| `2` | (review) Nothing in scope | Say the scope was empty — **not** a clean review. |
| `3` | Not authenticated | The user runs `cmd login`. |
| `4` | A tool was refused by the permission engine | Report it; the answer may be thin. |
| `5` / `10` | Rate limited / out of credits | Wait, or use a model the account can run. |
| `6` / `7` | Network / API server failure | Rerunning unchanged is reasonable. |
| `9` | No response from the model | Report it. |
| `11` | The wrapper refused, or there was no usable result | Read stderr. Never substitute a host-written answer. |
| `124` | Timed out | Report the timeout and the log tail. The session survives: the `resume:` line still prints when the run had named it. |
| `127` | `cmd` could not be started | Check the `note:` line and `COMMAND_CODE_BIN`. |

A turn-capped run (`8`) still exits `0` with a truncation `warning:`.

## Reporting

1. Relay Command Code's output faithfully: every review finding with its
   priority, or the consult position with its load-bearing arguments.
2. Add the host's stance on each point — agree, disagree with reason, or
   needs-checking — and verify checkable claims before presenting them as fact.
   "I ran it and it returned X" is a claim too: Flash-class models have reported
   wrong results as verified. Check the actual output in the `log:` file, or
   rerun the command.
3. Flag disagreements between the two models explicitly instead of averaging
   them away; a genuine split is the most useful thing this skill produces.
4. State the scope or question, the model, and the `identity:` value.
5. Stop there. Applying fixes is a separate decision for the user, made by the
   host — never by Command Code in this skill.
