---
name: multi-agent-convergence-loop
description: Use this skill when the user wants a managed subagent loop that can involve multiple coding agents and multiple review agents, with only high-confidence findings accepted for fixes, and repeated review-fix-review iterations until no accepted issues remain. Good for full-project audits, large refactors, new feature delivery, or any task where convergence discipline matters more than a single-pass implementation.
---

# Multi-Agent Convergence Loop

Use this skill when the main agent should orchestrate a repeatable loop instead of doing the coding directly.

The goal is not "collect lots of comments." The goal is convergence: keep only high-confidence problems, route them to the right coding agent, re-review the updated result, and stop only when no accepted issues remain.

## Main-agent role

The main agent owns:

1. Scope control.
2. File and module ownership.
3. Review triage.
4. Stop/go decisions for another loop.
5. Final verification and user-facing summary.

Coding agents own implementation inside their assigned boundaries. Review agents own independent critique. Do not blur those roles unless a tiny local patch is faster and clearly safer than another handoff.

## When to use this

Use it for:

1. New feature implementation where the user wants review-driven convergence.
2. Bug-fix or refactor work that spans multiple modules.
3. Full-project or large-scope audits followed by targeted repairs.
4. Existing diffs or PR-like changes that should be reviewed, fixed, and re-reviewed until clean.

Do not use it when the task is still exploratory, the acceptance target is unclear, or the codebase is too unknown to assign safe ownership.

## Phase 1: Scope and topology

Before spawning agents:

1. Restate the request, constraints, and acceptance target in a compact brief.
2. Inspect the codebase enough to identify likely files, tests, risky integrations, and natural ownership boundaries.
3. Decide whether the work is:
   - `implementation-first`: code must be written before review.
   - `audit-first`: review existing code or the whole project before assigning fixes.
4. Choose the agent topology.

Use one coding agent for narrow work. Use multiple coding agents only when the write sets are disjoint or can be cleanly sequenced.

Good multi-coder splits:

1. Frontend vs backend.
2. API layer vs persistence layer.
3. Independent packages or services.
4. One coder per accepted issue cluster when file ownership is non-overlapping.

Bad multi-coder splits:

1. Several coders editing the same module without explicit ownership.
2. Artificial parallelism where the next step depends on one shared blocking change.
3. Splits based on reviewer opinion instead of code boundaries.

## Phase 2: Create ownership briefs

For each coding agent, write a concrete brief that includes:

1. Exact behavior to implement or defect to fix.
2. File or module ownership.
3. Required tests, checks, or manual verification.
4. Constraints:
   - other agents may be active;
   - do not revert unrelated edits;
   - adapt to changes made by other agents;
   - report changed files, test results, and remaining risks.

If using multiple coding agents, make ownership explicit enough that each file has one clear owner for the current loop.

For each review agent, ask for:

1. Findings first, ordered by severity.
2. Concrete bugs, regressions, missing tests, unsafe assumptions, or integration risks.
3. File and line references where possible.
4. No deference to other reviewers.

Keep reviewers independent. Do not preload them with the conclusions of other reviewers.

## Phase 3: Run the first pass

### Implementation-first mode

1. Spawn the needed coding agents.
2. Wait for code to exist.
3. Run independent review agents on the resulting diff or target scope.

### Audit-first mode

1. Spawn independent review agents on the target scope first.
2. Aggregate accepted findings into fix clusters.
3. Assign those clusters to one or more coding agents.

For full-project audits, prefer one of these review patterns:

1. Whole-project reviewers plus one cross-cutting integration review.
2. Per-slice reviewers for major subsystems plus one reviewer on the combined impact.

Do not let every reviewer inspect every file if the repository is large and the result will be shallow noise.

## High-confidence acceptance bar

Only feed accepted findings back into coding loops.

Accept a finding when at least one of these is true:

1. Two or more reviewers independently identify the same underlying defect.
2. One reviewer reports a clearly severe issue:
   - broken core behavior;
   - reproducible crash;
   - data loss or corruption;
   - security or privacy exposure;
   - failing tests or obviously missing required coverage.
3. The finding is directly supported by a spec mismatch, failing command, or local reproduction by the main agent.

Reject or defer findings that are only:

1. Style preferences.
2. Speculative refactors without a concrete defect.
3. "Could be cleaner" comments.
4. Duplicate wording for the same issue.
5. Hypotheses that nobody can support with code, behavior, or tests.

Normalize reviewer output into issue groups. Group by underlying defect, not by wording or exact line number.

## Phase 4: Fix loop

For each iteration:

1. Keep only the accepted issue groups.
2. Map each group to one coding owner.
3. Send each coding agent a narrowed fix brief containing only the accepted issues in its boundary.
4. Re-run relevant tests or checks.
5. Re-run independent review on the updated result.

If multiple coding agents are active, prefer parallel fixes only when their write sets stay disjoint. If accepted issues cross ownership boundaries, handle them in sequence and re-baseline before the next split.

Reuse the same coding agent thread when the context still helps. Spawn a fresh coding agent when:

1. the thread has drifted;
2. the ownership boundary changes;
3. the agent repeatedly misses the same accepted issue.

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

## Operating rules

1. The main agent stays decisive. Do not dump raw reviewer output back onto coding agents.
2. Accepted issues must be rewritten as a clean, deduplicated fix brief.
3. Multiple coding agents are a scaling tool, not a default.
4. Independence matters more than reviewer specialization, but light reviewer bias is fine:
   - reviewer A: correctness and regressions;
   - reviewer B: edge cases and tests;
   - reviewer C: integration and maintainability risks.
5. Convergence beats churn. Another loop is justified only by accepted findings.

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
