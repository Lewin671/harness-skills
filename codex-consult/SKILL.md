---
name: codex-consult
description: >-
  Claude Code ONLY — do not use in Codex itself. Use this skill in
  Claude Code when the user wants Codex (OpenAI models) to weigh in on
  a decision, design, plan, or open question rather than review a code
  change — phrasings like "ask codex what it thinks", "let codex
  evaluate this plan", "discuss this design with another model", "which
  option would codex pick". It runs `codex exec` read-only over the
  repository and returns a free-form reasoned answer to relay with a
  Claude-side stance; follow-ups can continue the same Codex session
  for a multi-turn discussion. For reviewing a diff, commit, or branch, use
  codex-review instead. The final decision stays with the user; do not
  use this to outsource choices the user already made, or when the
  `codex` CLI is not installed.
harnesses: [claude-code]
---

# Codex Consult

Ask OpenAI's Codex for a second opinion on a decision, design, plan,
or trade-off, from inside Claude Code. The value is model diversity: an
adviser that does not share Claude's blind spots, answering with the
repository as context.

This is the discussion counterpart to `codex-review`: that skill
produces a prioritised defect list for a code change; this one produces
a reasoned position on an open question. Changed code → `codex-review`.
Anything else — plans, architecture choices, "should we do X or Y" →
this skill.

## Usage

Run the `run-codex-consult` script that sits next to this SKILL.md —
usually `~/.claude/skills/codex-consult/run-codex-consult`.

```bash
~/.claude/skills/codex-consult/run-codex-consult --repo /path/to/repo \
  -- "Evaluate the migration plan in docs/plan.md: feasibility risks,
      missing edge cases, conflicts with the current architecture"
```

If that path does not exist, locate the script beside this file rather
than reconstructing the command by hand.

Write the question to stand alone: name the files or documents Codex
should read, state the decision criteria, and say what a useful answer
looks like (a ranked choice, a risk list, a counter-proposal). Codex
starts with zero conversation context — everything it needs must be in
the question or in the repo. If the material under discussion exists
only in the conversation, embed it in the question itself — QUESTION is
one argument but happily multiline. Do not write it into the repo: the
consultation is advertised as read-only, and a helper file left in the
working tree dirties later Git status and Codex context. If it truly
must be a file (very large, or referenced repeatedly across turns),
put it *outside* the repo — under TMPDIR, say — and give Codex its
absolute path; the read-only sandbox can still read it.

### Multi-turn discussion

Every successful run prints `session: <ID>` to stderr. To push back,
probe an argument, or ask a follow-up, pass that id with `--continue`:

```bash
run-codex-consult --repo /path/to/repo --continue <ID> \
  -- "You ranked option B last — but doesn't the schema in
      db/schema.sql make its migration cheaper than A's?"
```

Codex resumes the same session with everything it already read and
said, so follow-ups need only the new material, not a restatement.
Each follow-up prints the `session:` line again for the next turn.
This is a real discussion loop: relay each answer, gather the user's
(or your own) counterpoints, and continue until the question is
settled or the disagreement is crisply mapped.

Three rules keep the loop honest:

- **Repeat model flags on every follow-up.** They do not travel with
  the session: a follow-up without the original `--model`/`--effort`
  (or `--inherit`) switches the discussion back to the pinned
  defaults mid-conversation.
- Continuation is verified: if the session expired, the script
  discards the fresh-thread answer and exits `4` instead of passing
  it off as a follow-up. Start a new consultation and restate context.
- If the `session:` line is ever missing, the answer is still valid —
  there is just nothing to continue; the next question starts fresh.

**Always run it with `run_in_background: true`, then end the turn.**
The default adviser is the strongest model at maximum reasoning effort
and legitimately runs for minutes. Do other work or stop and wait —
the completion notification resumes the conversation the moment the
run finishes. Never `sleep`-poll: a guessed sleep usually overshoots
the actual finish time and wastes the difference.

### Is it still running, or hung?

The script streams a bounded progress feed to stderr — one truncated
line per Codex event — so the background task's output file grows in
real time and stays small:

- New `item.started` / `item.completed` lines → working; Codex is
  reading files and running commands.
- Nothing new for several minutes → likely stalled on the model side.
  It will not hang forever: `--timeout` (default 1800s, max 86400)
  kills the whole process group and exits `5`.
- `answer:` line → finished; the answer is on stdout.
- `session: <ID>` line → the id to pass with `--continue` for a
  follow-up turn.

The script also prints `log: <path>` at startup. That file holds the
same stream **untruncated**, so `tail` it for diagnostics; never read
it whole — single JSON lines can carry tens of KB.

## Model

The script defaults to the strongest available model at maximum
reasoning effort, and **you should normally leave that alone**. A
second opinion that is weaker than the first opinion is not worth the
round trip; latency is the wrong thing to optimise here.

Override only on an explicit request:

- `--model <MODEL> --effort <LEVEL>` — always pass both. A weaker model
  rejects the default `max` effort and the run dies a minute in.
- `--inherit` — use the user's own codex config instead.

If the pinned default model has gone stale, the script says so and
retries once on the user's configured model — but only on fresh runs.
A follow-up is never retried automatically: the rejected attempt may
already have recorded the question in the session, and any resend into
that session — scripted or manual — could duplicate it. Treat such a
session as contaminated and start a fresh consultation instead. Relay
the fallback warning when it fires: the answer still came, but not
from the tier it promised.

## Exit Codes

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | An answer was produced | Read stdout and relay it. |
| `3` | Environment problem | No `codex`, not a git tree, bad flags, empty question, or hooks that managed policy keeps enabled. Report it; do not silently substitute a Claude answer. |
| `4` | Codex ran and failed | Read stderr. Also covers a follow-up whose session could not actually be resumed (the un-continued answer is discarded) and a rejected model on a follow-up (never auto-retried). |
| `5` | Hung and was killed | Report where it stalled from the log tail; rerun with a larger `--timeout` only if it was genuinely progressing. |

## Reporting

The answer is free-form Markdown — there is no fixed structure to
parse, unlike codex-review's `[P<n>]` bullets. Relay it faithfully:

1. Present Codex's position and its load-bearing arguments, not just
   its conclusion. Do not compress a nuanced recommendation into a
   verdict.
2. Add Claude's own stance: agree, disagree with reason, or
   needs-checking. You have conversation context Codex lacks; Codex
   has distance Claude lacks. Say which applies where.
3. Flag disagreements between the two models explicitly rather than
   averaging them away — a genuine split is the most useful output
   this skill produces, and the user should see both sides.
4. State the question asked and the model used, so it is reproducible.
5. The decision belongs to the user. Present, compare, recommend —
   never declare the question settled because two models agree.

## Boundaries

- Read-only by design, same enforced boundary as codex-review:
  model-generated commands run under a read-only sandbox, command hooks
  are disabled (verified fail-closed before the run starts), and the
  legacy `notify` callback is cleared. Write-capable MCP servers from
  the user's own codex config stay outside that boundary.
- Not for reviewing code changes — `codex-review` exists for that and
  its defect-list format fits diffs better. If a consultation exposes
  a concrete bug in changed code, suggest a follow-up review rather
  than stretching this skill.
- Follow-ups belong in the same session via `--continue` — a fresh run
  rereads the repo from scratch and forgets every position already
  staked out. Only start fresh when the topic genuinely changes.
- If the answer is vague or unusable twice, say so honestly instead of
  paraphrasing a weak result into confidence.

## Why The Script Looks Like That

Verified against `codex-cli 0.146.0`; recheck if these stop holding.

- The sandbox is set via `-c 'sandbox_mode="read-only"'` on both the
  fresh and resume paths: `exec resume` has no `-s` flag, and the
  config key is exactly what `-s` sets, so one spelling keeps the two
  paths verifiably identical.
- The session id comes from the `thread.started` event in the JSONL
  stream; multi-turn works because sessions persist under
  `CODEX_HOME/sessions`. Never pass `--ephemeral` — it would silently
  break `--continue`.
- That sandbox covers model-generated commands only. Trusted command
  hooks run outside it, so the script passes `--disable hooks` and
  verifies the effective state with `codex features list`, exiting `3`
  if managed policy forces hooks back on.
- The legacy `notify = [...]` callback is not feature-gated, so
  `--disable hooks` does not stop it. The script clears it with
  `-c notify=[]`; plain config keys have no managed-policy override,
  so the `-c` layer is authoritative there.
- The question is passed after `--` so questions starting with a dash
  (a Markdown bullet, say) are not parsed as options.
- The answer comes from `-o` (the agent's last message), not stdout:
  the event stream on stdout is `--json`, one bounded line per event,
  because the default human stream echoes entire file dumps.
- The answer file must live outside the repo, or Codex's own file
  sweeps pick it up and pollute the answer.
- The default model slug is pinned in the script, which will go stale.
  That is why a rejected model triggers one automatic retry on the
  user's config instead of a hard failure.
