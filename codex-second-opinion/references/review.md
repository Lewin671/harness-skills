# Review Mode

`run-codex-second-opinion.mjs review` runs `codex exec review` as an
independent reviewer over a change and prints the report to stdout.

## Scope

At most one explicit scope; omission means `--uncommitted`:

| Flag | Reviews |
|------|---------|
| `--uncommitted` (default) | startup snapshot of staged + unstaged + untracked |
| `--base <BRANCH>` | startup snapshot of the current branch and tracked working changes against that branch |
| `--commit <SHA>` | that one commit |
| `--custom "<TEXT>"` | whatever the instructions describe |

`--uncommitted` reviews *everything* uncommitted, related or not. On a
tree carrying unrelated WIP, commit the intended change and use
`--commit` so findings stay on what the user asked about.

For `--uncommitted` and `--base`, the wrapper creates an isolated local
clone, overlays changed tracked files (plus non-ignored untracked files
for `--uncommitted`), preserves the index separately, verifies the source
and copied bytes, and prints `snapshot: ready`. Edits to the source
repository are safe after that marker. The temporary clone is removed
after the run. Unresolved merges and live changes inside submodules fail
closed. So do embedded repositories, changed symlinks that resolve
outside the clone, and any symlink that resolves back into the live
source repository; make those paths repository-local, or review an
immutable commit with `--commit`. An unchanged symlink pointing
elsewhere — a dotfiles repository linking into `$HOME`, say — is
tolerated: the same exposure a live-repository review has.

Pick `--custom` only when the user has a specific concern that the
built-in review prompt would not prioritise. It replaces the built-in
prompt rather than supplementing it — say what to look at inside the
text itself. Narrowing to a path is such a concern: for "review only
`foo.py`'s uncommitted changes", use `--custom` naming the paths and
the comparison base — accepting that `--custom` has no empty-scope
precheck and reads the live repository.

Keep an independent first review unseeded: provide the change and its
intended behaviour without Claude's suspected findings. If the user
asks Codex to adjudicate a specific finding, use `--custom` and label
the result a targeted cross-check rather than a blind review.

## Context

A scope flag carries the diff and nothing else. When the review needs
to know what the change was *meant* to do — a refactor that must
preserve behaviour, a constraint not visible in the diff — pass that
background with `--context`. Keep it to what the Independence Contract
in SKILL.md allows; Claude's suspected defects belong in `--custom`
with the result labelled accordingly. The prompt tells Codex to treat
the background as something to check the code against, not to accept:
where code and stated intent disagree, that mismatch is itself a
finding.

One trade-off is worth knowing: `codex exec review` refuses a scope
flag and a prompt in the same invocation, so with `--context` the scope
reaches Codex as prose instead of as a flag. The empty-scope precheck
still runs on the real flag. The startup clone keeps built-in live
scopes stable, but prompt interpretation remains less mechanical than
a plain scope flag. Without a genuine need for context, prefer the
plain scope flag. `--context` cannot be combined with `--custom`.

The script refuses to spend minutes on an empty scope: a clean tree, an
empty commit, or no changes since the merge base exit `2` before Codex
is invoked. Codex itself reports "there are no changes" as an ordinary
successful review, which reads like a pass — that is the misreport the
precheck exists to prevent. `--custom` gets **no such precheck** — the
wrapper cannot know what free-form instructions cover — so exit `2`
never fires for it, and a "nothing to report" response must be read
under the no-bullets rule below, not as a verified-empty scope.

## Reading The Report

Findings come back as Markdown on stdout:

```
<one-paragraph overall verdict>

Full review comments:

- [P1] <title> — /abs/path/file.py:10-14
  <body>
```

Anchor on the `- [P<n>]` bullets, not the heading above them — it
varies with the number of findings. Priority runs `P0` (most severe)
down to `P3`.

**No bullets is not, by itself, a clean review.** The wrapper accepts
any non-empty result, so a genuine zero-finding report and a response
mangled by format drift look identical to a parser that only counts
bullets. Decide on the prose:

- No bullets **and** the text affirmatively says there is nothing to
  report → zero findings. Say so.
- No bullets and the text does not say that → **unparseable**. Relay it
  verbatim, say the `[P<n>]` structure was missing, and do not
  characterise it as clean.

Never report a verdict the output does not actually state.

## Reporting Duties

Follow SKILL.md § Reporting, plus:

1. Account for every finding with its priority, file, and line range.
   Do not silently drop low-priority findings.
2. Add a Claude-side trust line **per finding**: agree, disagree with
   reason, or needs-checking.
3. `--uncommitted` and `--base` identify the ephemeral snapshot by the
   wrapper's fingerprint. Only `--commit` names a durable immutable
   object; `--custom` remains live and is not reproducible.

For open questions rather than code changes, use consult mode instead.
