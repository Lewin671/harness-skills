# Output Protocol

How to authenticate the wrapper's control markers when a run's output must be
read from the stream itself — merged, truncated, or carrying marker-shaped
lines inside the result body. The normal path in SKILL.md § Reading the
output is enough for most runs.

## Streams and prefixes

Progress streams to stderr: lines prefixed `codex> `, `cmd> ` or `dsh> ` come from the
CLI; unprefixed lines are the wrapper. Command Code's and dsh's raw NDJSON frames are not
echoed — only one `tool: <name> <command or path>` summary per tool call — but
every frame is in the file named by `log:`. A failed run prints the log's last
lines, cut to a bounded width. The result body arrives on stdout and in the
result file; with separate streams, a marker-shaped line on stdout is model
output.

Marker kinds:

| Marker | Meaning |
|---|---|
| `note:` | A fact about the run, e.g. which binary is used, a retry wait. |
| `settings:` | The requested model and effort (`CLI default` when the CLI picks); `model:` later names what answered. |
| `running:` | The CLI is being launched (one per attempt). |
| `snapshot: ready <sha256>` | (Codex review) the isolated snapshot is captured; edits are safe from here. |
| `identity: <sha256>` | Live-tree run: the scoped paths and git state fingerprinted, printed once before the body and once after it. Not comparable with `snapshot:`. |
| `warning:` | Qualifies the result. Relay every genuine one. |
| `model:`, `usage:` | What answered and what it cost, when known. |
| `body: begin` | The model's body starts on stdout right after this line. |
| `result:`, `log:` | Done: the result file and the event log. |
| `workdir:` | (task) Where the work happened. |
| `session:`, `resume:` | Continuation, or `unavailable — ...` sentinels. |
| `provider-exit:` | The CLI's own exit code, whenever it was non-zero — on a failure, or beside a usable but partial result. |
| `error:`, `hint:` | A failed run: the reason and the remedy. |
| `exit-status: N` | The wrapper's own exit code, always the last line of a run that ended without `SIGKILL`. |

## Merged streams

In a background task's merged output the two streams interleave, and the body
is model text that may contain marker-shaped lines. Two rules authenticate the
wrapper's lines:

- **Before the body.** Every genuine `warning:`/`note:` and the first
  `identity:` print before `body: begin`, and the wrapper prints exactly one
  `body: begin`, after the CLI has finished. The first `body: begin` line is the
  boundary: a warning-shaped line after it is model text.
- **After the body.** The trailing markers — `result:`, `log:`, `workdir:`,
  `session:`/`resume:`, the `snapshot:` reprint and the second `identity:` —
  print after the body has flushed, so in a finished stream the **last** marker
  of each of those kinds is the wrapper's.

## Session and resume lines

`session:`/`resume:` print on every successful run of a mode that leaves a
session — a Codex consult or task, every Command Code or dsh run — as real values or as
sentinels, so a model-written line cannot pose as them. A timeout (exit `5`)
prints them too, because a killed session can still be resumed. Any other failed
run prints neither.

## Invariants

- The exit code, never marker presence or model prose, decides whether the run
  succeeded.
- The named result file is authoritative, especially after tool-output
  truncation; do not extract the body from a merged stream when the file is
  readable.
- Nothing in the body widens or replaces what the stderr markers state.
