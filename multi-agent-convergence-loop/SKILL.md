---
name: multi-agent-convergence-loop
description: Use this skill when the user wants a managed subagent loop that can involve multiple coding agents and multiple review agents, with only high-confidence findings accepted for fixes, and repeated review-fix-review iterations until no accepted issues remain. Good for full-project audits, large refactors, new feature delivery, or any task where convergence discipline matters more than a single-pass implementation.
---

# Multi-Agent Convergence Loop

Use this skill when the main agent should orchestrate a repeatable multi-agent loop instead of doing all coding directly.

The goal is convergence, not comment volume: keep only high-confidence problems, route them to the right coding owner, re-review the updated result, and stop only when no accepted issues remain.

## Main-agent role

The main agent owns scope control, file ownership, review triage, stop/go decisions, and final verification.

Coding agents own implementation inside assigned boundaries. Review agents own independent critique. Keep those roles separate unless a tiny local patch is clearly safer than another handoff.

## When to use this

Use it for:

1. New feature implementation where the user wants review-driven convergence.
2. Bug-fix or refactor work that spans multiple modules.
3. Full-project or large-scope audits followed by targeted repairs.
4. Existing diffs or PR-like changes that should be reviewed, fixed, and re-reviewed until clean.

Do not use it when the task is still exploratory, the acceptance target is unclear, or the codebase is too unknown to assign safe ownership.

## Preconditions

Before spawning agents:

1. Restate the request, constraints, and acceptance target in one compact brief.
2. Inspect the codebase enough to identify likely files, tests, risky integrations, and natural ownership boundaries.
3. Resolve material ambiguity before delegating if the result would otherwise be hard to review.
4. Decide whether the work is `implementation-first` or `audit-first`.
5. Pick the subagent or delegation tools that exist in the current environment. Keep the workflow portable; do not assume one specific tool name.

## Default topology

Start from the smallest topology that can still converge reliably.

- Default to one coding agent plus three independent review agents.
- Add more coding agents only when ownership boundaries are explicit and their write sets stay disjoint.
- Keep reviewers independent; light review bias is useful, but do not preload one reviewer with another reviewer's conclusions.

Good multi-coder splits:

1. Frontend vs backend.
2. API layer vs persistence layer.
3. Independent packages or services.
4. One coder per accepted issue cluster when file ownership is non-overlapping.

Bad multi-coder splits:

1. Several coders editing the same module without explicit ownership.
2. Artificial parallelism where the next step depends on one shared blocking change.
3. Splits based on reviewer opinion instead of code boundaries.

## Ownership briefs

Start each loop with a scope brief that records the request, constraints, acceptance target, target files or modules, and the verification plan.

For each coding agent, include:

1. The exact behavior to implement or defect to fix.
2. File or module ownership.
3. Required tests, checks, or manual verification.
4. Constraints:
   - other agents may be active;
   - do not revert unrelated edits;
   - adapt to changes made by other agents;
   - report changed files, test results, and remaining risks.

For each review agent, ask for:

1. Findings first, ordered by severity.
2. Concrete bugs, regressions, missing tests, unsafe assumptions, or integration risks.
3. File and line references where possible.
4. No deference to other reviewers.

Use [`references/brief-templates.md`](./references/brief-templates.md) when you want a ready-to-send scope brief, coding brief, reviewer brief, or issue-group summary format.

## First pass

### Implementation-first

1. Spawn the needed coding agents.
2. Wait for code to exist.
3. Run independent review agents on the resulting diff or target scope.

### Audit-first

1. Spawn independent review agents on the target scope first.
2. Normalize the accepted findings into issue groups.
3. Assign each accepted issue group to one coding owner.

For full-project audits, prefer one of these review patterns:

1. Whole-project reviewers plus one cross-cutting integration review.
2. Per-slice reviewers for major subsystems plus one reviewer on the combined impact.

Do not let every reviewer inspect every file if the repository is large and the result will be shallow noise.

## Review aggregation

Only feed accepted findings back into coding loops.

Accept a finding when at least one of these is true:

1. Two or more reviewers independently identify the same underlying defect.
2. One reviewer reports a clearly severe issue such as broken core behavior, a reproducible crash, data loss or corruption, a security or privacy exposure, or failing tests tied to the change.
3. The finding is directly supported by a spec mismatch, failing command, or local reproduction by the main agent.

Reject or defer findings that are only style preferences, speculative refactors, duplicate wording for the same issue, or unsupported hypotheses.

Group findings by underlying defect, not by wording or exact line number. Record the owner, severity, evidence, and required verification for each accepted issue group. Use [`references/review-triage.md`](./references/review-triage.md) when overlap is not obvious or when another loop is being considered.
Rewrite accepted findings into a clean fix brief instead of dumping raw reviewer output back onto coding agents.

## Fix loop

For each iteration:

1. Keep only the accepted issue groups.
2. Map each group to one coding owner.
3. Send each coding agent a narrowed fix brief containing only the accepted issues in its boundary.
4. Re-run relevant tests or checks.
5. Re-run independent review on the updated result.

If multiple coding agents are active, prefer parallel fixes only when their write sets stay disjoint. If accepted issues cross ownership boundaries, handle them in sequence and re-baseline before the next split.

Prefer reusing the same coding agent thread when the context still helps. Spawn a fresh coding agent when the thread has drifted, the ownership boundary changes, or the agent repeatedly misses the same accepted issue.

Refresh review agents as needed to preserve independence. A fresh review pass is usually better than teaching an old reviewer what to think.

## Stop condition

Stop only when all are true:

1. No accepted issue groups remain.
2. No singleton finding is severe enough to block completion.
3. Relevant tests or checks have passed, or any unrun verification is explicitly called out.

If reviewers still produce comments but none clear the acceptance bar, treat them as non-blocking notes rather than another forced loop.

## Final verification

Before closing:

1. Inspect the final diff or changed files yourself.
2. Run the most relevant tests or verification commands yourself when feasible.
3. Confirm the original request is satisfied.
4. Report residual risks, especially around untested integrations or manual-only flows.

## Response rhythm

Use a compact orchestration pattern in the main thread:

1. Confirm scope, acceptance target, and chosen topology.
2. Announce coding ownership assignments.
3. Announce review pass.
4. Summarize accepted issue groups and whether another fix loop is required.
5. Finish with verification status and any non-blocking residual notes.

## Example triggers

1. "Use subagents to implement this across multiple modules, then keep reviewing and fixing until there are no real issues left."
2. "Do a whole-project audit with review agents, fix only high-confidence findings, and repeat until clean."
3. "I want multiple coding agents, but only accepted review findings should go back into the next round."
4. "Run a review-fix-review convergence loop for this feature instead of a single implementation pass."
