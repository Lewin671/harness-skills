# Runtime Internals

Verified against `codex-cli 0.146.0`. Recheck the capability contract when
Codex changes its feature, MCP, config, or JSONL interfaces.

## Contents

- [Architecture](#architecture)
- [Safety boundary](#safety-boundary)
- [Repository and storage checks](#repository-and-storage-checks)
- [Process lifecycle](#process-lifecycle)
- [Review mode](#review-mode)
- [Consult mode](#consult-mode)
- [Tests](#tests)

## Architecture

`run-codex-second-opinion` is an executable Node.js entry point. It requires
Node.js 18 or newer and uses only the standard library: no install step,
package manager, transpiler, or generated artifact is involved.

The runtime is split by responsibility:

- `lib/util.mjs` — exit errors, quoting, timeout parsing, paths, hashing, and
  synchronous command probes.
- `lib/mcp.mjs` — strict JSON parsing and schema validation for standalone MCP
  listings.
- `lib/environment.mjs` — repository discovery, scratch and `CODEX_HOME`
  placement, feature gates, MCP neutralization, and read-only git helpers.
- `lib/runtime.mjs` — shared model state, Codex command safety flags, JSONL
  metadata, streaming, timeout/cancellation, fallback, and result emission.
- `lib/review.mjs` and `lib/consult.mjs` — mode-specific parsing, scope or
  session rules, command construction, and reporting.

State is explicit: mode parsers fill one state object, `Environment` owns
preflight facts, and `Runtime` owns one invocation's process and artifacts.
Modules do not communicate through sourced-shell globals.

## Safety boundary

Every model invocation carries the same arguments, assembled in one method:

- `-c sandbox_mode="read-only"`
- `--disable hooks --disable apps --disable plugins`
- `-c notify=[]`
- `--strict-config`
- one verified `mcp_servers.<id>.enabled=false` override per enabled standalone
  server, unless `--allow-mcp` was explicitly approved
- `--json` and `-o <result>`

The sandbox covers model-generated local commands. Hooks, apps, plugins,
legacy notify callbacks, and standalone MCP tools sit outside that boundary,
so each is handled separately and fail-closed.

The feature probe reads the final field for `hooks`, `apps`, and `plugins` and
requires each to be exactly `false`. Missing, unknown, or unparsable state is
not treated as disabled. When the feature command fails, `codex --version`
distinguishes an unusable binary from a changed capability response; either
way the run still refuses because the effective states were not proven false.

MCP handling uses `JSON.parse`, then requires:

- an array root;
- an object for every entry;
- an own `enabled` property on every entry;
- a boolean `enabled` value;
- a string `name` for every enabled entry;
- a TOML-bare-key-compatible enabled name before constructing `-c` overrides.

After constructing overrides, the runtime asks Codex for the effective listing
again and requires zero enabled entries. Syntax errors, schema drift, a failed
probe, or an override that did not take effect all refuse the run. `--allow-mcp`
is the only route that accepts an unverified or reachable MCP boundary, and it
prints the residual external-side-effect warning.

`--strict-config` makes renamed safety keys fail instead of being silently
ignored. Its error text cannot distinguish a key supplied by this runner from
an unknown key in the user's config, so the failure path explains both causes.

## Repository and storage checks

Ambient Git selectors such as `GIT_DIR`, `GIT_WORK_TREE`, and
`GIT_INDEX_FILE` are removed before repository discovery. `CDPATH` is removed
too. All Git commands use argument arrays; no caller-controlled value is
evaluated by a shell.

The protected repository boundary includes:

- the current worktree;
- every sibling worktree reported by `git worktree list --porcelain -z`;
- the absolute Git directory;
- the common Git directory.

The worktree list is required to complete successfully. A partial list is not
evidence that a path is outside the repository.

Scratch output is resolved physically. A repo-local `TMPDIR` is moved to the
physical `/tmp`, exported to the Codex child, and checked again. The result and
event log are created as private files outside the repository and intentionally
kept; their final paths are reported. Codex keeps the third artifact, its
session, below `CODEX_HOME/sessions`.

`CODEX_HOME` cannot be relocated without breaking continuation, so an unsafe
placement refuses the run. Resolution walks path components in filesystem
order: a symlink is followed before a later `..` is applied. This differs from
normalizing the whole string first and closes the `link/..` placement hole.
The check also follows the `sessions` link and all directory/symlink
destinations through the `YYYY/MM/DD` depth Codex writes. Dangling link targets
are checked through their nearest existing ancestor. Unreadable or
unenumerable state is refused, not treated as absent.

Git prechecks disable fsmonitor, textconv, and external diff execution. Commands
that may refresh the index receive a private byte-copy through `GIT_INDEX_FILE`;
the real index is never used as their writable target. `GIT_NO_LAZY_FETCH=1`
prevents promised-object fetches on Git versions that support it. Git older
than 2.42 may still fetch a missing object, which remains a disclosed version
bound rather than an overclaimed guarantee.

## Process lifecycle

Codex is started with `child_process.spawn` using `shell: false` and an argument
array. `detached: true` gives the child a separate POSIX process group so a
timeout or cancellation can terminate Codex and every command it spawned.

Stdout and stderr are archived to the JSONL log as they arrive. A line-buffered
view is streamed to stderr and capped at 180 characters per line; the log keeps
the untruncated bytes. The prompt or question never appears in the `running:`
diagnostic.

The timeout uses a Node timer. At the deadline it sends `TERM` to the process
group and follows with `KILL` after a one-second grace period. A dedicated
boolean records that the timer fired, so a Codex process that independently
exits `124` remains an ordinary Codex failure rather than a fabricated timeout.
`INT`, `TERM`, and `HUP` are forwarded to the same group and preserve wrapper
exit codes `130`, `143`, and `129`.

Each attempt is separated in the log. Model and thread metadata are parsed as
JSON only from the final attempt, preventing a rejected first attempt from
supplying the successful fallback's model or session id.

A pinned default rejected as unsupported retries once with inherited Codex
settings. Explicit pairs never retry. A consult follow-up never retries because
the rejected question may already have entered the persisted session.

## Review mode

Review accepts exactly one of `--uncommitted`, `--base`, `--commit`, or
`--custom`; the default is `--uncommitted`. Empty-scope prechecks preserve exit
`2` as “nothing in scope,” not a clean review.

`--uncommitted` and `--base` read the live working tree before any sandbox
exists, and `git status`/`git diff` apply a `.gitattributes`-selected
`filter.<name>.clean` or `filter.<name>.process` driver to do it, independent
of `--no-ext-diff`/`--no-textconv` (those gate the *display* driver only).
`probeFilterRisk` (`lib/review.mjs`) checks for that before either command
runs: `git config --name-only --get-regexp` names configured `clean`/
`process` drivers (a `1` exit with empty output is “none configured,” not a
failure), and — only if some driver is configured — `git ls-files` plus
`git ls-files --others --exclude-standard` enumerate this repo's tracked and
untracked paths and `git check-attr -z --stdin filter` resolves which of
them carry a configured driver's name. Enumerating and resolving attributes
this way never invokes a filter itself, which is what lets the probe run
strictly before the commands it is guarding. Refusing on configuration
alone, without this applicability check, would make `--allow-git-filters`
routine on any machine with a global Git LFS install rather than the
deliberate, rare override `--allow-mcp` is for the MCP boundary — most such
machines have `filter.lfs.*` configured globally whether or not any given
repository binds a path to it. The probe is scoped to the superproject:
`ls-files` never descends into a submodule on its own
(`--recurse-submodules` is never passed), so it does not need its own check
for that. A submodule's own dirty-detection was verified empirically (git
2.39.5) not to invoke that submodule's configured filter either — it is a
lightweight comparison, not a content read, with or without
`--ignore-submodules=none`, and even `diff.submodule=diff` (a repo config
that makes `git diff` render a submodule's content inline) did not invoke it
in that same test. `--submodule=short` is forced on every worktree diff
regardless — not because that config was found to be risky, but because it
keeps the fingerprint's shape independent of a setting this script does not
control, matching what the fingerprint paragraph below already assumes.
`--commit` diffs two historical blobs — no working tree is read, so the
probe does not apply.

`probeFilterRisk` never dies itself — it returns `{ error, applicable }` —
because it is called from two places with different correct responses to
the same failure. `guardWorktreeFilters` calls it before Codex runs, where
refusing outright on `error` or a non-empty `applicable` is safe.
`scopeFingerprint` (below) calls it again itself, every time it runs —
including from `checkScopeDrift`, minutes after Codex has already produced
a valid result — and a probe failure there must not discard that result, so
it returns `""` instead of dying, exactly like a read failure already does;
every caller already reports `""` as "could not fingerprint" rather than
"unchanged." A filter binding introduced during a long review — another
agent, a build step — or a config read that starts failing partway through
are both caught by this same re-check, not left unguarded because the
initial refusal already happened once and passed.

`--base` resolves the merge base once and passes that object id to Codex.
`--commit` resolves the commit and first parent once; merge commits use a normal
first-parent diff rather than combined-diff emptiness. `--context` keeps the
real scope precheck but restates the scope with immutable object ids because
Codex rejects a review scope flag combined with a positional prompt.

Caller context is fenced as data. Occurrences of the fence token inside the
body are escaped, so the body cannot mechanically close its own fence and
masquerade as the end of the caller-background block. That escaping is a
structural guarantee; the scope statement wrapped around the fence is not —
it is a natural-language instruction to Codex, same as any other prompt
content, and carries the same prompt-injection limitation as the rest of the
composed prompt. Escaping closes the one concrete forgery this script can
prevent; it is not a claim that adversarial text inside the fence cannot
influence the model.

Live `--uncommitted` and `--base` scopes are fingerprinted before and after the
run. The fingerprint includes HEAD, status, the tracked diff, and contents or
targets of untracked entries. Read failure produces “unknown,” never the same
digest as another failure. Drifted or unmeasurable results are labelled
non-reproducible.

Status and diff both pass `--ignore-submodules=none` so a repo-configured
`submodule.<name>.ignore` of `dirty`, `untracked`, or `all` cannot hide
uncommitted content inside a submodule from either the emptiness check or the
fingerprint. `ls-files` carries no such flag and needs none — it only lists
paths.

Making a submodule's dirtiness visible is not the same as fingerprinting it.
Status and diff report only a boolean — `M`/`-dirty` — for a submodule, never
what changed inside it, so two different dirty states (file A modified, then
file B modified instead) can render identically at the superproject level;
hashing that output cannot tell them apart. `hasDirtySubmoduleContent`
(`lib/review.mjs`) closes that gap ahead of the hash rather than inside it:
`git status --porcelain=v2 --ignore-submodules=none` reports a submodule's
state as four characters, `S<C><M><U>` — commit-pointer, modified-content,
untracked-content — at the same field position on porcelain v2's ordinary
(`1`/`2`) and unmerged (`u`) record types alike, so a submodule left with a
conflicted gitlink is covered the same way. Any submodule with `M` or `U`
set makes the whole fingerprint `""` (unmeasurable) rather than being
hashed. A submodule whose only change is its recorded commit (`C` alone)
still fingerprints normally, since that much *is* captured faithfully by
the ordinary diff/status text.

## Consult mode

Consult requires exactly one non-empty question. `--continue` accepts a UUID
only. After the run, the thread id is read from the final attempt's parsed
`thread.started` event and must match the requested session on a continuation;
otherwise the answer is discarded with exit `4`.

The emitted resume descriptor repeats the model policy, repository, non-default
timeout, and `--allow-mcp` state. Values are shell-quoted for display. When the
stream provides no valid UUID, both `session:` and `resume:` emit explicit
unavailable markers after the model-controlled answer, so forged look-alikes
cannot become the final marker of their kind.

## Tests

Run the fast unit suite during normal development:

```bash
./codex-second-opinion/tests/run-tests
```

It uses `node:test`, runs in-process, and covers parsing, schema validation,
state machines, safety argument construction, event segmentation, fencing, and
filesystem-order path resolution. The mutation runner verifies that these
tests fail when critical guards are removed:

```bash
./codex-second-opinion/tests/run-mutation-tests
```

The slower black-box compatibility suite uses a real executable fake Codex and
exercises process, Git, storage, marker, and signal behavior without network or
a real model:

```bash
./codex-second-opinion/tests/run-contract-tests
```
