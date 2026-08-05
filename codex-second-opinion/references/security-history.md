# Security History

Historical rationale and iterative hardening record for the
codex-second-opinion skill. This document captures the forensic trail of
how the current security boundary was shaped — successive review rounds,
the specific exploits each closed, and the empirical evidence behind
design decisions. For the **current-state** description of each
mechanism, see [internals.md](./internals.md).

## Codex binary trust boundary — hardening rounds

Six review rounds shaped `resolveCodexBin` into its current form, each
closing a gap the previous round's fix left open:

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

## Bootstrap entry-point hardening

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
splits the entry point in two: `run-codex-second-opinion` is now a
`#!/bin/sh` bootstrap, and `/bin/sh` needs no `PATH` search of its own —
the shebang names it by an absolute, POSIX-guaranteed path, so it starts
running before `PATH` matters at all. It filters `PATH` down to absolute
entries using nothing but shell built-ins (a `for`/`case` loop and
parameter expansion — no external command, so nothing else has to be found
on `PATH` first either), then `exec`s `node run-codex-second-opinion.mjs
"$@"` — the `node` that bare `exec` resolves is now looked up under the
already-filtered `PATH`, closing the gap the same way `baseEnv.PATH` closes
it for codex's own child process. If every original `PATH` entry was
relative, filtering leaves an empty string — and an empty `PATH` is not
"search nothing" under POSIX command lookup, it means "search the current
directory," reopening the exact hijack this bootstrap exists to close
(verified empirically: `env -i PATH= /bin/sh -c 'exec node --version'` runs
a `./node` placed in cwd). The bootstrap refuses (exit `3`) rather than
export that empty value. Splitting that same `PATH` also needed `set -f`
(part of the `set -euf` at the top of the script): an unquoted `$PATH`
expansion undergoes pathname (glob) expansion as well as the field-splitting
`IFS=:` enables, so an entry like `/opt/*` would otherwise expand to every
matching child directory of `/opt` — names the literal `PATH` value never
actually contained — before the loop's own absolute/relative filter ever saw
them (verified empirically). `set -f` disables that expansion for the whole
script, which needs no globbing anywhere else.

## argv0 preservation

Dereferencing `codexBin` to a real path (point 2) changes *which file* gets
executed, on purpose. It also changes what a program that branches on its own
`argv[0]` — a multicall binary, or a symlink-dispatching shim, both
established Unix patterns — would see itself invoked as, which was not on
purpose and could turn a working install (`command -v codex` succeeds) into a
broken one this script itself caused. `codexArgv0` (`Environment`, captured at
construction, before any resolution) keeps the pre-resolution identity — the
literal `CODEX_BIN` value, or the bare `'codex'` default — and every spawn of
`codexBin` passes it as `argv0`, so the file that runs is the safe, resolved
one while the identity it sees itself invoked under is unchanged. This is a
real but narrow fix: `argv0` only affects a *natively executed* target's own
`argv[0]`. A shebang script's interpreter does not receive it — the kernel
reconstructs the interpreter's argv from the script's own file path when
handling `#!`, independent of what the exec caller set as `argv0` (verified
empirically). The installed `codex.js` (`#!/usr/bin/env node`) is exactly
such a script, and inspection of it found no `argv[0]`-based branching
regardless, so this closes a real gap for a *native* multicall target without
claiming to help the packaging codex actually ships as today.

That same kernel behaviour is why `argv0` cannot be contract-tested here: the
fake codex is a shebang script and can never observe a caller-supplied
`argv0`. The plumbing is pinned instead by a unit test that sends `argv0`
through `Environment.command` to `/bin/sh` (a real executable, which does
observe it), plus a mutant that deletes `argv0` from `run()` in
`lib/util.mjs`.

## Absolute PATH entries inside the repository

Absolute turned out not to mean safe. Every point above filters `PATH` down to
its *absolute* entries — but the dev-tooling case the bootstrap discussion
names as the motivation prepends an entry that is normally absolute **and
inside the project**: direnv's `PATH_add bin` exports `/repo/bin`, `layout
node` exports `/repo/node_modules/.bin`. Such an entry passed the
absolute-only filter untouched and could supply this run's `git`, its `codex`,
or the `node` an env-shebang launcher resolves — out of the repository under
review, before any sandbox exists. Verified empirically: a `/repo/bin/node`
reached via an absolute repo-internal `PATH` entry executed. The motivating
example was, in other words, the one case the filter did not cover.

It is closed in both halves of the entry point, and in both cases the
directory that gets filtered against is the **repository root**, not the
launch directory or `--repo` value as given. Filtering against those alone
protected only that directory: launched from `/repo/sub`, or with `--repo
/repo/sub`, an absolute `/repo/bin` entry survived untouched. The root is
found by walking up for a `.git` entry — a file counts, since linked
worktrees and submodule checkouts use a gitfile — which deliberately does not
ask `git`, because choosing a trustworthy `PATH` is exactly what has to happen
before any binary is looked up on it.

The `#!/bin/sh` bootstrap compares physical locations (`cd` + `pwd -P`, both
built-ins, so nothing has to be found on `PATH` to run the filter) rather than
spellings, so a symlink into the repository is caught too. An entry it cannot
enter at all is dropped silently — `cd` needs the same execute bit a `PATH`
search does, so it could never have supplied a binary — while a
repository-internal drop prints a `note:`.

`Environment.excludeFromPath` then repeats this on the Node side against `cwd`
(before the first `git` runs, since `git` is what discovers the rest of the
boundary) and again against the full `repoRoots` once sibling worktrees and
the git storage directories are known.

A filtered `PATH` can legitimately end up with no `node` on it. This is now
caught with exit `3` and a hint naming the cause.

## Fail-open resolution budget

`resolvePathSemantics`'s step budget originally returned the prefix it had
reached when exhausted. Returning the prefix was a fail-OPEN: `..` means the
prefix does not descend monotonically, so a path like `/outside/` + `x/../` ×
260 + `<repo>/pwned` keeps the prefix parked on `/outside` for every one of
the 512 steps while the components that actually descend into the repository
are still queued in `pending`. The caller then checked `/outside` — outside
the repo, approved — and handed codex a string the kernel resolves to a
destination inside the very repository being reviewed. Verified empirically
with a 530-component path. Every caller now treats null as "cannot establish
where this lands."

## Log interleaving incident

The log was originally appended raw-chunk by raw-chunk. A stderr chunk
arriving between two halves of a split stdout event spliced itself into the
middle of that JSON line in the log file, so the line no longer parsed and the
event vanished — silently, because `hasRecognizedEvent` is satisfied by any
other well-formed event in the log. The events lost that way are exactly the
ones this script draws conclusions from: model rejection, session id, model
attribution. The fix gives each stream its own line buffer and appends
complete lines only.

## Orphan process incident

A failed `appendFileSync` from inside a stream callback escaped both the
awaited promise and the entry point's `try`/`catch`, so Node printed a raw
stack trace and exited `1` — a code this skill does not document — while the
*detached* Codex process group kept running with nothing left to reap it. The
entry point now installs `uncaughtException`/`unhandledRejection` handlers
that kill the active group and exit `3`.
