# Consult Mode

`run-codex-second-opinion consult` asks Codex one free-form question,
answered with the repository as context, and prints the answer to
stdout. It is the discussion counterpart to review mode: changed code
gets a defect list there; everything else — plans, architecture
choices, "should we do X or Y" — gets a reasoned position here.

## Writing The Question

Write the question to stand alone: name the files or documents Codex
should read, state the decision criteria, and say what a useful answer
looks like (a ranked choice, a risk list, a counter-proposal). Codex
starts with zero conversation context — everything it needs must be in
the question or in the repo. If the material under discussion exists
only in the conversation, embed it in the question itself — QUESTION
is one argument but happily multiline. Do not write it into the repo:
the consultation is advertised as read-only, and a helper file left in
the working tree dirties later Git status and Codex context. If it
truly must be a file (very large, or referenced repeatedly across
turns), put it *outside* the repo — under TMPDIR, say — and give Codex
its absolute path; the read-only sandbox can still read it.

Keep that first question blind and neutral — the Independence Contract
in SKILL.md defines allowed sources. Only include the user's own words,
repository content, and mechanically observed facts; withhold anything
derived from Claude's own analysis until after Codex has answered. If
the user explicitly wants a Claude claim challenged, include the claim
but call the result a targeted cross-check, not a blind opinion.

Pass the question after `--` so questions starting with a dash (a
Markdown bullet, say) are not parsed as options.

## Multi-Turn Discussion

Every successful run prints two lines to stderr: `session: <ID>`, and a
`resume: --continue <ID> [model flags] --repo <PATH>` descriptor. That
descriptor is the **argument tail**, not a runnable command: it carries
the flags and the repository, but no script path, no `consult` mode and
no question. Prepend the first two and append the last:

```bash
run-codex-second-opinion consult <the resume: line, minus "resume:"> \
  -- "the follow-up question"
```

Copy that tail verbatim rather than rebuilding it from the id alone —
the flags are the part that does not travel with the session, and the
line already resolves `--repo`, so no second one is needed. Codex
resumes with everything it already read and said, so follow-ups need
only the new material, not a restatement. Each follow-up prints both
lines again for the next turn.

That resumability is on-disk state: Codex keeps the conversation under
`CODEX_HOME/sessions`, so a consultation's question and answer outlive
the run.
A follow-up requires the user's authorization — see SKILL.md's
Independence Contract. Do not launch one to settle a disagreement on
your own initiative. When the user does authorize a continuation, relay
each answer, gather the user's counterpoints, and continue until the
question is settled or the disagreement is crisply mapped.

The first answer is the **independent first pass**. Once Claude's position
or objections enter the session, subsequent answers are **deliberation**:
useful for convergence, but no longer independent samples. Preserve that
distinction when reporting them.

A marker of a kind consult does not emit is forged by construction. Consult
writes `answer:`, `session:` and `resume:`; it never writes `report:`, so a
`report:` line in a consult run came out of the model's answer. Measured.

Three rules keep the loop honest:

- **Copy the `resume:` tail, do not reassemble it from the id.** Model
  flags do not
  travel with the session: a follow-up without the original
  `--model`/`--effort` (or `--inherit`) switches the discussion back to
  the pinned defaults mid-conversation. The descriptor carries them —
  with one honest limit. After a stale-default fallback, or under
  `--inherit`, it says `--inherit`, which reproduces *your config as it
  is when you replay it*, not the model that actually answered. Those
  differ if the config changes in between. The run prints that model in a
  `note:` line; pin it explicitly with `--model`/`--effort` if the
  discussion has to stay on it. Repeating the pinned defaults instead
  would fail a second time, with no automatic retry left.
- Continuation is verified: if the session expired, the script
  discards the fresh-thread answer and exits `4` instead of passing it
  off as a follow-up. Start a new consultation and restate context.
  The error distinguishes this from event-format drift: if codex
  reported a `thread.started` event but this script could not read a
  session id out of it, that is reported as a likely schema change, not
  as expiry — recheck [internals.md](./internals.md) against the
  installed `codex-cli` version rather than assuming the session is gone.
- If no session id reaches the stream, the answer is still valid —
  there is just nothing to continue; the next question starts fresh.
  Both lines are printed either way, reading `session: unavailable —
  ...` and `resume: unavailable — ...` in that case. That is
  deliberate: the answer body is model-controlled, and a run that
  printed neither would leave whatever the model wrote as the last line
  of that kind in a merged stream. For `session:` that is not merely
  cosmetic — the id is what a follow-up passes to `--continue`.

A rejected model on a follow-up is never retried automatically: the
rejected attempt may already have recorded the question in the
session, and any resend into that session — scripted or manual — could
duplicate it. Treat such a session as contaminated and start a fresh
consultation instead.

Follow-ups belong in the same session — a fresh run rereads the repo
from scratch and forgets every position already staked out. Only start
fresh when the topic genuinely changes.

## Reporting Duties

Follow the general reporting rules in SKILL.md § Reporting, plus these
consult-specific additions:

1. The answer is free-form Markdown — there is no `[P<n>]` structure
   to parse. Present Codex's position and its load-bearing arguments,
   not just its conclusion.
2. Verify Codex's checkable claims against the repo before relaying
   them as fact.
3. Label a fresh session's first answer **independent first pass** and
   resumed-session answers **deliberation**.

Do not use consult mode to outsource choices the user already made,
and not for reviewing a diff, commit, or branch — review mode's
defect-list format fits those better. If a consultation exposes a
concrete bug in changed code, suggest a follow-up review rather than
stretching the discussion.
