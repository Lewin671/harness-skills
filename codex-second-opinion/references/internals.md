# Why The Script Looks Like That

Verified against `codex-cli 0.146.0`; recheck if these stop holding.

## Shared runtime (lib/common.bash)

- The sandbox is set via `-c 'sandbox_mode="read-only"'` on every
  path: `exec review` and `exec resume` have no `-s/--sandbox` flag,
  and the config key is exactly what `-s` sets, so one spelling keeps
  all paths verifiably identical.
- That sandbox covers model-generated commands only. Trusted command
  hooks run outside it — codex's own trust prompt says so — so the
  script passes `--disable hooks` and verifies the *effective* state
  with `codex features list`, exiting `3` if managed policy forces
  hooks back on. Fail closed: an unparseable answer counts as enabled.
- The legacy `notify = [...]` callback is not feature-gated, so
  `--disable hooks` does not stop it. The script clears it with
  `-c notify=[]`; plain config keys have no managed-policy override,
  so the `-c` layer — the highest-precedence config source — is both
  the fix and the guarantee.
- The result comes from `-o` (the agent's last message), not stdout:
  the event stream on stdout is `--json`, one bounded line per event,
  because the default human stream echoes entire file dumps.
- The result file must live outside the repo, or Codex's own file
  sweeps pick it up and pollute the result. A repo-local TMPDIR is
  detected and replaced with /tmp for the same reason.
- There is no portable `timeout` binary on macOS, hence the watchdog
  subshell. It signals the whole process group — codex spawns shell
  commands that inherit the pipeline's stdout, and killing only the
  parent leaves them holding it open. `set -m` gives codex its own
  process group to make that possible; the INT/TERM traps forward
  cancellation into that group for the same reason.
- The pipeline is backgrounded and awaited because bash defers traps
  until the foreground command finishes — a foreground pipeline would
  swallow a cancel signal for the whole run.
- The default model slug is pinned in this file, which will go stale.
  That is why a rejected model triggers one automatic retry on the
  user's config instead of a hard failure. `ultra` is deliberately not
  used: it delegates subtasks, which is not what a second opinion
  wants.
- The `running:` diagnostic never includes the prompt or question
  body: a multiline value would forge standalone `report:` /
  `answer:` / `item.started` markers in the stderr feed.

## Review mode (lib/review.bash)

- Both `codex review` and `codex exec review` run non-interactively,
  but only `exec review` exposes `-m`, `-o`, and `--json`, so the
  script uses it.
- The positional `[PROMPT]` is **mutually exclusive with all three
  scope flags** — hence `--custom` being its own scope rather than a
  modifier.
- The empty-scope prechecks must match what Codex actually reviews: it
  diffs the merge base against the *working tree* (not HEAD) for
  `--base`, and a merge commit needs a first-parent diff (not
  `git show`, whose combined-diff semantics usually print nothing).
- `--output-schema` is silently ignored by `exec review` (an invalid
  schema that makes plain `codex exec` fail with a 400 produces no
  error here). Structured findings do exist, but only in the rollout
  session file under `CODEX_HOME/sessions`, as
  `exited_review_mode.review_output`. Parsing that is a possible
  future addition; it would break under `--ephemeral`.

## Consult mode (lib/consult.bash)

- The session id comes from the `thread.started` event in the JSONL
  stream; multi-turn works because sessions persist under
  `CODEX_HOME/sessions`. Never pass `--ephemeral` — it would silently
  break `--continue`.
- Continuation is verified by comparing the stream's thread id against
  the requested one: given a well-formed but expired session id, codex
  0.146.0 silently starts a fresh thread and exits 0 — an answer
  produced without the prior discussion. The script discards it and
  exits `4` instead.
- The *last* `thread.started` match in the log is authoritative: the
  log accumulates across the stale-model fallback retry, and only the
  final run's session can be resumed.
- A rejected model on a follow-up is never auto-retried: codex may
  have persisted the question in the session before rejecting the
  model, and a resend could record it twice.
