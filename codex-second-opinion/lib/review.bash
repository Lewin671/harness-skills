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
  --context <TEXT>     neutral background for the reviewer: intended
                       behaviour, facts, constraints. Keeps the scope's
                       empty-scope precheck, but the scope then reaches
                       Codex as prose rather than as a flag (the CLI
                       refuses a scope flag and a prompt together).
                       Not for Claude's suspected findings, and not
                       combinable with --custom.
  --model <MODEL>      override the pinned high-capability model
  --effort <LEVEL>     low|medium|high|xhigh|max (default: xhigh). Must
                       be given together with --model — a weaker model
                       may not accept the default effort.
  --inherit            use the model and effort from your codex config
                       instead of the pinned defaults; cannot be
                       combined with --model or --effort
  --allow-mcp          keep enabled standalone MCP servers reachable
                       instead of switching them off for this run;
                       only after explicit user approval, because
                       they may mutate external systems
  --repo <DIR>         repository to review (default: current directory)
  --timeout <SECONDS>  abort a hung review (default: 3000; 0 disables;
                       max 86400)

Defaults to a pinned high-capability model at xhigh reasoning effort,
optimising for confidence on consequential reviews. Use an explicit
override when cost, latency, or a different model perspective matters.

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
context=""
context_set=0
# Object names resolved by check_scope_nonempty, so --context can name
# revisions instead of caller-supplied refs. Empty until it runs.
resolved_base=""
resolved_commit=""
resolved_parent=""

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
      # Kept for --context, which has to describe this scope in prose.
      resolved_base="$merge_base"
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
      # Pin the ref to an object name once, then use only that. A
      # movable ref — `HEAD`, a branch — can advance between two
      # lookups, and this repo expects concurrent agents (AGENTS.md).
      # Re-resolving `${scope_value}^1` afterwards would then pair the
      # *new* commit's parent with the *old* commit: the same object
      # twice, an empty diff, and a review that comes back clean
      # because it was handed nothing to look at.
      resolved_commit="$(git rev-parse --verify --quiet "${scope_value}^{commit}")" || resolved_commit=""
      [ -n "$resolved_commit" ] || {
        echo "error: no such commit: ${scope_value}" >&2; exit 3; }
      # Against the first parent, not `git show`: for a merge commit the
      # latter uses combined-diff semantics and usually prints nothing,
      # which would misreport an ordinary merge as an empty commit.
      # `|| { exit 3; }` on each substitution: under set -e a bare
      # failing assignment would end the script with git's own exit
      # code (128), not the documented environment exit 3.
      local commit_files
      if resolved_parent="$(git rev-parse --verify --quiet "${resolved_commit}^1")"; then
        commit_files="$(git diff --name-only "$resolved_parent" "$resolved_commit")" || {
          echo "error: git diff failed for ${scope_value}" >&2; exit 3; }
      else
        resolved_parent=""
        commit_files="$(git show --pretty=format: --name-only "$resolved_commit")" || {
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

# The scope, restated as prose, for the one case where the scope flag
# cannot travel: `exec review` rejects a scope flag and a PROMPT in the
# same invocation ("the argument '--uncommitted' cannot be used with
# '[PROMPT]'"), so passing context means describing the scope instead of
# declaring it. Name the exact revisions the precheck just validated —
# Codex resolves them with its own read-only git commands, and anything
# vaguer here silently widens or narrows what gets reviewed.
#
# The commands carry the *resolved object names*, never the ref the
# caller typed: git happily accepts a branch named `a;whoami` or
# ``a`id` ``, and a raw ref pasted into a command the reviewer is told
# to run would be command injection into that reviewer's shell. Hashes
# have no metacharacters, and they also pin the scope more precisely
# than a name that could move mid-run. The ref is still named, quoted,
# for human context.
scope_sentence() {
  case "$scope_flag" in
    --uncommitted)
      printf '%s' "Review the uncommitted changes in this repository: staged, unstaged, and untracked files. Use \`git status --porcelain --untracked-files=normal\` together with \`git diff\`, \`git diff --cached\`, and the contents of any untracked files." ;;
    --base)
      printf '%s' "Review the changes on the current branch against base branch $(shell_quote "$scope_value"): the diff from merge base ${resolved_base} to the working tree, i.e. \`git diff ${resolved_base}\`. Do not review anything already contained in ${resolved_base}." ;;
    --commit)
      if [ -n "$resolved_parent" ]; then
        printf '%s' "Review only the changes introduced by commit ${resolved_commit} (given as $(shell_quote "$scope_value")): \`git diff ${resolved_parent} ${resolved_commit}\`. Do not review unrelated code."
      else
        printf '%s' "Review only the changes introduced by root commit ${resolved_commit} (given as $(shell_quote "$scope_value")): \`git show ${resolved_commit}\`. Do not review unrelated code."
      fi ;;
  esac
}

# Scope prose plus the caller's background. The framing is deliberate:
# stated intent must not be swallowed as fact, because a mismatch
# between what the change claims to do and what it does is one of the
# most valuable things an independent reviewer can catch.
composed_prompt() {
  printf '%s\n\n%s\n\n%s\n' \
    "$(scope_sentence)" \
    "Background supplied with this request — the intended behaviour, relevant facts, and constraints for this change. Use it to judge whether the code does what it is meant to do; do not accept it on faith, and do not repeat it back as a finding. Where the code and this description disagree, that disagreement is itself a finding." \
    "$context"
}

# Build `cmd` and the redacted `diag` for one attempt.
# Args: model ("" to inherit), effort ("" to inherit).
build_cmd() {
  cmd=("$codex_bin" exec review)
  local prompt="" prompt_label=""
  if [ "$scope_flag" = "--custom" ]; then
    prompt="$scope_value"
    prompt_label="custom prompt"
  elif [ "$context_set" -eq 1 ]; then
    prompt="$(composed_prompt)"
    prompt_label="context prompt"
  else
    cmd+=("$scope_flag")
    [ -n "$scope_value" ] && cmd+=("$scope_value")
  fi
  append_safety_args "$1" "$2"
  diag="running: ${cmd[*]}"
  if [ -n "$prompt" ]; then
    diag="${diag} -- <${prompt_label}: ${#prompt} chars>"
    # The prompt is a bare positional PROMPT, last, after a `--`.
    # Without the terminator, text that begins with a dash (a Markdown
    # bullet, say) is parsed as an unknown option.
    cmd+=(-- "$prompt")
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
        # Non-empty, not just present: an empty --custom would skip
        # every precheck and spend a full run on an empty prompt with
        # no scope flag at all.
        [ "$#" -gt 0 ] && [ -n "$1" ] || {
          echo "error: ${scope_flag} needs a non-empty value" >&2; mode_usage; exit 3; }
        scope_value="$1"; shift ;;
      --context)
        shift
        [ "$#" -gt 0 ] && [ -n "$1" ] || {
          echo "error: --context needs a non-empty value" >&2; exit 3; }
        if [ "$context_set" -eq 1 ]; then
          echo "error: --context may be given only once; pass the whole background as one argument" >&2
          exit 3
        fi
        context="$1"; context_set=1; shift ;;
      --model)
        shift; [ "$#" -gt 0 ] && [ -n "$1" ] || {
          echo "error: --model needs a non-empty value (use --inherit for your config's model)" >&2; exit 3; }
        model="$1"; pinned=0; model_set=$((model_set + 1)); shift ;;
      --effort)
        shift; [ "$#" -gt 0 ] && [ -n "$1" ] || {
          echo "error: --effort needs a non-empty value" >&2; exit 3; }
        effort="$1"; pinned=0; effort_set=$((effort_set + 1)); shift ;;
      --inherit)
        model=""; effort=""; pinned=0; inherit_set=$((inherit_set + 1)); shift ;;
      --allow-mcp)
        allow_mcp=1; shift ;;
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

  # --custom already *is* free-form text with its own scope; adding
  # --context would silently drop one of the two bodies rather than
  # merge them.
  if [ "$context_set" -eq 1 ] && [ "$scope_flag" = "--custom" ]; then
    echo "error: --context cannot be combined with --custom; custom instructions already carry their own context" >&2
    exit 3
  fi

  common_check_model_flags
  common_env_checks
  check_scope_nonempty
  common_setup_scratch
  run_with_fallback
  emit_result
}
