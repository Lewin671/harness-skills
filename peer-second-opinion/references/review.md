# Review Mode

`peer.mjs <provider> review` asks the peer for a prioritised defect list over a
code change and prints the report to stdout.

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
`--commit` if the change is already committed.
`--base` takes any ref: `--base HEAD~3` reviews the last three commits plus
tracked working changes. If the user asked only about the commits, name the
range in `--custom` rather than reshaping their tree.

An empty scope — a clean tree, an empty commit, no changes since the merge base
— exits `2` before the peer runs, because a CLI reports "no changes" as an
ordinary answer that reads like a pass. `--custom` gets no such check: the
wrapper cannot know what free-form instructions cover. Unresolved merges, live
changes inside a submodule, and a repository with no commits fail with exit `3`.

## What the peer reads

- **Codex** runs its native `codex exec review` on the scope flag. For
  `--uncommitted` and `--base` it reads an isolated snapshot — a local clone
  with the changed files overlaid — and the wrapper prints `snapshot: ready`
  once captured; source edits are safe after that. Details and the snapshot's
  refusals are in [providers/codex.md](./providers/codex.md). `--commit` and
  `--custom` read the live tree.
- **Command Code** has no review command, so the wrapper writes the prompt: the
  scope sentence (or the `--custom` text), `git status --porcelain`, the
  untracked paths to read directly, the `git diff` for the scope (cut at
  400,000 bytes, and the prompt says so), the report format, and a read-only
  note. It always reads the live tree.

A live-tree review fingerprints the scoped paths, index and working-tree
status as `identity:` (SKILL.md § Reading the output).

## --custom and --context

Pick `--custom` only for a specific concern a plain review would not
prioritise, or to narrow to paths. It replaces the scope sentence — say what to
compare, what to read and what to produce. A Command Code custom review still
carries the current uncommitted diff as data.

```bash
--custom "Verify only the fix in src/foo.py: the guard now rejects an empty
  list before dividing. Report whether that defect is fixed, plus any new
  defect the change introduced."
```

`--context` passes neutral background — what the change is meant to do, a
constraint not visible in the diff — fenced as data. Keep it within the
Independence Contract; the host's suspected defects belong in `--custom`, with
the result labelled **deliberation**. The peer is told to check the code against
the background, not to accept it: a mismatch is itself a finding. With Codex,
`--context` turns the scope flag into prose (its review command refuses a flag
and a prompt together), so prefer a plain scope when no context is needed.

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

A Codex review is ephemeral: to discuss a finding, start a consult carrying it,
or run a `--custom` review of it. A Command Code review leaves a session; its
`resume:` line continues it in consult mode with the same read-only note. Both
are **deliberation** (SKILL.md § Independence Contract).

## Reporting duties

Follow SKILL.md § Independence Contract, plus: account for every finding with
its priority, file and line range; give a per-finding stance; and say what was
reviewed — only `--commit` names an immutable object; a snapshot or an
`identity:` value is what ties the other scopes to the bytes read.
