# Execution

Shared mechanics of `run-codex-second-opinion.mjs` for every mode —
review, consult and the `task` mode used by delegate-to-codex.

## Prerequisites and binary

Node.js 18+, macOS or Linux, no dependencies, and a `codex` CLI that is
already authenticated (`codex login`) — an unauthenticated codex fails
the run with exit `4` and its own message in the log tail. The script
finds `codex` on the absolute entries of `PATH`, or uses `CODEX_BIN`
(must be an absolute path to an executable file). Every run prints
`note: using codex binary: <path>` before anything runs; a binary that
resolves inside the repository under review is refused (exit `3`).

An agent's shell is usually non-interactive and does not load
interactive startup files, so a `codex` that is a shell function or
alias there (often one that also sets a proxy) is not found. That is the
user's environment to fix — exporting `CODEX_BIN` and whatever the
function sets where non-interactive shells read it. Report it; do not
work around it by running `codex exec` through an interactive shell,
which bypasses this script's protections.

The wrapper's own git prechecks run outside Codex's sandbox: ordinary
read-only git commands (`--no-optional-locks`, no external
diff/textconv) — best effort, not a guarantee.

Codex is spawned with stdin closed, in its own process group, so a
timeout or signal terminates everything it started.

## Timeouts

`--timeout` covers the codex run, including capacity retries and their
waits. Snapshot and preflight git steps have a separate fixed 120 s
budget; if a huge repository's snapshot clone hits it, review with
`--commit`, which skips the clone. The snapshot is retried once if the
tree changes while being copied, and fails rather than use an unstable
capture.

## Capacity retries

The exact "Selected model is at capacity. Please try a different
model." error is retried up to three times, after 15, 30 and 60
seconds, within the original `--timeout`, always with the same model:

- With a recoverable session (consult, task), the wrapper resumes it
  with `Continue`, preserving its progress; every continuation must
  report the same session id.
- Without one (including ephemeral review), it repeats the original
  invocation only if no model/tool item or result has appeared yet. It
  never replays partial work without a session.

Exhausted retries exit `4`; a retry that no longer fits the remaining
timeout exits `5`. Other errors are not retried. Relay the retry notes
and let the wrapper finish.

## Model rejections

A model codex rejects — retired, renamed, not entitled, or newer than
the installed CLI — fails with exit `4` and a hint naming where the
model came from (flag, environment or pinned default). No fallback is
attempted. Check `codex debug models` and upgrade codex before
concluding a model is retired. Do not resume a session under a
different model; start fresh and restate the context.
