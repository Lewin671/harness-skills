# Consult Mode

`run-codex-second-opinion.mjs consult` asks Codex one free-form
question, answered with the repository as context, and prints the
answer to stdout. Changed code gets a defect list in review mode;
everything else — plans, architecture choices, "should we do X or Y" —
gets a reasoned position here.

## Writing The Question

Write the question to stand alone: name the files or documents Codex
should read, state the decision criteria, and say what a useful answer
looks like (a ranked choice, a risk list, a counter-proposal). Codex
starts with zero conversation context — everything it needs must be in
the question or in the repo. A repository is not required: `--repo` may
point at any directory when the question stands entirely on its own.

If the material under discussion exists only in the conversation, get
it to Codex one of two ways. Short material (up to a screenful) goes in
the question itself — QUESTION is one argument but happily multiline.
For anything longer, **prefer a file**: a multi-page document squeezed
through shell quoting into one argv element is easy to mangle, and a
mangled quote surfaces as a confusing "expected exactly one QUESTION"
error. Write it *outside* the repo (under TMPDIR, say) and give Codex
its absolute path — never into the repo, where a helper file dirties
later Git status.

Keep the first question blind and neutral — the Independence Contract
in SKILL.md defines allowed sources. Withhold anything derived from
Claude's own analysis until after Codex has answered. If the user
explicitly wants a Claude claim challenged, include the claim but call
the result a targeted cross-check, not a blind opinion.

Pass the question after `--` so questions starting with a dash are not
parsed as options.

## Multi-Turn Discussion

Every successful run prints two lines to stderr: `session: <ID>`, and a
`resume:` line holding the complete follow-up command — script path,
`consult`, session, model flags, repo — except for the question itself:

```bash
<the resume: line, minus "resume:"> -- "the follow-up question"
```

Copy the line verbatim rather than rebuilding it from the id alone —
the model flags do not travel with the session, and a follow-up without
them can switch the discussion to different defaults mid-conversation.
This does not contradict SKILL.md's "pass no model flags" rule: that
rule governs *fresh* runs, where flags select a model; in a copied
line they pin the one that already answered. Codex resumes with
everything it already read and said, so follow-ups need only the new
material.

The session lives on disk in codex's own session store
(`~/.codex/sessions` by default), so a consultation's question and
answer outlive the run. A follow-up
requires the user's authorization — do not launch one to settle a
disagreement on your own initiative, and authorization for one
follow-up is not authorization for an unlimited loop.

Label an answer **independent first pass** only when its prompt
contains no Claude-derived analysis. Once Claude's position has entered
the session — or a replacement session after expiry — every subsequent
answer is **deliberation**. Independence depends on information
exposure, not session freshness.

Three rules keep the loop honest:

- Continuation is verified: if the stream's thread id does not match
  the requested session, the script discards the fresh-thread answer
  and exits `4` instead of passing it off as a follow-up. Start a new
  consultation and restate context.
- If no session id reaches the stream, the answer is still valid —
  there is just nothing to continue. The two lines then read
  `session: unavailable — ...` and `resume: unavailable — ...`; they
  are printed either way so a model-written line cannot pose as them.
- A rejected model is never retried automatically. On a follow-up,
  treat the session as contaminated and start a fresh consultation.

Follow-ups belong in the same session — a fresh run rereads the repo
from scratch and forgets every position already staked out. Only start
fresh when the topic genuinely changes.

## Reporting Duties

Follow SKILL.md § Reporting, plus:

1. The answer is free-form Markdown — present Codex's position and its
   load-bearing arguments, not just its conclusion.
2. Verify Codex's checkable claims against the repo before relaying
   them as fact.
3. Label a fresh session's first answer **independent first pass** and
   resumed-session answers **deliberation**.

Do not use consult mode to outsource choices the user already made, and
not for reviewing a diff, commit, or branch — review mode fits those
better. If a consultation exposes a concrete bug in changed code,
suggest a follow-up review rather than stretching the discussion.
