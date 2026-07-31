---
name: adversarial-code-review
description: >-
  Claude Code ONLY — requires the Workflow and Agent tools; do not use
  in Codex or any other harness. Use only when the user explicitly
  names adversarial-code-review or explicitly asks for its
  falsification contract: severity-tiered skeptic refutation, red-team
  counterexamples or executable failing tests in throwaway worktrees,
  and a residual-risk ledger that records killed findings. For
  ordinary, quick, thorough, deep, or high-effort code review, use
  Claude Code's native /code-review flow instead, including its
  deepest tier when appropriate. Pure review — it outputs a findings
  report and never modifies the working tree; do not use when fixes
  are wanted.
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

## Positioning

This skill is an explicit opt-in, not the default deep review. Reach
for it only when the user names it or asks for its falsification
contract in their own words; do not infer invocation from "thorough",
"deep", "verified", or "high effort" — those route to the native
/code-review flow. What this skill guarantees beyond that flow is an
auditable falsification *procedure*: every reported finding survived
named skeptics, red-team attacks are graded and reported even when
they fail, and killed findings stay visible in the residual-risk
ledger.

## Hard Requirements

- Claude Code with the Workflow and Agent tools available — otherwise
  abort per the harness gate above. This skill explicitly instructs
  you to call Workflow — the user invoking this skill is the
  multi-agent opt-in.
- Never modify the user's working tree or index. Red-team tests run
  only in throwaway git worktrees (Workflow `isolation: 'worktree'`),
  discarded after the run.
- Tier every subagent's `model` per the defaults below. The tier
  names (`haiku`/`sonnet`/`opus`) are rolling aliases and role
  *defaults*, not permanent model identities: pass only values the
  live Workflow/Agent schema declares, map a missing alias to the
  nearest declared tier, and announce that substitution before
  launching. Two rules override habit: the *verification floor* — an agent that judges or
  refutes another agent's findings runs at least the tier that
  produced them, higher when its verdict is final — and *escalate
  once* — a weak or uncertain result is rerun exactly one tier up,
  never retried at the same settings and never silently accepted.

## Phase 0 — Scope and Effort

Resolve the review target in this priority order, and state the chosen
target before spawning anything:

1. A range, PR, or paths the user named explicitly.
2. Uncommitted changes (staged + unstaged) if any exist.
3. Current branch vs `merge-base` with the default branch.

If none of these yields a non-empty diff, stop and ask.

Size the diff and pick an effort tier. An explicit user request
("compact pass" / "maximum coverage") overrides line counts. Announce
the chosen tier, the model role assignments, and the planned fan-out
before spawning anything; broadening coverage beyond the tier's
definition requires the user's approval — never silently escalate.

| Tier | Trigger | Pipeline | Relative spend |
|------|---------|----------|------|
| small | < ~200 changed lines | Compact contract, no workflow: one finder (default: sonnet) via the Agent tool, then one skeptic (default: sonnet) over its findings; red team runs only if a critical finding survives the skeptic. The Residual Risks ledger is still mandatory. If the finder flags the change as high-risk (auth, concurrency, money, data loss), recommend the full pipeline in the report. | low |
| medium | default | Full pipeline; red team attacks only surviving critical findings. | medium |
| large | > ~800 lines, or user asked for maximum coverage | Full pipeline; red team also attacks surviving major findings and every triage-flagged high-risk region. | high |

The spend column is deliberately relative: per-run cost varies with
model pricing, diff size, findings, and red-team test loops, so a
fixed currency estimate would only go stale. The concrete cost driver
is the fan-out you announce up front.

For medium and large, orchestrate phases 1–3 as a single Workflow
invocation (`meta.phases`: Triage, Find, Refute, Attack). Triage is a
barrier (it selects the lenses); finders run parallel; the cross-lens
dedup before refutation is a justified barrier. There is NO barrier
between refutation and attack: each finding's red-team agent launches
as soon as that finding survives its skeptics (pipeline per finding).
On the large tier, high-risk-region red-team agents depend only on
triage — launch them immediately after triage, in parallel with the
finders.

## Phase 1 — Triage (one agent, default: haiku)

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

## Phase 2 — Finders (one agent per lens, parallel, default: sonnet)

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

- **minor** — batch all minor findings to one skeptic (default:
  sonnet), which returns a per-finding verdict list.
- **major** — one skeptic (default: sonnet) per finding. If its
  verdict is uncertain or weakly grounded in cited code, escalate
  that one finding to a skeptic one tier up (default: opus; escalate
  once); if that verdict is still weak, surface the uncertainty. On
  the large tier, majors go straight to the critical panel below.
- **critical** — three skeptics (default: sonnet) per finding, each with
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

- When the repository supports it (triage reported `fast_tests`), the
  agent **must** create and run a focused failing test in an isolated
  worktree (`isolation: 'worktree'`) and report the result. Never
  write into the user's tree.
- Only when executable reproduction is unavailable, produce a
  reasoning counterexample: exact input, the step-by-step trace
  through the new code, and expected vs actual behavior.

Output grade: `reproduced` (test actually fails — attach the test
code) · `plausible` (concrete counterexample, not executed — valid
only where executable reproduction was unavailable) · `held` (tried,
could not break it — name the attack vectors attempted). A failed
attack is reported as `held`, never silently dropped.
A `reproduced` result is terminal evidence: it enters the report at
the top regardless of any skeptic verdict on the same code.

## Phase 4 — Report

Write the report as terminal markdown in your final message. Order:
`reproduced` findings first, then by severity. Each finding shows:

- severity, `file:line`, title, one-paragraph explanation;
- verification status — *reproduced by failing test* (include the
  test code), *survived 3-skeptic panel (N refute votes)*, or
  *survived single-skeptic check*; include *escalated a tier,
  unresolved* when an escalated major remains uncertain;
- a suggested direction for the fix (one sentence, not a patch).

End with a mandatory **Residual Risks** section — on every tier,
including a zero-finding review: lenses not run;
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
that the data flow doesn't require. The triage and skeptic defaults
(haiku/sonnet) are deliberate — do not silently upgrade them;
escalate a single weak verdict one tier up (escalate once) instead.
