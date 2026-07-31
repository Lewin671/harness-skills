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

Pass the question after `--` so questions starting with a dash (a
Markdown bullet, say) are not parsed as options.

## Multi-Turn Discussion

Every successful run prints `session: <ID>` to stderr. To push back,
probe an argument, or ask a follow-up, pass that id with `--continue`.
Codex resumes the same session with everything it already read and
said, so follow-ups need only the new material, not a restatement.
Each follow-up prints the `session:` line again for the next turn.
This is a real discussion loop: relay each answer, gather the user's
(or Claude's own) counterpoints, and continue until the question is
settled or the disagreement is crisply mapped.

Three rules keep the loop honest:

- **Repeat model flags on every follow-up.** They do not travel with
  the session: a follow-up without the original `--model`/`--effort`
  (or `--inherit`) switches the discussion back to the pinned defaults
  mid-conversation.
- Continuation is verified: if the session expired, the script
  discards the fresh-thread answer and exits `4` instead of passing it
  off as a follow-up. Start a new consultation and restate context.
- If the `session:` line is ever missing, the answer is still valid —
  there is just nothing to continue; the next question starts fresh.

A rejected model on a follow-up is never retried automatically: the
rejected attempt may already have recorded the question in the
session, and any resend into that session — scripted or manual — could
duplicate it. Treat such a session as contaminated and start a fresh
consultation instead.

Follow-ups belong in the same session — a fresh run rereads the repo
from scratch and forgets every position already staked out. Only start
fresh when the topic genuinely changes.

## Reporting Duties

The answer is free-form Markdown — there is no fixed structure to
parse, unlike review mode's `[P<n>]` bullets. Relay it faithfully:

1. Present Codex's position and its load-bearing arguments, not just
   its conclusion. Do not compress a nuanced recommendation into a
   verdict.
2. Add Claude's own stance: agree, disagree with reason, or
   needs-checking — and verify Codex's checkable claims against the
   repo before relaying them as fact.
3. Flag disagreements between the two models explicitly rather than
   averaging them away, and argue them to resolution in the session
   when a decision depends on it.
4. State the question asked and the model used, so it is reproducible.
5. The decision belongs to the user. Present, compare, recommend —
   never declare the question settled because two models agree.

Do not use consult mode to outsource choices the user already made,
and not for reviewing a diff, commit, or branch — review mode's
defect-list format fits those better. If a consultation exposes a
concrete bug in changed code, suggest a follow-up review rather than
stretching the discussion.
