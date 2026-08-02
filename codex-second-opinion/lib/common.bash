# Shared runtime for run-codex-second-opinion. Sourced, not executed.
#
# Everything here is mode-agnostic and safety-critical: read-only
# enforcement, external-tool fail-closed verification, scratch placement,
# the watchdog, process-group termination, bounded progress, and the
# stale-default fallback. Mode files (review.bash, consult.bash) build the
# codex command and interpret its result; only the explicit --allow-mcp
# acknowledgement may accept an external boundary this file detects.
#
# Mode files must set before use:
#   run_noun     what a run is called in messages ("review"/"consultation")
#   result_noun  what the output is called ("report"/"answer")
#
# Mode files may override:
#   mode_block_retry  return 0 to suppress the stale-default retry
#                     (printing its own explanation first)

# Pin a high-capability default for consequential reviews rather than
# inheriting whichever model the user last configured. Explicit cost,
# latency, and model-diversity preferences can override it. Verified
# against codex-cli 0.146.0 on 2026-07-31; if the slug goes stale the
# script falls back to the user's config (see defaults_rejected below).
# `ultra` is deliberately not used: it delegates subtasks, which is not
# what a single independent second opinion wants.
#
# Effort is pinned one tier below the top: `xhigh` mostly buys latency on
# a run that is already a cross-check, and `high` is a tier far more
# models accept. Raise it per-run with an explicit --model/--effort pair.
default_model="${CODEX_SECOND_OPINION_MODEL:-gpt-5.6-sol}"
default_effort="${CODEX_SECOND_OPINION_EFFORT:-high}"

model="$default_model"
effort="$default_effort"
pinned=1
repo="."
allow_mcp=0

# `-c mcp_servers.<id>.enabled=false` overrides, one pair per enabled
# standalone MCP server, filled in by common_env_checks and replayed on
# every invocation. Empty when the config has none, or when --allow-mcp
# deliberately keeps them reachable.
mcp_disable_args=()

# Model settings are a closed three-way choice — pinned defaults, a
# complete --model/--effort pair, or --inherit — not a bag of independent
# flags whose outcome depends on their order. The parsers count what was
# asked for; common_check_model_flags rejects every other combination.
# Enforcing it matters because a half-specification fails in a way that
# reads like a Codex problem: `--model X` alone keeps the pinned effort —
# the exact tier weaker models reject — and clears `pinned`, which
# disables the fallback retry that would otherwise rescue the run.
model_set=0
effort_set=0
inherit_set=0

# Set when the stale-default fallback is what actually answered. A
# follow-up then has to repeat --inherit: the pinned defaults already
# failed once, and on a resumed session there is no automatic retry left.
used_fallback=0

# Bounded, not just numeric: a digit string longer than what `[ -gt ]`
# can parse makes the comparison error out inside an `if`, silently
# removing the hang protection entirely. The length gate runs before any
# numeric test so an oversized value never reaches one. 86400 (one day)
# is far above any legitimate run.
validate_timeout() {
  local value="$1" source="$2"
  case "$value" in
    ''|*[!0-9]*)
      echo "error: ${source} must be a whole number of seconds, got '${value}'" >&2
      exit 3 ;;
  esac
  # Normalize leading zeros ("000030" → "30") so padded automation
  # input is judged by numeric value; an all-zero string becomes 0.
  value="${value#"${value%%[!0]*}"}"
  [ -n "$value" ] || value=0
  if [ "${#value}" -gt 5 ] || [ "$value" -gt 86400 ]; then
    echo "error: ${source} must be between 0 and 86400 seconds, got '$1'" >&2
    exit 3
  fi
  validated_timeout="$value"
}

# Generous by default: a high-effort run over a large repo or diff
# legitimately takes many minutes. This is a stuck-process backstop,
# not a budget.
timeout_secs="${CODEX_SECOND_OPINION_TIMEOUT:-3000}"
# Validated here, not just at the flag: the environment is an input too.
validate_timeout "$timeout_secs" "CODEX_SECOND_OPINION_TIMEOUT"
timeout_secs="$validated_timeout"

# Render a value for display inside a command someone is expected to
# copy, run, or hand to a model. Anything outside a plainly safe set is
# single-quoted, with embedded quotes escaped the portable '\'' way, so
# a value carrying `;`, `$(...)`, backticks, or spaces cannot turn into
# syntax. Ordinary values are left bare to keep the common case
# readable.
shell_quote() {
  local v="$1"
  # The replacement is the four-character sequence '\'' — close the
  # quote, emit an escaped one, reopen. It lives in a variable because
  # spelling it inline in the substitution is exactly where the escaping
  # goes wrong: an earlier inline attempt produced `'a\'\'\'b'`, which
  # is not valid shell at all.
  local esc="'\\''"
  case "$v" in
    ''|*[!A-Za-z0-9._/-]*)
      v="${v//\'/$esc}"
      printf "'%s'" "$v" ;;
    *)
      printf '%s' "$v" ;;
  esac
}

# True when $1 is one of the repository roots in `repo_paths`, or sits beneath
# one. Defined at file scope rather than inside common_resolve_scratch so a
# test can exercise the boundary a test cannot otherwise reach: a worktree at
# `/`, where a naive "$root"/* pattern becomes `//*` and matches nothing — so
# a repository containing every path on the machine would read as containing
# none of them. The trailing slash is stripped for exactly that case.
inside_repo() {
  local candidate="$1" root prefix
  for root in ${repo_paths[@]+"${repo_paths[@]}"}; do
    [ "$candidate" = "$root" ] && return 0
    prefix="${root%/}"
    case "$candidate/" in "$prefix"/*) return 0 ;; esac
  done
  return 1
}

# Collapse `.` and `..` in an absolute path without touching the filesystem.
# Purely lexical, so it is wrong in the presence of symlinks — which is why
# callers test it *alongside* a resolved path rather than instead of one.
lexical_path() {
  local path="$1" out="" part
  local IFS=/
  for part in $path; do
    case "$part" in
      ''|.) ;;
      ..) out="${out%/*}" ;;
      *) out="${out}/${part}" ;;
    esac
  done
  printf '%s' "${out:-/}"
}

# Print one line per *enabled* server in a `codex mcp list --json`
# payload read from stdin: its id, or `?` when the entry is enabled but
# its name could not be read.
#
# One line per entry, never per name, is the whole point. Safety here
# depends on counting enabled *entries*, and a nameless entry is exactly
# the one a name-keyed check would miss — in both the first pass and the
# re-check, whose blind spots would then coincide and hide it twice.
# `?` is not a TOML bare key, so it can never collide with a real id.
#
# A payload whose braces or brackets never balance — truncated output — or
# that carries bytes outside its JSON root, prints `!` instead. Both matter: a cut mid-entry leaves that entry
# unclosed and therefore unemitted, while a cut cleanly *between*
# entries is brace-balanced and would otherwise look like a complete
# listing that simply has no servers after the cut. Either way the
# missing part is exactly what has not been switched off.
#
# Brace depth, not indentation or key order: the listing is
# pretty-printed today and could be compact tomorrow, and a nested
# object — a transport block with its own `name`, say — must never be
# mistaken for a server. Only keys directly inside a top-level entry
# (depth 1) are read.
mcp_enabled_ids() {
  awk '
    function flush() {
      if (enabled == 1) print (name == "" ? "?" : name)
      name = ""; enabled = 0; key = ""; just_opened = 1; pending_comma = 0; value_started = 0
    }
    {
      s = $0; n = length(s)
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        # Bytes outside the JSON root are not part of a listing. A payload
        # like `[{...}] trailing-garbage` balances its brackets and passes
        # every value check, but it is not what codex prints — and whatever
        # mangled it may equally have dropped an enabled server before the
        # part that arrived. A second root counts too.
        if (depth == 0 && bdepth == 0 && c !~ /[ \t\r]/) {
          if (started || (c != "[" && c != "{")) garbage = 1
          if (c == "[" || c == "{") started = 1
        }
        if (c == "\"") {
          # Consume the whole string token, honouring backslash escapes,
          # so that a brace or colon inside it cannot move the parser.
          val = ""; i++
          while (i <= n) {
            c = substr(s, i, 1)
            if (c == "\\") { val = val substr(s, i, 2); i += 2; continue }
            if (c == "\"") break
            val = val c; i++
          }
          # A string followed by `:` is a key; anything else is a value.
          j = i + 1
          while (j <= n && substr(s, j, 1) ~ /[ \t\r]/) j++
          if (substr(s, j, 1) == ":") {
            if (depth == 1) {
              value_started = 0
              # A key must be the first thing in its entry or follow a comma.
              # `{"name":"off" "enabled":false}` balances and spells its
              # boolean correctly; only the missing separator gives it away.
              if (!just_opened && !pending_comma) garbage = 1
              just_opened = 0; pending_comma = 0
              key = val
            }
            i = j
          } else {
            # A value at entry level with no key in front of it means the
            # colon is missing: `{"name":"github","enabled" true}` balances,
            # spells its boolean fine, and has no `"enabled":` for the value
            # counter to find either — so this is the only check that sees it.
            if (depth == 1 && key == "") garbage = 1
            if (depth == 1) { just_opened = 0; pending_comma = 0 }
            if (depth == 1 && key == "name") name = val
            key = ""
          }
          # A string is a significant token: it ends any pending comma, so
          # the trailing-comma check below does not fire on `{"a":"b"}`.
          trailing = 0
          if (depth == 1) value_started = 1
          continue
        }
        # A comma before a close is a trailing comma: `[{...},]`.
        if (c == ",") {
          if (depth == 1) pending_comma = 1
          trailing = 1
          value_started = 0
          continue
        }
        if (c !~ /[ \t\r]/) {
          if ((c == "]" || c == "}") && trailing) garbage = 1
          trailing = 0
        }
        if (c == "{") { depth++; if (depth == 1) flush(); continue }
        if (c == "}") { if (depth == 1) flush(); depth--; continue }
        # Brackets are tracked purely to prove the payload is whole.
        # Braces alone are not enough: a listing cut off between two
        # entries — after `}` but before `]` — is brace-balanced, so it
        # would parse as a complete listing that happens to omit every
        # server after the cut.
        if (c == "[") { bdepth++; continue }
        if (c == "]") { bdepth--; continue }
        if (depth == 1 && key == "enabled" && substr(s, i, 4) == "true") {
          enabled = 1; key = ""; i += 3
          value_started = 1
          continue
        }
        # A value has to begin with something JSON allows. `{"enabled":false,
        # GARBAGE}` balances, counts its booleans and emits no id — so without
        # this it reads as a complete listing with nothing enabled. Strings,
        # objects and arrays are consumed above; what reaches here is a
        # literal or a number, and anything else is not JSON.
        if (depth == 1 && !value_started && c !~ /[ \t\r]/) {
          if (c ~ /[-0-9]/) { value_started = 1; continue }
          if (substr(s, i, 4) == "true" || substr(s, i, 4) == "null") { value_started = 1; i += 3; continue }
          if (substr(s, i, 5) == "false") { value_started = 1; i += 4; continue }
          garbage = 1
        }
      }
    }
    END { if (depth != 0 || bdepth != 0 || garbage) print "!" }'
}

# Every `"enabled"` key in the payload must carry a bare true or false.
# The enumeration keys entirely on that: the grep looks for `true`, and the
# parser only sets enabled on the literal four bytes. So a payload that spelled
# it `"enabled":"true"` would match neither, produce no id, and read as a
# server that is switched off — a fail-open on exactly the CLI schema drift the
# rest of this block is built to survive. Counting keys against well-formed
# values catches it whichever way the drift went.
mcp_enabled_values_boolean() {
  local payload="$1" keys values
  keys="$(grep -oE '"enabled"[[:space:]]*:' <<< "$payload" | wc -l | tr -d '[:space:]')"
  values="$(grep -oE '"enabled"[[:space:]]*:[[:space:]]*(true|false)' <<< "$payload" | wc -l | tr -d '[:space:]')"
  [ "$keys" = "$values" ]
}

# Close the model state machine. Called by each mode_main straight after
# parsing, before anything is spent: every rejection here is a mistake
# that would otherwise surface minutes later as a failed run.
common_check_model_flags() {
  # A newline in either value would survive into the consult `resume:`
  # line and forge a second standalone marker there. Rejecting it beats
  # sanitizing: silently rewriting a model name would advertise a
  # command that does not reproduce the run. Both sources are covered,
  # since $model/$effort already hold the environment defaults.
  # Held in variables: `$(printf '\n')` would strip the very newline it
  # is meant to match, leaving a pattern of `**` that rejects everything.
  local lf=$'\n' cr=$'\r'
  case "${model}${effort}" in
    *"$lf"*|*"$cr"*)
      echo "error: the model and effort must not contain line breaks" >&2
      exit 3 ;;
  esac
  if [ "$model_set" -gt 1 ] || [ "$effort_set" -gt 1 ] || [ "$inherit_set" -gt 1 ]; then
    echo "error: --model, --effort, and --inherit may each be given only once." >&2
    echo "hint: repeating one makes the effective setting depend on flag order." >&2
    exit 3
  fi
  if [ "$inherit_set" -eq 1 ] && { [ "$model_set" -eq 1 ] || [ "$effort_set" -eq 1 ]; }; then
    echo "error: --inherit cannot be combined with --model or --effort." >&2
    echo "hint: pick one — no flags for the pinned defaults, '--model M --effort L' for an explicit pair, or --inherit for your codex config." >&2
    exit 3
  fi
  if [ "$model_set" -eq 1 ] && [ "$effort_set" -eq 0 ]; then
    echo "error: --model needs an explicit --effort." >&2
    echo "hint: the pinned default effort ('${default_effort}') is not a tier every model accepts, and naming a model already turns off the automatic fallback that would rescue the run." >&2
    exit 3
  fi
  if [ "$effort_set" -eq 1 ] && [ "$model_set" -eq 0 ]; then
    echo "error: --effort needs an explicit --model." >&2
    echo "hint: naming an effort turns off the automatic fallback that rescues a stale pinned model, so the model has to be named too." >&2
    exit 3
  fi
}

# Enter the repo and verify the environment. Called by mode_main after
# argument parsing, before any codex invocation.
common_env_checks() {
  # `--` because `cd` is a builtin that parses its own options: `cd -` jumps to
  # OLDPWD *and echoes the path to stdout*, which must carry nothing but the
  # result, and `cd -P` is silently accepted as a flag — leaving the run
  # pointed at whatever directory it was already in. Quoting does not stop
  # either; the terminator does.
  cd -- "$repo" || { echo "error: cannot enter ${repo}" >&2; exit 3; }

  # A repository path carrying a line break would break out of the `resume:`
  # descriptor — advertised as ready to run — and forge a later standalone
  # `session:` marker than the wrapper's own, which is the value a follow-up
  # feeds back to --continue. Rejected rather than sanitized, for the same
  # reason as the model and effort values: silently rewriting a path would
  # advertise a command that does not reproduce the run.
  # Held in variables, exactly as common_check_model_flags does: `$(printf
  # '\n')` strips the very newline it is meant to match, leaving a pattern of
  # `**` that matches every path there is.
  local lf=$'\n' cr=$'\r'
  case "$PWD" in
    *"$lf"*|*"$cr"*)
      echo "error: the repository path contains a line break, which would forge marker lines in this script's output" >&2
      exit 3 ;;
  esac

  # The printed value matters, not just the exit status: in a bare
  # repository this command *succeeds* and prints "false", and trusting
  # the status alone would misreport the bare repo as something later
  # stages have to untangle instead of a clear environment problem.
  local work_tree
  work_tree="$(git rev-parse --is-inside-work-tree 2>/dev/null)" || work_tree=""
  [ "$work_tree" = "true" ] || {
    echo "error: ${repo} is not a git work tree" >&2; exit 3; }

  # Before the first here-string below: on bash 3.2 `<<<` materialises a
  # temporary file under TMPDIR, so a repo-local TMPDIR would be written —
  # briefly, but written — inside the tree this run promises only to read, and
  # the relocation that fixes that used to happen afterwards.
  common_resolve_scratch

  # A partial clone fetches missing objects on demand, so a precheck that
  # needs one reaches the network and writes .git/objects before any sandbox
  # exists. GIT_NO_LAZY_FETCH stops that; it landed in git 2.42 and is inert
  # below, which is why internals.md states the residual instead of claiming
  # the prechecks cannot fetch on every git.
  export GIT_NO_LAZY_FETCH=1

  codex_bin="${CODEX_BIN:-codex}"
  if ! "$codex_bin" --version >/dev/null 2>&1; then
    cat >&2 <<EOF
error: '${codex_bin}' is not runnable.

A codex on PATH that fails --version usually means a broken install
(a shell-function wrapper, or an npm shim whose vendored binary is
missing) rather than a missing one. Try 'codex update', or set
CODEX_BIN to a working binary.
EOF
    exit 3
  fi

  # Command hooks run outside the shell sandbox once trusted — codex's
  # own trust prompt says "Hooks can run outside the sandbox after you
  # trust them" — so a read-only sandbox alone does not make the run
  # read-only. Apps and plugins likewise act outside it: an installed
  # plugin can bundle a write-capable connector or MCP server whose
  # tools mutate external systems regardless of sandbox_mode. All
  # three are disabled on every invocation; this verifies the
  # *effective* states, because managed policy can force a feature
  # back on. Fail closed: an unparseable or missing answer is treated
  # the same as "enabled".
  local features_out feature state
  features_out="$("$codex_bin" features list \
    --disable hooks --disable apps --disable plugins 2>/dev/null)" || features_out=""
  for feature in hooks apps plugins; do
    state="$(printf '%s\n' "$features_out" |
      awk -v f="$feature" '$1 == f { state = $NF } END { print state }')" || state=""
    if [ "$state" != "false" ]; then
      echo "error: codex ${feature} stay enabled (effective state: '${state:-unknown}')." >&2
      echo "error: ${feature} act outside the read-only sandbox, so this ${run_noun} could write; refusing to start." >&2
      exit 3
    fi
  done

  # Standalone MCP servers from the user's own codex config sit outside
  # sandbox_mode and may mutate external systems. There is no global
  # kill switch on 0.146.0 (no --disable mcp), but each server has an
  # `mcp_servers.<id>.enabled` key, and the -c layer overrides it for
  # this invocation alone — verified: `mcp list -c
  # mcp_servers.<id>.enabled=false` reports that server as disabled.
  # So the default is to neutralize them rather than to refuse: the run
  # proceeds with the exposure actually removed, which is a stronger
  # guarantee than a refusal the caller can be tempted to override.
  # Refusing is reserved for the case where they cannot be enumerated —
  # an unusable listing means there is nothing to switch off, and
  # assuming an empty config there would fail open. --allow-mcp is the
  # opposite opt-in: leave them reachable, on explicit user acceptance.
  local mcp_out mcp_status=0 mcp_problem="" mcp_count=0
  mcp_out="$("$codex_bin" mcp list --json \
    --disable hooks --disable apps --disable plugins 2>/dev/null)" || mcp_status=$?
  # A failed or unrecognizable listing is unsafe, never equivalent to an
  # empty config. Match only actually enabled entries: the listing also
  # includes disabled ones. A here-string, not a pipeline: grep -q exits
  # on the first match, and under pipefail the writer's SIGPIPE would
  # turn a found entry into a false pipeline status.
  if [ "$mcp_status" -ne 0 ]; then
    mcp_problem="could not verify standalone MCP exposure ('codex mcp list' failed)"
  elif ! mcp_enabled_values_boolean "$mcp_out"; then
    mcp_problem="could not verify standalone MCP exposure (an 'enabled' field is not a bare true or false)"
  elif grep -qE '"enabled"[[:space:]]*:[[:space:]]*true' <<< "$mcp_out"; then
    local mcp_id unaddressable="" unnamed=0 truncated=0
    while IFS= read -r mcp_id; do
      [ -n "$mcp_id" ] || continue
      if [ "$mcp_id" = "!" ]; then
        truncated=1
        break
      fi
      # An enabled entry with no readable name cannot be switched off,
      # and the re-check below shares that blind spot exactly — so it
      # has to stop the run here, where it is still visible.
      if [ "$mcp_id" = "?" ]; then
        unnamed=1
        break
      fi
      # A dotted -c path can only address a TOML bare key. An id with
      # anything else in it cannot be switched off this way, and
      # pretending otherwise would leave it live behind a reassuring
      # message.
      case "$mcp_id" in
        *[!A-Za-z0-9_-]*) unaddressable="$mcp_id"; break ;;
      esac
      mcp_disable_args+=(-c "mcp_servers.${mcp_id}.enabled=false")
      mcp_count=$((mcp_count + 1))
    done <<< "$(mcp_enabled_ids <<< "$mcp_out")"

    if [ "$truncated" -eq 1 ]; then
      mcp_disable_args=()
      mcp_problem="the standalone MCP listing is incomplete, so its enabled servers cannot be identified"
    elif [ "$unnamed" -eq 1 ]; then
      mcp_disable_args=()
      mcp_problem="an enabled standalone MCP server has no readable name and so cannot be switched off"
    elif [ -n "$unaddressable" ]; then
      mcp_disable_args=()
      mcp_problem="standalone MCP server '${unaddressable}' cannot be addressed by a config override and so cannot be switched off"
    elif [ "$mcp_count" -eq 0 ]; then
      # The listing says something is enabled but no entry could be
      # named. The re-check below cannot catch this — with no overrides
      # to apply it would just re-read the same unparsed payload — so
      # this is its own refusal rather than a silent pass.
      mcp_problem="could not identify the enabled standalone MCP server(s) to switch off"
    elif [ "$allow_mcp" -eq 0 ]; then
      # Ask codex itself whether the overrides worked, rather than
      # trusting the parser that produced them. This is what makes a
      # missed or misnamed server a refusal instead of a silent
      # exposure: whatever the reason, a server still reporting as
      # enabled here is one the run would have left reachable.
      local verify_out verify_status=0 verify_left=""
      if [ "${#mcp_disable_args[@]}" -gt 0 ]; then
        verify_out="$("$codex_bin" mcp list --json \
          --disable hooks --disable apps --disable plugins \
          "${mcp_disable_args[@]}" 2>/dev/null)" || verify_status=$?
      else
        verify_out="$mcp_out"
      fi
      if [ "$verify_status" -ne 0 ]; then
        mcp_problem="could not confirm the standalone MCP servers were switched off ('codex mcp list' failed on the re-check)"
      else
        # The re-check is only evidence if it is a listing. Output this
        # pass cannot recognize proves nothing, and reading it as "no
        # enabled servers" would turn every parse failure into a silent
        # pass. Stricter than the first listing on purpose: empty output
        # is plausible for a config with no servers at all, but not here,
        # where a listing with entries was just read.
        case "$verify_out" in
          '[]'|'{}') : ;;
          *'"enabled"'*)
            # Same value-shape bar as the first listing: a re-check whose
            # booleans have become strings proves nothing either.
            mcp_enabled_values_boolean "$verify_out" ||
              mcp_problem="could not confirm the standalone MCP servers were switched off (an 'enabled' field is not a bare true or false)" ;;
          *)
            mcp_problem="could not confirm the standalone MCP servers were switched off (unrecognized re-check output)" ;;
        esac
        if [ -z "$mcp_problem" ]; then
          verify_left="$(mcp_enabled_ids <<< "$verify_out")"
          # `!` can never be an id, so its presence anywhere means the
          # payload never balanced — truncated after an enabled entry,
          # say, which would otherwise parse to nothing and read as
          # all-clear.
          case "$verify_left" in
            *'!'*)
              mcp_problem="could not confirm the standalone MCP servers were switched off (incomplete re-check output)" ;;
            ?*)
              mcp_problem="standalone MCP server(s) still enabled after being switched off: $(printf '%s' "$verify_left" | tr '\n' ' ')" ;;
          esac
        fi
      fi
      # A plain `if`: as the last statement of this branch, a `&&` list
      # whose test fails would return 1 out of common_env_checks and
      # end the script under `set -e`.
      if [ -n "$mcp_problem" ]; then
        mcp_disable_args=()
      fi
    fi
  else
    # Empty output is NOT an empty config. Verified on 0.146.0: a config with
    # no servers prints `[]`, three bytes, not nothing. So a `mcp list` that
    # exits 0 having printed nothing has failed to enumerate — a wrapper that
    # swallowed the output, a build that writes elsewhere — and reading it as
    # "no servers" is the one fail-open this whole block exists to avoid. The
    # re-check below has always been strict here; the first listing has the
    # same blind spot and no better excuse.
    case "$mcp_out" in
      '[]'|'{}') : ;;             # empty config: nothing to disclose
      *'"enabled"'*)
        # Recognized shape, nothing enabled *in the part that arrived*. That
        # last clause is the whole point: a listing cut off after a complete
        # DISABLED entry — `[{"name":"off","enabled":false},` — contains
        # `"enabled"`, matches this arm, and says nothing at all about the
        # servers in the suffix that never printed. The grep above cannot
        # catch it either, since it looks for `true`. Only the balance check
        # can, so run the parser here too and refuse on `!`.
        case "$(mcp_enabled_ids <<< "$mcp_out")" in
          *'!'*)
            mcp_problem="the standalone MCP listing is incomplete, so its enabled servers cannot be identified" ;;
        esac ;;
      *)
        mcp_problem="could not verify standalone MCP exposure (unrecognized 'codex mcp list --json' output)" ;;
    esac
  fi

  # Explicitly asking for MCP access means keeping it: drop the
  # overrides so the servers stay reachable, and say so.
  if [ "$allow_mcp" -eq 1 ] && [ "${#mcp_disable_args[@]}" -gt 0 ]; then
    mcp_disable_args=()
    echo "warning: leaving ${mcp_count} enabled standalone MCP server(s) reachable because --allow-mcp was set" >&2
    echo "warning: local commands stay read-only, but MCP tools may mutate external systems" >&2
  elif [ "${#mcp_disable_args[@]}" -gt 0 ]; then
    echo "note: disabled ${mcp_count} enabled standalone MCP server(s) for this ${run_noun}; pass --allow-mcp to keep them" >&2
  fi

  if [ -n "$mcp_problem" ]; then
    if [ "$allow_mcp" -eq 1 ]; then
      echo "warning: ${mcp_problem}; proceeding because --allow-mcp was set" >&2
      echo "warning: local commands stay read-only, but MCP tools may mutate external systems" >&2
    else
      echo "error: ${mcp_problem}." >&2
      echo "error: refusing to start because MCP tools may mutate external systems." >&2
      echo "hint: disable those servers, or use --allow-mcp only after the user explicitly accepts that risk." >&2
      exit 3
    fi
  fi
}

# Resolve where this run may write, and refuse the placements that would
# put those writes inside the repository under review. Split out of
# common_setup_scratch and called EARLIER, because the empty-scope
# prechecks need somewhere outside the repo to keep a throwaway index.
#
# Place the output and log outside the repo: a file written inside it
# gets picked up by Codex's own file sweeps and pollutes the result. A
# relative or repo-local TMPDIR would quietly break that invariant, so
# resolve it and fall back to /tmp when it lands inside the worktree.
common_resolve_scratch() {
  scratch="${TMPDIR:-/tmp}"
  scratch="$(cd "$scratch" 2>/dev/null && pwd -P)" || scratch="/tmp"
  # Three roots, not one. In a linked worktree the administrative git
  # directory lives under the MAIN repository's .git/worktrees/<name>, well
  # outside `--show-toplevel`, and the common dir is elsewhere again — so a
  # path checked against the worktree root alone can still sit inside the
  # repository's own storage. All three are repository paths and none of them
  # is a place for this run's scratch files or codex's sessions.
  local worktree_root p resolved
  repo_paths=()
  worktree_root="$(git rev-parse --show-toplevel)"
  worktree_root="$(cd "$worktree_root" && pwd -P)"
  repo_paths+=("$worktree_root")
  # Every worktree root, not only this one. A linked worktree shares its
  # object store with the main checkout and any siblings, so a CODEX_HOME or
  # TMPDIR under one of those is inside the repository on any reading that
  # matters — and it is outside both the current root and the git directories.
  local wt
  while IFS= read -r wt; do
    [ -n "$wt" ] || continue
    resolved="$(cd -- "$wt" 2>/dev/null && pwd -P)" || continue
    repo_paths+=("$resolved")
  done <<< "$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10)}')"
  for p in "$(git rev-parse --absolute-git-dir 2>/dev/null || true)" \
           "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"; do
    [ -n "$p" ] || continue
    resolved="$(cd "$p" 2>/dev/null && pwd -P)" || continue
    repo_paths+=("$resolved")
  done


  # Codex persists every run's session under CODEX_HOME/sessions. Inside the
  # worktree that write lands in the very tree being read: it dirties git
  # status, and Codex's own file sweeps pick the session files up, so a
  # previous run's prompt and answer become input to this one. Unlike the
  # scratch files there is nothing to substitute — relocating CODEX_HOME
  # orphans every earlier session and breaks --continue — so the only
  # honest options are to refuse or to break the read-only claim, and the
  # repo-local TMPDIR case a few lines up already settles which of those
  # this script picks. The caller's remedy is one variable.
  #
  # Resolved through the nearest EXISTING ancestor: codex creates
  # CODEX_HOME on first use, so a directory that does not exist yet is
  # about to, exactly where its parent says.
  local codex_home probe parent resolved_home=""
  codex_home="${CODEX_HOME:-${HOME:-}/.codex}"
  case "$codex_home" in
    /*) probe="$codex_home" ;;
    # A relative CODEX_HOME resolves against the current directory, which is
    # the repository — inside it by construction.
    *)  probe="${PWD}/${codex_home}" ;;
  esac
  # Collapse `.` and `..` textually FIRST. The ancestor walk below stops at
  # the nearest directory that exists, and `..` after a component that does
  # not exist yet sends it somewhere the finished path will never be:
  # `/tmp/new/../../repo/home` with no `/tmp/new` walks up to `/tmp` and is
  # approved, while mkdir -p lands it in `repo`. Lexical collapse is not
  # symlink-aware, which is why both it and the resolved ancestor are checked
  # below — either landing inside the repository is a refusal.
  probe="$(lexical_path "$probe")"
  while [ -n "$probe" ] && [ ! -d "$probe" ]; do
    parent="${probe%/*}"
    [ "$parent" = "$probe" ] && parent=""
    probe="$parent"
  done
  [ -n "$probe" ] && resolved_home="$(cd -- "$probe" 2>/dev/null && pwd -P)"
  # `sessions` is the child codex actually writes, and a symlink there points
  # somewhere the parent does not: an outside CODEX_HOME whose sessions link
  # into the repository writes into it just the same. Resolved with pwd -P,
  # which follows the link.
  local resolved_sessions=""
  resolved_sessions="$(cd -- "${probe}/sessions" 2>/dev/null && pwd -P)" || resolved_sessions=""

  if { [ -n "$resolved_home" ] && inside_repo "$resolved_home"; } \
     || { [ -n "$resolved_sessions" ] && inside_repo "$resolved_sessions"; } \
     || inside_repo "$probe"; then
    echo "error: CODEX_HOME (${codex_home}) resolves inside ${worktree_root} or its git storage." >&2
    echo "error: codex writes every session under CODEX_HOME/sessions, so this ${run_noun} would write the repository it is reading; refusing to start." >&2
    echo "hint: point CODEX_HOME outside the repository for this run." >&2
    exit 3
  fi
  if inside_repo "$scratch"; then
    echo "warning: TMPDIR is inside the repo; using /tmp instead" >&2
    scratch="/tmp"
    # Recheck the fallback: on a repo rooted at (or above) the real
    # /tmp — /private/tmp on macOS — the substitute is just as unsafe,
    # and there is nowhere non-repo left to write.
    scratch="$(cd "$scratch" 2>/dev/null && pwd -P)" || scratch=""
    if [ -z "$scratch" ] || inside_repo "$scratch"; then
      echo "error: no temporary directory outside the repo; set TMPDIR elsewhere" >&2
      exit 3
    fi
    # Move TMPDIR itself, not just this script's own files: bash puts
    # here-string temporaries there, mktemp defaults to it, and so does codex.
    # Relocating `scratch` alone would leave every one of those writing into
    # the repository.
    export TMPDIR="$scratch"
  fi

  # Same reason as the repository path: `log:` and `report:`/`answer:` print
  # this path, and a line break in it forges a later standalone marker than
  # the wrapper's own — the one callers are told to trust.
  local lf=$'\n' cr=$'\r'
  case "$scratch" in
    *"$lf"*|*"$cr"*)
      echo "error: the temporary directory path contains a line break, which would forge marker lines in this script's output" >&2
      echo "hint: set TMPDIR to a path without one." >&2
      exit 3 ;;
  esac
}

# Run a git command that would otherwise refresh — and therefore rewrite —
# the repository's index.
#
# The empty-scope prechecks run before any sandbox exists, so they are the
# one place this wrapper itself could write the tree it promises only to
# read. `git status` is fixed by --no-optional-locks; `git diff` against the
# working tree is not, with or without that flag (measured). Pointing
# GIT_INDEX_FILE at a byte copy keeps the answer identical — same index
# content, same diff — while the refresh lands on the copy, which is then
# discarded. There is no fallback to the plain command: see below for why
# running it unprotected would buy nothing but a rewritten index. A
# repository with no index at all is different, and runs as-is: there is
# nothing there to protect.
git_readonly_index() {
  local real copy status=0
  real="$(git rev-parse --git-path index 2>/dev/null)" || real=""
  if [ -z "$real" ] || [ ! -f "$real" ] || [ -z "${scratch:-}" ]; then
    "$@" || status=$?
    return "$status"
  fi
  copy="$(mktemp "${scratch}/codex-idx-XXXXXX" 2>/dev/null)" || copy=""
  if [ -z "$copy" ] || ! cat "$real" > "$copy" 2>/dev/null; then
    [ -n "$copy" ] && rm -f "$copy"
    # No fallback to the plain command. A scratch directory that cannot hold
    # one copied index cannot hold the result file either, so common_setup_
    # scratch is about to exit 3 regardless — running unprotected here buys
    # no successful run at all, only a rewritten .git/index on the way out.
    echo "error: cannot create the throwaway index under ${scratch}" >&2
    echo "error: refusing to run a working-tree git command that would rewrite ${real}" >&2
    exit 3
  fi
  GIT_INDEX_FILE="$copy" "$@" || status=$?
  rm -f "$copy"
  return "$status"
}

# Create the result and log files. Split from common_resolve_scratch so the
# prechecks can use $scratch without a `log:` line being printed for a run
# that is about to exit 2 on an empty scope.
common_setup_scratch() {
  # Guarded: under set -e a bare failing substitution would exit with
  # mktemp's own status, not the documented environment exit 3.
  out="$(mktemp "${scratch}/codex-${mode}-XXXXXX")" || {
    echo "error: cannot create scratch files under ${scratch}" >&2; exit 3; }
  log="$(mktemp "${scratch}/codex-${mode}-log-XXXXXX")" || {
    echo "error: cannot create scratch files under ${scratch}" >&2; exit 3; }

  # Announce up front, not just on failure: a caller watching a long
  # run needs somewhere to look while it is still going.
  echo "log: ${log}" >&2
}

# Append the flags every invocation must carry, mode-independent.
append_safety_args() {
  # The config override, not `-s`: `exec review` and `exec resume` have
  # no sandbox flag, and sandbox_mode is the key `-s` sets anyway — one
  # spelling keeps every path verifiably identical.
  cmd+=(-c 'sandbox_mode="read-only"')
  # apps and plugins ride outside the shell sandbox just like hooks —
  # a plugin can bundle write-capable connectors and MCP tools — so
  # all three are disabled on every invocation, matching the
  # fail-closed verification at startup.
  cmd+=(--disable hooks --disable apps --disable plugins)
  # The legacy `notify = [...]` callback lives in the hooks crate but is
  # a plain config key, not feature-gated: --disable hooks leaves it
  # registered, and it runs outside the sandbox. Unlike features, plain
  # keys have no managed-policy override and no inspection command, so
  # the -c layer — the highest-precedence config source — is both the
  # fix and the guarantee.
  cmd+=(-c 'notify=[]')
  # Without this, an unknown `-c` key is silently ignored — verified on
  # 0.146.0, where only --strict-config turns it into an error. That is
  # the one drift this script cannot otherwise detect: if a later codex
  # renames or moves `sandbox_mode` or `notify`, the two lines above stop
  # taking effect and the run keeps going with no sandbox and a live
  # notify callback. Every other dependency here already fails closed
  # (features/mcp verification, model rejection, session mismatch); this
  # makes the config layer fail closed too. It also rejects unknown
  # fields in the user's own config.toml — same error, different cause,
  # which is why the failure path names both.
  cmd+=(--strict-config)
  # One `-c mcp_servers.<id>.enabled=false` per enabled standalone MCP
  # server, so the exposure is removed for this invocation instead of
  # merely refused. Length-guarded: expanding an empty array under
  # `set -u` is an unbound-variable error on the bash 3.2 that macOS
  # ships.
  [ "${#mcp_disable_args[@]}" -gt 0 ] && cmd+=("${mcp_disable_args[@]}")
  # --json is for progress bounding, not for parsing: it turns the run
  # into one line per event. The default human stream instead echoes the
  # full output of every command Codex runs (entire diffs, entire ls
  # listings), which can reach thousands of lines and blow up the
  # context of whoever reads it. The result still comes from -o.
  cmd+=(--json)
  [ -n "$1" ] && cmd+=(-m "$1")
  [ -n "$2" ] && cmd+=(-c "model_reasoning_effort=\"${2}\"")
  cmd+=(-o "$out")
}

# Run the prepared `cmd` array with `diag` as the redacted announcement.
# Returns codex's exit status, or 124 on timeout.
execute_codex() {
  # The diagnostic was rendered before the prompt/question was appended
  # and never includes its body: a multiline value would otherwise break
  # out of this line and forge standalone progress markers in the
  # stderr feed. The tr pass keeps the line physical-single even if
  # some other argument ever carries a newline.
  diag="$(printf '%s' "$diag" | tr '\r\n' '  ')"
  echo "$diag" >&2

  # Each attempt's stream is fenced in the log. The stale-model fallback
  # appends a second run to the same file, so "the last thread.started" can
  # belong to the attempt that FAILED — and a retry that answers without
  # emitting one would then advertise the dead session as resumable.
  attempt_marker="=== codex-second-opinion attempt boundary ==="
  local status watchdog="" statedir pidfile marker
  # A private 0700 directory from mktemp -d: the marker must not be a
  # path another local process can pre-create as a symlink in a shared
  # /tmp, which would both forge a timeout and truncate whatever it
  # points at.
  statedir="$(mktemp -d "${scratch}/codex-${mode}-state-XXXXXX")" || {
    echo "error: cannot create scratch files under ${scratch}" >&2; exit 3; }
  current_statedir="$statedir"
  pidfile="${statedir}/pgid"
  marker="${statedir}/timed-out"

  # A hung run would otherwise wait forever. The progress feed only
  # lets a caller *notice* that; this is what stops it. There is no
  # portable `timeout` binary here — macOS ships none.
  if [ "$timeout_secs" -gt 0 ]; then
    (
      # Sleep as a job so the TERM below can reap it. Killing this
      # subshell alone would orphan the sleeper, leaking one per
      # successful run until its original deadline expired.
      sleep "$timeout_secs" &
      sleeper=$!
      trap 'kill "$sleeper" 2>/dev/null; exit 0' TERM
      wait "$sleeper" 2>/dev/null || exit 0

      pgid="$(cat "$pidfile" 2>/dev/null || true)"
      if [ -n "$pgid" ] && kill -0 "-${pgid}" 2>/dev/null; then
        : > "$marker"
        # Signal the whole process group, not just codex. Codex spawns
        # shell commands that inherit the pipeline's stdout; killing
        # only the parent leaves them holding it open, so the script
        # would hang forever on a timeout that was supposed to end it.
        kill -TERM "-${pgid}" 2>/dev/null || true
        for _ in 1 2 3 4 5 6 7 8 9 10; do
          kill -0 "-${pgid}" 2>/dev/null || break
          sleep 1
        done
        # Unconditional: whether or not the group looks gone, a
        # survivor here is exactly the case this backstop exists for.
        kill -KILL "-${pgid}" 2>/dev/null || true
      fi
    ) &
    watchdog=$!
    # Published so the signal traps can reap the watchdog too: when a
    # supervisor signals only the wrapper PID, the watchdog would
    # otherwise sleep on harmlessly for up to the full timeout.
    current_watchdog="$watchdog"
  fi

  # Stream a bounded progress feed to stderr, archive the full stream to
  # the log. Runs take many minutes; without a live feed there is no way
  # to tell a working run from a hung one. stdout stays clean for the
  # result.
  # The pipeline runs in the background and is awaited, rather than run
  # in the foreground: bash defers traps until the current foreground
  # command finishes, so a foreground pipeline would swallow a cancel
  # signal for the entire length of the run — exactly when it needs to
  # be honoured. `wait` is interruptible, so the traps fire at once.
  # codex's status travels through a file because PIPESTATUS is not
  # available for a backgrounded pipeline.
  {
    # `set -m` puts codex in its own process group (pgid == pid), which
    # is what makes the group-wide kill above possible without setsid.
    set -m
    "${cmd[@]}" 2>&1 &
    echo $! > "$pidfile"
    set +m
    codex_status=0
    wait $! || codex_status=$?
    echo "$codex_status" > "${statedir}/status"
  } | { printf '%s\n' "$attempt_marker"; cat; } | tee -a "$log" | truncate_stream >&2 &
  local pipeline_pid=$!
  wait "$pipeline_pid" 2>/dev/null || true
  status="$(cat "${statedir}/status" 2>/dev/null || echo 1)"

  if [ -n "$watchdog" ]; then
    if [ -f "$marker" ]; then
      # Escalation is already under way. The pipeline can return during
      # the grace period — a group member that ignores TERM may have
      # closed the pipe without dying — so stopping the watchdog here
      # would cancel the KILL and leave that process running behind an
      # exit 5. Let it finish instead.
      wait "$watchdog" 2>/dev/null || true
    else
      kill -TERM "$watchdog" 2>/dev/null || true
      wait "$watchdog" 2>/dev/null || true
    fi
  fi

  # The timeout travels through a dedicated flag, not an overloaded
  # return code: codex itself (or a CODEX_BIN wrapper) can exit 124
  # without any watchdog involvement, and that must surface as a
  # failed run (exit 4), not a fabricated timeout (exit 5).
  watchdog_fired=0
  [ -f "$marker" ] && watchdog_fired=1
  rm -rf "$statedir"
  current_statedir=""
  current_watchdog=""
  return "$status"
}

# Set while a run is in flight, so the signal traps can find the codex
# process group and the watchdog. Cleared once they are gone.
current_statedir=""
current_watchdog=""
watchdog_fired=0

# `set -m` runs codex in its own process group, which means a signal
# aimed at this script's group — how task runners and Ctrl-C cancel
# things — never reaches it. Without forwarding, a cancelled run keeps
# going, burning tokens with nobody left to read the result.
forward_termination() {
  local pgid="" attempt
  # The pgid is published by the background pipeline moments after the
  # run starts; a signal landing in that window would otherwise find
  # the file missing and leave the just-launched group running. A
  # bounded re-read covers the gap.
  for attempt in 1 2 3 4 5; do
    [ -n "$current_statedir" ] || break
    pgid="$(cat "${current_statedir}/pgid" 2>/dev/null || true)"
    [ -n "$pgid" ] && break
    sleep 0.2
  done

  if [ -n "$pgid" ] && kill -0 "-${pgid}" 2>/dev/null; then
    kill -TERM "-${pgid}" 2>/dev/null || true
    sleep 2
    kill -KILL "-${pgid}" 2>/dev/null || true
  fi
  # Reap the watchdog too — its own TERM trap kills the sleeper — so a
  # PID-targeted cancel does not leave a subshell sleeping for up to
  # the full timeout.
  if [ -n "$current_watchdog" ]; then
    kill -TERM "$current_watchdog" 2>/dev/null || true
    wait "$current_watchdog" 2>/dev/null || true
    current_watchdog=""
  fi
  [ -n "$current_statedir" ] && rm -rf "$current_statedir"
  current_statedir=""
}
trap 'forward_termination; exit 130' INT
trap 'forward_termination; exit 143' TERM
trap 'forward_termination; exit 129' HUP
trap 'forward_termination' EXIT

# Truncate each line and emit it immediately. A `while read` loop is
# line-buffered by construction; awk block-buffers when its stdout is
# not a TTY, which is exactly the background case where a live progress
# feed is the only way to tell a working run from a hung one — there,
# a whole short run can finish before the first byte appears.
truncate_stream() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "${#line}" -gt 180 ]; then
      printf '%s...\n' "${line:0:180}"
    else
      printf '%s\n' "$line"
    fi
  done
}

# Show the tail of the log without dumping raw event JSON, whose single
# lines can carry tens of KB of captured command output.
tail_log() {
  tail -n 20 "$log" | truncate_stream >&2
}

# Model/effort rejection detection is split from retry eligibility:
# a rejection on a resumed session must trigger the contamination
# warning whether the settings were pinned or explicit, while the
# automatic fallback retry stays reserved for the pinned defaults.
#
# The match is deliberately loose, and not anchored to an error line:
# Codex formats these 400s differently across modes. A false positive
# costs one extra run; a false negative costs the whole result.
rejected_model() {
  grep -qE "reasoning\.effort|is not supported|unsupported_value|unknown model|model_not_found" "$log" 2>/dev/null
}

defaults_rejected() {
  [ "$pinned" -eq 1 ] || return 1
  rejected_model
}

# A --strict-config rejection has two very different causes and the same
# error text, so never let it be read as a generic codex failure: either
# this script's safety keys no longer match the installed codex — in
# which case the read-only guarantee is what broke — or the user's own
# config.toml carries a field this version does not know. Silence when
# the log shows neither.
strict_config_hint() {
  grep -q 'unknown configuration field' "$log" 2>/dev/null || return 0
  echo "hint: codex rejected an unrecognized configuration field. --strict-config is deliberate: it stops a renamed config key from silently disabling the read-only sandbox." >&2
  echo "hint: the error line names the field. A key this script sets — sandbox_mode, notify, model_reasoning_effort, or an mcp_servers.<id>.enabled override — means the codex CLI drifted and the safety keys need updating; any other field is your own config.toml." >&2
}

# Timing out is not a stale-model symptom, so it must not trigger the
# fallback retry — that would double an already too-long wait. It also
# has to be recognised on the retry, not just the first attempt.
exit_timed_out() {
  echo "error: ${run_noun} exceeded ${timeout_secs}s and was terminated" >&2
  echo "hint: raise --timeout, or check the log for where it stalled: ${log}" >&2
  tail_log
  rm -f "$out"
  exit 5
}

# Default: never block the stale-default retry. consult.bash overrides
# this to protect resumed sessions from duplicate questions.
mode_block_retry() {
  return 1
}

# Run once via the mode's build_cmd, retrying once on the user's config
# when the pinned defaults are rejected. Leaves a successful result in
# $out or exits with the documented code.
# Best-effort name of the model a fallback or --inherit run actually
# used, extracted from the event stream. Empty when the stream carries
# no model field. Always returns success: a missing field makes grep
# exit 1, and under set -e a failing substitution in the caller would
# otherwise abort the script *after* a successful run.
effective_model_from_log() {
  # The LAST attempt's segment only, for the same reason the session id reads
  # one: the log accumulates across the stale-model fallback, so a rejected
  # attempt that named a model and a retry that did not would label the answer
  # with the model that refused it.
  awk -v m="$attempt_marker" '$0 == m { buf = "" ; next } { buf = buf $0 "\n" } END { printf "%s", buf }' "$log" 2>/dev/null |
    grep -oE '"model"[[:space:]]*:[[:space:]]*"[^"]*"' |
    tail -1 | sed 's/.*"model"[[:space:]]*:[[:space:]]*"//; s/"$//' || true
}

run_with_fallback() {
  local status=0
  build_cmd "$model" "$effort"
  execute_codex || status=$?

  [ "$watchdog_fired" -eq 1 ] && exit_timed_out

  if [ "$status" -ne 0 ]; then
    if rejected_model && mode_block_retry; then
      strict_config_hint
      tail_log
      rm -f "$out"
      exit 4
    fi
    if defaults_rejected; then
      echo "warning: '${model}' at effort '${effort}' was rejected — these pinned defaults look stale." >&2
      echo "warning: retrying once with the model and effort from your codex config." >&2
      local retry_status=0
      # Truncated before the RETRY, and only there. `$out` starts life as a
      # fresh mktemp, so the first attempt cannot inherit anything — but a
      # rejected first invocation can already have written `-o`, and a retry
      # that exits 0 without writing one would then be served that stale
      # answer by the `[ ! -s "$out" ]` check below: a result from the model
      # that was refused, reported as the fallback's.
      : > "$out"
      build_cmd "" ""
      execute_codex || retry_status=$?
      [ "$watchdog_fired" -eq 1 ] && exit_timed_out
      if [ "$retry_status" -eq 0 ]; then
        used_fallback=1
        local fallback_model
        fallback_model="$(effective_model_from_log)"
        echo "note: the ${result_noun} below came from your configured model${fallback_model:+ (${fallback_model})}, not '${model}'." >&2
      else
        echo "error: codex ${run_noun} failed on both the pinned defaults and your config; raw output at ${log}" >&2
        strict_config_hint
        tail_log
        rm -f "$out"
        exit 4
      fi
    else
      echo "error: codex ${run_noun} failed; raw output at ${log}" >&2
      strict_config_hint
      tail_log
      rm -f "$out"
      exit 4
    fi
  fi

  if [ ! -s "$out" ]; then
    echo "error: codex produced no ${result_noun}; raw output at ${log}" >&2
    tail_log
    exit 4
  fi

  # The log was announced at startup and downstream steps (consult's
  # session id, diagnostics) read it; a missing or empty log after a
  # successful run means the tee leg of the pipeline failed. The
  # result above is still valid — say what was lost instead of failing.
  if [ ! -s "$log" ]; then
    echo "warning: progress log ${log} is missing or empty; session and diagnostic details may be lost" >&2
  fi

  # Reproducibility: when the run inherited the user's config
  # (--inherit), name the model that actually answered if the stream
  # exposed it. Explicit if: a `[ -n ] &&` as the function's last
  # statement would return 1 on an absent field and abort under set -e.
  if [ -z "$model" ]; then
    local inherited_model
    inherited_model="$(effective_model_from_log)"
    if [ -n "$inherited_model" ]; then
      echo "note: inherited model in effect: ${inherited_model}" >&2
    else
      # Say so rather than staying silent. Both modes owe the reader the
      # model that answered, and silence here is indistinguishable from a
      # caller who forgot to look — leaving them to state a model nobody
      # confirmed. "Inherited, and the stream did not name it" is the true
      # answer, and it is one a report can actually carry.
      echo "note: the model was inherited from your codex config; the event stream did not name it, so report it as inherited rather than naming a tier" >&2
    fi
  fi
}

# Print the result to stdout with the marker contract intact.
emit_result() {
  cat "$out"
  # A result without a final newline would glue the marker onto its
  # last line when a caller merges the streams (2>&1), breaking the
  # marker's own-line contract. `tail -c 1` substitution is empty
  # exactly when the last byte is a newline.
  [ -z "$(tail -c 1 "$out")" ] || echo
  # Both files are left in place: the log path was announced at
  # startup, so deleting it here would break a promise the caller may
  # still be holding. TMPDIR cleanup is the system's job.
  echo "${result_noun}: ${out}" >&2
}
