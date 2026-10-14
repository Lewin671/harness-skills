# Consult Mode

`run-command-code-second-opinion.mjs consult` asks Command Code one free-form
question, answered with the repository as context, and prints the answer to
stdout. Changed code gets a defect list in review mode; everything else — plans,
architecture choices, "should we do X or Y" — gets a reasoned position here.

## Writing The Question

Write the question to stand alone: name the files or documents Command Code
should read, state the decision criteria, and say what a useful answer looks
like (a ranked choice, a risk list, a counter-proposal). A fresh run starts with
zero conversation history — no host-derived analysis, no earlier session — so
everything it needs must be in the question or in the repository. A repository is
not required: `--repo` may point at any directory when the question stands
entirely on its own.

Keep the first question blind and neutral — the Independence Contract in
SKILL.md defines allowed sources. Withhold anything derived from the host's own
analysis until after Command Code has answered. If the user explicitly wants a
host claim challenged, include the claim but call the result a targeted
cross-check, not a blind opinion.

The question is one argument; pass it after `--` so a question starting with a
dash is not parsed as an option. The wrapper hands it to the CLI on stdin, so a
question is not limited by the command line's argument size — but a multi-page
document still belongs in a file, with the file's path named in the question.

## Multi-Turn Discussion

Every successful run prints two lines to stderr: `session: <ID>`, and a
`resume:` line holding the complete follow-up command — script path, `consult`,
session, any explicit model pair, `--max-turns` and `--timeout` when they were
given, repo — **except for the question itself**:

```bash
<the resume: line, minus "resume: "> -- "the follow-up question"
```

Copy the line and append the question; do not rebuild the command from the id
alone, because the model pair that was in force does not travel with the session
and a follow-up without it can switch the discussion to different defaults
mid-conversation. Command Code resumes with everything it already read and said,
so follow-ups need only the new material.

A follow-up requires the user's authorization — do not launch one to settle a
disagreement on your own initiative, and authorization for one follow-up is not
authorization for an unlimited loop.

Label an answer **independent first pass** only when its prompt contains no
host-derived analysis. Once the host's position has entered the session, every
subsequent answer is **deliberation**. Independence depends on information
exposure, not session freshness.

Three rules keep the loop honest:

- Continuation is verified: the CLI reports the session it actually used. If it
  does not match the requested one the answer is discarded and the run exits
  `11`; if a resumed run reports no session id at all, the answer is discarded
  the same way — it may be fine, but it cannot be shown to have carried the
  discussion, which is the whole point of a follow-up. Start a new consultation
  and restate context.
- If a **fresh** consultation's stream carries no session id, the answer is still
  valid — there is just nothing to continue. The two lines then read
  `session: unavailable — ...` and `resume: unavailable — ...`; they print either
  way so model-written text cannot pose as them.
- A resume target that no longer exists fails the run (exit `1`, with a hint to
  start fresh). Every session the CLI keeps lives on disk in its own session
  store, so a consultation's question and answer outlive the run.

Follow-ups belong in the same session — a fresh run rereads the repository from
scratch and forgets every position already staked out. Only start fresh when the
topic genuinely changes.

## Reporting Duties

Follow SKILL.md § Reporting, plus:

1. The answer is free-form Markdown — present Command Code's position and its
   load-bearing arguments, not just its conclusion.
2. Verify checkable claims against the repository before relaying them as fact.
3. Label an answer **independent first pass** only when its prompt held no
   host-derived analysis; a fresh session carrying a prior finding or position is
   **deliberation**, as is every resumed-session answer.

Do not use consult mode to outsource choices the user already made, and not for
reviewing a diff, commit, or branch — review mode fits those better. If a
consultation exposes a concrete bug in changed code, suggest a follow-up review
rather than stretching the discussion.
