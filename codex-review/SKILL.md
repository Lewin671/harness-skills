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

Set the Bash tool `timeout` to at least `600000`. Reviews routinely
run for minutes; the 120s default kills them mid-run.

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

Other options: `--model`, `--effort low|medium|high|xhigh`, `--repo`,
`--keep-log`. Omit `--model` by default and inherit the user's
configured model; escalate one tier only after a weak first pass.
**When you do pass `--model`, pass `--effort` too** — the user's
configured default effort may be rejected by the model you asked for,
and the run fails a minute in.

## Exit Codes

The script's exit code is the verdict on *the run*, never on the code:

| Code | Meaning | What to do |
|------|---------|------------|
| `0` | A report was produced | Read stdout. Findings or not, both are `0`. |
| `2` | Nothing in scope | Tell the user the scope was empty. This is **not** a clean bill of health. |
| `3` | Environment problem | No `codex`, not a git tree, bad flags. Report it; do not silently substitute a Claude review. |
| `4` | Codex ran and failed | Read the hint on stderr. Usually a model/effort mismatch — retry once with an explicit `--effort`. |

Codex's own exit code is `0` for both a P1 finding and a clean review,
so never gate on it directly. That is why this script exists.

## Reading The Result

Findings come back as Markdown on stdout, in a fixed shape:

```
<one-paragraph overall verdict>

Review comment:

- [P1] <title> — /abs/path/file.py:7-7
  <body>
```

Priority runs `P1` (most severe) downward. Zero findings reads as a
plain sentence, not an empty list.

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
  buys a cheap, fast, independent second opinion. Running both on a
  high-stakes change is reasonable — Codex first, since it is cheaper.
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
