# Shared runtime for run-codex-second-opinion. Sourced, not executed.
#
# Everything here is mode-agnostic and safety-critical: read-only
# enforcement, hook fail-closed verification, scratch placement, the
# watchdog, process-group termination, bounded progress, and the
# stale-default fallback. Mode files (review.bash, consult.bash) build
# the codex command and interpret its result; nothing in them may relax
# what this file enforces.
#
# Mode files must set before use:
#   run_noun     what a run is called in messages ("review"/"consultation")
#   result_noun  what the output is called ("report"/"answer")
#
# Mode files may override:
#   mode_block_retry  return 0 to suppress the stale-default retry
#                     (printing its own explanation first)

# A second opinion is only worth having from the strongest tier, so
# these pin it rather than inheriting whatever the user last
# configured. Verified against codex-cli 0.146.0 on 2026-07-31; if the
# slug goes stale the script falls back to the user's config (see
# defaults_rejected below). `ultra` is deliberately not used: it
# delegates subtasks, which is not what a second opinion wants.
default_model="${CODEX_SECOND_OPINION_MODEL:-gpt-5.6-sol}"
default_effort="${CODEX_SECOND_OPINION_EFFORT:-xhigh}"

model="$default_model"
effort="$default_effort"
pinned=1
repo="."

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
  # read-only. --disable hooks (passed to every invocation) asks for
  # them off; this verifies the *effective* state, because managed
  # policy can force a feature back on. Fail closed: an unparseable or
  # missing answer is treated the same as "enabled".
  local hooks_state
  hooks_state="$("$codex_bin" features list --disable hooks 2>/dev/null |
    awk '$1 == "hooks" { state = $NF } END { print state }')" || hooks_state=""
  if [ "$hooks_state" != "false" ]; then
    echo "error: codex command hooks stay enabled (effective state: '${hooks_state:-unknown}')." >&2
    echo "error: hooks run outside the read-only sandbox, so this ${run_noun} could write; refusing to start." >&2
    exit 3
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
  fi

  out="$(mktemp "${scratch}/codex-${mode}-XXXXXX")"
  log="$(mktemp "${scratch}/codex-${mode}-log-XXXXXX")"

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
  cmd+=(--disable hooks)
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
  statedir="$(mktemp -d "${scratch}/codex-${mode}-state-XXXXXX")"
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

  local timed_out=1
  [ -f "$marker" ] || timed_out=0
  rm -rf "$statedir"
  current_statedir=""
  [ "$timed_out" -eq 1 ] && return 124
  return "$status"
}

# Set while a run is in flight, so the signal traps can find the codex
# process group. Cleared once that group is gone.
current_statedir=""

# `set -m` runs codex in its own process group, which means a signal
# aimed at this script's group — how task runners and Ctrl-C cancel
# things — never reaches it. Without forwarding, a cancelled run keeps
# going, burning tokens with nobody left to read the result.
forward_termination() {
  local pgid=""
  [ -n "$current_statedir" ] && [ -f "${current_statedir}/pgid" ] &&
    pgid="$(cat "${current_statedir}/pgid" 2>/dev/null || true)"

  if [ -n "$pgid" ] && kill -0 "-${pgid}" 2>/dev/null; then
    kill -TERM "-${pgid}" 2>/dev/null || true
    sleep 2
    kill -KILL "-${pgid}" 2>/dev/null || true
  fi
  [ -n "$current_statedir" ] && rm -rf "$current_statedir"
  current_statedir=""
}
trap 'forward_termination; exit 130' INT
trap 'forward_termination; exit 143' TERM
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

# A rejected model or effort means the pinned defaults have gone stale,
# not that the run is impossible. Fall back to the user's configured
# model once rather than failing a minute in.
#
# The match is deliberately loose, and not anchored to an error line:
# Codex formats these 400s differently across modes. A false positive
# costs one extra run; a false negative costs the whole result.
defaults_rejected() {
  [ "$pinned" -eq 1 ] || return 1
  grep -qE "reasoning\.effort|is not supported|unsupported_value|unknown model|model_not_found" "$log" 2>/dev/null
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
run_with_fallback() {
  local status=0
  build_cmd "$model" "$effort"
  execute_codex || status=$?

  [ "$status" -eq 124 ] && exit_timed_out

  if [ "$status" -ne 0 ]; then
    if defaults_rejected && mode_block_retry; then
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
      [ "$retry_status" -eq 124 ] && exit_timed_out
      if [ "$retry_status" -eq 0 ]; then
        echo "note: the ${result_noun} below came from your configured model, not '${model}'." >&2
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
