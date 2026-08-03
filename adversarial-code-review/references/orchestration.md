# Claude Code Orchestration

How Claude Code executes [contract.md](./contract.md). Everything here
is harness-specific: subagents, model tiers, worktree isolation, the
cost model, and the bundled Workflow script.

Three quantities trade against each other in every run — **coverage**
(defects seen at all), **accuracy** (claims that survive scrutiny), and
**token cost**. This file is mostly about how that trade is made
explicit, budgeted, and disclosed.

## 1. Phase 0 — Capture the review artifact

The Workflow script cannot run shell commands, so scope resolution and
patch capture happen **before** it is invoked, in the main agent.

Resolve the target in this priority order and state the choice:

1. A range, PR, or paths the user named explicitly.
2. Uncommitted changes (staged + unstaged) if any exist.
3. Current branch versus `merge-base` with the default branch.

Then bind it. This is not bookkeeping — a git worktree is a clean
checkout of a commit, so without an explicit patch to carry, the attack
phase reads different code than the review phase.

```bash
# FIRST LINE OF EVERY Phase 0 Bash call, not decoration. Almost every guard
# below is written assuming a failure stops the run: `cp` of the index, the
# patch capture, the pipelines whose producers propagate explicitly. Without
# it a `git diff` that exits 128 leaves a SHORT patch, the manifest still
# names what the patch lacks, and patch_sha256 hashes the incomplete artifact
# — a binding that is internally consistent and describes the wrong thing.
# Bash does not inherit this between tool calls, so repeat it in each one.
set -euo pipefail

# BASH, not merely "a shell". Everything below uses bash arrays, `read -r -d ''`
# and `${arr[@]+"${arr[@]}"}`. Under zsh — the default login shell on macOS —
# arrays are 1-indexed, so `${diff_args[0]}` is UNSET: measured, `base_sha`
# comes out empty while the patch is still written and hashed, which is a
# binding that is internally consistent and describes the wrong thing. That is
# the exact failure this file's capture rules exist to prevent, so it refuses
# rather than producing it.
[ -n "${BASH_VERSION:-}" ] || {
  echo "Phase 0 requires bash: this recipe uses bash arrays and read -d, and under zsh base_sha comes out empty while the patch still looks captured" >&2
  exit 1
}

# AT THE TOP LEVEL, before anything enumerates. `git ls-files` — unlike
# `git diff` and `git status` — is scoped to the CURRENT DIRECTORY and prints
# paths relative to it. Measured: from `src/`, `git ls-files --stage` omits a
# sibling `vendor/` gitlink entirely and reports `src/s.txt` as `s.txt`. Every
# enumeration below is an ls-files — the untracked half of the patch, both
# manifests, the changed-range list, the submodule disclosure and the
# write-safety snapshot — so a Phase 0 run from a subdirectory silently
# reviews a subtree while reporting it as the repository. One cd fixes all of
# them; a pathspec on each would have to be right at six sites.
cd -- "$(git rev-parse --show-toplevel)" ||
  { echo "could not reach the repository root" >&2; exit 1; }

# Everything Phase 0 writes goes under this: the index copy, the patch, both
# snapshots. A TMPDIR inside the worktree — or inside its git storage, which a
# linked worktree keeps elsewhere — would put all of it in the tree being
# reviewed, before the baseline that could disclose it exists. Relocate, and
# refuse if there is nowhere left.
acr_root="${TMPDIR:-/tmp}"
# `--`: TMPDIR is an environment variable, and `cd` is a builtin that parses
# its own options. `TMPDIR=-P` makes this `cd -P` with no operand, which
# succeeds and lands on $HOME — every Phase 0 scratch file, including both
# snapshots, would then be written there while the containment checks below
# judge the wrong directory. Quoting does not stop it; the terminator does.
acr_root="$(cd -- "$acr_root" 2>/dev/null && pwd -P)" || acr_root=/tmp
# A line break in the scratch path would forge records in the §8 handoff.
# `tmp` is printed as `tmp=%s\nbase_sha=%s\n`, so a TMPDIR ending in
# `<newline>base_sha=<forty hex>` yields a handoff whose second line the
# reader takes as the base commit — a review then binds its attacks to a
# commit nobody captured, and the patch hash it checks belongs to a different
# tree. Refuse at the root, before mktemp derives anything from it.
# Held in a variable: `$(printf '\n')` strips the very newline it is meant to
# match, leaving the pattern `**`, which matches every path.
acr_lf='
'
# CR too, not only LF. A carriage return is not a record separator here, but
# the Workflow boundary rejects any patch_path carrying one — so a TMPDIR with
# a `\r` completed Phase 0, persisted a scratch directory, and produced a
# capture nothing downstream could consume. Refusing both is the only reading
# under which "the handoff is intact" and "the run can continue" agree.
acr_cr="$(printf '\r')"
case "${acr_root}" in
  *"${acr_lf}"*|*"${acr_cr}"*)
    echo "the scratch path contains a line break, which would forge records in the Phase 0 handoff and is refused at the Workflow boundary; set TMPDIR elsewhere" >&2
    exit 1 ;;
esac
# A partial clone fetches missing objects on demand, so a capture that needs
# one reaches the network and writes the SHARED .git/objects — before the
# baseline exists. Inert below git 2.42; say so rather than claim otherwise.
export GIT_NO_LAZY_FETCH=1

# Every worktree root, not just this one. A linked worktree shares its object
# store with the main checkout and any siblings, and a TMPDIR under one of
# those is inside the repository by any reading that matters.
# Read into an array. `for x in ${roots}` splits on whitespace, and a
# worktree path may contain some — the containment check would then look for
# two directories that do not exist and miss the one that does.
# `-z`, not the line form: measured, a worktree path containing a NEWLINE is
# emitted raw and unquoted, so a line-oriented reader sees two records and the
# real path in neither — and that root then goes unchecked.
# The exit status rides the stream as a final NUL record. A process
# substitution's status is UNREACHABLE — `set -euo pipefail` does not see it,
# so a git that fails or is killed reads as a repository with no worktrees and
# every containment check silently passes. `&&`/`||` rather than `;` because
# set -e inside the substitution would kill it before the marker was written.
acr_roots=()
acr_wt_status=missing
while IFS= read -r -d '' acr_rec; do
  case "${acr_rec}" in
    'worktree '*) acr_roots+=("${acr_rec#worktree }") ;;
    'acr_status '*) acr_wt_status="${acr_rec#acr_status }" ;;
  esac
done < <(git worktree list --porcelain -z && printf 'acr_status 0\0' || printf 'acr_status %s\0' "$?")
if [ "${acr_wt_status}" != 0 ]; then
  echo "could not enumerate worktrees (${acr_wt_status}); refusing to place scratch blind" >&2
  exit 1
fi
# The CURRENT checkout, explicitly. `git worktree list` does NOT report it in
# every layout: measured on git 2.39.5, a repository created with
# `--separate-git-dir` — and one driven by GIT_DIR + GIT_WORK_TREE — reports
# the GIT STORAGE as the worktree record and omits the checkout entirely. A
# TMPDIR inside the tree under review then passed every containment check
# below, and Phase 0 wrote the patch, both snapshots and the manifests into
# the very tree it was about to diff, before the baseline that could disclose
# it existed. The shell is already at the top level, so this is that path.
acr_roots+=("$(pwd -P)")
acr_roots+=("$(git rev-parse --absolute-git-dir)")
acr_roots+=("$(git rev-parse --path-format=absolute --git-common-dir)")
for acr_repo in "${acr_roots[@]}"; do
  acr_repo="$(cd "$acr_repo" 2>/dev/null && pwd -P)" || continue
  # Trailing slash stripped before the pattern is built: a worktree at `/`
  # would otherwise give `//*`, which matches nothing — so a repository
  # containing every path on the machine would read as containing none.
  acr_repo="${acr_repo%/}"
  case "${acr_root}/" in "${acr_repo}"/*|"${acr_repo}/") acr_root=/tmp ;; esac
  case "$(cd /tmp && pwd -P)/" in "${acr_repo}"/*|"${acr_repo}/")
    echo "no scratch directory outside the repository; set TMPDIR elsewhere" >&2; exit 1 ;;
  esac
done
# This directory PERSISTS after the run, and that is not an oversight: the
# attack phase reads patch.diff out of it in a different Bash call, and the
# post-run snapshot compares against tree-before taken in the first one. So
# nothing here may clean up after itself, and one directory accumulates per
# review — holding the full reviewed diff, a copy of the index, both tree
# snapshots, and the enumeration files the chosen scope needed. Say so in the
# report rather than leaving the user to find it:
# the sibling skill names the two files it keeps, and this one kept six
# without naming any.
tmp="$(mktemp -d "${acr_root}/acr-XXXXXX")"
# Remove it ONLY on failure. A successful capture must persist — the attack
# phase and the post-run snapshot read it after this shell exits — but a run
# that dies at the patch capture or a manifest exits under `set -e` before
# anything can name the directory, so every retry would leave another
# unannounced copy of a partial diff and the index. Success falls through with
# the directory intact.
trap 'acr_st=$?; [ "${acr_st}" -ne 0 ] && [ -n "${tmp:-}" ] && rm -rf "${tmp}"; exit "${acr_st}"' EXIT

# Read git without letting it write the repository. A diff against the WORKING
# TREE refreshes stale stat data and rewrites .git/index — with or without
# --no-optional-locks, measured — and the capture below runs before the
# baseline snapshot exists, so that write could not even be disclosed. A byte
# copy gives the same answer and absorbs the refresh. Export it in EVERY Bash
# call that runs these commands: environment does not survive between calls.
cp "$(git rev-parse --git-path index)" "${tmp}/index-copy"
export GIT_INDEX_FILE="${tmp}/index-copy"
# --no-ext-diff and --no-textconv on every diff for the same reason as
# fsmonitor: both name a program git runs, before any of this is sandboxed —
# and a textconv driver also yields prose the attack phase cannot apply.
# --binary because a tracked binary change otherwise becomes "Binary files
# differ", which `git apply` refuses, silently breaking the patch binding.
# And `core.fsmonitor` names a program git EXECUTES while refreshing, outside
# anything this review controls and before it has taken a baseline. The index
# copy only redirects the write; this stops the run. Both belong on every
# working-tree query below, which is why they are environment, not flags.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false

# Fix the endpoints ONCE, here. Every command below — patch, manifests,
# changed_ranges — must use these same ones. A branch review that captures
# base..HEAD but builds its manifest from `git diff HEAD` yields an EMPTY
# included_paths on a clean tree, and the script then refuses to start.
#
# ONE scope, chosen by a `case`, and the only lines to edit are the three
# directly below. This was four assignments in sequence with `(1)`..`(4)`
# comments — a menu written as a script. Pasted as it stood it ran all four:
# `${from_ref}` is set by nobody but the explicit-range caller, so under
# `set -u` the block aborted with `unbound variable` after the scope it wanted
# had already been chosen and overwritten, and a repository with no default
# branch exited 1 during a capture that never needed one. Both read as a broken
# recipe rather than as a menu, and an agent that hits either improvises — the
# one thing a bundled procedure exists to prevent.
acr_scope=uncommitted            # uncommitted | branch | range
from_ref=""; to_ref=""           # REQUIRED when acr_scope=range
# Paths the user named: NOT a fourth scope. They keep the endpoints of whatever
# scope they sit in and narrow it by pathspec, which means running the FILTERED
# recipe below. Patch, both manifests and changed_ranges must use the same
# list, or included_paths describes something other than the captured patch.
paths=()                         # e.g. paths=(src/pay.js src/auth.js)

case "${acr_scope}" in
  uncommitted)
    diff_args=(HEAD); untracked=1 ;;
  branch)
    # `origin/HEAD` is an OPTIONAL symbolic ref: a clone made without it, or a
    # repository whose remote HEAD was never set, has none — measured, this
    # very repository exits 128 with "Not a valid object name origin/HEAD"
    # while having an `origin` remote. Under `set -e` that aborts Phase 0
    # before capture. Fall back to the remote HEAD, then to the local default
    # names, and say which was used rather than guessing silently.
    acr_base_ref=""
    for acr_try in origin/HEAD "$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)" \
                   origin/main origin/master main master; do
      [ -n "${acr_try}" ] || continue
      if git rev-parse --verify --quiet "${acr_try}^{commit}" >/dev/null 2>&1; then acr_base_ref="${acr_try}"; break; fi
    done
    [ -n "${acr_base_ref}" ] || { echo "no default branch found; set acr_scope=range and name from_ref/to_ref" >&2; exit 1; }
    diff_args=("$(git merge-base "${acr_base_ref}" HEAD)" HEAD); untracked=0 ;;
  range)
    # Checked, not assumed. Left to `set -u` this is an `unbound variable`
    # abort that names a shell variable rather than the choice the caller did
    # not finish making.
    if [ -z "${from_ref}" ] || [ -z "${to_ref}" ]; then
      echo "acr_scope=range needs both from_ref and to_ref" >&2; exit 1
    fi
    diff_args=("${from_ref}" "${to_ref}"); untracked=0 ;;
  *)
    echo "acr_scope must be one of: uncommitted, branch, range" >&2; exit 1 ;;
esac

# The pathspec every capture command shares, `.` when no paths were named. One
# spelling for both cases, so the patch, the two manifests and the range map
# cannot be narrowed in different places — which is how excluded_paths comes to
# describe something other than what the agents received.
# `${arr[@]+"${arr[@]}"}` because on bash 3.2 an empty array expands as unset
# under `set -u`, and the recipe refuses to run under anything but bash.
acr_pathspec=(.)
if [ "${#paths[@]}" -gt 0 ]; then acr_pathspec=(${paths[@]+"${paths[@]}"}); fi

base_sha="$(git rev-parse "${diff_args[0]}")"
# Explicit, not left to errexit alone. This one command produces the entire
# tracked half of the artifact, and a partial write here is the failure that
# stays invisible: the untracked half still appends, the manifest still names
# every path, and the hash still computes — over a patch missing the tracked
# changes the review claims to be about.
git diff --no-ext-diff --no-textconv --binary --ignore-submodules=dirty "${diff_args[@]}" -- "${acr_pathspec[@]}" > "${tmp}/patch.diff" ||
  { echo "could not capture the tracked patch" >&2; exit 1; }
# Untracked files exist only in the working tree, so they belong to the
# uncommitted scope alone. Added without touching the index.
if [ "${untracked}" = 1 ]; then
  # Read the list FIRST, then loop: a `while` on the right of a pipe runs in a
  # subshell, so nothing it does can stop the outer shell.
  # Via a FILE, not a process substitution. A substitution's exit status is
  # unreachable — a git that fails or is killed mid-list reads as "no
  # untracked files" and the patch quietly omits them while the manifest below
  # still names them. A redirection to a real file gives git's status
  # directly, and reading it back keeps the loop in this shell. The status
  # cannot ride the stream here the way it does for worktrees: these records
  # are PATHS, and an attacker can create a file named like any marker.
  acr_untracked=()
  git ls-files --others --exclude-standard -z -- "${acr_pathspec[@]}" > "${tmp}/untracked.z" ||
    { echo "could not enumerate untracked files" >&2; exit 1; }
  while IFS= read -r -d '' f; do acr_untracked+=("$f"); done < "${tmp}/untracked.z"
  for f in ${acr_untracked[@]+"${acr_untracked[@]}"}; do
    # The per-file status needs `|| st=$?` because exit 1 is the ordinary case
    # here: `--no-index` reports "they differ" that way, and under `set -e` a
    # bare invocation aborts on it. Anything ABOVE 1 is a real failure, and
    # swallowing it drops a file from the patch while the manifest still names
    # it — included_paths would then describe something the bound patch lacks.
    st=0
    git diff --no-ext-diff --no-textconv --no-index --binary -- /dev/null "${f}" \
      >> "${tmp}/patch.diff" || st=$?
    [ "${st}" -le 1 ] || { echo "capture failed on ${f}" >&2; exit 1; }
  done
fi

patch_sha256="$(shasum -a 256 "${tmp}/patch.diff" | cut -d' ' -f1)"

# included_paths is REQUIRED and the script refuses to start without it, so it
# belongs here and not only in the filtered recipe below. Same endpoints again.
#
# An `if`, not `&&`: with `untracked=0` the group's last command is a FALSE
# test, so under `set -o pipefail` this otherwise perfect pipeline reports
# failure. And each producer propagates explicitly, because `sort` succeeding
# would otherwise hide a `git diff` that did not.
# `--ignore-submodules=dirty` HERE TOO, and for the reason the capture uses
# it: a submodule whose gitlink has not moved but whose worktree is dirty is
# reported as changed by a default `git diff`. The capture drops it, so without
# the same flag the manifest names a path the bound patch does not contain —
# and included_paths is the one thing that keeps a finding inside the artifact,
# so a candidate could then be accepted and reported against source nobody
# captured. Every diff that feeds a manifest or a range needs the same policy
# as the diff that feeds the patch, or the three describe different artifacts.
acr_manifest() {                       # ${1}.. = extra pathspec arguments
  { git diff --name-only --ignore-submodules=dirty "${diff_args[@]}" ${1+"$@"} || exit 1
    if [ "${untracked}" = 1 ]; then
      git ls-files --others --exclude-standard ${1+"$@"} || exit 1
    fi
  } | sort -u
}
# The pathspec goes here too, so a caller who named paths gets the same
# narrowing in the manifest as in the patch. Passing it to only one of them is
# how included_paths comes to describe something other than the bound artifact.
included="$(acr_manifest -- "${acr_pathspec[@]}")" || { echo "manifest capture failed" >&2; exit 1; }
excluded=""
```

Never use `git add -N` to surface untracked files: it writes the index,
which this skill promises not to do. `git diff --no-index` is read-only.

These are the unfiltered forms. Run the filtered versions below instead
whenever anything is excluded — the hash must cover the patch the agents
actually receive.

If the patch is empty, stop and ask — do not review an empty diff.

**Submodules are not in the artifact, and that has to be said rather than
assumed away.** A superproject diff records a gitlink — which commit the
submodule points at — not the source inside it, and `git ls-files --others`
does not recurse. So changes *within* a checked-out submodule reach neither
the patch every agent is told is the exact artifact, nor the snapshot in §7,
whose `ls-files` is the superproject's: an agent overwriting a file inside an
already-dirty submodule leaves both snapshots identical. Detect it and say so:

```bash
# Gitlinks, read from the index — NOT `git submodule status`. That command's
# line is `<flag><sha> <path>[ (<describe>)]`, and each variable part can
# contain the other's delimiter: a path may hold ` (` (`libs/foo (legacy)`),
# and a describe may hold `(`, because `git check-ref-format` accepts a ref
# named `rel(legacy)`. Measured in both directions — a greedy ` (.*)$` turned
# `libs/foo (legacy)` into `libs/foo`, and a non-greedy ` ([^(]*)$` left
# `libs/foo (rel(legacy))` unstripped. The grammar is ambiguous, so no
# expression resolves it; the fix is to stop parsing that output.
#
# `ls-files --stage` gives mode, object, stage and path as fixed fields, and
# mode 160000 IS a submodule. `-z`, read with `read -r -d ''`, because a path
# may contain a newline — which the sed could not represent at all, and which
# `awk -v RS='\0'` cannot either: measured, the awk macOS ships (BWK 20200816)
# reads NOTHING at all from a NUL-separated stream, so a recipe built on it
# would report every repository as having no submodules.
#
# The exit status rides the stream as a final NUL record, as it does for the
# worktree list above: a process substitution's status is unreachable, so a
# git that failed would otherwise read as a repository with no submodules.
# Unforgeable here, unlike the untracked-file case — every real record starts
# with a mode, so none of them can begin `acr_status `.
#
# First-level gitlinks only — this is the superproject's index, so a submodule
# nested inside another is not named here. That is the honest scope, and it is
# what the disclosure offers: reviewing a named submodule as its own scope is
# what surfaces anything beneath it.
acr_submodules=()
acr_sm_status=missing
while IFS= read -r -d '' acr_rec; do
  case "${acr_rec}" in
    '160000 '*)     acr_submodules+=("${acr_rec#*$'\t'}") ;;
    'acr_status '*) acr_sm_status="${acr_rec#acr_status }" ;;
  esac
done < <(git ls-files --stage -z && printf 'acr_status 0\0' || printf 'acr_status %s\0' "$?")
if [ "${acr_sm_status}" != 0 ]; then
  echo "could not enumerate index entries (${acr_sm_status}); submodule disclosure would be a guess" >&2
  exit 1
fi
```

Reviewing the submodule separately, with `--repo` pointing inside it, is the
supported answer. Recursing here is not: `git diff --submodule=diff` produces
output `git apply` cannot apply into the superproject, so the patch binding
the whole attack phase rests on would become a claim rather than a fact.

**What Phase 0 leaves on disk.** `${tmp}` is still there when the run ends,
holding `patch.diff`, `index-copy` and both tree snapshots — plus
`untracked.z` only in the uncommitted scope, and `included.z` only if the
NUL-safe manifest block ran. Naming six unconditionally was wrong: a clean
branch capture writes four. A disclosure that lists artifacts a run did not
create is the same defect as one that hides artifacts it did, because the attack phase and the post-run
snapshot both read them after Phase 0's shell has exited. Name the directory
in the report alongside `base_sha` and the patch hash. It holds the complete
reviewed diff, so it is exactly as sensitive as the code under review, and
one accumulates per run.

Record the pre-run tree state for the write-safety check in §7. Status
alone is **not** enough, and this matters more than it looks: a tracked
file that is already modified reports ` M path` before and after an
agent overwrites it, and a file that is already untracked reports `??`
either way. Both snapshots would be byte-identical while the contents
changed underneath. Hash the contents:

```bash
set -euo pipefail                        # this is a Phase 0 Bash call too

acr_snapshot() {
  # A FRESH copy of the LIVE index for every snapshot, not the frozen one the
  # capture above reads through. Staging existing work changes .git/index and
  # nothing else — not HEAD, not any file's bytes — so a snapshot taken
  # through a stale copy reports that tree as untouched. Copying keeps the
  # refresh off the real index all the same.
  #
  # "$(git rev-parse --git-dir)/index", NOT `rev-parse --git-path index`:
  # the latter returns whatever GIT_INDEX_FILE points at, which during Phase 0
  # is precisely the frozen copy this must not read.
  local acr_idx acr_real acr_st=0
  acr_idx="$(mktemp "${tmp:-${TMPDIR:-/tmp}}/acr-index-XXXXXX")"
  acr_real="$(git rev-parse --git-dir)/index"
  [ -f "${acr_real}" ] && cp "${acr_real}" "${acr_idx}"

  (
    # `pipefail` HERE, not borrowed from whoever called. Four of the digests
    # below are pipelines ending in `shasum`, and without it a `git ls-files`
    # that fails hands `shasum` an empty stream, which exits 0 — so the `||
    # exit 1` never fires, the digest is the hash of nothing, and it is the
    # hash of nothing IDENTICALLY before and after. That is the silent
    # all-clear this whole function exists to rule out, produced by the one
    # shell option a caller is most likely not to have set: the function is
    # copied into a fresh Bash call, and a plain Bash call has no pipefail.
    # Measured on `ls-files --stage` and `ls-files -v`, whose guards are
    # reachable no other way.
    set -o pipefail
    # The top level, for the same reason as the capture block: both `ls-files`
    # calls below are scoped to the current directory, so a snapshot taken
    # from a subdirectory hashes a SUBTREE — and does so identically before
    # and after, which is the silent all-clear this function exists to rule
    # out. Inside the subshell, so the caller's directory is untouched.
    cd -- "$(git rev-parse --show-toplevel)" || exit 1
    # Exported inside a subshell so it cannot outlive the snapshot. An index
    # that does not exist yet — a repository with nothing added — is left
    # unset rather than pointed at an empty file, which git rejects.
    [ -s "${acr_idx}" ] && export GIT_INDEX_FILE="${acr_idx}"
    # fsmonitor off for the WHOLE function, not just status: `git ls-files`
    # consults it too (measured), and this function is shown separately for
    # the post-run check, so it cannot rely on the capture block's export
    # having been copied with it.
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0=false

    # ONE enumeration, checked, reused by both digests below. As the first
    # command of a `{ a; b; } | while` the failure of `a` is invisible even
    # under pipefail: a compound's status is its LAST command's. A git that
    # failed there would hash the empty set — and it would do so in both
    # snapshots, so every change to every visible file would read as no change
    # at all, which is the one thing this function exists to rule out.
    acr_files="${acr_idx}.files"
    git ls-files -z > "${acr_files}" ||
      { echo "snapshot: could not list tracked files" >&2; exit 1; }
    git ls-files --others --exclude-standard -z >> "${acr_files}" ||
      { echo "snapshot: could not list untracked files" >&2; exit 1; }

    # `|| exit 1` ON EVERY COMMAND IN HERE, not left to errexit. Measured:
    # bash suppresses errexit inside a subshell that is the left operand of
    # `||`, and re-arming with `set -e` in the subshell does not restore it.
    # So a failing command here is followed by successful ones whose status
    # overwrites it, and the function returns 0 with a digest of nothing —
    # identically in both snapshots, which is the silent all-clear the whole
    # function exists to prevent. `exit` ends the subshell immediately, and
    # its status is what `|| acr_st=$?` below reads.
    git rev-parse HEAD || exit 1
    # The INDEX ITSELF, not just what status makes of it. A path already `MM`
    # can have its staged blob replaced while the working-tree bytes are put
    # back: HEAD, the porcelain columns, the content hash and the mode hash
    # all stay as they were. `ls-files --stage` gives mode, object and path,
    # which changes then — and does NOT change when a mere stat refresh
    # rewrites the index, so this stays quiet when nothing happened.
    # `-z` and hashed: a tracked path may contain a newline, and the raw form
    # would split one record across lines that another path's halves could
    # complete.
    git ls-files --stage -z | shasum -a 256 || exit 1
    # Index FLAGS, which --stage does not print at all. `git update-index
    # --assume-unchanged <path>` leaves HEAD, the porcelain columns, every
    # content and mode hash AND the staged mode/object identical — only the
    # `-v` tag goes H -> h. It is not a cosmetic bit: git then stops noticing
    # working-tree edits to that path, so an agent that sets it has made its
    # own later writes invisible to the very status this snapshot relies on.
    # skip-worktree (S) does the same by another route.
    git ls-files -v -z | shasum -a 256 || exit 1
    # --no-optional-locks so a plain status does not rewrite the index it reads.
    git --no-optional-locks status --porcelain=v1 || exit 1
    # REGULAR FILES ONLY, and `./` on every operand.
    #   - `shasum` follows a symlink. Pointed at a FIFO it blocks forever, and
    #     Phase 0 hangs before the review starts; pointed at a missing target it
    #     fails into 2>/dev/null and contributes nothing, identically before and
    #     after. Symlinks are covered by their link text below instead, which is
    #     what actually changes when one is retargeted.
    #   - a file literally named `-` makes `shasum` read STDIN — the hash of
    #     nothing, the same both times, while `git status` shows the same ` M`.
    #     Measured; a `--` terminator does not help, `./-` does.
    while IFS= read -r -d '' f; do
      [ -L "./$f" ] && continue
      [ -f "./$f" ] || continue
      if [ -r "./$f" ]; then
        # Measured: shasum C-QUOTES a name containing a newline and marks the
        # line with a leading `\`, so its record stays one line and the sort
        # below cannot interleave two files' halves. That is the tool's
        # doing, not this recipe's — hence the explicit hash on the other
        # branch, which has no such protection.
        shasum -a 256 "./$f"
      else
        # Not silently dropped. `2>/dev/null` on the whole batch hid an
        # unreadable file completely, so an agent could overwrite a
        # write-only one and both snapshots would agree. Its CONTENT still
        # cannot be hashed — nothing can hash what it cannot read — but its
        # existence and its unreadability are recorded, so the file
        # appearing, vanishing or becoming readable is visible. The residual
        # is stated below rather than hidden.
        # ONE HASH PER RECORD, as in the mode digest: printing the raw name
        # splits `p\none` into two lines, and `p\none`+`q\ntwo` then sorts to
        # the same multiset as `p\ntwo`+`q\none`. Verified to collide.
        printf 'UNREADABLE\0%s\0' "$f" | shasum -a 256
      fi
    done < "${acr_files}" | sort | shasum -a 256 || exit 1
    # Content hashes miss a mode change, and so does status: a tracked file
    # already reported ` M` reports ` M` after its executable bit flips, and its
    # bytes never moved. Both snapshots would match while the repository
    # changed. `test -x` / `test -L` are POSIX, unlike stat's format flags.
    while IFS= read -r -d '' f; do
      # The whole permission string, not just the executable bit: a visible
      # file going 0644 -> 0600 changes none of its bytes, none of its
      # porcelain columns, and neither x nor l. `ls -ld` prints the mode in
      # its first ten characters on every platform this runs on; git itself
      # tracks only the executable bit, which is why nothing else here sees
      # the change.
      # ELEVEN characters, not ten. macOS puts an ACL/xattr marker in the
      # eleventh — `@` for extended attributes, `+` for an ACL — and an
      # executed test can add one without touching a byte, a porcelain column
      # or a permission bit. Measured: `ls -ld` reads `-rw-r--r--@` and
      # `cut -c1-10` discarded exactly that character. Ten was not wrong on
      # Linux, where the column is a space; eleven is right on both.
      # ONE HASH PER FILE, not one line per file. A symlink target may
      # contain a newline, and three newline-delimited fields then sort as
      # separate lines whose association with each other is lost — while
      # symlinks are absent from the content digest, so nothing else would
      # notice. No specific colliding pair was demonstrated; a digest cannot
      # contain a newline, so hashing each record removes the question
      # rather than answering it case by case.
      # `ls -ld`, never `-L`, for a symlink: dereferencing reports the
      # TARGET's permissions, so a chmod on the link itself is invisible.
      # And the target is piped raw, not through `$( )`, which strips
      # trailing newlines — retargeting `missing` to `missing\n` would
      # otherwise produce an identical record.
      if [ -L "./$f" ]; then
        { printf '%s\0%s\0' "$(ls -ld "./$f" 2>/dev/null | cut -c1-11)" "$f"
          readlink "./$f" 2>/dev/null || true; } | shasum -a 256
      else
        printf '%s\0%s\0' "$(ls -ld "./$f" 2>/dev/null | cut -c1-11)" "$f" |
          shasum -a 256
      fi
    done < "${acr_files}" | sort | shasum -a 256 || exit 1
  ) || acr_st=$?
  # The cleanup must not become the function's exit status. `rm -f` succeeds
  # on a path that was never created, so as the LAST command it reported
  # success for a snapshot that had refused to take itself — and the caller
  # then compared two digests it had no reason to trust. `|| acr_st=$?` also
  # keeps `set -e` from killing the run before the temporaries are removed.
  rm -f "${acr_idx}" "${acr_idx}.files"
  return "${acr_st}"
}
acr_snapshot > "${tmp}/tree-before"
```

The same function produces the after-state, and the comparison is the whole
point of having taken the first one. Define and run it in **one** Bash call:
a shell function does not survive between separate tool invocations, and an
agent that finds it gone tends to fall back to `git status` alone — the
status-only check this recipe exists to replace.

```bash
set -euo pipefail                        # every Phase 0 Bash call, this one too
acr_snapshot > "${tmp}/tree-after"       # same definition, same call
if ! diff -q "${tmp}/tree-before" "${tmp}/tree-after" >/dev/null; then
  diff -u "${tmp}/tree-before" "${tmp}/tree-after"   # disclose, never revert
fi
```

What the two digests divide between them: the first hashes the contents of
regular files, the second records every listed path with its full permission
string and, for a symlink, where it points. A path that is neither —
a FIFO, a socket, a device — appears in the second and has no content to
hash, which is the honest treatment rather than a hang.

Six kinds of change stay outside it, and every one of them belongs in the
report rather than behind an implied "total coverage". The count is stated
because it has been wrong twice: the list once said "two" while carrying five
bullets, and the sixth was added only after the mode read was widened to catch
the ACL/xattr marker — widening it proved the marker's PRESENCE is seen and
its VALUE is not. A summary that miscounts its own exclusions is how the
shorter claims below came to name only some of them.

- **gitignored paths** — build output, `node_modules`, local caches.
- **a symlink target differing only by a trailing newline.** `readlink`
  prints the target and then a newline of its own, so `x` and `x\n` are the
  same bytes coming out of it — measured. The target is piped in raw rather
  than through `$( )`, which keeps every internal newline, but this one is a
  limit of the tool and not of the encoding.
- **the contents of a file the snapshot cannot read.** Its existence and
  unreadability are recorded, so it appearing, vanishing or changing mode is
  detected — but nothing can hash bytes it cannot read, and a rewrite of a
  write-only file that stays write-only is invisible.
- **anything inside a checked-out submodule.** The `ls-files` here is the
  superproject's, and a dirty submodule reports the same one-line marker in
  status however much changes inside it. The capture passes
  `--ignore-submodules=dirty` so that marker does not reach the patch either:
  a default `git diff HEAD` emits a `Subproject commit <sha>-dirty`
  pseudo-hunk, which is submodule worktree state appearing in an artifact this
  file says never carries any — and it carries none of the changed source, so
  it describes the change without containing it. A real gitlink MOVE is a
  superproject change and still appears; both measured. (`git apply` accepts
  the `-dirty` hunk rather than rejecting it — checked, because the opposite
  was the plausible guess.)
- **a change to the VALUE of an existing xattr or ACL entry.** The eleventh
  column of `ls -ld` records that a file HAS extended attributes or an ACL —
  `@` or `+` — so adding or removing them is detected. Rewriting one in place
  is not: measured, `com.example.k` going from `v1` to `v2` leaves the mode
  string, the content hash, the index and every porcelain column identical.
  Reading the values would mean `xattr -l` per file on macOS and `getfattr` on
  Linux, one process per path in a recipe that already runs two per path;
  disclosed instead, which is what the rest of this list does with the same
  kind of limit.
- **anything git does not list at all.** `git ls-files --others` and
  `git status` report neither FIFOs, sockets, nor device nodes — measured,
  both are empty for a worktree containing one. So a special file appearing,
  vanishing or changing kind is invisible here, and no amount of hashing in
  this recipe changes that, because the recipe never learns the path exists.

So the shortest true sentence is longer than the one that used to stand here.
"Changes to tracked and untracked-but-visible files are detected" is **not**
quite true, and this file cannot claim it while listing the write-only case
four bullets above: a rewrite of a file the snapshot cannot read leaves every
digest identical. What holds is:

> Every tracked and untracked-but-visible path is recorded with its mode, and
> its contents are hashed when they can be read. A change to one is detected,
> except a rewrite of a file that is unreadable both before and after, and
> except a symlink retargeted to differ only by a trailing newline.

"Changes to the parent tree are detected" is not true at all — the other three
bullets are why.

### Exclusions and partitioning

Exclusions must be applied to the captured patch, not merely declared.
A report that lists `excluded_paths` while every agent reviewed them —
and the attack applied them — is exactly the kind of false disclosure
this skill exists to prevent. Use pathspecs at capture time and hash
the *filtered* patch.

And `excluded_paths` means *an exclusion removed this*, not *the review did
not cover this*. The baseline manifest it is computed against therefore
carries the same positive pathspec as `included` and differs only in the
exclusion terms. Left repository-wide, a review of one named path listed
every other changed file as excluded — scope narrowing and exclusion, two
different reasons for absence, rendered as one in the section whose whole job
is to distinguish them. The narrowing is already disclosed as the scope.

```bash
# Exclusions are pathspec arguments to the same capture commands.
excludes=(':(exclude)*.lock' ':(exclude)package-lock.json'
          ':(exclude)vendor/**' ':(exclude)**/node_modules/**'
          ':(exclude)**/__snapshots__/**' ':(exclude)*.min.js')

git diff --no-ext-diff --no-textconv --binary --ignore-submodules=dirty "${diff_args[@]}" -- "${acr_pathspec[@]}" "${excludes[@]}" > "${tmp}/patch.diff" ||
  { echo "could not capture the tracked patch" >&2; exit 1; }

# The SAME pathspecs must filter untracked files. `git check-ignore` only
# knows about .gitignore, so it will happily let an untracked vendor/ path or
# lockfile through the exclusion list.
if [ "${untracked}" = 1 ]; then
  # Via a file for the same reason as the unfiltered recipe above: a process
  # substitution's exit status is unreachable, so a failing enumeration reads
  # as "no untracked files" and the patch omits what included_paths names.
  acr_untracked=()
  git ls-files --others --exclude-standard -z -- "${acr_pathspec[@]}" "${excludes[@]}" > "${tmp}/untracked.z" ||
    { echo "could not enumerate untracked files" >&2; exit 1; }
  while IFS= read -r -d '' f; do acr_untracked+=("$f"); done < "${tmp}/untracked.z"
  for f in ${acr_untracked[@]+"${acr_untracked[@]}"}; do
    st=0
    git diff --no-ext-diff --no-textconv --no-index --binary -- /dev/null "${f}" \
      >> "${tmp}/patch.diff" || st=$?
    [ "${st}" -le 1 ] || { echo "capture failed on ${f}" >&2; exit 1; }
  done
fi

patch_sha256="$(shasum -a 256 "${tmp}/patch.diff" | cut -d' ' -f1)"

# Both manifests, from the same pathspecs that produced the patch, through the
# same helper — same pipefail and propagation reasoning as above.
included="$(acr_manifest -- "${acr_pathspec[@]}" "${excludes[@]}")" || { echo "manifest capture failed" >&2; exit 1; }
# The SAME positive pathspec as `included`, differing only in the exclusions.
# Left repository-wide, every changed file outside the paths the user named
# came out in `excluded_paths` as though an exclusion had removed it — two
# different reasons for absence reported as one, in the section whose whole job
# is to say why something was left out. The scope narrowing is already
# disclosed as the scope.
everything="$(acr_manifest -- "${acr_pathspec[@]}")" || { echo "manifest capture failed" >&2; exit 1; }
excluded="$(comm -23 <(printf '%s\n' "${everything}") <(printf '%s\n' "${included}"))"
```

**Print the handoff before this shell exits.** Everything §8 passes to
`Workflow` — and everything the §7 post-run snapshot needs — was computed in a
Bash call that is about to end, taking its variables with it. Nothing here
persists them, and guessing the newest `/tmp/acr-*` afterwards is wrong the
moment two reviews overlap, which AGENTS.md says to expect. End the capture
call with them, and carry the values forward explicitly:

```bash
printf 'tmp=%s\nbase_sha=%s\npatch_sha256=%s\n' "${tmp}" "${base_sha}" "${patch_sha256}"
printf 'included_paths:\n'; printf '%s\n' "${included}"
printf 'excluded_paths:\n'; printf '%s\n' "${excluded}"
```

The snapshot function in §7 is defined and called in ONE call for the same
reason; `${tmp}` is what lets the post-run half find `tree-before`.

`included` and `excluded` are newline-delimited shell variables;
`included_paths` and `excluded_paths` are JSON arrays of the same paths.
Convert them explicitly and pass each path **verbatim** — a
mis-transcribed path is not a cosmetic problem: `evidenceProblem` rejects
every candidate whose file is not in the manifest, so the review silently
loses that file's findings while reporting it as covered.

Two ways the transcription goes wrong. `git diff --name-only` and
`git ls-files` C-quote a path containing a quote, a backslash or a
non-ASCII byte — `"src/caf\303\251.js"` — and that quoted spelling is
not the path. Use the `-z` variants when either is possible:

```bash
# NUL-separated, never C-quoted. Read into an array, then serialise that.
# Each producer is checked on its own. Grouped into one process substitution
# the statuses vanish twice over — the substitution has none the reader can
# see, and a compound's status is only its last command's — so a manifest
# built from a failed `git diff` would name nothing and the review would
# report a clean tree it never looked at.
included_arr=()
git diff --name-only -z --ignore-submodules=dirty "${diff_args[@]}" -- "${acr_pathspec[@]}" "${excludes[@]}" > "${tmp}/included.z" ||
  { echo "could not list changed paths" >&2; exit 1; }
if [ "${untracked}" = 1 ]; then
  git ls-files --others --exclude-standard -z -- "${acr_pathspec[@]}" "${excludes[@]}" >> "${tmp}/included.z" ||
    { echo "could not enumerate untracked files" >&2; exit 1; }
fi
while IFS= read -r -d '' f; do included_arr+=("$f"); done < "${tmp}/included.z"
```

And a path containing a newline cannot be represented in the
newline-delimited form at all. If one exists, exclude it and name it in
`excluded_paths` rather than passing a mangled spelling — an excluded
file is a disclosed gap; a wrong path is a silent one.

`allow_execution` is **required** too, with no default. Running the
artifact's own test command with this session's privileges is a trust
decision, and a decision nobody made is not one.

`included_paths` is **required** — the script refuses to start without a
non-empty one. It is the only thing that keeps a finding inside the
artifact the review claims to be about; absent, a finder can nominate
any file in the repository and, if the verifier and adjudicator agree,
that becomes a "verified finding" about code nobody reviewed.

Better still, pass `changed_ranges` too — file-level binding still lets a
candidate cite an untouched line in a reviewed file. Build it from the
same filtered pathspecs, and cover all three shapes of change:

```bash
# tracked hunks; a deletion-only hunk has new-side length 0, so anchor it at
# the line the deletion sits against rather than dropping it.
# A wholly deleted file has `+++ /dev/null`, so the new-side rule never fires
# for it: track the old-side path as well, or its hunk is emitted under an
# empty filename — or worse, under the PREVIOUS file's name. Its span comes
# from the OLD side too: a 100-line deletion has new-side length 0, and
# collapsing that to `1 1` would leave an explicit range covering only line 1,
# which then rejects every candidate anchored anywhere else in the file.
# Fields are written in the parenthesised form $(0) and $(3) on purpose:
# Claude Code replaces bare dollar-digit tokens with invocation arguments when
# it renders a skill, so the unparenthesised spelling would be substituted away
# before the recipe ever reached awk.
# `-c core.quotePath=false`: with the default, a path holding any non-ASCII
# byte is C-QUOTED in the header — `+++ "b/caf\303\251.js"` — and the fixed
# substr below then yields `/caf\303\251.js"`, which matches no entry in the
# NUL-decoded included_paths. The range is filed under a key nobody has, the
# real file gets none, and every candidate in it silently drops to file-level
# binding. Measured.
# Same flag again: a dirty submodule's `Subproject commit <sha>-dirty`
# pseudo-hunk would otherwise become a synthetic one-line range for a path the
# patch does not carry — which is worse than having no entry, because an
# explicit range is the only thing that can bind a candidate at hunk level.
git -c core.quotePath=false diff --no-ext-diff --no-textconv --ignore-submodules=dirty --unified=0 "${diff_args[@]}" -- "${acr_pathspec[@]}" "${excludes[@]}" |
  awk '# A header pair is only a header pair INSIDE a file header — between
       # `diff --git` and the first hunk. Requiring the `--- ` half is not
       # enough: one hunk that rewrites a source line `-- a/forged` into
       # `++ b/forged` is emitted as `--- a/forged` then `+++ b/forged`, a
       # complete and well-formed-looking pair, and every following hunk is
       # then filed under the path the artifact chose. With an explicit range
       # list, candidates outside it are rejected, so that silently discards
       # real findings. Content lines always carry a +/-/space prefix, so no
       # hunk body can spell `diff --git ` at the start of a line.
       /^diff --git /{inhdr=1; f=""; o=""; del=0; saw_old=0; next}
       # `--- `, not `--- a/`: a NEW file has `--- /dev/null`, and skipping it
       # leaves `f` holding the PREVIOUS file — which both loses the new
       # file`s range and invents one the previous file never had.
       /^--- /{if(!inhdr) next
             o=($(0)=="--- /dev/null") ? "" : substr($(0),7); saw_old=1; next}
       /^\+\+\+ /{if(!inhdr || !saw_old) next
             saw_old=0; inhdr=0
             f=($(0)=="+++ /dev/null") ? o : substr($(0),7); del=($(0)=="+++ /dev/null")
             next}
       /^@@/{if(f=="") next;
             split($(3),a,","); s=substr(a[1],2)+0; n=(a[2]==""?1:a[2])+0;
             if(del){ split($(2),b,","); os=substr(b[1],2)+0; on=(b[2]==""?1:b[2])+0;
                      if(on>0) print f, (os>0?os:1), os+on-1; next }
             if(n>0) print f, s, s+n-1;
             else print f, (s>0?s:1), (s>0?s:1)}'

# untracked files are changed in their entirety (uncommitted scope only)
# An `if`, not `[ ... ] &&`. With untracked=0 — every branch and explicit-range
# scope — the AND-list's status is the FAILED test's, and as the last statement
# of a Phase 0 Bash call that is the call's own exit status: the tracked ranges
# above were produced correctly and the step still reports failure.
if [ "${untracked}" = 1 ]; then
git ls-files --others --exclude-standard -z -- "${acr_pathspec[@]}" "${excludes[@]}" |
  while IFS= read -r -d '' f; do
    # `./$f`, exactly as the snapshot recipe does it, and for the same reason:
    # a file literally named `-` makes awk read STDIN — which here is the NUL
    # stream this loop is reading from, so awk swallows every remaining record.
    # Measured: with `-` followed by one more path the loop runs ONCE, emits a
    # bogus one-line range for `-`, and the following file gets no entry at
    # all. Its candidates then fall back to file-level binding while `-`
    # rejects every candidate past line 1.
    n="$(awk 'END{print NR}' "./$f")"
    # An EMPTY file has zero lines, and "1 0" is not a range. Emitting it
    # makes the whole run return invalid_args; omitting the entry lets the
    # documented file-level fallback cover the file instead.
    # An `if`, not `[ ] &&`, for the same reason as the guard around this
    # loop: the test's status is the loop body's status, and on the LAST
    # record it becomes the whole pipeline's. An empty untracked file sorting
    # last therefore aborted Phase 0 under `set -euo pipefail` instead of
    # quietly getting no range, which is what this comment claims happens.
    # Measured. Sorting decides whether it reproduces, which is why the
    # fixture that first covered this passed: `empty.txt` came before two
    # non-empty files and the last iteration succeeded.
    if [ "${n}" -gt 0 ]; then printf '%s 1 %s\n' "$f" "${n}"; fi
  done
fi
# awk, not `wc -l`: a file with no trailing newline counts 0 lines under wc,
# which produces the range 1..0 and silently rejects every candidate in it.
```

A wholly deleted file takes its span from the OLD side, because the new side
has length zero: collapsing that to a single line would leave an explicit
range covering only line 1, which then rejects every candidate anchored
anywhere else in the file — worse than having no entry at all.

A file the map does not mention falls back to file-level binding rather
than having all its candidates rejected. That is deliberate: an
incomplete map is the likely case — new files, deletion-only hunks, a
caller who built it from tracked changes alone — and rejecting on absence
would silently discard findings about exactly the code most likely to be
new. Only an explicit range list can rule a line out.

That fallback is a real weakening, so it is disclosed rather than
assumed away. The script returns `run.scope_binding.by_path` and
`run.scope_binding.file_level_only_paths`, and every candidate carries
`scope_binding.level` — `hunk_level` with the `matched_range`, or
`file_level_only` with the reason. The report must name the
file-level-only paths in Coverage and tag any finding anchored in one:
its anchor is in a reviewed file, but nothing mechanically placed it
inside the change.

**Malformed** range data is not treated as absent data. A
`changed_ranges` that is not an object, an entry that is not an array,
or a pair that is not `[start, end]` of **1-indexed integers** with
`start <= end`, all return `invalid_args`. The 1-indexed part is not
pedantry: a `[0, 0]` range would otherwise mechanically bind a candidate
at line 0 — a line no file has — and the run would certify that anchor
as hunk-bound. Candidate line numbers are checked the same way, in the
reader as well as the schema. Absence is an expected gap; a broken range builder is a
caller bug, and reading it as absence would quietly drop hunk binding
across the entire run.

Both manifests are returned in `run`, so the report states what was
actually reviewed rather than what was intended.
A generated-code diff inflates cost estimates and floods the finders
with noise — but exclusion is a judgement, not a reflex: when the
dependency bump *is* the change under review, a lockfile is the review
target and must stay in.

If the remaining patch still exceeds roughly 1,500 changed lines or
spans more than about eight top-level modules, partition it by module
and review one partition per run, or ask the user to narrow the scope.
One pass over a very large diff produces context pressure, duplicate
candidates, and a report whose ledger is longer than its findings.

## 2. Profiles and budget

Two independent controls. **Profile** decides where the money goes;
**budget** decides how much there is. Changed-line count chooses
neither — it feeds cost estimation and partitioning only. Volume is not
value: a ten-line authorization change and a two-thousand-line
generated-client update sit at opposite ends of value per token.

| Profile | Buys | Use when |
|---------|------|----------|
| `balanced` *(default)* | Broad lens coverage, verification of every candidate, probes on the top 2 high-risk regions, execution for critical targets | Most reviews |
| `recall-first` | Up to six lenses — triage's schema ceiling — plus at most one supplemental, probes on **all** high-risk regions; execution only where a probe already built a counterexample | "What did we miss?" — pre-release sweeps, unfamiliar code |
| `precision-first` | Minimum coverage floor, then depth: execution for criticals *and* majors that have a counterexample | A contested finding, or a report that must not contain false alarms |

Announce the profile, the budget, and the estimated launch count before
invoking the script. A run near the default budget typically lands
around 15–19 subagent launches — precision-first buys the
fewest, recall-first the most — which is above this
session's default workflow-size guideline — say so, since the user can
raise "Dynamic workflow size" in `/config` and should not discover the
fan-out afterwards.

### Two floors that are not negotiable

- **Coverage floor** — triage plus every lens triage selected. Without
  it the review has no breadth and its silence means nothing.
- **Accuracy floor** — a verifier for every surviving candidate, plus
  reserved adjudication capacity. One exception, and it is the
  measured one: when a sampled verifier costs far more than projected,
  the rest of that wave is deferred rather than launched into an
  overspend, and the deferral is disclosed. Without the floor breadth produces
  candidates that can never become findings.

The token target is projected at a rate the run **calibrates as it goes**.
The weighted-unit priors are estimates, and projecting later waves at the
original prior after the run has already observed a higher rate is how an
atomically-admitted wave overshoots a hard target: at 7x drift a 48,000-token
target saw 75,250 spent. Once anything has been spent, projections use the
worse of the prior and the observed rate — never the cheaper one — so the
trim and every admission tighten exactly as drift reveals itself. The rate is measured per weighted unit
actually **launched**, not committed: reservations run ahead of spending, so
dividing by committed units spreads observed cost over units nobody has paid
yet and reports a rate lower than the one being incurred.

Calibration cannot see drift that arrives *with* a wave, and a wave is
admitted atomically. That is why the **first lens runs alone**: it is the
sample that prices everything after it. Launching the whole finder wave
together let four finders at 20x their estimate spend 1.68x the token target,
and at 40x, 3.35x, with nothing able to intervene. Sampling one first bounds
the exposure to that one sample; if the rest of the coverage floor no longer
fits at the observed rate, the run stops, because a review without breadth
has nothing to say.

The rate is also tracked **per wave**, not only cumulatively, because a
cumulative mean is dominated by whatever ran first. Triage and the finders
are cheap, so a verifier costing twenty times its estimate barely moves the
average and the next wave is priced as though nothing had changed — measured
at 4.42x the token target. Pricing takes the worst of prior, cumulative and
most-recent-wave, and a rate once observed is never forgotten.

**The bound is not a single number, and it would be dishonest to quote one.**
What is bounded is exposure to a *wave*: every multi-agent wave — finders,
region probes, verifiers, the escalated reruns, the executable attacks and
adjudication itself — launches one agent first, and the rest are admitted
only at what that one actually cost, cumulatively rather than item by item.
The escalations matter most and were
added last: they are the strongest model at the highest effort, and drift
that appears only there has been priced by nothing before it. Candidate probes are repriced too, because they were admitted
before the sample existed. Those shapes now hold at 1.35x, against 1.57x,
1.92x, 1.99x, 3.35x and 4.42x before.

Clearing the wave estimate before that repricing is part of the mechanism,
not bookkeeping. An accepted purchase is already charged to the open wave by
whichever admission approved it, so a launch-time check that adds its cost
again judges it against twice its price — and a *lone* item, which has no
sample to take, is judged that way while the first of three is judged
correctly. That inverted strictness could defer the one affordable executable
attack, or a verifier belonging to the accuracy floor this run promises never
to trim.

Adjudication's debt is declared *before* that repricing, not after. It is
owed tokens from the moment the floors are committed, and repricing a wave
against capacity adjudication has a prior claim on spends exactly the
reserve that lets the run assign verdicts at all — the failure mode is a
review that pays for every verifier and can then adjudicate none of them.

What is **not** bounded is a wave of exactly one agent. At the default budget
that is the usual shape of the expensive half — one executable attack at ten
weighted units, one adjudication batch — and there is genuinely nothing to
sample first, so a 20x drift there runs to 4.63x with nothing able to
intervene. It is also the shape of the *sample* in a larger wave: bounding
the rest of a wave says nothing about its first member. The suite carries
those shapes too, marked as unpriced rather than quietly exempted, and
asserts what still has to hold: the run ends honestly rather than reporting
findings it could not pay to establish. Say this in the report rather than
implying a ceiling that only some shapes respect.

Adjudication is admitted one batch at a time for a second reason beyond
pricing. Refusing the whole reserve when only part of it fits ends the run
`adjudication_failed` — every verifier paid for and not one verdict assigned
— when the honest outcome is to adjudicate what the budget still covers and
disclose the batches it does not.

If the budget cannot fund the **coverage** floor, do not run: a review
without breadth has nothing to say and its silence means nothing.

The **accuracy** floor is different, and it took a hostile-artifact
review to see why. Aborting when candidates outnumber the budget makes
suppression cheap — anything that inflates the candidate count, a noisy
diff or an artifact manufacturing decoys, deletes the whole review and
the real findings with it. So the candidate set is trimmed from the
least consequential end (minors, then majors, then criticals) until it
fits, and everything trimmed is reported as **found but not verified**,
with its anchor, in the top-level `found_but_not_verified` array. Every
*retained* candidate is scheduled a verifier, and nothing optional may take
that capacity — that part is not negotiable.

One thing still outranks it, and pretending otherwise would be the
overclaim this file exists to avoid: the user's own token target. When the
sampled verifier reveals a rate the priors under-stated, the remaining
verifiers are deferred rather than launched past a hard ceiling that would
throw mid-wave and lose them anyway. Those candidates stay in the results —
deferred with kind `candidate_verifier`, distinct from the trim's
`candidate_verification`, and reported with `verifier_completed: false` —
because "reported without a refutation attempt" and "not reported at all"
are different admissions and the ledger owes the reader both.

The trim checks **both** ceilings — weighted units and the token target
— because the reservation it precedes checks both. Trimming on units
alone left the token case aborting the whole review, which is the same
suppression through the other door. It is also the single place the
token floor is enforced: the supplemental-lens rollback deliberately
checks units only, since the trim runs later and sees the whole set, and
a second token check there merely rolled back candidates the tokens
could have covered.

Trimming happens **before** the buckets, verification tiers, reserves
and the verify plan are derived, so exactly one candidate set is ever in
play. Deriving them first is not a cosmetic ordering question: it makes
the run launch verifiers, probes and executable attacks for candidates
it has already decided not to report — spending the budget on work it
throws away, and calling those candidates unverified in the ledger when
a verifier did in fact run on them.

Once trimming is done the candidate array is sorted into canonical order,
before anything is cut from it. Adjudication batches are chunks of that
array, so leaving it in finder-arrival order let the order two finders
happened to answer in decide which candidates shared a batch — and with
weak verdicts and a single escrowed rerun, that changed which candidate
came out substantiated. Sorting the severity buckets was not enough; the
batches are cut from the array, not the buckets.

Every bounded selection reads **one** order — the per-lens cap, the
supplemental-lens rollback and this trim — and the two drop paths read it
backwards. The order is severity first, then inside a high-risk region, then
confidence, then `file:line`, and finally the candidate's content fingerprint;
the victim is its last element. It has to be literally the same order and not
merely a similar one, because the disclosure says what was *least*
consequential and that has to mean what "most consequential" meant when the
budget was spent. Three comparators stood here once. The rollback dropped
whichever candidate a finder emitted last, so a supplemental lens returning
twenty-four majors and then one critical gave up the critical. And after that
was fixed the victim selector still ran its fingerprint tie-break the *other
way* from the funding order, and ignored `file:line` entirely: among claims
tying on everything meaningful, the run gave up precisely the one it would
have verified first.

The fingerprint is the final tie-break rather than arrival order or id, so
co-located claims that tie on every other field resolve identically in two
runs whose finders answered in a different order — which is also what decides,
at a budget affording one probe, which of them gets it.

**One spelling per path, too.** `included_paths`, `changed_ranges` keys and
every agent-supplied `file` and anchor are canonicalised — redundant `.`
segments and repeated slashes removed, `..` deliberately left alone — before
anything compares them. Every scope check is an exact string match, so a
manifest that said `./util.js` while a finder said `util.js` rejected that
finder's candidates as naming an unreviewed file, and the run reported `ok`
with them in the invalid-candidate ledger. A spelling the validator accepts
and the pipeline cannot match is worse than one it refuses.

Report achieved depth as `verification_depth.candidates_found` against
`candidates_retained`, so a trimmed run cannot be read as a run that
found less: "0/6 candidates adjudicated; 6 found but unverified by
budget", never "no candidates found".

## 3. Model tiers

| Role | Default | Why |
|------|---------|-----|
| Triage | `sonnet` | It picks the lenses and the high-risk regions. A lens never run and a region never flagged cannot be recovered downstream, so this is a recall gate, not clerical work. |
| Finder | `sonnet` | Breadth across lenses — the cheapest coverage available. |
| Major / minor verifier | `sonnet` | Same tier as the producer; its output is refutation evidence, not a verdict. |
| Critical verifier | `opus` | Its analysis is the main input to a final decision. |
| Reasoning probe | `sonnet` | Counterexample construction is a thinking task, not an agentic one. |
| Executable attack | `opus` | Agentic loop: bind, preflight, control, patch, rerun. |
| Adjudicator | `opus` | Assigns the final state. Verification floor: strictly above the finders. |

The tier names are rolling aliases and role *defaults*, not permanent
model identities — and the script cannot check what the live schema
declares, so **the caller resolves them in Phase 0 and passes them in**
as `args.models` (`{cheap, strong, highEffort}`). Defaults apply when
the caller says nothing. Pass only values the live Workflow schema
declares, map a missing alias to the nearest declared tier, and announce
the substitution before launching. If the finders already run at the
schema's ceiling, set `strong` to that ceiling and rely on the raised
`highEffort` for the adjudicator, then note in the report that the
verification floor was met at equal tier. The resolved roles come back
in `run.model_roles`, so the report can state what actually ran.

Escalate-once applies only where a *field* can trigger it, never to a
prose impression of weakness — the script must be able to evaluate the
condition without judging text:

| Role | Trigger field | Action |
|------|---------------|--------|
| Critical verifier | `grounding: weak` | rerun once at raised effort |
| Adjudicator | any verdict with `grounding: weak` | one rerun over those candidates only |

Triage is deliberately **not** on that list. It runs once, and a
`confidence: low` triage becomes a disclosed coverage risk instead of a
rerun. The reason is structural: a triage escalation is a purchase made
after a completed sequential agent, inside a wave whose estimate is
still open, and that shape double-charged the finished triage against
the token target — producing a false `deferred_by_budget` reason in the
one ledger whose job is to say truthfully why coverage was omitted.
Removing the purchase point removes the shape. The remedy for a triage
that doubts itself is to rerun the review with a stronger
`models.cheap`, which the report says.

Each escalation is at most one rerun, is charged to the budget, and is
disclosed. Nothing is retried at identical settings, and nothing weak
is silently accepted.

## 4. Cost model

Launch counts are **not** cost. An executable attack is an agentic loop
that binds a worktree, preflights, authors a test, runs a control and
reruns patched code; a batched minor verifier reads a few anchors once.
Treating them as one unit each bounds the wrong quantity.

The budget primitive is the **weighted unit (WU)**, where one sonnet
finder is `1.0`:

| Role | WU |
|------|-----|
| Triage (sonnet) | 0.75 |
| Finder (sonnet) | 1.00 |
| Major verifier (sonnet) | 1.25 |
| Critical verifier (opus) | 2.50 |
| Critical verifier, escalated rerun (opus, highest effort) | 3.50 |
| Minor verifier, batched (sonnet) | 0.75 + 0.30 × n, n ≤ 4 per batch |
| Reasoning probe (sonnet) | 1.50 |
| Executable attack (opus) | 10.00 |
| Adjudicator, batched (opus) | 1.50 + 0.30 × n, n ≤ 8 per batch |

**These are scheduling priors, not measurements.** They exist to rank
purchases and reserve capacity, and they should be recalibrated from
real runs. The report says "weighted units", never "tokens", unless a
real token figure is available.

Default budget: **48 WU**, and the number is derived rather than
chosen. A seven-candidate balanced run spends roughly 4.75 on coverage,
3 on region probes, 9.15 on verifiers, 3.6 on adjudication, 7.1
escrowed for the two escalate-once guarantees, and 4.5 on candidate
probes — about 32 before a single execution, which costs 10 more.
Anything under about 44 means the expensive half is never reachable and
the skill quietly degenerates into a reasoning-only review, which is the
one outcome its positioning cannot survive.

Sizing down is legitimate — it just has to be *said*. A smaller budget
buys a reasoning-only review, and the report's tradeoff lines will show
`executed: 0`.

When the user has set a turn token target, the script also reads the
`budget` global (`budget.total`, `budget.spent()`, `budget.remaining()`)
and treats `budget.remaining()` as a **hard admission guard**: it will
not open a wave whose projected WU cost maps to more than the remaining
tokens. Weighted units schedule; real tokens veto. Without a user
target, the WU budget is the only bound.

It guards *admission*, not actual spend, and the difference is not a
quibble. A wave is admitted atomically and cannot be re-checked in
flight, so if the priors under-state real cost, an already-open wave
overshoots and nothing in the script can prevent it. Note also that
`tokensPerWU` is `total / budgetWU`, which makes the token check
arithmetically identical to the weighted-unit check whenever actuals
match the priors — it earns its keep only when they drift. Both facts
are why the priors are labelled estimates and why the report says
"weighted units" rather than "tokens".

### Wave scheduling

Capacity is reserved **before** each `parallel()` call, never checked
afterwards — by the time a wave is running, its cost is already
committed.

Four admission paths, and the split is deliberate:

| Path | Used for | Rule |
|------|----------|------|
| `reserve` | mandatory floors | fits in weighted units and tokens, or the run stops |
| `admitOptional(cost, protectedFloor)` | every optional purchase | the floor still owed must fit *afterwards*, in both quantities; the floor is verified, never consumed here |
| `drawOrReserve(pool, cost)` | the two escalate-once guarantees | draws the escrow set aside with the floors, still token-checked |
| `admitPrepaid(cost)` | a wave whose units were committed earlier | re-checks only the token ceiling, against real spend |

Every optional admission happens either before its wave opens or after
the previous wave was closed with `endWave()`. Nothing is bought while
a completed agent's estimate is still standing — that is the invariant
whose violation cost the triage escalation its existence.

`admitOptional` exists because the same guard was written four times at
four call sites during review and three of those versions protected
weighted units but not tokens, or the reverse. A scheduler with this
many purchase points cannot be kept correct site by site.

Centralising the *call* was not enough on its own, because weighted
units and tokens are committed at different moments: adjudication's
units are reserved with the floors, but its tokens are spent two waves
later, and `endWave()` drops it out of the per-wave projection in
between. So the obligation is tracked centrally too — `prepaidDebtWU`
holds units that are committed but whose tokens are still owed to a
later wave, and every token admission subtracts it. That is what stops
an executable attack from spending the tokens adjudication was already
promised, which no per-call-site argument reliably prevented.

The practical effect, and the priority it encodes: when tokens are
tight enough to fund adjudication but not adjudication plus an attack,
the attack is deferred and disclosed. Adjudication is what turns
candidates into findings; an execution that starves it buys evidence
for a report that can no longer be written.

| Wave | Contents | Barrier justification |
|------|----------|----------------------|
| 1 Triage | 1 agent | Selects the lenses; everything downstream depends on it |
| 2 Find | one agent per lens, plus the supplemental lens | — |
| 3 Probe | reasoning probes over high-risk regions | Runs **before** verification so a counterexample against an unflagged region becomes a candidate in time to be verified and adjudicated like any other |
| 4 Verify | a verifier per candidate, plus candidate probes | Needs the full candidate set, emergent ones included |
| 5 Execute | executable attacks for eligible targets | Eligibility depends on *which* probes built a counterexample, and capacity must be recomputed from actual spend |
| 6 Adjudicate | one batched agent per 8 candidates | Needs every candidate's refutation and attack evidence together |

These are real barriers, and they are the deliberate price of
deterministic, disclosable spending: a per-candidate pipeline would race
on the budget and could commit an expensive attack the ledger has
already promised away.

Wave 3 is the one that makes the recall channel real. A region probe
that constructs a counterexample must emit a full `emergent_candidate`,
which enters the candidate set and goes through the same refutation and
adjudication as a finder's. Without that promotion the region channel
can attack code but can never *report* anything — which is the exact
shape of defect this design was rewritten to remove.

### Spending order

Adjudication capacity is reserved before anything optional, because
without it candidates can never become findings at all.

1. **Coverage floor** — triage, every selected lens. Never trimmed.
2. **Cheap coverage** — region probes, per profile, funded only after
   the projected accuracy floor is set aside.
3. **Accuracy floor** — a verifier for every candidate, emergent ones
   included. Never trimmed to buy something else; deferred only when a
   sampled verifier reprices the wave past the budget, which the ledger
   reports as `actions_deferred`.
4. **Cheap coverage, part two** — probes for critical and major
   candidates.
5. **Conditional depth** — executable attacks, in exactly this rank
   order (`review-workflow.js`, wave 5):
   1. critical candidates whose probe built a counterexample;
   2. major candidates with a counterexample — `precision-first` only;
   3. critical candidates without one — skipped when the profile sets
      `execUnprovenCriticals: false`, which `recall-first` does.

A constructed counterexample outranks a speculative critical, and that
ordering is deliberate. The counterexample is direct evidence that
execution will yield terminal evidence; an unproven critical is a hope
that it might. Spending the single affordable execution on the hope
while a ready-made counterexample goes unrun is the worse trade — a
smoke run over the bundled script showed exactly that happening under
the earlier ordering.

Within a rank, order by overlap with a high-risk region, then finder
confidence, then stable `file:line`.

Buying breadth before depth is not a universal law — reproducing an
authorization bypass can be worth more than a sixth lens. What is
universal is that the floors come first, and that the expensive half is
bought *selectively*, on evidence, rather than sprayed across every
target.

### When the plan does not fit

Only the **floors** decide whether a run is viable. Not being able to
afford every attack is the normal case, not an error: execution is
rationed by design, and the surplus targets are deferred and disclosed.

- Floors fit — run, and defer optional targets with
  `deferred_by_budget` in the ledger.
- The **coverage** floor does not fit — `budget_too_small`. Nothing runs
  when the shortfall is visible up front. It is not always visible up
  front: the first lens is sampled precisely to price the rest, so the
  same status can arrive with triage and one finder already run and
  charged, at the rate those two revealed. Say that when reporting it —
  the run cost something and produced no report. Raise the budget or
  narrow the scope; do **not** produce a degraded review.
- The **accuracy** floor does not fit — the trim runs, and the run
  continues over what the budget can verify. There is no
  `scope_too_large` status any more and there deliberately is not one:
  a status returned by comparing the post-trim floor against the budget
  could never fire, because the trim runs until exactly that comparison
  is false. Reinstating it *before* the trim would restore the abort the
  trim replaced, and with it the suppression that made a padded
  candidate list able to delete a whole review.
- Floors exceed twice the budget **before** trimming — the run proceeds
  and says so, as a coverage risk naming the ratio: past that point the
  candidate set is not slightly too big, it is too big for this budget
  to verify at all, and narrowing the scope buys more than a larger
  budget would. The advice the old status carried survives; the abort
  does not.

## 5. Role prompts

Every subagent receives `base_sha`, the patch path, `scope`, and the
neutral intended behavior. None receives another agent's conclusion
except where stated.

**Triage** — told which profile is running, so its breadth guidance
matches what the profile promises. Returns `change_kind`, 3–6 `lenses`
chosen for *this* change (not the whole menu), `high_risk_regions` as
file/line ranges where a defect would be severe regardless of whether
anything was found there — **ordered most dangerous first**, because
only the first few are funded and the order it returns is the order they
are bought — `probe_candidates` (focused test commands the repo
*appears* to support — inspect config, do not execute), and its own
`confidence` plus `uncertainties`.

**Finder** — one lens each, may read any file for context. Coverage,
not filtering: report everything found including uncertain and
low-severity candidates, with `confidence` marked; downstream
adjudication does the filtering. Every candidate must satisfy the
evidence schema in contract.md §1, including the `omission` shape when
the defect is missing code. A finder may also return
`additional_high_risk_regions` and at most one
`recommended_missing_lens`. Regions it adds are deduplicated against
triage's and queue *behind* them, because triage was the role asked to
rank regions by danger and that ranking is the funding order.

**Verifier** — the refutation burden in contract.md §3. Critical
verifiers return three separately grounded analyses — `semantics`,
`reachability`, `contract_violation` — plus `strongest_refutation`,
`unsettled_predicates`, and `grounding`. They do **not** return a
verdict. Minor candidates go to one batched verifier.

**Reasoning probe** — given one candidate or one high-risk region, no
execution and no worktree: construct a concrete counterexample — exact
input, step-by-step trace through the changed code, expected versus
actual, plus the failure signature a test would show — or return
`no_counterexample_constructed`. Failing to imagine one is **not**
evidence of robustness, and the prompt says so.
A *region* probe that succeeds must additionally return a full
`emergent_candidate` satisfying the same evidence contract as a
finder's. A counterexample with no candidate attached cannot be
verified or adjudicated, so the script records that as a malformed
result rather than quietly discarding it.

**Executable attack** — §6.

**Adjudicator** — batched, reading every candidate with its refutation
evidence and any attack result. Assigns `substantiated | refuted |
unresolved`, final severity, `grounding`, and a one-line decisive
evidence note. It is the only role that assigns state.

## 6. Attack protocol

### Stage 1 — reasoning probe (sonnet, no worktree)

Cheap enough to point at every high-risk region, which is what makes
the recall channel affordable outside the most expensive profile. Its
outcome decides whether stage 2 is worth buying.

### Stage 2 — executable attack (opus, `isolation: 'worktree'`)

**`isolation: 'worktree'` is a checkout, not a sandbox.** It stops two
agents colliding on files; it does not constrain what the commands they
run can reach. This stage applies the reviewed patch and runs the
artifact's own test command, so it executes code the artifact controls
with whatever privileges the session has — network, credentials, paths
outside the worktree. "No network, no dependency installation" is an
instruction to the *agent*, not a restriction on the *code*.

So `allow_execution: false` is a first-class argument, not a
degradation. A caller reviewing code they would not run keeps triage,
every lens, verification, probes and adjudication, and every execution
is deferred with reason `disabled_by_caller` in the ledger. The report
then says what a sandboxed rerun would buy. Point stage 2 at untrusted
code only in an environment you would let that code run in.

The worktree is a clean checkout at the parent's HEAD with **no
gitignored artifacts and none of the parent's uncommitted changes** —
measured behavior, not an assumption. So every attack begins by binding
itself to the reviewed artifact:

1. **Bind.** `git rev-parse HEAD`; if it is not `base_sha`,
   `git checkout --detach <base_sha>`. Verify the patch file's sha256
   matches `patch_sha256`; abort and report `blocked` if it does not.
2. **Preflight.** Before applying the patch, run one existing focused
   test near the changed code. Budget: 120 seconds wall clock. **No
   network, no dependency installation, no full-suite runs.** Record
   `test_capability` as `ready`, `setup_required`, or `unavailable`,
   with the probe command and its output.
   This replaces any repo-wide `fast_tests` boolean: testability is per
   target, not per repository, and a test directory says nothing about
   whether a fresh worktree can run it.
3. **Control.** If `ready`, author the focused reproducer and run it
   here — still unpatched. A reproducer that already fails at
   `base_sha` is testing a pre-existing breakage, not the change.
4. **Attack.** `git apply <patch_path>`, confirm `git diff --stat` is
   non-empty, rerun the reproducer.
5. **Grade** per contract.md §5. `reproduced` requires the predicted
   failure signature *and* the control passing. Without the control,
   grade `plausible` and say why.

If `test_capability` is not `ready`, fall back to the stage-1
counterexample graded `plausible` with `execution_status: unavailable`,
or `blocked` when even that is impossible. Never install dependencies
to rescue a run: it spends minutes, reaches the network, and can mask
the very defect under test.

Total budget: 600 seconds per executed target.

Executable attacks on critical candidates are **not** gated on the
verifier's refutation. Gating execution on a model's refutation vote is
what made the old "reproduced overrides the skeptic" rule — which overrides a
refutation of SEMANTICS, reachability and the obligation still needing cited
evidence — unreachable:
a candidate the verifier killed was never attacked, so the override had
nothing to override. Verification and attack run in different waves but
neither vetoes the other; the adjudicator sees both.

## 7. Write safety — what is actually guaranteed

The honest contract, and it is narrower than "never modifies":

> Triage, finder, verifier, probe and adjudicator prompts issue no
> write instructions. Executable attacks are *directed* at a throwaway
> worktree holding the verified review patch, and they run the
> artifact's own test command there with the session's privileges — a
> worktree is a checkout, not a sandbox, so an absolute path in that
> command reaches anything the session can reach. The launcher snapshots
> the parent tree's HEAD, index, status, and every tracked and
> untracked-but-visible path — with its mode, and with a content hash
> where the file can be read — before and after the run, and reports any
> unexpected difference. Six kinds of change are outside it, listed in
> §1: gitignored paths, submodule contents, anything git does not list,
> a rewrite of a file that is unreadable both times, a symlink retargeted
> by a trailing newline alone, and a rewrite of an existing xattr or ACL
> VALUE — whose presence is seen and whose contents are not.

"A content hash of every tracked and untracked-but-visible file" is what this
paragraph used to say, and §1 has always contradicted it: a write-only file
contributes a constant `UNREADABLE` record, so an agent can rewrite one and
both snapshots agree. The summary is the place that claim gets read, so it is
the place it has to be exact.

It said "executable attacks write only inside throwaway worktrees" too, and
§6 has contradicted that for as long: `isolation: 'worktree'` picks a
checkout and a working directory, and constrains nothing about where a
command can write. A test in the artifact that names an absolute path writes
there, outside the worktree and outside the snapshot above. That is precisely
why `allow_execution` is required and has no default — the caller is being
asked to accept it, so the summary must not describe it away.

That last part is **detection, not enforcement**. Claude Code exposes no
tool-restriction knob on `agent()` — the options are `label`, `phase`,
`schema`, `model`, `effort`, `isolation` and `agentType` — and the
built-in read-only-ish agent types still carry Bash, which can write.
Shipping a custom read-only `agentType` is not possible from this repo:
agent definitions live in `.claude/agents/`, and the linker only
symlinks skill directories.

If the after-state differs unexpectedly, stop and disclose it. Never
silently revert: the user's tree is theirs, and a "cleanup" can destroy
work the skill should never have touched.

## 8. Invoking the bundled script

Call the `Workflow` tool with `scriptPath` pointing at
`review-workflow.js` beside this file — usually
`~/.claude/skills/adversarial-code-review/review-workflow.js`. If that
path does not exist, locate the script beside `SKILL.md` rather than
reconstructing the pipeline inline. Reconstructing it from prose is the
defect this file exists to close.

```
Workflow({
  scriptPath: "<skill dir>/review-workflow.js",
  args: {
    scope: "uncommitted changes in the payments module",
    intent: "extract the retry loop; behaviour must be unchanged",
    base_sha: "<sha>",
    patch_path: "<TMPDIR>/acr-XXXX/patch.diff",
    patch_sha256: "<hash>",
    repo_root: "<abs path>",
    profile: "balanced",       // recall-first | precision-first
    budget_wu: 48,             // override only on request
    included_paths: ["src/pay.js", "src/auth.js"],   // REQUIRED, non-empty
    changed_ranges: { "src/pay.js": [[10, 14]] },     // optional, binds to hunks
    excluded_paths: ["package-lock.json", "vendor/"],
    allow_execution: true,                            // false keeps the contract,
                                                      // declines the execution half
    models: { cheap: "sonnet", strong: "opus", highEffort: "xhigh" }
  }
})
```

`models` carries the tiers resolved against the live schema in Phase 0.
Omit it only when the defaults are known to be valid.

The script owns schemas, weighted budgeting, wave reservation, and the
disclosure checklist. It does **not** rank models: `args.models` is used
as given and echoed back in `run.model_roles`, so a wrong tier is
auditable after the fact but not prevented. It never judges
prose: "weakly grounded" is a field an agent emits, never something the
script infers.

## 9. Failure handling

`agent()` returns `null` when a subagent is skipped or dies on a
terminal error. The script filters nulls; the consequences are
reported, never swallowed:

- A null **finder** means that lens was not run — Coverage ledger.
- A null **verifier** leaves its candidate `unresolved` with reason
  `verification did not complete`.
- A **weakly grounded** verifier does the same, at *every* severity. Only
  criticals buy an escalation, but a refutation that could not ground
  itself has settled nothing regardless of severity, so a candidate whose
  sole refutation is weak cannot be substantiated without a controlled
  reproduction. Cheap severities fail closed rather than relax.
  The weak record is kept for the report — its `unsettled_predicates` are
  what the Unresolved Candidates section needs — but
  `verifier_completed` means a *grounded* refutation, not merely a
  returned one. Defining the count that way is what makes the rule
  uniform; there is no separate withdrawal step.
- A target that was never probed is `not_attempted`, never `inconclusive` —
  minor candidates are not probe targets under any profile, so most runs have
  several, and grading them as "we tried and it held up" would be invention.
- A null **probe** is `blocked`, not `held` and not `inconclusive`:
  `inconclusive` means a probe ran and found nothing, which is a claim about
  the difficulty of the code. A probe that never returned says only that the
  run failed, and the ledger records it as an agent failure.
- A null **executable attack** is `blocked`, not `held`.
- A null **adjudicator batch** leaves the candidates *in that batch*
  unresolved; other batches stand. Only when every batch fails does the run
  report `adjudication_failed`. Either way no candidate is promoted on finder
  output alone.
- A **weak** verdict is withdrawn before its one permitted rerun. If the
  rerun returns nothing, returns the wrong ids, or is still weak, the
  candidate stays unresolved — the weak verdict is never restored.

## 10. Report assembly

The script returns structured data; the main agent writes the report as
terminal markdown, in the four-section order of contract.md §6, headed
by the three tradeoff lines and the frontier sentence from that same
section, plus scope, `base_sha`, short patch hash, profile, and model
roles.

That header is what makes a run reproducible, what stops "verified"
from meaning "we looked at it", and what lets the user decide whether
the next run should buy breadth or depth.

If the user then asks for fixes, that is a new task outside this skill:
re-read the code fresh rather than trusting the report's snippets.
