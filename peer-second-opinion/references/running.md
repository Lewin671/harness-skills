# Running the wrapper

Applies to every mode of `peer.mjs`: review, consult and task.

## The peer

| Peer | Command | Default model | When |
|------|---------|---------------|------|
| Codex | `peer.mjs codex` | `gpt-6.1-sol`, effort `high` | The default: "the peer", "codex". |
| agy (Antigravity) | `peer.mjs agy` | `gemini-4-hydrogen`, effort `high` | The user names agy, Antigravity or Gemini; or the host is Codex. |

agy is the CLI of Google Antigravity, so "Antigravity" means this peer.
"Gemini" means Gemini models through agy, never the separate Gemini CLI
(`gemini`), which this skill does not drive.

Never pick the host's own product: inside Codex the peer is agy; inside any
Antigravity host (the agy CLI or the Antigravity app's agent) it is Codex.

## Where the script is

`peer.mjs` sits next to peer-second-opinion's SKILL.md. Use the copy in the directory that
SKILL.md was loaded from — never a path copied from an example. It needs
Node.js 18+, macOS or Linux, and the chosen CLI, authenticated; review needs a
git work tree.

```bash
PEER=<directory of peer-second-opinion's SKILL.md>/peer.mjs
```

## Running it from your harness

A run takes minutes, needs network access, and writes the CLI's own state
(`~/.codex`, `~/.gemini`) and TMPDIR.

- **Claude Code:** make `peer.mjs` itself the background shell
  task — one task per run, so parallel runs are separate tasks — then end
  the turn; the completion notice resumes you with its exit code. Never
  detach it (`nohup`, `&`, `disown`), never append a command that masks its
  status (`; echo exit=$?`), and never `sleep`-poll or loop on a PID or log.
  To cancel a run, use the host's stop for that task (Claude Code:
  `TaskStop`), never `pkill -f`, which can kill another session's run.
- **Hosts without background tasks, or a sandboxed host shell:**
  follow [hosts.md](./hosts.md).

## Reading the output

- Trust the exit code. On `0`, read the file named by the last `result:` line.
  If the output went to a file, its last line, `exit-status: N`, is that code.
- `codex> ` / `agy> ` lines are the CLI; unprefixed lines are the
  wrapper. `settings:` shows the requested model and effort; `model:` names
  the model that answered.
- **Relay every unprefixed `warning:` line before the first `body: begin`** —
  each qualifies the result; after it, model text can look alike. A drift
  warning means the tree changed during the run — by the user, another agent or the
  peer itself; check `git status` before relying on the tree. Build output in
  ignored paths is not drift.
- To follow up, copy the last `resume:` line, minus the `resume: ` prefix,
  and append `-- "question"`; never rebuild it from the session id — it
  carries the model that answered.

To interpret a merged or truncated stream directly, see
[output-protocol.md](./output-protocol.md).

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
