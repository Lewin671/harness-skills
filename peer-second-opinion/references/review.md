# Review Mode

`peer.mjs <provider> review` asks the peer for a prioritised defect list over a
code change.

## Scope

At most one explicit scope; omission means `--uncommitted`:

| Flag | Reviews |
|------|---------|
| `--uncommitted` (default) | staged + unstaged + untracked changes |
| `--base <REF>` | everything since the merge base with that ref: the branch's commits plus tracked working changes (no untracked files) |
| `--commit <SHA>` | the changes introduced by that one commit |
| `--custom "<TEXT>"` | whatever the instructions describe |

`--uncommitted` reviews *everything* uncommitted, related or not. On a tree with
unrelated work in progress, narrow with `--custom` naming the paths, or use
`--commit` if the change is already committed. `--base HEAD~3` reviews the last
three commits plus tracked working changes; if the user asked only about the
commits, name the range in `--custom` rather than reshaping their tree.

An empty scope exits `2` before the peer runs, because a CLI reports "no
changes" as an answer that reads like a pass. `--custom` gets no such check.

## What the peer reads

A Codex `--uncommitted` or `--base` review reads an isolated snapshot; edits
are safe once `snapshot: ready` prints (limits in
[providers/codex.md](./providers/codex.md)). Every other review reads the live
tree, fingerprinted as `identity:`. Command Code and dsh get the scope's
`git diff` in their prompt, cut at 400,000 bytes.

## --custom and --context

Pick `--custom` only for a specific concern a plain review would not
prioritise, or to narrow to paths. It replaces the scope sentence — say what to
compare, what to read and what to produce.

```bash
--custom "Verify only the fix in src/foo.py: the guard now rejects an empty
  list before dividing. Report whether that defect is fixed, plus any new
  defect the change introduced."
```

`--context` passes neutral background — what the change is meant to do, a
constraint not visible in the diff — fenced as data, and the peer checks the
code against it. Keep it within the Independence Contract; the host's suspected
defects belong in `--custom`, with the result labelled **deliberation**. With
Codex, prefer a plain scope when no context is needed.

## Reading the report

```
<one-paragraph overall verdict>

- [P1] <title> — path/file.py:10-14
  <body>
```

Anchor on the `- [P<n>]` bullets, not any heading above them. `P0` is most
severe, down to `P3`. No bullets is not, by itself, a clean review:

- No bullets **and** the text says there is nothing to report → zero findings.
- No bullets and no such statement → **unparseable**. Relay it verbatim and say
  the `[P<n>]` structure was missing.

## Following up

A Codex review leaves no session: to discuss a finding, start a consult carrying
it, or run a `--custom` review of it. A Command Code or dsh review's `resume:`
line continues it in consult mode. Both are **deliberation**.

## Reporting duties

Beyond SKILL.md § Independence Contract: account for every finding with its
priority, file and line range, and say what was reviewed — only `--commit`
names an immutable object; a snapshot or an `identity:` value ties the other
scopes to the bytes read.
