# Provider: command-code

The Command Code CLI, `cmd`. Not for use from inside Command Code itself, which
has its own `/review`. Its conclusions depend on the model configured in `cmd`
and can be wrong: check its claims, including "I ran it and it returned X" —
the `log:` file holds what each command actually returned.

## Prerequisites and binary

An authenticated `cmd` (`cmd login`). The wrapper finds `cmd` on the absolute
entries of `PATH`, or uses `COMMAND_CODE_BIN` (an absolute path to an executable
file), and prints `note: using cmd binary: <path>` first. A binary inside the
repository under review is refused.

## Permissions

Every run passes `--yolo`, so the peer can investigate: run tests, read git
history, try a reproduction script. Review and consult add a prompt note asking
it to stay read-only and giving it a scratch directory outside the repository.
That request is **not a sandbox** — the run has the user's own shell.

- The reviewed project's `AGENTS.md`, the user's `~/.commandcode/AGENTS.md` and
  any configured MCP servers load into the run. Review and consult pass
  `--no-skills`, so the repository's own skills stay out; a task loads them.
- The `identity:` fingerprint, before and after, is how a read-only run's writes
  get noticed. An unflagged identity means the reviewed change did not shift,
  not that nothing outside it was touched.

## Cost and turns

Because it can investigate, the cost follows the repository: a toy change takes
about fifteen seconds and 30k input tokens, while reviewing a real commit has
taken four to five minutes, a dozen to twenty tool calls and 0.5–1.7M input
tokens, mostly cache reads. Every run is capped at `--max-turns` (default 200);
a capped run still exits `0` but prints a truncation `warning:` — treat that
result as partial. A `usage:` line reports the tokens.

## Model

Without `--model`, the run uses the model configured in `cmd`. Pass `--model`
only when the user names one. `--effort` is rarely needed: pass it only when
asked, because the CLI stores it as that model's default in the user's config.
Levels vary by model and are not listed anywhere; a bad value fails with exit
`4`, `provider-exit: 1` and the CLI's own reason. A `resume:` line always
carries the model that answered, because a session does not remember it.

## Worktree tasks

`task --worktree` lets the CLI create a fresh git worktree on a new branch. Its
path arrives only at the end of the run, as `workdir:`, and the session lives
there: the `resume:` line points into it. A run cut short before reporting it
prints `workdir: unavailable` and no runnable resume — find it with
`git worktree list` and resume from inside it. Nothing removes a worktree
automatically.

## provider-exit

A failed run exits `4` and prints the CLI's own code as `provider-exit:`:

| Code | Meaning | Remedy |
|---|---|---|
| `1` | The CLI rejected the invocation: unknown model or effort, a missing resume session | Fix the arguments; do not rerun unchanged. |
| `3` | Not authenticated | The user runs `cmd login`. |
| `4` | A tool was refused by the permission engine | Check `~/.commandcode/settings.json` for a deny rule. |
| `5` / `10` | Rate limited / out of credits | Wait, or use a model the account can run. |
| `6` / `7` | Network / API server failure | Rerunning unchanged is reasonable. |
| `9` | No response from the model | Report it. |
| `127` | `cmd` could not be started | Check the `note:` line and `COMMAND_CODE_BIN`. |
