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
default_model="${CODEX_SECOND_OPINION_MODEL:-gpt-5.6-sol}"
default_effort="${CODEX_SECOND_OPINION_EFFORT:-xhigh}"

model="$default_model"
effort="$default_effort"
pinned=1
repo="."
allow_mcp=0

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

# Generous by default: an xhigh-effort run over a large repo or diff
# legitimately takes many minutes. This is a stuck-process backstop,
# not a budget.
timeout_secs="${CODEX_SECOND_OPINION_TIMEOUT:-3000}"
# Validated here, not just at the flag: the environment is an input too.
validate_timeout "$timeout_secs" "CODEX_SECOND_OPINION_TIMEOUT"
timeout_secs="$validated_timeout"

# Enter the repo and verify the environment. Called by mode_main after
# argument parsing, before any codex invocation.
common_env_checks() {
  cd "$repo" || { echo "error: cannot enter ${repo}" >&2; exit 3; }

  # The printed value matters, not just the exit status: in a bare
  # repository this command *succeeds* and prints "false", and trusting
  # the status alone would misreport the bare repo as something later
  # stages have to untangle instead of a clear environment problem.
  local work_tree
  work_tree="$(git rev-parse --is-inside-work-tree 2>/dev/null)" || work_tree=""
  [ "$work_tree" = "true" ] || {
    echo "error: ${repo} is not a git work tree" >&2; exit 3; }

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

  # Standalone MCP servers from the user's own codex config cannot be
  # globally disabled on 0.146.0 (no --disable mcp; only per-server
  # config keys). They sit outside sandbox_mode and may mutate external
  # systems, so fail closed when any are enabled or their state cannot
  # be verified. --allow-mcp is deliberately wrapper-local: it records
  # explicit user acceptance of that separate boundary without changing
  # the local read-only sandbox.
  local mcp_out mcp_status=0 mcp_problem=""
  mcp_out="$("$codex_bin" mcp list --json \
    --disable hooks --disable apps --disable plugins 2>/dev/null)" || mcp_status=$?
  # A failed or unrecognizable listing is unsafe, never equivalent to an
  # empty config. Match only actually enabled entries: the listing also
  # includes disabled ones. A here-string, not a pipeline: grep -q exits
  # on the first match, and under pipefail the writer's SIGPIPE would
  # turn a found entry into a false pipeline status.
  if [ "$mcp_status" -ne 0 ]; then
    mcp_problem="could not verify standalone MCP exposure ('codex mcp list' failed)"
  elif grep -qE '"enabled"[[:space:]]*:[[:space:]]*true' <<< "$mcp_out"; then
    mcp_problem="enabled standalone MCP servers remain reachable outside the read-only sandbox"
  else
    case "$mcp_out" in
      ''|'[]'|'{}') : ;;          # empty config: nothing to disclose
      *'"enabled"'*) : ;;         # recognized shape, none enabled
      *)
        mcp_problem="could not verify standalone MCP exposure (unrecognized 'codex mcp list --json' output)" ;;
    esac
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

# Place the output and log outside the repo: a file written inside it
# gets picked up by Codex's own file sweeps and pollutes the result. A
# relative or repo-local TMPDIR would quietly break that invariant, so
# resolve it and fall back to /tmp when it lands inside the worktree.
common_setup_scratch() {
  scratch="${TMPDIR:-/tmp}"
  scratch="$(cd "$scratch" 2>/dev/null && pwd -P)" || scratch="/tmp"
  local worktree_root
  worktree_root="$(git rev-parse --show-toplevel)"
  worktree_root="$(cd "$worktree_root" && pwd -P)"
  if [ "$scratch" = "$worktree_root" ] || case "$scratch/" in "$worktree_root"/*) true ;; *) false ;; esac; then
    echo "warning: TMPDIR is inside the repo; using /tmp instead" >&2
    scratch="/tmp"
    # Recheck the fallback: on a repo rooted at (or above) the real
    # /tmp — /private/tmp on macOS — the substitute is just as unsafe,
    # and there is nowhere non-repo left to write.
    scratch="$(cd "$scratch" 2>/dev/null && pwd -P)" || scratch=""
    if [ -z "$scratch" ] || [ "$scratch" = "$worktree_root" ] ||
       case "$scratch/" in "$worktree_root"/*) true ;; *) false ;; esac; then
      echo "error: no temporary directory outside the repo; set TMPDIR elsewhere" >&2
      exit 3
    fi
  fi

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
  } | tee -a "$log" | truncate_stream >&2 &
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
  grep -oE '"model"[[:space:]]*:[[:space:]]*"[^"]*"' "$log" 2>/dev/null |
    tail -1 | sed 's/.*"model"[[:space:]]*:[[:space:]]*"//; s/"$//' || true
}

run_with_fallback() {
  local status=0
  build_cmd "$model" "$effort"
  execute_codex || status=$?

  [ "$watchdog_fired" -eq 1 ] && exit_timed_out

  if [ "$status" -ne 0 ]; then
    if rejected_model && mode_block_retry; then
      tail_log
      rm -f "$out"
      exit 4
    fi
    if defaults_rejected; then
      echo "warning: '${model}' at effort '${effort}' was rejected — these pinned defaults look stale." >&2
      echo "warning: retrying once with the model and effort from your codex config." >&2
      local retry_status=0
      build_cmd "" ""
      execute_codex || retry_status=$?
      [ "$watchdog_fired" -eq 1 ] && exit_timed_out
      if [ "$retry_status" -eq 0 ]; then
        local fallback_model
        fallback_model="$(effective_model_from_log)"
        echo "note: the ${result_noun} below came from your configured model${fallback_model:+ (${fallback_model})}, not '${model}'." >&2
      else
        echo "error: codex ${run_noun} failed on both the pinned defaults and your config; raw output at ${log}" >&2
        tail_log
        rm -f "$out"
        exit 4
      fi
    else
      echo "error: codex ${run_noun} failed; raw output at ${log}" >&2
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
