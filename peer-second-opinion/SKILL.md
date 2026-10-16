---
name: peer-second-opinion
description: >-
  Get an independent second opinion from a peer coding-agent CLI — Codex
  (`codex`) or Command Code (`cmd`) — a different harness and model that did
  not write the code. Requires an explicit user request naming the peer; every
  trigger below is conditional on that. Use review mode when the user asks the
  peer to review or cross-check a code change — a diff, the working tree, a
  branch, or a commit ("let codex review this", "让 command code 审一下") — or to
  adjudicate a contested finding from the host's own review. Use consult mode
  when they ask the peer to weigh in on a design, plan, decision, trade-off, or
  open question ("ask codex what it thinks", "问问 command code"). Never call the
  CLI you are running inside. Do not trigger on a review or question the host
  should answer itself, or on a disagreement the user has not asked the peer to
  settle. Never use it to apply fixes; to hand the peer the work itself, use
  delegate-to-peer.
---

# Peer Second Opinion

A blind second look from another coding-agent CLI. The value is a perspective
that does not share the host's blind spots. Its conclusions can be wrong: treat
them as input to weigh, never as a verdict.

> **Loading this skill does NOT start the peer.** Run the script below in a
> shell. Do not claim the peer is running until the output shows the
> `running:` line — a preflight failure is not that.

## Providers

| `<provider>` | CLI | Read-only by | Notes |
|---|---|---|---|
| `codex` | `codex` | a real read-only sandbox | Native review command; isolated review snapshots; pinned model. [providers/codex.md](./references/providers/codex.md) |
| `command-code` | `cmd` | a prompt note only (`--yolo`) | Turn-capped; drift is detected, not prevented. [providers/command-code.md](./references/providers/command-code.md) |

Use the provider the user named. **Never pick the CLI you are running inside**
(Codex has its own `/review`; Command Code would be reviewing itself); if the
user names it, say so and ask which peer to use. If the
named provider fails, report that — never quietly switch to another one. Read
the provider's reference before its first run.

## Modes

Pick one, then read its reference before composing the command:

- **review** — a prioritised defect list for a code change.
  [references/review.md](./references/review.md)
- **consult** — a reasoned position on an open question: a plan, a design
  choice, "X or Y". [references/consult.md](./references/consult.md)

The script's third mode, `task`, delegates work that may edit files; it belongs
to [delegate-to-peer](../delegate-to-peer/SKILL.md), and nothing here about
read-only runs applies to it.

## Boundary

- Scope is focus, not access: the peer may read the whole repository,
  untracked secrets included. Do not point it at material that must not reach
  its model provider.
- The repository's `AGENTS.md`, the user's own CLI configuration and any MCP
  servers it enables load into the run and can steer it. Enabling an MCP server
  there is the user's authorization; mention it if the output shows one was
  used. Use the skill on repositories the user trusts.
- A run leaves a result file and an event log in TMPDIR, plus whatever session
  the CLI itself keeps.
- **Never use review or consult to apply fixes.**

## Independence Contract

What enters a first-pass prompt must come from the user's own words, the
repository, or mechanical scope facts (paths, branch names, hashes) — never from
the host's own analysis: suspected defects, inferred constraints, preferred
approaches, rankings. When in doubt, omit it. If the user explicitly wants a
host claim challenged, include it and label the run **deliberation**.

After the peer answers:

1. Relay the result faithfully, before anything else — every finding with its
   priority (review), or the position plus its load-bearing arguments
   (consult). State the provider, model, and scope or question.
2. Add the host's stance on each point — agree, disagree with reason, or
   needs-checking — and verify checkable claims before presenting them as fact.
   "I ran it and it returned X" is a claim too: check the `log:` file.
3. Flag splits between the two models explicitly rather than averaging them
   away; a genuine split is the most useful thing this skill produces.
4. Label an answer **independent** only when its prompt held no host-derived
   analysis. Once the host's position has entered the session — or a fresh
   session that restates it — every answer is **deliberation**.
5. Then stop. Continue the session only if the user asked for a discussion or
   approves one. Applying fixes is the user's call; the host applies them,
   never the peer.

## Command Synopsis

```
peer.mjs <provider> review [--repo DIR] [SCOPE] [OPTIONS]
peer.mjs <provider> consult [--repo DIR] [OPTIONS] [--] QUESTION
peer.mjs <provider> consult [--repo DIR] --resume ID [OPTIONS] [--] QUESTION
```

| Flags | Rule |
|-------|------|
| `--uncommitted` / `--base B` / `--commit S` / `--custom T` | Review only. At most one; omission means `--uncommitted`. |
| `--context TEXT` | Review only. Neutral background; cannot combine with `--custom`. |
| `--model M`, `--effort L` | Codex needs both together; Command Code takes either. Pass them only when the user asked for a model. |
| `--timeout N` | 1–86400 seconds; default 3000 (7200 for a task). |
| `--resume ID` | Consult or task only. Continue a session (see § Reading the output). |
| `--max-turns N` | Command Code only; default 200. |

Review requires a git work tree; consult runs in any directory.

## Usage

`peer.mjs` sits next to this SKILL.md. Harnesses load skills from different
places (`~/.claude/skills/` for Claude Code, `~/.agents/skills/` for Codex and
Command Code), so take the directory this SKILL.md was loaded from — never
copy a path from an example — and use that script for every run. It needs
Node.js 18+, macOS or Linux, and the provider's CLI, authenticated.

```bash
PEER=<directory of this SKILL.md>/peer.mjs

"$PEER" codex review --repo /path/to/repo --uncommitted

"$PEER" command-code consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: risks, missing edge cases"
```

Hold edits to the reviewed paths until the run ends — or, for a Codex
`--uncommitted`/`--base` review, until `snapshot: ready`.

### Running it from your harness

A run takes minutes and starts a second CLI that needs network access and
writes its own config and session files (`~/.codex`, `~/.commandcode`) as well
as TMPDIR.

- **Claude Code, Command Code:** start it as a background shell task and wait
  for it to exit — the completion notice resumes you. Never `sleep`-poll.
- **Codex, or any host without background tasks:** run it in the foreground
  with the shell tool's longest timeout. If the tool returns before the
  process exits, keep waiting on that same process (its session or task id) —
  never start a second run. A model can be silent for minutes; never kill a
  run because it looks idle.
- **A sandboxed host shell** (Codex in `read-only` or `workspace-write`): run
  the command outside the sandbox through the host's own escalation mechanism.
  Inside it, the run typically fails — exit `3` (scratch files cannot be
  written) or exit `4` with a network or `EPERM` error in the log tail —
  because of the host's sandbox, not the peer. If the host forbids escalation,
  report that the peer cannot run here and stop; do not retry or work around
  it.

### Reading the output

- Trust the exit code. On `0`, read the file named by the last `result:` line.
- `codex> ` / `cmd> ` lines are the CLI; unprefixed lines are the wrapper.
  **Relay every unprefixed `warning:` line before the first `body: begin`** —
  each qualifies the result; after it, interleaved model text can look alike.
- `model:` names the model that answered. On a live-tree run the wrapper
  compares its before/after `identity:` fingerprints itself and prints a drift
  `warning:` if they differ — relay it. A match means the scoped change did not
  shift, not that nothing was touched: rewrites of existing ignored files and
  writes under `.git/` go unseen.
- To follow up, copy the last `resume:` line, minus the `resume: ` prefix,
  and append `-- "question"`; never rebuild it from the session id — it
  carries the model that answered.

When a merged or truncated stream must be interpreted directly, see
[references/output-protocol.md](./references/output-protocol.md).

## Exit Codes

The exit code is the verdict on *the run*, never on the code.

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read the result file and relay it. A `warning:` still qualifies it. |
| `2` | (review) Nothing in scope | Say the scope was empty — **not** a clean review. |
| `3` | Bad arguments or an unusable environment | Report the stderr reason; fix the arguments or environment — never rerun unchanged. If the CLI cannot be found, relay the `hint:` lines and stop. Do not substitute a host-written answer. |
| `4` | No usable result | The CLI failed or the session did not resume. Report the `error:` and `hint:` lines; `provider-exit:` is the CLI's own code (provider reference). |
| `5` | Timed out | Report it with the log tail. |
| `129`/`130`/`143` | The wrapper was signalled | Report it; do not rerun unless the user asks. |

- On a review or consult, rerun at most once, only for a transient cause
  (network, capacity, timeout, or a session that did not resume). When
  rerunning:
  - after exit `5`, append `-- "Continue; check the current state first."`
    to the `resume:` line if one is usable — a retry, so no extra
    authorization and the same label; with no usable `resume:` line, start
    fresh;
  - after exit `4`, start fresh (a consult restates the context).
- A task follows delegate-to-peer's round limit instead.

If a rerun still returns nothing usable, say so rather than paraphrasing a
weak result into confidence.
