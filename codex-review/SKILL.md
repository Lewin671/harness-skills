---
name: codex-review
description: >-
  Claude Code ONLY — do not use in Codex, which has its own built-in
  /review. Use this skill in Claude Code when the user wants a second
  opinion on a code change from Codex (OpenAI models) — phrasings like
  "let codex review this", "cross-check with codex", "review with
  another model", or when a Claude-side review is contested and an
  independent reviewer would settle it. It runs `codex exec review` in
  read-only mode over uncommitted changes, a base branch, a single
  commit, or free-form instructions, then reports the findings verbatim
  with a trust assessment. Pure review — it never edits the working
  tree. Do not use for reviews Claude should do itself, or when the
  `codex` CLI is not installed.
harnesses: [claude-code]
---

# Codex Review

Run OpenAI's Codex as an independent reviewer over a change, from
inside Claude Code. The value is model diversity: a reviewer that did
not write the code and does not share Claude's blind spots.

Read-only by design. Never use this skill to apply fixes.

## Usage

Run the `run-codex-review` script that sits next to this SKILL.md —
usually `~/.claude/skills/codex-review/run-codex-review`. It handles
the parts that fail silently when hand-rolled: read-only enforcement,
output placement, empty-scope detection, mutually exclusive flags.

```bash
~/.claude/skills/codex-review/run-codex-review --repo /path/to/repo --uncommitted
```

If that path does not exist, locate the script beside this file rather
than reconstructing the command by hand.

**Always run it with `run_in_background: true`.** The default reviewer
is the strongest model at maximum reasoning effort: a two-file, 374-line
diff blew past the Bash tool's 10-minute ceiling, and a tiny one still
took 100s. Foreground runs are a coin flip, and losing costs the whole
review. Start it in the background, then do other work or wait for the
completion notification — never `sleep`-poll for it.

### Is it still running, or hung?

The script streams a bounded progress feed to stderr — one truncated
line per Codex event — so the background task's output file grows in
real time and stays small. A full review of a small diff produced 19
lines, 3 KB. Read that file to check:

- New `item.started` / `item.completed` lines → working; Codex is
  reading files and running git commands.
- Nothing new for several minutes → likely stalled on the model side.
- `report:` line → finished; the report is on stdout.

The feed is deliberately `--json`, one line per event, **not** Codex's
default human stream. That default echoes the full output of every
command Codex runs — entire `git diff`s, entire directory listings —
which runs to thousands of lines and will blow up the context of
whoever reads it.

The script also prints `log: <path>` at startup. That file holds the
same stream **untruncated**, so `tail` it for diagnostics; never read
it whole for the same reason.

Scope — exactly one, and they cannot be combined:

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

## Model

The script defaults to the strongest available model at maximum
reasoning effort, and **you should normally leave that alone**. A
second opinion that is weaker than the first opinion is not worth the
round trip; latency is the wrong thing to optimise here.

Override only on an explicit request:

- `--model <MODEL> --effort <LEVEL>` — always pass both. A weaker model
  rejects the default `max` effort and the run dies a minute in.
- `--inherit` — use the user's own codex config instead.

If the pinned default model has gone stale, the script says so and
retries once on the user's configured model. Relay that warning: the
review still ran, but not on the tier it promised.

## Exit Codes

The script's exit code is the verdict on *the run*, never on the code:

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A report was produced | Read stdout. Findings or not, both are `0`. |
| `2` | Nothing in scope | Tell the user the scope was empty. This is **not** a clean bill of health. |
| `3` | Environment problem | No `codex`, not a git tree, bad flags. Report it; do not silently substitute a Claude review. |
| `4` | Codex ran and failed | Read stderr. A model/effort mismatch is retried automatically, so a `4` means both attempts failed. |

Codex's own exit code is `0` for both a P1 finding and a clean review,
so never gate on it directly. That is why this script exists.

## Reading The Result

Findings come back as Markdown on stdout:

```
<one-paragraph overall verdict>

Full review comments:

- [P1] <title> — /abs/path/file.py:10-14
  <body>
```

Anchor on the `- [P<n>]` bullets, not on the heading above them — it
varies with the number of findings ("Review comment:" for one, "Full
review comments:" for several). Priority runs `P1` (most severe)
downward. Zero findings reads as a plain sentence with no bullets at
all, not an empty list.

## Reporting

1. Relay every finding with its priority, file, and line range. Do not
   silently drop low-priority ones.
2. Add a Claude-side trust line per finding: agree, disagree with
   reason, or needs-checking. You have repo context Codex lacks, and
   Codex has no stake in defending code Claude wrote.
3. Flag disagreements explicitly rather than averaging them away. A
   contested finding is the most useful output this skill produces.
4. State the scope reviewed and the model used, so it is reproducible.
5. Stop there. Applying fixes is a separate, user-authorized step.

## Boundaries

- Not a replacement for `adversarial-code-review`. That skill runs a
  deep multi-agent Claude review with skeptics and red teams; this one
  is a single strong reviewer from a different model family. They are
  complementary, not ranked — running both on a high-stakes change is
  reasonable. Neither is the cheap option.
- Never invoke `codex apply`, and never pass any `--dangerously-bypass-*`
  flag. Both routes can write.
- If Codex returns nothing usable twice, say so honestly instead of
  paraphrasing a weak result into confidence.

## Why The Script Looks Like That

Verified against `codex-cli 0.146.0`; recheck if these stop holding.

- Only `codex exec review` is scriptable. Bare `codex review` drives
  the TUI and has no `-m`, `-o`, or `--json`.
- `exec review` has **no `-s/--sandbox` flag**. Read-only is reachable
  only via `-c sandbox_mode="read-only"`.
- The positional `[PROMPT]` is **mutually exclusive with all three
  scope flags** — hence `--custom` being its own scope rather than a
  modifier.
- The report file must live outside the reviewed repo. A file written
  inside it gets picked up by Codex's own `grep`/`ls` sweeps and
  pollutes the review.
- `--output-schema` is silently ignored by `exec review` (an invalid
  schema that makes plain `codex exec` fail with a 400 produces no
  error here). Structured findings do exist, but only in the rollout
  session file under `CODEX_HOME/sessions`, as
  `exited_review_mode.review_output`. Parsing that is a possible future
  addition; it would break under `--ephemeral`.
- The default model slug is pinned in the script, which will go stale.
  That is why a rejected model triggers one automatic retry on the
  user's config instead of a hard failure.
