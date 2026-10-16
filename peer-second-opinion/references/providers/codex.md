# Provider: codex

OpenAI's `codex` CLI. Not for use from inside Codex itself, which has its own
`/review`.

## Prerequisites and binary

A `codex` CLI that is already authenticated (`codex login`); an
unauthenticated one fails the run with exit `4` and its own message in the log
tail. The wrapper finds `codex` on the absolute entries of `PATH`, or uses
`CODEX_BIN` (an absolute path to an executable file), and prints
`note: using codex binary: <path>` first. A binary inside the repository under
review is refused.

An agent's shell is usually non-interactive and does not load interactive
startup files, so a `codex` that is a shell function or alias there (often one
that also sets a proxy) is not found: exit `3` with "could not find 'codex'".
That is the user's environment to fix — export `CODEX_BIN` and whatever the
function sets where non-interactive shells see it. Report it and stop; never
work around it with a hand-rolled `codex exec` or an interactive shell, which
bypasses the wrapper's protections.

## Permissions

Review and consult run in Codex's read-only sandbox (`sandbox_mode="read-only"`),
with hooks, apps, plugins, cross-session memories and the `notify` callback
disabled; `--strict-config` turns an unrecognized key into a failed run instead
of a silently ignored safety setting. Review also passes `--ephemeral`, so it
leaves no session. The sandbox covers Codex's local commands only: standalone
MCP servers from the user's codex configuration stay reachable.

A task runs with `sandbox_mode="danger-full-access"` and
`approval_policy="never"`, in the user's normal codex setup — hooks, plugins,
memories and MCP included.

## Review snapshots

For `--uncommitted` and `--base` the wrapper builds an isolated local clone,
overlays the changed tracked files (plus non-ignored untracked files for
`--uncommitted`), preserves the index separately, verifies the source and
copied bytes match, and prints `snapshot: ready <sha256>`. Edits to the source
are safe after that marker; the clone is removed after the run, and paths
inside it are rewritten to the source repository in the report.

- An unchanged submodule appears as an empty directory, and ignored untracked
  files (a local `.env`, build output) never enter it. A review that needs
  them should use `--commit`, which reads the live tree.
- Embedded repositories, changed symlinks that resolve outside the clone, and
  any symlink that resolves back into the live source repository fail with exit
  `3`. An unchanged symlink pointing elsewhere (a dotfiles repository linking
  into `$HOME`) is tolerated.
- The snapshot is retried once if the tree changes while it is copied, then
  fails rather than use an unstable capture. Snapshot and preflight git steps
  have their own 120 s budget; for a repository too large to clone in that,
  review with `--commit`.

## Model

The wrapper pins a high-capability model at the `high` effort tier. Override it
for one run with an explicit `--model M --effort L` pair, or for every run with
`PEER_CODEX_MODEL` and `PEER_CODEX_EFFORT` set together. Pass model flags only
when the user asked for a model. A `resume:` line carries the pair that
answered.

A model codex rejects — retired, renamed, not entitled, or newer than the
installed CLI — fails with exit `4` and a hint naming where the model came from
(flag, environment or pinned default). No fallback is attempted. Check
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
