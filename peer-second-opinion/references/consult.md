# Consult Mode

`peer.mjs <provider> consult` asks the peer one free-form question, answered
with the repository as context. Plans, architecture choices, "X or Y" and how to
fix a bug get a reasoned position here; changed code gets a defect list in
review mode.

## Writing the question

Write it to stand alone — a fresh run has no conversation history: name the
files or documents to read, state the decision criteria, and say what a useful
answer looks like (a ranked choice, a risk list, a counter-proposal). `--repo`
may point at any directory, git or not.

Short material goes in the question itself; anything longer than a screenful
goes in a file **outside** the repository (under TMPDIR), named by absolute
path — a helper file inside the repo dirties later reviews. Put the question
after `--`. Keep the first question blind (SKILL.md § Independence Contract).

## Continuing the discussion

A successful run prints a `resume:` line holding the complete follow-up command
except the question; the peer keeps everything it already read and said, so a
follow-up needs only the new material. If the session did not resume, the run
exits `4`: start fresh and restate the context — that run is **deliberation**.

A follow-up needs the user's authorization, and authorization for one is not
authorization for a loop.

## Reporting duties

Present the position and its load-bearing arguments, not just the conclusion.
Do not use consult to outsource a choice the user already made. If a
consultation exposes a concrete bug in changed code, suggest a review instead.
