# Provider: agy

Google's Antigravity CLI (`agy`), run headlessly in print mode. It is the
command-line client of Google Antigravity and shares its state under
`~/.gemini`. Not the Gemini CLI (`gemini`), a separate tool. Not for use from
inside any Antigravity host, CLI or app.

## Prerequisites and binary

An `agy` that is already signed in; a signed-out one fails the run with exit
`4` and its own message in the log tail. The wrapper finds `agy` on the
absolute entries of `PATH`, or uses `AGY_BIN` (an absolute path to an
executable file), and prints `note: using agy binary: <path>` first. A
wrapper script on `PATH` (for example one that sets a proxy) is used as is. A
binary inside the repository under review is refused. If it is not found, see
running.md § Exit Codes; never hand-roll `agy -p` instead.

## Permissions

Every mode runs with `--dangerously-skip-permissions`: no one is there to
approve a tool call, so a review or consult can build, test and reach the
network like the user's own shell. `--disable-slash-commands` keeps a prompt
starting with `/` from running a command or skill. Review and consult carry
the shared note asking the peer not to modify the repository or git state.

agy has no switch for its hooks, plugins, skills, MCP servers, global rules
(`~/.gemini/GEMINI.md`) or cross-session memories, so every mode runs in the
user's normal agy setup, the repository's `AGENTS.md` included. The prompt
stays blind, but agy's own memories can carry context from earlier sessions.

A review is a prompt: agy has no review command, so the wrapper sends the
scope as prose plus the `[P<n>]` report shape that review.md reads. The
conversation it leaves in agy's history is not advertised for resuming.

## Model

The wrapper pins `gemini-4-hydrogen` at effort `high`. Override it for one
run with an explicit `--model M --effort L` pair, or for every run with
`PEER_AGY_MODEL` and `PEER_AGY_EFFORT` set together. Pass model flags only
when the user asked for a model. `agy models` lists the ids this login can
use; an id ending in `-low`, `-medium`, `-high` or `-xhigh` is the model plus an effort,
so pass the bare id with `--effort`. A `resume:` line carries the pair that
answered; `model:` names the model agy reported, without the effort.

An unknown model, or an effort the model lacks (Hydrogen has `low` through
`xhigh`, no `max`), fails before any work with exit `4` and a hint naming
where the pair came from. No fallback is attempted.

## Sessions

A follow-up passes `--conversation <id>`. For an id it does not know, agy
starts a new conversation instead of failing; the wrapper sees the different
id and exits `4` rather than pass the answer off as a follow-up.

## Failures

Only a result event with status `SUCCESS`, no `finished_reason` and a
non-empty response counts as an answer. No failure is retried: agy's
transient errors are not yet known. `agy` exits non-zero for any failure;
read the `error:`/`hint:` lines and the log tail.
