# Consult Mode

`peer.mjs <provider> consult` asks the peer one free-form question, answered
with the repository as context, and prints the answer to stdout. Changed code
gets a defect list in review mode; plans, architecture choices and "should we
do X or Y" get a reasoned position here.

## Writing the question

Write it to stand alone: name the files or documents to read, state the
decision criteria, and say what a useful answer looks like (a ranked choice, a
risk list, a counter-proposal). A fresh run has no conversation history — Codex
runs with its cross-session memories disabled — so everything it needs must be
in the question or the repository. `--repo` may point at any directory, git or
not.

Short material from the conversation goes in the question itself; for anything
longer than a screenful, write a file **outside** the repository (under TMPDIR)
and give its absolute path — a helper file inside the repo dirties later
reviews. The question is one argument; put it after `--` so a leading dash is
not parsed as an option. Command Code and dsh get a fixed read-only note appended to
the prompt; do not add one yourself.

Keep the first question blind — the Independence Contract says what may go in.

## Continuing the discussion

A successful run prints `session: <ID>` and a `resume:` line holding the
complete follow-up command except the question (SKILL.md § Reading the
output). The peer resumes with everything it already read and said, so a follow-up
needs only the new material.

- The wrapper checks that the CLI resumed the requested session. If it reports
  another one, or none, the answer is discarded and the run exits `4`; start
  fresh and restate the context. The restated fresh run is **deliberation**.
- A fresh run whose stream carried no session id still produced a valid
  answer; `session:` and `resume:` then read `unavailable — ...`.

A follow-up needs the user's authorization, and authorization for one is not
authorization for a loop. Labels follow SKILL.md § Independence Contract.

## Reporting duties

Follow SKILL.md § Independence Contract: present the position and its
load-bearing arguments, not just the conclusion, and verify checkable claims
before relaying them as fact. Do not use consult to outsource a choice the user
already made. If a consultation exposes a concrete bug in changed code, suggest
a review instead of stretching the discussion.
