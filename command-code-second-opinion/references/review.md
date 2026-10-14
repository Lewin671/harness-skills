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

`--uncommitted` reviews *everything* uncommitted, related or not. On a tree
carrying unrelated work in progress, commit the intended change and use
`--commit` so findings stay on what the user asked about.

`--base` takes any ref, not just a branch: `--base HEAD~3` reviews the last three
commits plus tracked working changes. It deliberately ignores untracked files —
an unrelated local file should not appear in a review of the branch.

The wrapper refuses to spend a model run on an empty scope: a clean tree, an
empty commit, or no changes since the merge base exits `2` before Command Code is
invoked. Command Code itself reports "there are no changes" as an ordinary
successful answer, which reads like a pass — that is the misreport the precheck
exists to prevent. `--custom` gets **no** such precheck, because the wrapper
cannot know what free-form instructions cover.

## The diff is built by the wrapper

Command Code's print mode does not give the main loop a shell, and this skill
does not want it to depend on one. So the wrapper runs its own read-only git
call and puts three things in the prompt:

- the scope sentence naming what to review,
- `git status --porcelain` plus the list of untracked paths to read directly,
- the authoritative `git diff` for that scope.

This is the one place the prompt and the `--custom` text coexist: `--custom`
replaces the scope sentence, never the mechanical facts. A fix verification that
needs the exact before/after therefore gets the current diff automatically —
say what to compare and what to produce in the custom text itself:

```bash
--custom "Verify only the fix in src/foo.py: the guard now rejects an empty
  list before dividing. Compare against the finding 'division by an empty
  list'. Report only whether this specific defect is fixed, plus any new
  defect the change introduced."
```

A diff larger than 400,000 bytes is cut with an explicit marker. The prompt then
says the diff was truncated and to read the affected files directly, so a huge
change is reviewed from file reads plus the part of the diff that fit.

The untracked list is repository data, not a recommendation: a symlinked path in
it points wherever it points, so treat the untracked list as a thing to read
deliberately rather than trust in a repository you do not control.

## `--context`

A scope carries the change and nothing else. When the review needs to know what
the change was *meant* to do — a refactor that must preserve behaviour, a
constraint not visible in the diff — pass that background with `--context`. Keep
it to what the Independence Contract in SKILL.md allows; suspected defects mean
the result is a cross-check, not a blind review, and `--context` cannot be
combined with `--custom`. The prompt tells Command Code to treat the background
as something to check the code against, not to accept: where the code and the
stated intent disagree, that mismatch is itself a finding.

## The reviewer reads the live tree

Nothing is frozen. The reviewer reads the repository as it is during the run, so
hold edits to the reviewed paths while a run is in flight when a stable reading
matters. The wrapper fingerprints the reviewed paths plus the working-tree status
before and after, prints `identity: <sha256>`, and — when the two differ — adds:

```
warning: the tree changed while this run was in progress (identity X is not Y);
the answer is not identity-verified — it describes no single stable state, and
it must not be used to close a verification budget. Check <repo> for edits the
run may have made.
```

Relay that warning. It means either the caller edited the tree mid-run or the run
itself mutated it (a run can: see the Boundary section — a delegated sub-agent is
not bound by print mode's refusal). Only `--commit` names a durable immutable
object; `--uncommitted`, `--base` and `--custom` reviewed an ephemeral state
whose `identity:` value is what ties the report to the bytes it saw.

What the identity covers: the reviewed paths, the index, and the working-tree
status including ignored paths — so a file created or deleted anywhere in the
tree changes it. What it does **not** cover: an in-place rewrite of an existing
ignored file, and any write under `.git/`. An unflagged `identity:` therefore
means the reviewed change did not shift; it is not proof that the run modified
nothing.

Refusals are per scope, because they exist to stop a review of something
ambiguous:

| Scope | Fails closed when |
|---|---|
| `--uncommitted`, `--base`, `--custom` | the tree has unresolved merge entries, or a scoped path has live changes inside a submodule (`--custom` gets no empty-scope check) |
| `--commit` | the commit does not exist or is empty — a conflicted working tree is the caller's business, and a gitlink bump in the commit is an ordinary reviewed change |

Any `git` listing the wrapper cannot complete also fails closed with exit `11`.

## Reading The Report

Findings come back as Markdown on stdout:

```
<one-paragraph overall verdict>

- [P1] <title> — /abs/path/file.py:10-14
  <body>
```

Anchor on the `- [P<n>]` bullets, not the heading above them — it varies with
the number of findings. Priority runs `P0` (most severe) down to `P3`.

**No bullets is not, by itself, a clean review.** The wrapper accepts any
non-empty answer, so a genuine zero-finding report and one mangled by format
drift look identical to a parser that only counts bullets. Decide on the prose:

- No bullets **and** the text affirmatively says there is nothing to report →
  zero findings. Say so.
- No bullets and the text does not say that → **unparseable**. Relay it
  verbatim, say the `[P<n>]` structure was missing, and do not characterise it
  as clean.

Never report a verdict the output does not actually state.

## Reporting Duties

Follow SKILL.md § Reporting, plus:

1. Account for every finding with its priority, file, and line range. Do not
   silently drop low-priority findings.
2. Add a host-side trust line **per finding**: agree, disagree with reason, or
   needs-checking.
3. When stating the scope, say which kind it was: only `--commit` names a durable
   immutable object, while `--uncommitted`, `--base` and `--custom` are
   ephemeral. Relay the `identity:` value rather than implying the bytes were
   frozen.

For open questions rather than code changes, use consult mode instead.
