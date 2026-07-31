# Review mode: run `codex exec review` over a code change. Sourced by
# run-codex-second-opinion after lib/common.bash.

run_noun="review"
result_noun="report"

mode_usage() {
  cat >&2 <<'USAGE'
Usage: run-codex-second-opinion review [SCOPE] [OPTIONS]

Scope (choose exactly one, default --uncommitted):
  --uncommitted        staged + unstaged + untracked changes
  --base <BRANCH>      current branch against BRANCH
  --commit <SHA>       the changes introduced by one commit
  --custom <TEXT>      free-form instructions that describe their own
                       scope; mutually exclusive with the three above,
                       and skips the empty-scope precheck

Options:
  --model <MODEL>      override the model (default: strongest tier)
  --effort <LEVEL>     low|medium|high|xhigh|max (default: xhigh). Pass
                       this whenever you pass --model — a weaker model
                       may not accept the default effort.
  --inherit            use the model and effort from your codex config
                       instead of the pinned strongest defaults
  --repo <DIR>         repository to review (default: current directory)
  --timeout <SECONDS>  abort a hung review (default: 3000; 0 disables;
                       max 86400)

Defaults to the strongest available model at xhigh reasoning effort.
A second opinion is only worth the wait if it comes from the best
reviewer available, so speed is deliberately not the priority here.

Environment:
  CODEX_BIN                     path to the codex binary (default: codex)
  CODEX_SECOND_OPINION_MODEL    override the pinned default model
  CODEX_SECOND_OPINION_EFFORT   override the pinned default effort
  CODEX_SECOND_OPINION_TIMEOUT  override the default timeout (seconds)
USAGE
}

scope_flag="--uncommitted"
scope_value=""
scope_set=0

set_scope() {
  if [ "$scope_set" -eq 1 ]; then
    echo "error: scopes are mutually exclusive; pick one of --uncommitted, --base, --commit, --custom" >&2
    exit 3
  fi
  scope_set=1
}

# Refuse to spend minutes on an empty scope. Codex reports "there are no
# changes" as an ordinary successful review, which reads like a pass.
#
# Every check here must match what Codex actually reviews. A precheck
# that is narrower than the real scope silently skips a valid review,
# which is the worst failure this script can have.
check_scope_nonempty() {
  case "$scope_flag" in
    --uncommitted)
      # --untracked-files=normal is explicit because a repo configured
      # with status.showUntrackedFiles=no would otherwise report nothing
      # while untracked files — which this scope promises to review —
      # sit right there. A failing git status must surface as exit 3,
      # not be read as an empty scope.
      local status_out
      status_out="$(git status --porcelain --untracked-files=normal)" || {
        echo "error: git status failed in ${repo}" >&2; exit 3; }
      if [ -z "$status_out" ]; then
        echo "nothing to review: no staged, unstaged, or untracked changes" >&2
        exit 2
      fi
      ;;
    --base)
      git rev-parse --verify --quiet "$scope_value" >/dev/null || {
        echo "error: no such branch or ref: ${scope_value}" >&2; exit 3; }
      # Codex reviews `git diff <merge-base>` with no second revision,
      # so its scope runs from the merge base to the *working tree*.
      # Diffing against HEAD instead would miss uncommitted edits and
      # wrongly declare an empty scope whenever HEAD already matches
      # the base.
      local merge_base diff_status
      merge_base="$(git merge-base "$scope_value" HEAD 2>/dev/null)" || merge_base=""
      if [ -z "$merge_base" ]; then
        echo "error: ${scope_value} and HEAD have no common ancestor" >&2
        exit 3
      fi
      # --quiet means exit 0 for no changes, 1 for changes, >1 for a
      # hard failure. Collapsing the last two would review on a broken
      # diff.
      diff_status=0
      git diff --quiet "$merge_base" || diff_status=$?
      if [ "$diff_status" -eq 0 ]; then
        echo "nothing to review: no changes since the merge base with ${scope_value}" >&2
        exit 2
      elif [ "$diff_status" -ne 1 ]; then
        echo "error: git diff failed against merge base ${merge_base}" >&2
        exit 3
      fi
      ;;
    --commit)
      git rev-parse --verify --quiet "${scope_value}^{commit}" >/dev/null || {
        echo "error: no such commit: ${scope_value}" >&2; exit 3; }
      # Against the first parent, not `git show`: for a merge commit the
      # latter uses combined-diff semantics and usually prints nothing,
      # which would misreport an ordinary merge as an empty commit.
      # `|| { exit 3; }` on each substitution: under set -e a bare
      # failing assignment would end the script with git's own exit
      # code (128), not the documented environment exit 3.
      local commit_files
      if git rev-parse --verify --quiet "${scope_value}^1" >/dev/null; then
        commit_files="$(git diff --name-only "${scope_value}^1" "$scope_value")" || {
          echo "error: git diff failed for ${scope_value}" >&2; exit 3; }
      else
        commit_files="$(git show --pretty=format: --name-only "$scope_value")" || {
          echo "error: git show failed for ${scope_value}" >&2; exit 3; }
      fi
      if [ -z "$commit_files" ]; then
        echo "nothing to review: ${scope_value} is an empty commit" >&2
        exit 2
      fi
      ;;
    --custom)
      : # scope is whatever the instructions describe; nothing to precheck
      ;;
  esac
}

# Build `cmd` and the redacted `diag` for one attempt.
# Args: model ("" to inherit), effort ("" to inherit).
build_cmd() {
  cmd=("$codex_bin" exec review)
  if [ "$scope_flag" != "--custom" ]; then
    cmd+=("$scope_flag")
    [ -n "$scope_value" ] && cmd+=("$scope_value")
  fi
  append_safety_args "$1" "$2"
  diag="running: ${cmd[*]}"
  if [ "$scope_flag" = "--custom" ]; then
    diag="${diag} -- <custom prompt: ${#scope_value} chars>"
    # Custom instructions are a bare positional PROMPT — mutually
    # exclusive with every scope flag, and last, after a `--`. Without
    # the terminator, instructions that begin with a dash (a Markdown
    # bullet, say) are parsed as an unknown option.
    cmd+=(-- "$scope_value")
  fi
}

mode_main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --uncommitted)
        set_scope; scope_flag="--uncommitted"; scope_value=""; shift ;;
      --base|--commit|--custom)
        set_scope
        scope_flag="$1"
        shift
        [ "$#" -gt 0 ] || { echo "error: ${scope_flag} needs a value" >&2; mode_usage; exit 3; }
        scope_value="$1"; shift ;;
      --model)
        shift; [ "$#" -gt 0 ] || { echo "error: --model needs a value" >&2; exit 3; }
        model="$1"; pinned=0; shift ;;
      --effort)
        shift; [ "$#" -gt 0 ] || { echo "error: --effort needs a value" >&2; exit 3; }
        effort="$1"; pinned=0; shift ;;
      --inherit)
        model=""; effort=""; pinned=0; shift ;;
      --repo)
        shift; [ "$#" -gt 0 ] || { echo "error: --repo needs a value" >&2; exit 3; }
        repo="$1"; shift ;;
      --timeout)
        shift; [ "$#" -gt 0 ] || { echo "error: --timeout needs a value" >&2; exit 3; }
        validate_timeout "$1" "--timeout"
        timeout_secs="$validated_timeout"; shift ;;
      -h|--help) mode_usage; exit 0 ;;
      *) echo "error: unknown argument: $1" >&2; mode_usage; exit 3 ;;
    esac
  done

  common_env_checks
  check_scope_nonempty
  common_setup_scratch
  run_with_fallback
  emit_result
}
