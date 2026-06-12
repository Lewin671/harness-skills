---
name: adversarial-code-review
description: >-
  Claude Code ONLY — requires the Workflow and Agent tools; do not use
  in Codex or any other harness. Use this skill when the user asks for
  a thorough, adversarial, or verified code review of a diff, branch,
  PR, or working-tree change — especially when they want low-noise
  findings backed by evidence, or hard proof such as a failing test
  that reproduces a bug. It orchestrates finder, skeptic, and red-team
  subagents: finders fan out per review lens, skeptics try to refute
  every finding (kills false positives), and red-team agents attack
  high-risk code directly (catches what finders miss). Pure review —
  it outputs a findings report and never modifies the working tree. Do
  not use for quick one-pass reviews (a single agent is cheaper) or
  when the user wants fixes applied.
harnesses: [claude-code]
---

# Adversarial Code Review

**Harness gate — read first.** This skill runs ONLY in Claude Code
with the Workflow and Agent tools available. If you are any other
agent, or those tools are missing, abort now: tell the user this
skill cannot run in this harness, and stop. Do not substitute a
degraded single-agent review, do not execute any phase below, and do
not run or modify anything in the user's working tree as a fallback.

Review a code change with two opposing adversarial mechanisms layered
on top of a multi-lens finder pass:

- **Skeptic refutation** raises precision: every finding must survive
  agents whose only job is to prove it wrong.
- **Red-team attack** raises recall: agents try to construct concrete
  inputs, call sequences, or timings that break the new code — with a
  real failing test when the repo supports it.

The deliverable is a report of verified findings plus explicit
residual risks. Never apply fixes; fixing is a separate task the user
must request afterwards.

## Hard Requirements

- Claude Code with the Workflow and Agent tools available — otherwise
  abort per the harness gate above. This skill explicitly instructs
  you to call Workflow — the user invoking this skill is the
  multi-agent opt-in.
- Never modify the user's working tree or index. Red-team tests run
  only in throwaway git worktrees (Workflow `isolation: 'worktree'`),
  discarded after the run.
- Tier every subagent's `model` per the `claude-code-model-routing`
  skill. Defaults below; its rules (verification floor, escalate once)
  override habit.

## Phase 0 — Scope and Effort

Resolve the review target in this priority order, and state the chosen
target before spawning anything:

1. A range, PR, or paths the user named explicitly.
2. Uncommitted changes (staged + unstaged) if any exist.
3. Current branch vs `merge-base` with the default branch.

If none of these yields a non-empty diff, stop and ask.

Size the diff and pick an effort tier. An explicit user request
("quick look" / "audit this thoroughly") overrides line counts.

| Tier | Trigger | Pipeline | Rough cost |
|------|---------|----------|------------|
| small | < ~200 changed lines | No workflow. One sonnet reviewer via the Agent tool, then one sonnet skeptic over its findings. If the reviewer flags the change as high-risk (auth, concurrency, money, data loss), recommend the full pipeline to the user in the report — never silently escalate. | under 1 USD |
| medium | default | Full pipeline; red team attacks only surviving critical findings. | ~3 USD |
| large | > ~800 lines, or user asked for thoroughness | Full pipeline; red team also attacks surviving major findings and every triage-flagged high-risk region. | 10+ USD |

For medium and large, orchestrate phases 1–3 as a single Workflow
invocation (`meta.phases`: Triage, Find, Refute, Attack). Triage is a
barrier (it selects the lenses); finders run parallel; the cross-lens
dedup before refutation is a justified barrier. There is NO barrier
between refutation and attack: each finding's red-team agent launches
as soon as that finding survives its skeptics (pipeline per finding).
On the large tier, high-risk-region red-team agents depend only on
triage — launch them immediately after triage, in parallel with the
finders.

## Phase 1 — Triage (one haiku agent)

One cheap agent reads the diff and returns structured output:

- `change_kind`: bug fix / feature / refactor / config / perf / mixed.
- `lenses`: 3–6 entries from the menu below, chosen for this change —
  not the whole menu. A refactor needs behavior-equivalence lenses; a
  config change needs environment-difference lenses.
- `high_risk_regions`: file/line ranges where a defect would be severe
  (changed locking order, boundary arithmetic, auth checks, retry or
  pagination logic…). These are later red-team targets and are
  independent of whether any finding lands there.
- `fast_tests`: whether the repo has test infrastructure a subagent
  could run a single new test in within ~2 minutes (look for test
  dirs, runner config, lockfiles — do not run the full suite).

Lens menu: logic correctness · boundary & error handling ·
concurrency/async · security · performance · API & backward
compatibility · test adequacy · data migration & config.

## Phase 2 — Finders (one sonnet agent per lens, parallel)

Each finder reviews the diff through exactly one lens and may read any
file in the repo for context. Prompt requirements:

- **Coverage, not filtering**: report everything found, including
  uncertain or low-severity items, with confidence marked —
  downstream verification does the filtering. Do not self-censor.
- **Evidence required**: every finding must cite `file:line` in the
  diff and quote the actual code. A finding without a concrete anchor
  is invalid output.
- Structured output, one record per finding:
  `{file, line, title, severity: critical|major|minor,
  confidence: high|medium|low, evidence, lens}`.

After all finders return, dedup in plain code in the script: findings
on the same root cause at the same location collapse to one record,
keeping the highest severity and merging evidence.

## Phase 3a — Skeptic Refutation (every finding)

Skeptics get one finding (or batch) plus repo access. The prompt is
unidirectional — never "is this finding correct?" but:

> Try to prove this finding wrong. Read the implementations, callers,
> and tests it depends on. Every refutation must be grounded in code
> you actually read and cited. If the finding itself lacks concrete
> code evidence, refute it by default. If you cannot refute it with
> evidence, it survives.

Tiered by severity:

- **minor** — batch all minor findings to one sonnet skeptic, which
  returns a per-finding verdict list.
- **major** — one sonnet skeptic per finding. If its verdict is
  uncertain or weakly grounded in cited code, escalate that one
  finding to one opus skeptic (escalate once, per
  `claude-code-model-routing`); if the opus verdict is still weak,
  surface the uncertainty. On the large tier, majors go straight to
  the critical panel below.
- **critical** — three sonnet skeptics per finding, each with
  a distinct lens: *code semantics* (does the implementation actually
  behave as claimed), *reachability* (can this path trigger under
  real conditions), *author intent* (do diff context and tests show
  this is deliberate). Majority refute → the finding is killed.

Verdict schema: `{finding_id, refuted: bool, reasoning, evidence}`.
Killed findings are not discarded silently — they go to the report's
residual-risks section as one-liners.

## Phase 3b — Red Team

Targets: (a) every surviving critical finding on the medium tier;
surviving critical and major findings on the large tier; (b) on the
large tier only, additionally every triage `high_risk_region` —
**even regions with zero findings**.
Channel (b) is what catches bugs no finder saw; it is the reason the
large tier costs more. One agent per target, model omitted so it
inherits the main loop (these verdicts are final — verification
floor).

The task is to construct a concrete counterexample — an input, call
sequence, or interleaving that makes the new code misbehave:

- If triage reported `fast_tests`, write a real failing test in an
  isolated worktree (`isolation: 'worktree'`), run it, and report the
  result. Never write into the user's tree.
- Otherwise, produce a reasoning counterexample: exact input, the
  step-by-step trace through the new code, and expected vs actual
  behavior.

Output grade: `reproduced` (test actually fails — attach the test
code) · `plausible` (concrete counterexample, not executed) · `held`
(tried, could not break it — name the attack vectors attempted).
A `reproduced` result is terminal evidence: it enters the report at
the top regardless of any skeptic verdict on the same code.

## Phase 4 — Report

Write the report as terminal markdown in your final message. Order:
`reproduced` findings first, then by severity. Each finding shows:

- severity, `file:line`, title, one-paragraph explanation;
- verification status — *reproduced by failing test* (include the
  test code), *survived 3-skeptic panel (N refute votes)*, or
  *survived single-skeptic check*; include *escalated to opus,
  unresolved* when an escalated major remains uncertain;
- a suggested direction for the fix (one sentence, not a patch).

End with a mandatory **Residual Risks** section: lenses not run;
killed findings (one line each, so a wrong kill is recoverable);
high-risk regions the red team did not attack and why; red-team
targets graded `held`; anything truncated or skipped. No silent caps.

If the user then asks to fix the findings, that is a new task outside
this skill — re-read the relevant code fresh rather than trusting the
report's snippets.

## Cost Levers

The red team dominates both cost and wall-clock (each target is an
agentic loop that may build and run a test). Keep it pointed only at
the targets defined above, and never put a barrier in front of it
that the data flow doesn't require. Triage on haiku and skeptics on
sonnet are deliberate — do not silently upgrade them; escalate a
single weak verdict one tier up per `claude-code-model-routing` rule
4 instead.
