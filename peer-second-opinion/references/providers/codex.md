# Provider: codex

OpenAI's `codex` CLI. Not for use from inside Codex itself, which has its own
`/review`.

## Prerequisites and binary

A `codex` CLI that is already authenticated (`codex login`); an
unauthenticated one fails the run with exit `4` and its own message in the log
tail. The wrapper finds `codex` on the absolute entries of `PATH`, or uses
`CODEX_BIN` (an absolute path to an executable file), and prints
`note: using codex binary: <path>` first. A binary inside the repository under
review is refused. If it is not found, see running.md § Exit Codes; never
hand-roll `codex exec` instead.

## Permissions

Every mode runs with `sandbox_mode="danger-full-access"` and
`approval_policy="never"`: a review or consult can build, test and reach the
network like the user's own shell. They keep hooks, apps, plugins,
cross-session memories and the `notify` callback disabled, and carry the shared
note asking the peer not to modify the repository or git state;
`--strict-config` turns an unrecognized key into a failed run. Review also
passes `--ephemeral`, so it leaves no session. Standalone MCP servers from the
user's codex configuration stay reachable.

A review always passes its scope as prose in the prompt, never as a native
scope flag: `codex exec review` takes one or the other, and only the prompt can
carry the note.

A task runs in the user's normal codex setup — hooks, plugins, memories and MCP
included — with no note.

## Model

The wrapper pins a high-capability model at the `high` effort tier. Override it
for one run with an explicit `--model M --effort L` pair, or for every run with
`PEER_CODEX_MODEL` and `PEER_CODEX_EFFORT` set together. Pass model flags only
when the user asked for a model. A `resume:` line carries the pair that
answered.

A model codex rejects — retired, renamed, not entitled, or newer than the
installed CLI — fails with exit `4` and a hint naming where the model came from
(flag, environment or pinned default). No fallback is attempted. Rerun once
unchanged first: a rejection of an available model has been seen to clear on
the next run. Check
`codex debug models` and upgrade codex before concluding a model is retired. Do
not resume a session under a different model.

## Capacity retries

The exact "Selected model is at capacity" error is retried up to three times,
after 15, 30 and 60 seconds, within the original `--timeout`, always with the
same model. With a recoverable session (consult, task) the wrapper resumes it
with `Continue`; without one (a review) it repeats the invocation only if no
work had started, and never replays partial work. Exhausted retries exit `4`; a
retry that no longer fits the timeout exits `5`. Relay the `note:` lines and let
it finish.

## provider-exit

`codex` exits non-zero for any failure; its code carries no documented meaning
beyond that. Read the `error:`/`hint:` lines and the log tail instead.
