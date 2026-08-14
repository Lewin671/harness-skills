# Runtime Internals

Verified against `codex-cli 0.146.0`. Recheck the capability contract when
Codex changes its feature, MCP, config, or JSONL interfaces.

## Contents

- [Architecture](#architecture)
- [Session persistence](#session-persistence)
- [Trusted launch boundary](#trusted-launch-boundary)
- [Safety boundary](#safety-boundary)
- [Repository and storage checks](#repository-and-storage-checks)
- [Process lifecycle](#process-lifecycle)
- [Review mode](#review-mode)
- [Model policy](#model-policy)
- [Consult mode](#consult-mode)
- [Tests](#tests)

## Architecture

`run-codex-second-opinion` is a two-file entry point, not a single script:

- `run-codex-second-opinion` — a `#!/bin/sh` bootstrap. It sanitizes `PATH`
  to absolute, non-repository entries, clears dangerous Node startup variables,
  enforces Node 18+, and hands off to `node`; it contains no application logic.
- `run-codex-second-opinion.mjs` — the actual Node.js entry point, launched
  by the bootstrap as `node run-codex-second-opinion.mjs "$@"`. It requires
  Node.js 18 or newer and uses only the standard library: no install step,
  package manager, transpiler, or generated artifact is involved.

`main()` (in the `.mjs` entry point) calls
`assertSupportedPlatform(process.platform)` (`lib/util.mjs`) before anything
else and refuses (exit `3`) outside macOS/Linux. This is not a portability
nicety: `Runtime.terminateChild` kills Codex's whole process tree with a
negative-pid `process.kill(-pid, signal)`, which is POSIX process group
semantics, and the permission checks throughout `environment.mjs`
(`constants.X_OK`/`R_OK`/`W_OK`) assume POSIX bits — as does the `#!/bin/sh`
bootstrap itself. None of this was verified elsewhere, so an unverified
platform is refused rather than run with a process-cleanup or permission
guarantee that may not actually hold.

The runtime is split by responsibility:

- `lib/util.mjs` — exit errors, quoting, timeout parsing, paths, hashing
  (including bounded-memory file hashing), synchronous command probes, and the
  platform gate.
- `lib/path-safety.mjs` — stateless filesystem/path helpers: filesystem-order
  path resolution, CODEX_HOME subtree walking, safe PATH search, and binary
  resolution.
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

## Trusted launch boundary

The launcher distrusts:

- **Repository-resolved PATH entries** — filtered out in both the `#!/bin/sh`
  bootstrap (physical-location comparison, before `node` is looked up) and the
  Node side (`Environment.excludeFromPath`, before `git` or `codex` is
  spawned). Entries are compared against the repository root, not merely the
  launch directory.
- **Node preload/write variables** — `NODE_OPTIONS`, `NODE_PATH`,
  `NODE_V8_COVERAGE`, `NODE_COMPILE_CACHE`, and `NODE_REDIRECT_WARNINGS` are
  cleared in the bootstrap (before `node` starts) and deleted from `baseEnv`
  (before any child is spawned). These cover code-loading (`--require`,
  `--import`, module resolution) and file-writing (coverage, cache, warning
  redirect) channels that a repository-influenced environment (direnv, asdf,
  mise) could set.
- **Repository-local Codex binaries** — a `CODEX_BIN` or PATH-resolved
  candidate that resolves inside any protected repository root (worktrees, git
  storage directories) is refused.

It still assumes the already-running shell, operating-system loader, external
toolchain directories, TLS/proxy configuration, and concurrently writable
external filesystem paths are trusted. Dynamic-loader variables (`LD_PRELOAD`,
`DYLD_*`) can affect `/bin/sh` before the bootstrap executes and are outside
this script's reach. This boundary prevents the reviewed repository from
injecting code through the Node-specific channels this launcher controls; it
does not defend against an entirely hostile process environment.

## Safety boundary

Every model invocation carries the same arguments, assembled in one method:

- `-c sandbox_mode="read-only"`
- `--disable hooks --disable apps --disable plugins`
- `-c notify=[]`
- `--strict-config`
- one verified `mcp_servers.<id>.enabled=false` override per enabled standalone
  server, unless `--allow-mcp` was explicitly approved
- `--ephemeral`, **review only**, and only once the installed codex has been
  probed and shown to accept it (see "Session persistence" below)
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

That verification is **point-in-time, not continuous**, and the gap is worth
stating plainly: the listing and the re-check run in their own short-lived
`codex mcp list` processes, and `exec` loads its configuration separately,
afterwards. A server enabled in the user's config inside that window carries no
`enabled=false` override, because the override list is built from the names the
re-check saw. Closing this structurally would need either a deny-all switch or
a configuration snapshot shared by verification and execution, and codex-cli
`0.146.0` offers neither (`--ignore-user-config` was evaluated on `0.147.0` and
rejected — see "Session persistence" above): `-c mcp_servers={}` **merges** rather than replaces,
leaving an already-enabled server enabled (measured — with one enabled server
in the config, `codex mcp list --json -c 'mcp_servers={}'` still reports it as
enabled), and `exec` has no flag that pins a config the probes could share.
Per-name overrides are therefore the strongest mechanism available, and the
residual window is disclosed rather than papered over. Recheck this if codex
gains a real deny-all.

`--strict-config` makes renamed safety keys fail instead of being silently
ignored. Its error text cannot distinguish a key supplied by this runner from
an unknown key in the user's config, so the failure path explains both causes.

## Repository and storage checks

Ambient Git selectors such as `GIT_DIR`, `GIT_WORK_TREE`, and
`GIT_INDEX_FILE` are removed before repository discovery. `CDPATH` is removed
too. All Git commands use argument arrays; no caller-controlled value is
evaluated by a shell. `PATH` itself is filtered to its absolute entries
(`absolutePathEntries`, `lib/util.mjs`) before becoming part of
`baseEnv` — see "Codex binary trust boundary" below for why a relative
entry is a hijack risk for every child this script spawns, not only
`codexBin`'s own resolution.

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
kept; their final paths are reported. A third artifact — Codex's own session,
below `CODEX_HOME/sessions` — is written by consult and, on a codex without
`--ephemeral`, by review too.

### Session persistence

`--ephemeral` ("Run without persisting session files to disk") removes a write
channel rather than checking where it points, and review is the only mode that
can take it: review has no `--continue`, so the session it would write is never
read back by anything, while resuming a consultation *is* what consult offers.
`Environment.detectEphemeralSupport` (`lib/environment.mjs`) therefore refuses
to arm outside review rather than trusting every future call site to remember
that — a guard the unit suite mutation-tests, and which the contract suite
covers only against the mis-wiring it exists to catch (adding the probe call to
`runConsult`), since the method is otherwise unreachable from consult.

Support is probed, not assumed: a codex without the flag rejects the whole
invocation over an unknown argument, which would turn every review into an exit
`4` on an older install. A failed or silent probe degrades to the previous
behaviour — the session is written, and the `CODEX_HOME` placement checks are
what keep it out of the repository — and says so in a `note:`, so the caller is
never left assuming the stronger guarantee held. The probe runs from
`runReview` after the empty-scope precheck rather than from `initialize()`: a
run about to exit `2` or `3` should not spend a process on a capability it will
never use.

Measured against `codex-cli 0.147.0`, one release past this document's baseline:
an ephemeral run still emits `thread.started` carrying a `thread_id`, so nothing
this script parses out of the event stream changes; only the on-disk rollout
disappears, and resuming that thread id afterwards fails with `no rollout found
for thread id ...`. `codex exec review` accepts the flag as well as `codex
exec`.

This narrows what the `sessions/` refusal below is protecting, for review, from
"every run" to "only a run on a codex that cannot suppress it". It does not
retire that refusal: consult still writes a session on every run, and codex
reads `auth.json` and `config.toml` from `CODEX_HOME` regardless. Whether an
ephemeral run still writes `cache/`, `.tmp/` or `archived_sessions/` was **not**
measured, so the placement checks stay exactly as they are.

`--ignore-user-config` was evaluated as the "real deny-all" the MCP section
below says to recheck for, and rejected: `codex mcp list` does not accept it
(measured on 0.147.0), so the verified switch-off this script relies on could
not be performed at all; it would also discard the user's configured model,
breaking both `--inherit` and the stale-default fallback, and break any install
whose model provider is defined in `config.toml`.

`CODEX_HOME` cannot be relocated without breaking continuation, so an unsafe
placement refuses the run. Resolution walks path components in filesystem
order: a symlink is followed before a later `..` is applied. This differs from
normalizing the whole string first and closes the `link/..` placement hole.
The check also follows the `sessions` link and all directory/symlink
destinations through the `YYYY/MM/DD` depth Codex writes. Dangling link targets
are checked through their nearest existing ancestor. Unreadable or
unenumerable state is refused, not treated as absent — except a vanished
directory (`ENOENT`), which is not a destination anything can be written
through, and which codex's own scratch turns over often enough that refusing
on it would be intermittent rather than protective.

That walk is bounded (512 component steps, and a repeat-detection set for
cycles) and **fails closed when the bound is hit**, returning "cannot
establish" rather than the prefix it reached. Returning the prefix was a real
fail-open: `..` means the prefix does not descend monotonically, so a spelling
like `/outside/` + `x/../` × 260 + `<repo>/inside` parks it on `/outside` for
every one of the 512 steps while the components that actually enter the
repository are still queued — the check then approved `/outside` and handed
codex a string the kernel resolves inside the repository.

`sessions/` gets the deep walk and a hard refusal, because codex demonstrably
writes there on every run that is not `--ephemeral` (see "Session persistence"
above — which is review only, and only on a codex that accepts the flag). It is not the only thing it writes under
`CODEX_HOME` — a real install also carries `archived_sessions`, `cache`,
`.tmp`, `attachments` and `automations` — so `CODEX_HOME` is additionally swept
two levels deep and any entry resolving inside the repository is **named in a
warning**, not refused.

The asymmetry is deliberate and was corrected after a measured false positive.
`CODEX_HOME` also holds directories codex only *reads* — `skills/`,
`prompts/` — and pointing those at something inside a repository is completely
ordinary: this machine has `~/.codex/skills/obsidian-authoring` linked into
this very repository, and refusing on the whole subtree made every review of it
impossible. This script cannot tell which entries codex writes and which it
reads, so it refuses only what it can prove (`sessions/`) and discloses the
rest. Anything stronger would either block a normal setup or require a
name-by-name list of codex's internals that would silently rot.

The disclosure names the **logical entry** and its destination
(`<CODEX_HOME>/skills/x -> /repo/x`), not the destination alone. That is the
whole point of the warning: the reader has to decide read-only-versus-written,
and `/repo/x` does not say whether `skills` or `cache` pointed there — both can
target the same path. Every matching entry is listed, not a sample, for the
same reason.

Both storage paths are then handed to the child in their **validated** form:
`baseEnv.CODEX_HOME` and `baseEnv.TMPDIR` carry the resolved destinations, not
the spellings they were validated from. Leaving the original strings meant codex
re-walked them itself at spawn time, minutes later, so retargeting a symlink
component in that window moved its writes somewhere the placement check never
saw. This is the same reasoning that pins `codexBin` to a dereferenced path, and
it narrows the same TOCTOU window rather than closing it — a pathname is still
not a handle.

`resolveOnPath` (`lib/path-safety.mjs`, "Codex binary trust boundary" below)
reuses this same `resolvePathSemantics` walk for exactly the same reason: a
`PATH` entry containing `..` after a symlink component needs the symlink
followed before `..` is applied, or a `join()`-then-normalize approach can
probe (or miss) the wrong directory the same way an unsafe `CODEX_HOME`
placement could.

Git prechecks disable fsmonitor, textconv, and external diff execution. Commands
that may refresh the index receive a private byte-copy through `GIT_INDEX_FILE`;
the real index is never used as their writable target. `GIT_NO_LAZY_FETCH=1`
prevents promised-object fetches on Git versions that support it. Git older
than 2.42 may still fetch a missing object, which remains a disclosed version
bound rather than an overclaimed guarantee.

Every preflight probe — git, `codex features list`, `codex mcp list` — runs
synchronously, before `Runtime`'s watchdog timer exists, and so carries a
deadline of its own: `--timeout` or 600 seconds, **whichever is larger**. Without
one, "it will not hang forever" was only ever true of the model invocation; a
git command stalling on an unreachable network mount hung the wrapper
indefinitely. The 600-second floor matters because `--timeout` also means
"abort a hung review", and a deliberately tiny value (the contract suite uses
`--timeout 1` to exercise the watchdog) would otherwise kill every probe before
it could answer and turn a fast-failing review into an environment error. A
probe that exceeds its deadline is killed and reported as a failed probe, which
every caller already refuses on.

## Codex binary trust boundary

`Environment.resolveCodexBin` (`lib/environment.mjs`) runs after
`chdir`/`resolveScratchAndCodexHome` and before the first invocation of
`codexBin`. If `CODEX_BIN` is set, it must be an absolute path or the run is
refused (exit `3`). This is not merely stylistic: `initialize()` has already
called `process.chdir(this.state.repo)` by the time anything spawns
`codexBin`, and Node resolves a relative command against the child's `cwd`
option, not the launch directory — verified empirically by spawning a
relative path with `cwd` set to a directory containing a different
executable at that same relative path, which is the one that ran. A relative
`CODEX_BIN` would therefore resolve against the repository under review, so
a reviewed repository that happens to contain a file at that relative path
could be executed in place of the binary the caller intended, before any
sandbox exists. `PATH`-based resolution for a bare `codex` has the same
class of risk if `PATH` itself contains a relative entry, which would win a
plain OS/Node PATH search ahead of a later absolute entry exactly the same
way a relative `CODEX_BIN` would.

`resolveCodexBin` closes both cases the same way, and pins `this.codexBin`
to the shared `resolveReal` helper's result exactly once, here, rather than
leaving any symlink or `PATH` indirection for a later spawn to re-resolve
on its own. `resolveReal` does two things: fully dereferences the path
(`physicalPath`, i.e. `realpathSync`), and, on a resolved path, applies the
same `hasLineBreak` check `cwd`/`CODEX_HOME`/`scratch` already carry — a
resolved binary path is printed verbatim in the `note:` line below, so a
path containing `\r`/`\n` could otherwise forge a marker line in this
script's own output. Either failure makes `resolveReal` return `null`.

- `CODEX_BIN` set: `resolveReal(raw)` must succeed, and that resolved path
  — not the original `raw` string — becomes `codexBin`.
- `CODEX_BIN` unset: `resolveOnPath` (`lib/path-safety.mjs`) searches only
  absolute `PATH` entries, in order, skipping relative ones outright; its
  result is then also passed through `resolveReal` before becoming
  `codexBin`. If no absolute `PATH` entry matches, the run refuses (exit
  `3`) rather than fall back to an unqualified search that could still
  resolve through a relative entry.

None of this protects a *spawned* child's own, later PATH search, and one
matters concretely: `codex`'s real-world packaging is a `#!/usr/bin/env
node` script — `env`, not this script, resolves `node`, using whatever
`PATH` the codex child process inherits, after this process has already
changed into the repository under review. `this.baseEnv.PATH` (the
`Environment` constructor, `lib/environment.mjs`) is filtered to absolute
entries the same way, for the same reason resolveOnPath already was, so
that inherited search — and git's, and anything else this script spawns —
sees only absolute entries too. `resolveOnPath` takes that same filtered
value as an explicit argument rather than reading `process.env.PATH`
again, so there is one definition of "safe PATH entries"
(`absolutePathEntries`, `lib/util.mjs`), not two that could drift apart.

The current design was shaped by nine iterative review rounds, each closing a
gap the previous fix left open. See
[security-history.md](./security-history.md) for the full forensic trail.

A binary that resolves inside any protected repository root (current/sibling
worktrees, git storage directories) is refused — a binary inside the reviewed
repository can be controlled by it.

There is no cryptographic or otherwise reliable way for this script to
prove a resolved binary is genuinely Codex, and dereferencing once here
does not fully close the underlying TOCTOU class either: `physicalPath`
returns a *pathname* — a string of directory-entry lookups — not a stable
handle like an open file descriptor. Node's later `spawn(codexBin, ...)`
walks that same pathname again, fresh, at call time. Anyone able to write
to a directory anywhere along that resolved path (not only its final
component — an ancestor directory can be renamed, replaced, or have a new
symlink introduced into the walk) can still change what the pathname
resolves to before that later walk happens, with no file content
overwritten in place required. Resolving once removes the specific,
already-demonstrated hijack this script controls for — a relative
`CODEX_BIN`/`PATH` entry, and a symlink swapped between an early check and
a later spawn — but it narrows a TOCTOU window, on a filesystem this
script does not own, rather than closing it outright; only an untrusted or
concurrently-writable path to the binary makes it relevant. `note: using
codex binary: <realpath>`, printed as soon as the path resolves, is a
transparency measure for what remains, not a verification: it gives a
human or agent watching the run something concrete to notice if the
resolved path is not where they expect Codex to live.

## Process lifecycle

Codex is started with `child_process.spawn` using `shell: false` and an argument
array. `detached: true` gives the child a separate POSIX process group so a
timeout or cancellation can terminate Codex and the commands it spawned that
remain in that group (see the boundary note at the end of this section).

Stdout and stderr are archived to the JSONL log as they arrive. A line-buffered
view is streamed to stderr and capped at 180 characters per line; the log keeps
the untruncated bytes. The prompt or question never appears in the `running:`
diagnostic.

Each stream gets its **own** line buffer, and the log is appended a whole line
at a time out of those buffers rather than raw chunk by raw chunk. Appending
raw chunks let a stderr chunk arriving between two halves of a split stdout
event splice itself into the middle of that JSON line, so the line stopped
parsing and the event vanished — silently, since `hasRecognizedEvent` is
satisfied by any other well-formed event in the log. The events lost that way
are exactly the ones this script draws conclusions from: model rejection,
session id, model attribution. Separating only the *echoed* view does not fix
this: the log is what `jsonEvents()` parses, so the framing has to hold there.
Byte content is still untruncated; only the interleaving granularity changes,
from arbitrary chunk boundaries to line boundaries.

Event metadata — model attribution, session id, model-rejection detection —
is parsed from an in-memory stdout-only buffer (`stdoutEventBuffer`), not from
the combined log file. The log file still contains both streams for diagnostics,
but `rejectedModel`, `effectiveModel`, `lastThreadId`, `hasRecognizedEvent`,
and `hasThreadStartedEvent` all read from the stdout buffer. This prevents a
valid JSON line on child stderr from impersonating a `thread.started` event
(forging a session id), a model-attribution event, or a model-rejection error
that would trigger the stale-default fallback. The buffer is cleared at the
start of each `execute()` call, so it naturally contains only the current
attempt's events without needing the textual `ATTEMPT_MARKER` segmentation the
combined log uses.

Every echoed line of codex output carries a `codex> ` prefix and no line the
wrapper writes about itself does, which is what lets a caller tell them apart
mechanically. Position cannot: the wrapper's own `warning:`/`note:`/`hint:`
lines are emitted throughout the run, *after* `running:` included (a
stale-model fallback, an event-schema warning, a drift warning, a timeout
hint), and a codex event can carry text identical to any of them. The failure
tail skips the wrapper-written `ATTEMPT_MARKER` for the same reason —
prefixing it would put `codex> ` on a wrapper-authored line.

A failed log write is handled rather than thrown. `appendFileSync` throwing
from inside a stream callback escapes both the awaited promise and the entry
point's `try`/`catch`, so Node printed a raw stack trace and exited `1` — a
code this skill does not document — while the *detached* Codex process group
kept running with nothing left to reap it. The write failure is now recorded,
the group is killed, the partial result discarded, and the run ends as an
ordinary exit `4`. The entry point additionally installs
`uncaughtException`/`unhandledRejection` handlers that kill the active group
and exit `3`, so no future callback bug can reintroduce the orphan.

Exit `4` and exit `5` remove the result file *and its private directory*;
`createArtifacts` likewise cleans up any directory it made before a later step
failed. The log directory is deliberately kept — the log is the artifact those
exits tell the caller to read.

The timeout uses a Node timer. At the deadline it sends `TERM` to the process
group and follows with `KILL` after a one-second grace period. A dedicated
boolean records that the timer fired, so a Codex process that independently
exits `124` remains an ordinary Codex failure rather than a fabricated timeout.
`INT`, `TERM`, and `HUP` are each forwarded to the same group **as themselves**
— the signal that arrived is the signal the group receives, not a rewritten
`TERM` — and preserve wrapper exit codes `130`, `143`, and `129`. All three
pairs are measured by the contract suite, the received signal as well as the
exit code; for a long time only `TERM`/`143` was, and the implementation
underneath quietly rewrote the other two to `TERM`, which an exit-code-only
assertion cannot see.

The group is the boundary, and it is the whole claim: a descendant that leaves
it — anything calling `setsid`, or daemonizing — is out of reach of a
negative-pid kill and survives both the watchdog and cancellation. Portable
containment of a full process *tree* would need cgroups, a subreaper, or job
objects, none of which this wrapper has. "Codex and the descendants that stay
in its process group" is the guarantee; "every command it spawned" is not.

Each attempt is separated in the log. Model and thread metadata are parsed as
JSON only from the final attempt, preventing a rejected first attempt from
supplying the successful fallback's model or session id.

`effectiveModel`, `lastThreadId`, and `rejectedModel` all assume the
documented JSONL event shape (a `type` field, `thread.started` carrying
`thread_id`, top-level `error`/`turn.failed` events). None of that is
verified against the codex-cli feature surface the way sandbox/MCP state is
— there is no equivalent of `features list` for event schema. Instead,
`hasRecognizedEvent` (`lib/runtime.mjs`) is checked once a run has already
succeeded: if the log holds bytes but not one line parses with a string
`type` field, the JSONL format has almost certainly drifted from what this
script expects, and `runWithFallback` warns rather than staying silent. This
is deliberately a warning, not a refusal — the result on stdout came from
`-o`, not from the event stream, and is not invalidated by this — but every
value this script itself derives from the event stream (fallback
attribution, the inherited-model note, session resumability) should be
treated as unconfirmed until this doc is rechecked against the installed
`codex-cli` version.

## Model policy

Model and effort are a closed three-way choice, validated before anything is
spawned: no flags (the pinned defaults), an explicit `--model M --effort L`
pair, or `--inherit`. `--model` without `--effort` and `--effort` without
`--model` are both refused, because naming either turns off the stale-default
fallback and the pinned half of the pair is not a tier every model accepts.
Each flag may appear at most once — repeating one would make the effective
setting depend on argument order — and `--inherit` combines with neither.

`CODEX_SECOND_OPINION_MODEL` and `CODEX_SECOND_OPINION_EFFORT` replace the
pinned pair wholesale, for every run in that environment. They must be set
**together or not at all**: setting one half pairs a caller's value with this
script's other half, which is exactly the combination the `--model`/`--effort`
rules exist to refuse, so a half-set environment refuses the run. When a
fallback fires on a pair that came from these variables, the warning says so
explicitly rather than calling the defaults stale — they are not this script's
defaults.

A pinned default rejected as unsupported retries once with inherited Codex
settings. Explicit pairs never retry. A consult follow-up never retries because
the rejected question may already have entered the persisted session.

Detecting "the model was rejected" reads only top-level `error`/`turn.failed`
events, and requires either a phrase that can only describe a model or effort
(`model_not_found`, `unsupported_value`, `unknown model`, `reasoning.effort`)
or an `is not supported` message that *also* names a model or effort. Bare
`is not supported` is ordinary English an unrelated capability error carries
just as easily; treating it as a stale model spent a second full invocation and
then attributed the answer to "your configured model" in a note that was simply
wrong.

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

This too is a check, not an enforcement, and the distinction matters: the probe
runs immediately before the guarded `status`/`diff`, but nothing freezes the
repository in between. A `.gitattributes` edit or a `filter.<name>.*` config
change landing in that window — another agent, a build step, a branch
checkout — means the guarded command can still run a filter outside every
sandbox. Git has no switch that suppresses clean/process filters while
preserving the working-tree comparison this code needs: overriding a driver to
a stub changes the canonicalized content Git compares, so the emptiness
precheck and the drift fingerprint would both start answering a different
question, and sandboxing the wrapper's own prechecks needs a sandbox it does
not portably have. The post-run re-probe (below) can notice that the result
became unmeasurable; it cannot un-run a filter. `--commit` is the only scope
that avoids this outright, because it never compares working-tree content.

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
otherwise the answer is discarded with exit `4`. `emitResume`
(`lib/consult.mjs`) distinguishes two ways that read can come back empty on a
continuation, because they call for different messages: no `thread.started`
event in the log at all (a legitimate case elsewhere -- see below -- but not
here, since a continuation implies codex read an existing thread) is reported
as the session having expired; a `thread.started` event present without a
readable `thread_id` (`hasThreadStartedEvent`, `lib/runtime.mjs`) is reported
as likely event-format drift instead. Both still discard the answer and exit
`4` -- this script cannot verify session continuity either way -- but only
the first is actually evidence of expiry, and conflating the two would send
someone debugging a schema change looking for an expired session that was
never the problem.

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
state machines, safety argument construction, event segmentation, fencing,
stdout-event-stream provenance, and filesystem-order path resolution. The
mutation runner verifies that these tests fail when critical guards are removed.

Read its scope precisely: **the mutation runner mutates named guards and runs
`tests/unit.test.mjs` alone — it never invokes the contract suite.** So a guard
whose only coverage is black-box (the `CODEX_HOME` placement checks, the
`TMPDIR` relocation, the throwaway `GIT_INDEX_FILE` copy, the clean/process
filter guard, the bootstrap's own `PATH` filtering, signal forwarding) has
regression coverage but *no mutation evidence*. Those live in
`tests/run-contract-tests`, and when one is changed the honest check is to
break it by hand and confirm that suite goes red — the mutation total says
nothing about them.

Defense-in-depth can mask a mutant: adding a broader fail-closed guard
*after* an existing, narrower one (as `resolveCodexBin`'s round-3 fix did)
can make removing the narrower guard alone unobservable by exit code —
both paths now die with the same code, just for different reasons. When
`tests/unit.test.mjs:throwsExit` is asserting on a check that has, or gains,
a sibling guard reachable by the same failure, pass its optional
`messagePattern` argument to pin which guard actually fired, not just that
some guard did — an exit-code-only assertion silently stops discriminating
the moment a second guard is added nearby.

```bash
./codex-second-opinion/tests/run-mutation-tests
```

The slower black-box compatibility suite uses a real executable fake Codex and
exercises process, Git, storage, marker, and signal behavior without network or
a real model. It also has the one test in this project that exercises the
`#!/bin/sh` bootstrap's own PATH filtering against a real, separate fake
`node` executable — not something a fake `CODEX_BIN` alone can stand in for,
since that bootstrap runs before `CODEX_BIN` is ever read:

```bash
./codex-second-opinion/tests/run-contract-tests
```
