# Consult Mode

`run-command-code-second-opinion.mjs consult` asks Command Code one free-form
question, answered with the repository as context, and prints the answer to
stdout. Changed code gets a defect list in review mode; plans, architecture
choices and "should we do X or Y" get a reasoned position here.

## Writing the question

Write it to stand alone: name the files or documents to read, state the
decision criteria, and say what a useful answer looks like (a ranked choice, a
risk list, a counter-proposal). A fresh run has no conversation history, so
everything it needs must be in the question or the repository. `--repo` may
point at any directory, git or not.

Keep the first question blind — the Independence rules in SKILL.md say what may
go in. The question is one argument; put it after `--` so a leading dash is not
parsed as an option. The wrapper appends a fixed read-only note to every consult
prompt, so do not add one yourself.

## Continuing the discussion

Every successful run prints `session: <ID>` and a `resume:` line holding the
complete follow-up command except the question:

```bash
<the resume: line, minus "resume: "> -- "the follow-up question"
```

Copy it rather than rebuilding it from the id: it carries the model that
answered, which the session itself does not remember. Command Code resumes with
everything it already read and said, so a follow-up needs only the new material.
Every resumed answer is **deliberation**.

- The CLI reports the session it actually used. If that is not the requested
  one, or there is none, the answer is discarded and the run exits `11`; start
  fresh and restate the context.
- A fresh run whose stream carried no session id still produced a valid answer;
  `session:` and `resume:` then read `unavailable — ...`.
- A session that no longer exists fails with exit `1`.

A follow-up needs the user's authorization; do not launch one on your own
initiative to settle a disagreement.

## Reporting duties

Follow SKILL.md § Reporting: present the position and its load-bearing
arguments, not just the conclusion, and verify checkable claims before relaying
them as fact. If a consultation exposes a concrete bug in changed code, suggest a
review instead of stretching the discussion.
