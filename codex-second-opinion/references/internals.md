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

`run-codex-second-opinion` is a two-file entry point, not a single script:

- `run-codex-second-opinion` — a `#!/bin/sh` bootstrap. Its only job is to
  sanitize `PATH` to absolute entries (see "Codex binary trust boundary",
  point 7) before handing off to `node`; it contains no application logic.
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

- `lib/util.mjs` — exit errors, quoting, timeout parsing, paths, hashing,
  synchronous command probes, and the platform gate.
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

That verification is **point-in-time, not continuous**, and the gap is worth
stating plainly: the listing and the re-check run in their own short-lived
`codex mcp list` processes, and `exec` loads its configuration separately,
afterwards. A server enabled in the user's config inside that window carries no
`enabled=false` override, because the override list is built from the names the
re-check saw. Closing this structurally would need either a deny-all switch or
a configuration snapshot shared by verification and execution, and codex-cli
`0.146.0` offers neither: `-c mcp_servers={}` **merges** rather than replaces,
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
kept; their final paths are reported. Codex keeps the third artifact, its
session, below `CODEX_HOME/sessions`.

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
writes there on every run. It is not the only thing it writes under
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

Both storage paths are then handed to the child in their **validated** form:
`baseEnv.CODEX_HOME` and `baseEnv.TMPDIR` carry the resolved destinations, not
the spellings they were validated from. Leaving the original strings meant codex
re-walked them itself at spawn time, minutes later, so retargeting a symlink
component in that window moved its writes somewhere the placement check never
saw. This is the same reasoning that pins `codexBin` to a dereferenced path, and
it narrows the same TOCTOU window rather than closing it — a pathname is still
not a handle.

`resolveOnPath` (`lib/environment.mjs`, "Codex binary trust boundary" below)
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
- `CODEX_BIN` unset: `resolveOnPath` (`lib/environment.mjs`) searches only
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

Six review rounds shaped this into its current form, each closing a gap
the previous round's fix left open:

1. `resolveOnPath`'s result was printed as a `note:` line while the bare
   string `'codex'` stayed the actual spawn target for the unset-`CODEX_BIN`
   case; a relative `PATH` entry ahead of the resolved absolute one would
   still win the real search Node performs, so the note could name a
   safe-looking binary while a repository-controlled one actually ran.
   Assigning the resolved value to `codexBin` closed that.
2. The `CODEX_BIN`-set branch pinned `codexBin` to `raw` while printing its
   resolved form — so a `raw` symlink left the note showing one target
   while `codexBin` itself still named the symlink. `verifyFeatures`/
   `verifyMcp` and the actual review/consult exec each independently ask
   the OS to resolve that symlink again, at different times (the real exec
   can start minutes later); retargeting it in between would run a
   different binary than the one the earlier checks and note described.
   Passing the resolved value through and assigning *that* to `codexBin` —
   for both branches — removed the remaining symlink indirection.
3. A resolution failure (dangling symlink, permission error, a transient
   failure from something mid-swap) fell back to leaving `codexBin` as the
   unresolved, still-mutable original string instead of refusing — the
   exact unpinned state point 2 exists to eliminate, just reached through
   its failure path instead of its success path. Both branches now refuse
   (exit `3`) on a resolution failure rather than treat it as "safe enough
   to proceed with the raw name instead."
4. The resolved path was printed and assigned verbatim, with no check for
   an embedded `\r`/`\n` — the same class of gap `cwd`/`CODEX_HOME`/
   `scratch` are already checked for elsewhere in this file, just not yet
   applied here. `resolveReal`'s `hasLineBreak` check closed it, and folding
   both checks into one function shared by both branches (rather than
   duplicating them a second time) is what made point 3 and this point a
   single shared fix instead of four separate ones.
5. `resolveOnPath` and `CODEX_BIN`'s own resolution only ever protected
   *this script's* choice of which binary to name. They said nothing about
   what that binary's own process does next: an `env`-shebang launcher (the
   real shape codex ships in) performs a second, independent PATH search,
   inside the spawned child, using whatever `PATH` this script handed it —
   still the original, unfiltered one, relative entries included, evaluated
   with cwd already inside the reviewed repository. `baseEnv.PATH` being
   filtered to absolute entries closed that; every point above secured *how
   this script names* the binary, this one secures *what that binary's own
   process can resolve* once it runs.
6. The rejection message for a PATH candidate that failed `resolveReal`
   interpolated the rejected candidate itself, unflattened — so a
   line-break-forging candidate could still forge a marker line through its
   own rejection notice, on the one path where the line-break check was
   the reason for the rejection in the first place. `flat(found)` in that
   message closed it; the parallel `CODEX_BIN`-branch message already used
   `flat(raw)`, so this was catching up an inconsistency, not a new idea.

Point 5 raised a further question. `run-codex-second-opinion` — the file a
caller actually invokes — was itself a `#!/usr/bin/env node` script. A
relative `PATH` entry ahead of a real `node` resolves *that* shebang before
`Environment` is ever constructed — before any line of this project's own
JavaScript, including `baseEnv.PATH` filtering, has run. This was first
judged out of scope, on the reasoning that it requires the *launching*
environment to already have a relative `PATH` entry, a precondition none of
the other points needed. That reasoning did not survive a second review
round: the launching environment is routinely the reviewed repository
itself — an agent invoking this skill from inside the very project it is
about to review is the ordinary case, not an edge case — and project-local
dev-tooling (direnv, asdf, mise, and similar) commonly prepends a
project-relative `PATH` entry on `cd` into a repository. A repository able
to make that happen is exactly the adversarial-repository threat model
every other point in this section already defends against; this was a gap
in it, not a different problem outside it.

No code added *inside* a `#!/usr/bin/env node` script can retroactively
change how its own interpreter was already chosen, and hardcoding an
absolute `node` path into the shebang would break on every install that
does not happen to put `node` there (nvm, Homebrew, a system package
manager, volta, fnm, ... — there is no portable choice, and `AGENTS.md`
rules out hardcoding a machine-specific path regardless). The fix instead
splits the entry point in two, as the Architecture section above
describes: `run-codex-second-opinion` is now a `#!/bin/sh` bootstrap, and
`/bin/sh` needs no `PATH` search of its own — the shebang names it by an
absolute, POSIX-guaranteed path, so it starts running before `PATH` matters
at all. It filters `PATH` down to absolute entries using nothing but shell
built-ins (a `for`/`case` loop and parameter expansion — no external
command, so nothing else has to be found on `PATH` first either), then
`exec`s `node run-codex-second-opinion.mjs "$@"` — the `node` that bare
`exec` resolves is now looked up under the already-filtered `PATH`, closing
the gap the same way `baseEnv.PATH` closes it for codex's own child
process. If every original `PATH` entry was relative, filtering leaves an
empty string — and an empty `PATH` is not "search nothing" under POSIX
command lookup, it means "search the current directory," reopening the
exact hijack this bootstrap exists to close (verified empirically: `env -i
PATH= /bin/sh -c 'exec node --version'` runs a `./node` placed in cwd). The
bootstrap refuses (exit `3`) rather than export that empty value. Splitting
that same `PATH` also needed `set -f` (part of the `set -euf` at the top of
the script): an unquoted `$PATH` expansion undergoes pathname (glob)
expansion as well as the field-splitting `IFS=:` enables, so an entry like
`/opt/*` would otherwise expand to every matching child directory of
`/opt` — names the literal `PATH` value never actually contained — before
the loop's own absolute/relative filter ever saw them (verified
empirically: `IFS=: ; PATH="/x/*:/usr/bin" ; for d in $PATH; do ...`
enumerates `/x`'s children when `/x/*` matches something). `set -f`
disables that expansion for the whole script, which needs no globbing
anywhere else.
8. Dereferencing `codexBin` to a real path (point 2) changes *which file*
   gets executed, on purpose. It also changes what a program that branches
   on its own `argv[0]` — a multicall binary, or a symlink-dispatching shim,
   both established Unix patterns — would see itself invoked as, which was
   not on purpose and could turn a working install (`command -v codex`
   succeeds) into a broken one this script itself caused. `codexArgv0`
   (`Environment`, captured at construction, before any resolution) keeps
   the pre-resolution identity — the literal `CODEX_BIN` value, or the bare
   `'codex'` default — and every spawn of `codexBin` (`verifyFeatures`,
   `verifyMcp`, and the actual review/consult exec) passes it as `argv0`, so
   the file that runs is the safe, resolved one while the identity it sees
   itself invoked under is unchanged. This is a real but narrow fix: `argv0`
   only affects a *natively executed* target's own `argv[0]`. A shebang
   script's interpreter does not receive it — the kernel reconstructs the
   interpreter's argv from the script's own file path when handling `#!`,
   independent of what the exec caller set as `argv0` (verified empirically:
   `spawn(scriptPath, [], {argv0: 'x'})` against a `#!/bin/bash` script still
   reports `${0}` as `scriptPath`, never `'x'`). The installed `codex.js`
   (`#!/usr/bin/env node`) is exactly such a script, and inspection of it
   found no `argv[0]`-based branching regardless, so this closes a real gap
   for a *native* multicall target without claiming to help the packaging
   codex actually ships as today.

9. Absolute turned out not to mean safe. Every point above filters `PATH` down
   to its *absolute* entries — but the dev-tooling case point 5 and the
   bootstrap discussion both name as the motivation prepends an entry that is
   normally absolute **and inside the project**: direnv's `PATH_add bin`
   exports `/repo/bin`, `layout node` exports `/repo/node_modules/.bin`. Such
   an entry passed the absolute-only filter untouched and could supply this
   run's `git`, its `codex`, or the `node` an env-shebang launcher resolves —
   out of the repository under review, before any sandbox exists. Verified
   empirically: a `/repo/bin/node` reached via an absolute repo-internal `PATH`
   entry executed. The motivating example was, in other words, the one case the
   filter did not cover.

   It is closed in both halves of the entry point. The `#!/bin/sh` bootstrap
   drops entries resolving under its own launch directory and under an explicit
   `--repo` argument, comparing physical locations (`cd` + `pwd -P`, both
   built-ins, so nothing has to be found on `PATH` to run the filter) rather
   than spellings, so a symlink into the repository is caught too. An entry it
   cannot enter at all is dropped silently — `cd` needs the same execute bit a
   `PATH` search does, so it could never have supplied a binary — while a
   repository-internal drop prints a `note:`. `Environment.excludeFromPath`
   then repeats this on the Node side against `cwd` (before the first `git`
   runs, since `git` is what discovers the rest of the boundary) and again
   against the full `repoRoots` once sibling worktrees and the git storage
   directories are known.

   A filtered `PATH` can legitimately end up with no `node` on it. Reaching the
   bootstrap's `exec` in that state produced the shell's own diagnostic and
   status `127` — undocumented here, and unhelpful. It now refuses with exit
   `3` and a hint naming the cause.

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

Each stream gets its **own** line buffer. A single shared one let a stderr
chunk arriving between two halves of a split stdout event splice itself into
the middle of that JSON line, so the line stopped parsing and the event
vanished — silently, since `hasRecognizedEvent` is satisfied by any other
well-formed event in the log. The events lost that way are exactly the ones
this script draws conclusions from: model rejection, session id, model
attribution.

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
state machines, safety argument construction, event segmentation, fencing, and
filesystem-order path resolution. The mutation runner verifies that these
tests fail when critical guards are removed.

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
