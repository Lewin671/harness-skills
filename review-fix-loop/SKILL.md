---
name: review-fix-loop
description: Use this skill when a code change, diff, PR-like patch,
  skill, doc, prompt, config, or runbook needs repeated review,
  triage, fix, and verification loops until only verified issues or
  explicit residual risks remain. Use it when acceptance criteria and
  ownership boundaries are concrete, and when the work may need
  isolated reviewers or serialized local review passes to converge.
---

# Review-Fix Loop

Use this skill when the main agent should run a repeatable
review-triage-fix-verify loop instead of treating the task as one-pass
implementation.

The goal is convergence, not comment volume: keep only
high-confidence, anchored problems; feed only accepted issues into the
next fix pass; and stop only when verification and closeout are
explicit.

## Quick Start

1. Write a short scope brief with the request, constraints, acceptance
   target, artifact type, scope boundary, verification anchors, and
   environment limits. Use
   [`references/brief-templates.md`](./references/brief-templates.md).
2. Choose the mode:
   - `audit-first` for an existing diff, skill, doc, prompt, config,
     runbook, or other in-flight artifact.
   - `implementation-first` for concrete new work with no meaningful
     existing diff.
   - `mixed handoff` when you must audit existing work before adding
     follow-on changes.
3. Choose the smallest topology that can converge:
   - non-code artifacts: one coding owner plus two review passes;
   - code or mixed artifacts: one coding owner plus three review passes;
   - no safe delegation: one owner plus serialized fresh review passes.
4. Run isolated review, accept only findings with concrete anchors, and
   group accepted findings into stable issue ids.
5. Send narrowed fix briefs that reference issue ids, ownership
   boundary, evidence, base state, and verification to rerun.
6. Re-run boundary-specific verification, then re-run review, update the
   loop ledger, and close only when no accepted `blocking` or `major`
   issues remain.

If you are improving a skill itself, default to `audit-first` and treat
the artifact as a mixed doc-plus-prompt surface: review the trigger
wording, decision order, defaults, reference map, and closeout
contract, not just prose quality.

## Use It When

Use it for:

1. New feature work where the user wants review-driven convergence.
2. Bug fixes or refactors that cross modules or integration points.
3. Existing diffs, PR-like changes, or audits that need
   review-fix-review until clean.
4. Skills, docs, prompts, configs, or runbooks where the acceptance
   target is concrete and operator behavior matters.

Do not use it when the task is exploratory, the acceptance target is
unclear, or safe ownership boundaries cannot be identified yet.

## Required Inputs

Before starting the loop, make sure you can state:

- the request and acceptance target;
- the artifact type and exact review boundary;
- the most relevant verification anchors;
- whether owners can edit directly or only propose patches;
- whether review can be isolated from implementation;
- the base state, branch, ref, or diff anchor to use.

If one of these is missing, inspect the environment and infer it before
delegating. Do not start multi-pass review against a vague boundary.

## Default Operating Posture

Use these defaults unless the task clearly needs something else:

- Prefer `audit-first` for any in-flight artifact.
- Prefer fewer accepted findings with stronger anchors over long lists
  of plausible comments.
- Keep coding ownership narrow and explicit.
- Keep review isolated: separate prompts, threads, or fresh phases.
- If no safe subagent or parallel primitive exists, use serialized local
  review with at least two fresh review phases and report the result as
  self-reviewed, not independently reviewed.

Use
[`references/topology-playbook.md`](./references/topology-playbook.md)
when you need the topology matrix, the serialized fallback recipe,
artifact-specific review lenses, or stalled-loop recovery.

## Execution Rules

### Mode Behavior

Execute the chosen mode literally:

- `implementation-first`: assign the coding owner first, let the change
  exist, then review the resulting diff or boundary.
- `audit-first`: review the target scope first, normalize accepted
  findings into issue ids, then send fix briefs.
- `mixed handoff`: audit the in-flight artifact first, then switch to
  `implementation-first` only for accepted follow-on work inside the
  chosen boundary.

### Capability Rules

Treat roles as capabilities, not product names:

- A coding owner may edit files directly or return a patch for the main
  agent to apply.
- A review owner critiques only.
- If one system alternates between coding and review, separate those
  passes with distinct prompts, threads, or self-review phases.
- If owners do not share the same worktree state, define the base ref,
  diff anchor, or reconciliation contract before work starts.

Keep handoffs tight:

- point to files, diffs, commands, interfaces, and invariants instead of
  pasting long transcripts;
- do not dump raw reviewer output into coding briefs;
- tell each coding owner what is in scope, what is out of scope, and
  what verification must rerun.

### Review Rules

Keep review passes isolated and machine-checkable:

- Do not give one reviewer another reviewer's conclusions unless the
  task is explicitly to validate one named issue.
- Give each reviewer the target scope, artifact type, one review lens if
  useful, and the exact output contract.
- A valid finding includes a severity, one concrete evidence anchor, and
  one confirming check the main agent can run.
- Reject style-only comments, vague discomfort, duplicate wording
  without new evidence, and "might be wrong" speculation.
- If you must self-review serially, keep earlier accepted summaries out
  of the next review unless validating a named issue.

### Acceptance And Triage

Feed only accepted findings back into the next coding pass.

Accept a finding only when it has a concrete anchor such as:

- a spec mismatch;
- a failing command or check;
- reproducible manual behavior;
- direct code-path evidence;
- a broken rendered artifact;
- a prompt, config, or skill failure the main agent can verify.

Do not accept a finding just because:

- two reviewers said similar things without a concrete anchor;
- it sounds plausible but cannot be verified from the artifact or
  environment;
- it is a style preference with no correctness, usability, or
  integration consequence.

Use
[`references/review-triage.md`](./references/review-triage.md)
to merge overlap, assign severity, decide dispositions, and determine
whether another loop is required.

Rewrite accepted findings into a clean fix brief instead of forwarding
raw reviewer output.

### Fix Loop

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Carry forward each issue id with a disposition of `open`, `fixed`,
   `disproved`, or `downgraded`.
3. Map each accepted open issue group to one coding owner.
4. Send narrowed fix briefs with the exact issue id, evidence, boundary,
   base state, and verification to rerun.
5. Re-run boundary-specific verification.
6. Re-run isolated review on the updated result.
7. Write a short loop ledger that records each issue id, its
   disposition, what verification ran, and whether another loop is
   required.

If the same accepted issue survives two loops, change the topology:
tighten the brief, shrink the boundary, rotate the owner or reviewer,
deepen verification, or fall back to one-owner serialized repair.

If serialized repair still cannot clear a `blocking` or `major` issue,
stop looping and report the work as blocked with the latest evidence,
verification status, and next decision needed.

## Output Contracts

Make these artifacts explicit during the run:

- scope brief before substantive work;
- review brief for each review pass;
- accepted issue-group summary after triage;
- loop ledger after each fix iteration;
- final status before closing.

Use
[`references/brief-templates.md`](./references/brief-templates.md)
for the canonical shapes. If the task is small, shorten the wording, but
do not drop the fields that make the loop auditable.

## Stop Only When

All are true:

1. No accepted `blocking` issue groups remain.
2. No accepted `major` issue groups remain unless they were explicitly
   downgraded with rationale.
3. No singleton finding is severe enough to promote.
4. Required verification passed for each changed boundary.

If an automated check is infeasible, replace it with one explicit manual
verification note for that boundary and record the limitation. If the
loop ran without independent reviewers, say so explicitly before
closing.

## Final Closeout

Before closing:

1. Inspect the final diff or changed files yourself.
2. Run the most relevant verification yourself when feasible.
3. Confirm the original request is satisfied.
4. Report residual risks, especially around integrations, manual-only
   flows, or artifact checks that could not be automated.

Final status should always make these explicit:

- whether the original request is satisfied;
- which verification ran and what passed, failed, or was infeasible;
- the final disposition of each accepted issue id;
- whether review confidence came from independent reviewers or
  serialized self-review;
- any residual risks that still matter.

## Common Failure Modes

Avoid these:

- mixing implementation and review in the same pass when isolation is
  possible;
- handing raw reviewer transcripts to the coding owner;
- widening scope mid-loop without re-briefing the boundary;
- reopening already-disproved issues because wording changed;
- closing after "looks good" without a concrete verification rerun;
- presenting serialized self-review as if it were independent review;
- looping forever instead of reporting a real block.

## Read Next

- Use
  [`references/brief-templates.md`](./references/brief-templates.md)
  for scope, coding, review, loop-ledger, and final-status templates.
- Use
  [`references/topology-playbook.md`](./references/topology-playbook.md)
  for mode selection, topology sizing, serialized fallbacks, and
  artifact-specific review.
- Use
  [`references/review-triage.md`](./references/review-triage.md)
  for overlap handling, severity rules, dispositions, and loop
  decisions.
