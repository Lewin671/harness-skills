# Review Mode

`run-command-code-second-opinion.mjs review` asks Command Code for a prioritised
defect list over a code change, and prints the report to stdout.

## Scope

At most one explicit scope; omission means `--uncommitted`:

| Flag | Reviews |
|------|---------|
| `--uncommitted` (default) | staged + unstaged + untracked changes |
| `--base <REF>` | tracked changes since the merge base with that ref |
| `--commit <SHA>` | the changes introduced by that one commit |
| `--custom "<TEXT>"` | whatever the instructions describe |

`--uncommitted` reviews *everything* uncommitted, related or not. On a tree with
unrelated work in progress, commit the intended change and use `--commit`.

`--base` takes any ref: `--base HEAD~3` reviews the last three commits plus
tracked working changes. It ignores untracked files.

An empty scope — a clean tree, an empty commit, no changes since the merge base
— exits `2` before Command Code runs, because the CLI reports "no changes" as an
ordinary answer that reads like a pass. `--custom` gets no such check.

## What the prompt carries

The wrapper builds the diff itself with read-only git calls and puts the scope
sentence (or the `--custom` text), `git status --porcelain`, the untracked paths
to read directly, and the `git diff` for the scope into the prompt, followed by
the report format and the read-only note. A diff over 400,000 bytes is cut, and
the prompt says so.

`--custom` replaces only the scope sentence, never the mechanical facts, so a
targeted check still gets the current diff:

```bash
--custom "Verify only the fix in src/foo.py: the guard now rejects an empty
  list before dividing. Report whether that defect is fixed, plus any new
  defect the change introduced."
```

`--context` passes neutral background — what the change is meant to do, a
constraint not visible in the diff. Keep it within the Independence rules in
SKILL.md. Command Code is told to check the code against it, not to accept it:
a mismatch between code and stated intent is itself a finding.

## The live tree

The reviewer reads the repository as it is during the run. The wrapper
fingerprints the reviewed paths, the index and the working-tree status before
and after and prints `identity: <sha256>`; when the two differ it warns that the
tree changed mid-run. Relay that warning: either someone edited the tree, or the
run itself did — it has a shell. Only `--commit` names an immutable object; for
the other scopes the `identity:` value is what ties the report to the bytes it
saw. The identity does not cover an in-place rewrite of an existing ignored
file, or writes under `.git/`.

Merge conflicts or live submodule changes in scope, and any git listing the
wrapper cannot complete, fail with exit `11`.

## Reading the report

```
<one-paragraph overall verdict>

- [P1] <title> — path/file.py:10-14
  <body>
```

Anchor on the `- [P<n>]` bullets; models sometimes add a heading or an extra
paragraph above them. `P0` is most severe, down to `P3`.

No bullets is not, by itself, a clean review:

- No bullets **and** the text says there is nothing to report → zero findings.
- No bullets and no such statement → **unparseable**. Relay it verbatim and say
  the `[P<n>]` structure was missing.

## Following up

A review leaves a session. Its `resume:` line continues it in consult mode —
"why is this P1?", "I changed X, check the fix" — with the same read-only note.
The follow-up carries no new diff; Command Code can run `git diff` itself. Every
follow-up answer is **deliberation**.

## Reporting duties

Follow SKILL.md § Reporting, plus: account for every finding with its priority,
file and line range, give a per-finding stance, and say which scope kind was
reviewed.
