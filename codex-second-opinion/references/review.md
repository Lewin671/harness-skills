# Review Mode

`run-codex-second-opinion review` runs `codex exec review` as an
independent reviewer over a change and prints the report to stdout.

## Scope

Exactly one, and they cannot be combined:

| Flag | Reviews |
|------|---------|
| `--uncommitted` (default) | staged + unstaged + untracked |
| `--base <BRANCH>` | current branch against that branch |
| `--commit <SHA>` | that one commit |
| `--custom "<TEXT>"` | whatever the instructions describe |

Pick `--custom` only when the user has a specific concern that the
built-in review prompt would not prioritise. It replaces the built-in
prompt rather than supplementing it, and it cannot be narrowed to a
scope flag — say what to look at inside the text itself.

Keep an independent first review unseeded: provide the change and its
intended behaviour without Claude's suspected findings. If the user asks
Codex to adjudicate a specific finding, use `--custom` and label the result
as a targeted cross-check rather than a blind review.

## Context

A scope flag carries the diff and nothing else. When the review needs to
know what the change was *meant* to do — a refactor that must preserve
behaviour, a constraint that is not visible in the diff, a
performance-driven rewrite — pass that background with `--context`:

```
review --repo /path --base main \
  --context "Extracts the retry loop into retry(); behaviour must be
             unchanged. Callers in jobs/ rely on the old back-off timing."
```

Keep it to intended behaviour, facts, and constraints. Claude's
suspected defects do not belong there — that is a cross-check, and it
belongs in `--custom` with the result labelled accordingly. The prompt
tells Codex to treat the background as something to check the code
against, not to accept: where code and stated intent disagree, that
mismatch is itself a finding.

One trade-off is worth knowing, because it is not free. `codex exec
review` refuses a scope flag and a prompt in the same invocation, so
with `--context` the scope reaches Codex as prose ("review the diff from
`git merge-base main HEAD` to the working tree") instead of as a flag.
The empty-scope precheck still runs on the real flag, so an empty scope
still exits `2` — but what Codex ends up diffing is now
prompt-described, and can drift. Without a genuine need for context,
prefer the plain scope flag.

`--context` cannot be combined with `--custom`: custom instructions
already are free-form text carrying their own scope.

The script refuses to spend minutes on an empty scope: a clean tree,
an empty commit, or no changes since the merge base exit `2` before
Codex is ever invoked. Codex itself reports "there are no changes" as
an ordinary successful review, which reads like a pass — that is the
misreport the precheck exists to prevent.

## Reading The Report

Findings come back as Markdown on stdout:

```
<one-paragraph overall verdict>

Full review comments:

- [P1] <title> — /abs/path/file.py:10-14
  <body>
```

Anchor on the `- [P<n>]` bullets, not on the heading above them — it
varies with the number of findings ("Review comment:" for one, "Full
review comments:" for several). Priority runs `P0` (most severe: a
release blocker or critical failure) down to `P3`. Zero findings reads
as a plain sentence with no bullets at all, not an empty list.

## Reporting Duties

1. Account for every finding with its priority, file, and line range.
   Summarise repetitive detail if useful, but do not silently drop
   low-priority findings.
2. Add a Claude-side trust line per finding: agree, disagree with
   reason, or needs-checking. You have repo context Codex lacks, and
   Codex has no stake in defending code Claude wrote.
3. Flag disagreements explicitly rather than averaging them away. A
   contested finding is the most useful output review mode produces.
4. State the scope reviewed and the model used, so it is reproducible.
5. Stop there. Applying fixes is a separate, user-authorized step.

For open questions rather than code changes, use consult mode instead:
it returns a reasoned position instead of a defect list.
