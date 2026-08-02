# Why The Script Looks Like That

Verified against `codex-cli 0.146.0`; recheck if these stop holding.

## Shared runtime (lib/common.bash)

- The sandbox is set via `-c 'sandbox_mode="read-only"'` on every
  path: `exec review` and `exec resume` have no `-s/--sandbox` flag,
  and the config key is exactly what `-s` sets, so one spelling keeps
  all paths verifiably identical.
- That sandbox covers model-generated commands only. Trusted command
  hooks run outside it — codex's own trust prompt says so — and so do
  apps and plugins: an installed plugin can bundle a write-capable
  connector and its own MCP server (capability `"Write"` in the
  plugin manifest), none of which sandbox_mode touches. The script
  passes `--disable hooks --disable apps --disable plugins` on every
  invocation and verifies each *effective* state with
  `codex features list`, exiting `3` if managed policy forces any of
  them back on. Fail closed: an unparseable answer counts as enabled.
- Standalone MCP servers from the user's own config have no global
  disable switch on 0.146.0 — but the per-server
  `mcp_servers.<id>.enabled` key can be overridden through `-c` for a
  single invocation, verified: `codex mcp list --json -c
  mcp_servers.<id>.enabled=false` reports that server as disabled. So
  the script switches them off rather than refusing, which removes the
  exposure instead of merely declining to proceed in its presence.
  Three things make that safe:
  - Entries are read by brace depth, not by indentation or key order,
    so the parser survives a compact listing and ignores nested
    objects.
  - The parser emits one line per enabled *entry*, printing `?` when it
    cannot read that entry's name, and a `?` is a refusal. Keying
    safety on names instead would put the same blind spot in both the
    first pass and the re-check: a nameless enabled server sitting
    beside a named one would be disabled in neither and reported by
    neither. An id that is not a TOML bare key is refused for the same
    reason — it cannot be reached by a dotted `-c` path.
  - The overrides are not trusted on their own: the script re-runs
    `codex mcp list --json` *with* them and refuses unless codex agrees
    nothing is enabled any more. That re-check must also *look* like a
    listing; output it cannot recognize — including nothing at all —
    is evidence of nothing and is refused rather than read as "all
    clear".
  - The scanner also rejects two malformed shapes that balance and spell
    their booleans correctly: a trailing comma before a close, and two
    adjacent strings with no colon between them. It is deliberately not a
    JSON validator — there is no parser to hand in a bash wrapper, and one
    would be a dependency for a payload this script only needs to enumerate.
    What it rejects is what it can name; the guarantee is structural, not
    syntactic, and this sentence is the honest bound on it.
  - Every `"enabled"` field must be a bare `true` or `false`, checked by
    counting keys against well-formed values. The enumeration keys
    entirely on those literal bytes — the grep looks for `true`, the
    parser matches four characters — so a payload spelling it
    `"enabled":"true"` would satisfy neither and read as a server that is
    switched off. Applied to the re-check as well, where booleans that
    have become strings prove exactly as little.
  - The *first* listing is held to the same bar, for the same reason.
    Verified on 0.146.0: a config with no servers prints `[]`, three
    bytes — never nothing. So a `mcp list` that exits 0 having printed
    nothing has failed to enumerate, and reading that as "no servers"
    is the one fail-open the rest of this block exists to prevent. It
    was the first listing, not the re-check, that used to accept an
    empty payload.
  `--allow-mcp` inverts the default: it drops the overrides and leaves
  the servers reachable, on explicit user approval. Local commands stay
  read-only either way.
- The legacy `notify = [...]` callback is not feature-gated, so
  `--disable hooks` does not stop it. The script clears it with
  `-c notify=[]`; plain config keys have no managed-policy override,
  so the `-c` layer — the highest-precedence config source — is both
  the fix and the guarantee.
- `--strict-config` closes the one drift the rest of this file cannot
  detect. Verified on 0.146.0: an unknown `-c` key is silently ignored
  without it (`-c bogus_key_zzz="x"` runs fine; with `--strict-config`
  it errors "unknown configuration field ... in -c/--config override").
  So if a later codex renames or moves `sandbox_mode` or `notify`, the
  two guarantees above would quietly stop applying while the run
  succeeded. Everything else here already fails closed —
  features/mcp verification, model rejection, session mismatch — and
  this puts the config layer on the same footing. The cost: an unknown
  field in the *user's* config.toml now fails the run too, with the
  same error text, which is why the failure path prints a hint naming
  both causes. All three keys this script sets are accepted under
  `--strict-config` on 0.146.0.
- The result comes from `-o` (the agent's last message), not stdout:
  the event stream on stdout is `--json`, one bounded line per event,
  because the default human stream echoes entire file dumps.
- The result file must live outside the repo, or Codex's own file
  sweeps pick it up and pollute the result. A repo-local TMPDIR is
  detected and replaced with /tmp for the same reason.
- `CODEX_HOME` gets the same test and the opposite answer. Codex writes
  every run's session under it, so a `CODEX_HOME` inside the worktree
  writes into the tree being read — same pollution, same dirty status,
  and those session files then feed Codex's own file sweeps on the next
  run. It cannot be substituted the way TMPDIR can: moving it orphans
  every earlier session and breaks `--continue`. With no substitution
  available the choice is refuse or break the claim, and the TMPDIR case
  already settles which — exit `3`, naming the one variable that fixes
  it. Resolved through the nearest *existing* ancestor, because codex
  creates the directory on first use and a check that only looked at
  directories that already exist would wave through the very run that
  creates it.
- The `CODEX_HOME` containment check covers that directory and its
  `sessions` root, both resolved through symlinks. It does not walk
  deeper, and cannot: codex creates the per-session subdirectories at
  run time, so there is nothing to inspect beforehand and a check that
  enumerated today's tree would still miss tomorrow's. What it defends
  against is a *placement* — a repository that is also the home
  directory, a home pointed into the tree — not a symlink planted
  several levels down inside one's own codex state. That bound is
  stated here rather than closed by a walk that would still be partial.
- The scratch directory is resolved *before* the feature and MCP checks,
  not after. Those checks use here-strings, and on the bash 3.2 macOS
  ships `<<<` materialises a temporary file under `TMPDIR` — so a
  repo-local `TMPDIR` was written inside the repository, briefly, before
  the relocation that exists to prevent it. The relocation also exports
  `TMPDIR`: moving only this script's own files would leave the shell's
  temporaries, `mktemp`'s default, and codex itself still pointed inside
  the tree.
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
  `answer:` / `item.started` markers in the stderr feed. The consult
  `resume:` line has the same exposure through caller-supplied
  `--model`/`--effort` values, and sanitizes them the same way.
- Model settings are validated as a closed three-way choice (pinned /
  explicit pair / `--inherit`) rather than as independent flags. Left
  open, `--model X` alone keeps the pinned effort — which the named
  model need not accept — *and* clears `pinned`, which disables the
  stale-default retry, so the documented "always pass both" rule was
  the only thing standing between a caller and a guaranteed exit 4.
  `--inherit` mixed with `--model` was order-dependent for the same
  reason.

## Review mode (lib/review.bash)

- Both `codex review` and `codex exec review` run non-interactively,
  but only `exec review` exposes `-m`, `-o`, and `--json`, so the
  script uses it.
- The positional `[PROMPT]` is **mutually exclusive with all three
  scope flags** — hence `--custom` being its own scope rather than a
  modifier. Confirmed on 0.146.0: `exec review --uncommitted -- "x"`
  fails at argument parsing with "the argument '--uncommitted' cannot
  be used with '[PROMPT]'".
- A `--context` prompt names revisions by resolved object name, never
  by the ref the caller typed. `git check-ref-format` accepts branch
  names like `a;whoami` and ``a`id` ``, and the composed prompt is a
  command the reviewer is invited to run — a raw ref there is command
  injection into that reviewer's shell, and can point the review at a
  different scope. Hashes carry no metacharacters and pin the scope
  against a ref that moves mid-run. The ref is still named for human
  context, shell-quoted. The same helper quotes the model values in
  consult's `resume:` line, which is advertised as ready to run.
- That exclusivity is also why `--context` restates the scope as prose
  instead of keeping the flag: there is no invocation that carries
  both. The wrapper still runs the precheck on the real flag, so an
  empty scope is caught, but the reviewed scope becomes
  prompt-described. `--title` looked like a way out — it coexists with
  scope flags — but it is not a general context channel: in the
  binary, `commit_title` hangs off `ReviewTarget::Commit` alone
  (`BaseBranch` and `Custom` carry one field each), so it reaches the
  model only for `--commit` and only as a commit title.
- The empty-scope prechecks must match what Codex actually reviews: it
  diffs the merge base against the *working tree* (not HEAD) for
  `--base`, and a merge commit needs a first-parent diff (not
  `git show`, whose combined-diff semantics usually print nothing).
- Those prechecks run *before* any sandbox exists, so they are the one
  place the wrapper itself could write the repository or run a program.
  Three measures, each measured against 0.146.0's git:
  - `git status` refreshes stale stat info and rewrites `.git/index`;
    `--no-optional-locks` suppresses exactly that write. The
    `--uncommitted` scope sentence carries the same flag, where the
    command is handed to a reviewer under a read-only sandbox that would
    deny the write anyway.
  - `git diff` against the working tree refreshes the index *with or
    without* that flag, so the `--base` precheck runs it under a byte
    copy through `GIT_INDEX_FILE`. Same index content, same answer, and
    the refresh lands on the copy. When the copy cannot be made the run
    refuses: the same scratch directory is about to fail the result file,
    so running unprotected buys no successful run, only a rewritten
    index on the way to the exit.
  - A partial clone fetches promised objects on demand, so `git merge-base`
    can reach the network and write `.git/objects` before Codex starts.
    `GIT_NO_LAZY_FETCH=1` is exported for the prechecks. It landed in git
    2.42 and does nothing below that — the residual is narrow, since the
    common `--filter=blob:none` clone keeps every commit and merge-base
    needs no blobs, but it is a residual and not a guarantee.
  - `diff.external` and textconv drivers name programs too, and the review
    prechecks do NOT pass `--no-ext-diff`/`--no-textconv`. Measured on git
    2.39: neither runs for `diff --quiet` or `diff --name-only`, which is
    all this script uses — only a diff that actually produces output invokes
    them. The flags are on the *adversarial-code-review* capture, which does
    produce output. Recorded here so the absence reads as a measurement
    rather than an oversight.
  - `core.fsmonitor` names a program git executes while refreshing —
    outside every sandbox codex could impose, and before its hooks, apps
    and plugins are disabled. `--no-optional-locks` does not stop it;
    `-c core.fsmonitor=false` does. Verified: with a hook configured, a
    plain status runs it and the flagged one does not.
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
- A `resume:` line is printed even when there is no session id, as
  prose rather than a command. Callers are told to trust the *final*
  marker line; printing nothing would hand that status to a `resume:`
  line invented inside the model-controlled answer body.
- The `resume:` line exists because the session id alone is not enough
  to reproduce a turn: model settings do not travel with the session,
  and the operator was otherwise expected to remember them. After a
  stale-default fallback it prints `--inherit`, not the pinned
  defaults — those already failed once, and a resumed session has no
  automatic retry left to catch the second failure.
