---
name: codex-review
description: >-
  Claude Code ONLY — do not use in Codex, which has its own built-in
  /review. Use this skill in Claude Code when the user wants a second
  opinion on a code change from Codex (OpenAI models) — phrasings like
  "let codex review this", "cross-check with codex", "review with
  another model", or when a Claude-side review is contested and an
  independent reviewer would settle it. It shells out to
  `codex exec review` in read-only mode over uncommitted changes, a
  base branch, or a single commit, then reports the findings verbatim
  with a trust assessment. Pure review — it never edits the working
  tree. Do not use for reviews Claude should do itself, or when the
  `codex` CLI is not installed.
harnesses: [claude-code]
---

# Codex Review

Run OpenAI's Codex as an independent reviewer over a change, from
inside Claude Code. The value is model diversity: a reviewer that did
not write the code and does not share Claude's blind spots.

Read-only by design. This skill never writes to the working tree, and
must never be used to apply fixes.

## Preflight

1. Resolve the binary. Use `CODEX_BIN` if the user set it, else
   `codex`. Verify with `"$CODEX_BIN" --version` — do not assume.
   If it fails, tell the user Codex is unavailable and stop. Do not
   substitute a Claude-side review silently.
   - `codex` is often a shell function or an npm shim whose vendored
     binary is missing. A failing `--version` usually means a broken
     install, not a missing one; suggest `codex update` or point at a
     working install path, and let the user pick.
2. Confirm the repo is a git worktree and the intended change exists
   (`git status --short`, or `git log` for a commit target).
3. Pick exactly one scope with the user's intent, defaulting to
   uncommitted work.

## Command

```bash
OUT="$(mktemp "${TMPDIR:-/tmp}/codex-review-XXXXXX")"
"$CODEX_BIN" exec review --uncommitted \
  -c sandbox_mode="read-only" \
  -o "$OUT" >/dev/null 2>&1
```

Scope flags, mutually exclusive:

| Flag | Reviews |
|------|---------|
| `--uncommitted` | staged + unstaged + untracked |
| `--base <BRANCH>` | current branch against that branch |
| `--commit <SHA>` | that one commit |

Then `Read` the file at `OUT`. Never dump the raw event stream at the
user.

Notes on the invocation:

- Use `codex exec review`, never bare `codex review` — the bare form
  drives the TUI and has no `-m`, no `-o`, no `--json`.
- `mktemp` puts the output outside the repo. This matters: a file
  written inside the reviewed repo gets picked up by Codex's own
  `grep`/`ls` sweeps and pollutes the review.
- `-c sandbox_mode="read-only"` is required. `exec review` has no
  `-s/--sandbox` flag, so this config override is the only way to
  guarantee read-only. Never pass any
  `--dangerously-bypass-*` flag.
- Set the Bash tool `timeout` to at least `600000`. Reviews routinely
  run for minutes; the 120s default will kill them mid-run.
- Append a custom instruction as a positional argument when the user
  has a specific concern (`... --uncommitted "Focus on concurrency and
  error handling"`). It supplements Codex's built-in review prompt.
- Omit `-m` by default and inherit the user's configured model. Pass
  `-m` only on an explicit request, or to escalate one tier after a
  weak first pass.

## Reading The Result

Codex emits Markdown in a fixed shape:

```
<one-paragraph overall verdict>

Review comment:

- [P1] <title> — /abs/path/file.py:7-7
  <body>
```

Priority runs `P1` (most severe) downward. Zero findings reads as a
plain sentence such as "no discrete issues" — there is no empty list
to parse.

Two failure modes that both look like success:

- **Exit code is not a verdict.** A P1 finding exits `0`. So does a
  clean review. Only a real failure (bad model name, auth, no git
  repo) exits nonzero. Never gate on the exit code alone.
- **Empty scope reads as a pass.** With no changes in scope, Codex
  reports "There are no staged, unstaged, or untracked changes",
  which is not a clean bill of health. Check `git status` first and
  say so plainly if the scope was empty.

## Reporting

1. Relay every finding with its priority, file, and line range. Do
   not silently drop low-priority ones.
2. Add a Claude-side trust line per finding: agree, disagree with
   reason, or needs-checking. You have repo context Codex lacks, and
   Codex has no stake in defending code Claude wrote.
3. Flag disagreements explicitly rather than averaging them away. A
   contested finding is the most useful output this skill produces.
4. State the scope reviewed and the model used, so the result is
   reproducible.
5. Stop there. Applying fixes is a separate, user-authorized step.

## Boundaries

- Not a replacement for `adversarial-code-review`. That skill runs a
  deep multi-agent Claude review with skeptics and red teams; this one
  buys a cheap, fast, independent second opinion. Running both on a
  high-stakes change is reasonable — Codex first, since it is cheaper.
- Do not chain into `codex exec` for anything but review, and never
  into `codex apply`. Both write.
- If Codex returns nothing usable twice, report that honestly instead
  of paraphrasing a weak result into confidence.
