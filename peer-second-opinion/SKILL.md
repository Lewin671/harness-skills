---
name: peer-second-opinion
description: >-
  Get an independent second opinion from a peer coding-agent CLI — Codex
  (`codex`), Command Code (`cmd`) or DeepSeek Harness (`dsh`) — a different
  harness and model that did not write the code. Requires an explicit user request for the peer, by name
  or as "the peer" ("让 peer 看看"); every trigger below is conditional on that. Use review mode when the user asks the
  peer to review or cross-check a code change — a diff, the working tree, a
  branch, or a commit ("let codex review this", "让 command code 审一下") — or to
  adjudicate a contested finding from the host's own review. Use consult mode
  when they ask the peer to weigh in on a design, plan, decision, trade-off,
  open question, or how to fix something ("ask codex what it thinks", "问问 command code",
  "让 codex 看看这个 bug 怎么修"). Never call the
  CLI you are running inside. Do not trigger on a review or question the host
  should answer itself, or on a disagreement the user has not asked the peer to
  settle. Never use it to apply fixes; to hand the peer the work itself —
  implementing, or investigating and reporting back — use delegate-to-peer.
---

# Peer Second Opinion

A blind second look from another coding-agent CLI: a perspective that does not
share the host's blind spots. It can be wrong — weigh it, never treat it as a
verdict.

> **Loading this skill does NOT start the peer.** Run the script below. Do not
> claim the peer is running until the output shows a `running:` line.

## Providers

| `<provider>` | CLI | Read-only by |
|---|---|---|
| `codex` | `codex` | a real sandbox; isolated review snapshots |
| `command-code` | `cmd` | **a prompt note only** (`--yolo`); turn-capped |
| `dsh` | `dsh` | a real sandbox |

- **Never pick the CLI you are running inside.** If the user names it, say so
  and ask which peer to use; if it is the only peer installed, there is no
  peer — say so.
- **Named:** pass it. If it fails, report that — never quietly switch.
- **Not named:** inside Codex pass `command-code`; inside Command Code or dsh
  pass `codex`; anywhere else pass `auto`, which runs the first installed of
  Codex, Command Code and dsh and names it in a `note: auto selected` line.
- Every later call for the same request uses the provider that actually ran.
- When relaying, say which peer ran and why; for a Command Code run the user
  did not name, add that its read-only mode is a prompt request, not a sandbox.

The provider references — [codex](./references/providers/codex.md),
[command-code](./references/providers/command-code.md),
[dsh](./references/providers/dsh.md) — cover model overrides, provider-only
options, Codex snapshot limits and failure remedies. Read the one you need when
a run fails or before passing a provider-specific option.

## Modes

Pick one and read its reference before composing the command:

- **review** — a prioritised defect list for a code change.
  [references/review.md](./references/review.md)
- **consult** — a reasoned position on an open question: a plan, a design
  choice, "X or Y", how to fix a bug. [references/consult.md](./references/consult.md)

The script's `task` mode belongs to
[delegate-to-peer](../delegate-to-peer/SKILL.md); nothing here about read-only
runs applies to it.

## Boundary

- Scope is focus, not access: the peer may read the whole repository,
  untracked secrets included. Do not point it at material that must not reach
  its model provider.
- The repository's `AGENTS.md`, the user's CLI configuration and the MCP
  servers it enables steer the run; enabling a server there is the user's
  authorization. Mention MCP use when the output shows it. Use the skill on
  repositories the user trusts.
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
   analysis and, for a review, the reviewing model did not write the change
   (a fresh session with the authoring model is **self-review**). Once the
   host's position has entered the session — or a fresh session that
   restates it — every answer is **deliberation**.
5. Then stop. Continue the session only if the user asked for a discussion or
   approves one. Applying fixes is the user's call; the host applies them,
   never the peer.

## Commands

```
peer.mjs <provider> review [--repo DIR] [SCOPE] [OPTIONS]
peer.mjs <provider> consult [--repo DIR] [OPTIONS] [--] QUESTION
```

| Flags | Rule |
|-------|------|
| `--uncommitted` / `--base B` / `--commit S` / `--custom T` | Review scope: at most one; default `--uncommitted`. |
| `--context TEXT` | Review only: neutral background; not with `--custom`. |
| `--model M`, `--effort L` | Only when the user asked for a model; Codex needs both together. |
| `--timeout N`, `--resume ID` | Run deadline (default 3000 s); continuation — use the printed `resume:` line. |

`peer.mjs` sits next to this SKILL.md. Use the copy in the directory this
SKILL.md was loaded from — never a path copied from an example. It needs
Node.js 18+, macOS or Linux, and the provider's CLI, authenticated; review
needs a git work tree.

```bash
PEER=<directory of this SKILL.md>/peer.mjs

"$PEER" codex review --repo /path/to/repo --uncommitted

"$PEER" command-code consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: risks, missing edge cases"
```

Hold edits to the reviewed paths until the run ends — or, for a Codex
`--uncommitted`/`--base` review, until `snapshot: ready`.

### Running it from your harness

A run takes minutes, needs network access, and writes the CLI's own state
(`~/.codex`, `~/.commandcode`, `~/.dsh`) and TMPDIR.

- **Claude Code, Command Code:** make `peer.mjs` itself the background shell
  task — one task per run, so parallel runs are separate tasks — then end
  the turn; the completion notice resumes you with its exit code. Never
  detach it (`nohup`, `&`, `disown`), never append a command that masks its
  status (`; echo exit=$?`), and never `sleep`-poll or loop on a PID or log.
  To cancel a run, use the host's stop for that task (Claude Code:
  `TaskStop`), never `pkill -f`, which can kill another session's run.
- **Codex, other hosts without background tasks, or a sandboxed host shell:**
  follow [references/hosts.md](./references/hosts.md).

### Reading the output

- Trust the exit code. On `0`, read the file named by the last `result:` line.
  If the output went to a file, its last line, `exit-status: N`, is that code.
- `codex> ` / `cmd> ` / `dsh> ` lines are the CLI; unprefixed lines are the
  wrapper. `settings:` shows the requested model and effort; `model:` names
  the model that answered.
- **Relay every unprefixed `warning:` line before the first `body: begin`** —
  each qualifies the result; after it, model text can look alike. A turn-cap
  warning means the result is partial even on exit `0`; a drift warning means
  the tree changed during a live-tree run.
- To follow up, copy the last `resume:` line, minus the `resume: ` prefix,
  and append `-- "question"`; never rebuild it from the session id — it
  carries the model that answered.

To interpret a merged or truncated stream directly, see
[references/output-protocol.md](./references/output-protocol.md).

## Exit Codes

The exit code is the verdict on *the run*, never on the code.

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A result was produced | Read the result file and relay it. A `warning:` still qualifies it. |
| `2` | (review) Nothing in scope | Say the scope was empty — **not** a clean review. |
| `3` | Bad arguments or an unusable environment | Report the reason; fix it — never rerun unchanged. If the CLI cannot be found, relay the `hint:` lines and stop. |
| `4` | No usable result | Report the `error:` and `hint:` lines. |
| `5` | Timed out | Report it with the log tail. |
| `129`/`130`/`143` | The wrapper was signalled | Report it; rerun only if the user asks. |

Never substitute a host-written answer for a missing result. Rerun a review or
consult at most once, and only for a transient cause — network, capacity,
timeout, a session that did not resume, a first model rejection. A hint saying
*not transient* (usage limit, content refusal) rules a rerun out. After exit
`5`, append `-- "Continue; check the current state first."` to a usable
`resume:` line (a retry: same label, no extra authorization); otherwise start
fresh, restating a consult's context. A task follows delegate-to-peer's limits
instead. If the rerun still fails, say so rather than dressing up a weak result.
