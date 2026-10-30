# Provider: codex

OpenAI's `codex` CLI. Not for use from inside Codex itself, which has its own
`/review`.

## Prerequisites and binary

A `codex` CLI that is already authenticated (`codex login`); an
unauthenticated one fails the run with exit `4` and its own message in the log
tail. The wrapper finds `codex` on the absolute entries of `PATH`, or uses
`CODEX_BIN` (an absolute path to an executable file), and prints
`note: using codex binary: <path>` first. A binary inside the repository under
review is refused. If it is not found, see SKILL.md § Exit Codes; never
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

## Review snapshots

For `--uncommitted` and `--base` the wrapper builds an isolated local clone,
overlays the changed tracked files (plus non-ignored untracked files for
`--uncommitted`), preserves the index separately, verifies the source and
copied bytes match, and prints `snapshot: ready <sha256>`. Edits to the source
are safe after that marker; the clone is removed after the run, and paths
inside it are rewritten to the source repository in the report.

- An unchanged submodule appears as an empty directory, and ignored untracked
  files (a local `.env`, installed dependencies such as `node_modules` or
  `.venv`, build output) never enter it, so a build or test there may fail for
  want of them. A review that needs them should use `--commit` if committed,
  otherwise `--custom` naming the comparison (for example "the staged,
  unstaged and untracked changes"); both run in the live tree.
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
