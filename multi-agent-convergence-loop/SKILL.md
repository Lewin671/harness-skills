---
name: multi-agent-convergence-loop
description: Use this skill when the main agent should run a managed implementation-review-fix loop across coding and review agents, accepting only high-confidence findings and repeating until the result converges. Good for large features, multi-module fixes, PR audits, and other work where disciplined convergence matters more than a single pass.
---

# Multi-Agent Convergence Loop

Use this skill when the main agent should orchestrate a repeatable convergence loop instead of doing all coding directly.

The goal is convergence, not comment volume: keep only high-confidence problems, route them to the right owner, re-review the updated result, and stop only when no accepted issues remain.

## Main-agent role

The main agent owns scope, topology, capability mapping, review triage, stop/go decisions, and final verification.

Treat roles as capabilities:

- A coding owner may edit files directly or return a patch for the main agent to apply.
- A review owner critiques only; do not mix review and implementation in the same pass unless a tiny local fix is clearly safer than another handoff.
- If one system must alternate between coding and review roles, separate those passes with distinct prompts, threads, or self-review phases and avoid showing earlier review output until the new review is complete.

## When to use this

Use it for:

1. New feature implementation where the user wants review-driven convergence.
2. Bug-fix or refactor work that spans multiple modules or integration points.
3. Existing diffs or PR-like changes that should be reviewed, fixed, and re-reviewed until clean.
4. Full-project or subsystem audits followed by targeted repairs.
5. Non-code artifacts such as docs, prompts, configs, or runbooks when multiple review lenses are useful and the acceptance target is still concrete.

Do not use it when the task is still exploratory, the acceptance target is unclear, or the codebase is too unknown to assign safe ownership.

## Preconditions

Before delegating:

1. Restate the request, constraints, and acceptance target in one compact brief.
2. Inspect the codebase or artifact enough to identify likely files, tests, risky integrations, and natural ownership boundaries.
3. Classify the task shape:
   - `implementation-first` for concrete new work with no meaningful existing diff.
   - `audit-first` for an existing diff, a PR-like change, or a broad area where defects must be discovered before ownership can be assigned cleanly.
4. Identify the artifact type and expected verification anchors: tests, lint, renderability, sample flows, prompt transcripts, config semantics, or manual checks.
5. Map available capabilities in the current environment:
   - can any delegate edit files directly;
   - can delegates only propose patches;
   - can you run parallel delegates;
   - can you keep separate threads for independent review;
   - can delegates inspect diffs, line numbers, or only named files.
6. Choose the execution mode that fits those capabilities. Keep the workflow portable; do not assume one specific tool or thread model.
7. If the environment has no usable delegation primitive, switch to the serialized fallback in this skill and tell the user that the loop will run locally rather than through subagents.

### Context hygiene

Give each owner the smallest context packet that still lets it succeed:

- point to files, diffs, commands, and invariants instead of pasting large transcripts;
- include only the interfaces, constraints, and neighboring files that matter to that owner;
- keep raw reviewer output out of coding briefs unless a direct quote is itself the evidence.

### Serialized fallback

When no delegation primitive exists, keep the same convergence rules but run them serially:

1. Write the same scope brief and ownership boundaries you would have sent to delegates.
2. Do one coding pass at a time inside one explicit boundary.
3. Run at least two clearly separated review passes after each coding pass. Use different prompts or review lenses so each pass is as independent as the environment allows.
4. Aggregate only findings that clear the normal evidence bar.
5. Keep the same stop condition and final verification requirements before closing.

## Topology selection

Start from the smallest topology that can still converge reliably.

- Default to one coding owner plus three independent reviewers for riskier code changes.
- Use one coding owner plus two reviewers for single-file work or lower-risk docs, prompts, configs, or runbooks.
- Add more coding owners only when ownership boundaries are explicit and their write sets stay disjoint.
- For large repos, split review coverage by subsystem or artifact slice and add one integration review on the combined impact.
- If the environment lacks parallel edits, file isolation, or stable thread separation, prefer one coding owner and serialize the rest of the loop.

Good multi-coder splits:

1. Frontend vs backend.
2. API layer vs persistence layer.
3. Independent packages or services.
4. One coder per accepted issue group when file ownership is non-overlapping.

Bad multi-coder splits:

1. Several coders editing the same module without explicit ownership.
2. Artificial parallelism where the next step depends on one shared blocking change.
3. Splits based on reviewer opinion instead of code boundaries.
4. Parallel edits in a single shared worktree when the environment cannot isolate or merge them safely.

## Ownership briefs

Start each loop with a scope brief that records the request, constraints, acceptance target, target files or modules, and the verification plan.

For each coding owner, include:

1. The exact behavior to implement or defect to fix.
2. File or module ownership, plus any integration surfaces it must not break.
3. Change mode: direct edit or patch proposal.
4. Required tests, checks, or manual verification.
5. The minimal context packet:
   - request summary;
   - relevant files or diff;
   - interfaces, invariants, and commands that matter.
6. Constraints:
   - other agents may be active;
   - do not revert unrelated edits;
   - adapt to changes made by other agents;
   - report changed files, verification results, and remaining risks.

For each review owner, ask for:

1. Findings first, ordered by severity.
2. Concrete bugs, regressions, missing tests, unsafe assumptions, prompt failures, or integration risks.
3. File and line references where possible.
4. No deference to other reviewers.

Optionally give reviewers different lenses such as correctness, integration risk, or verification gaps, but do not preload them with each other's conclusions.

Use [`references/brief-templates.md`](./references/brief-templates.md) for ready-to-send scope, coding, review, or issue-group formats.

## First pass

### Implementation-first

1. Spawn the needed coding owners.
2. Wait for code or artifact changes to exist.
3. Run independent review owners on the resulting diff or target scope.

### Audit-first

1. Run independent review owners on the target scope first.
2. Normalize the accepted findings into issue groups.
3. Assign each accepted issue group to one coding owner.

For full-project audits, prefer one of these review patterns:

1. Whole-project reviewers plus one cross-cutting integration review.
2. Per-slice reviewers for major subsystems plus one reviewer on the combined impact.

Do not let every reviewer inspect every file if the repository is large and the result will be shallow noise.

For docs, configs, prompts, or runbooks, review for correctness, operator usability, and downstream failure modes rather than inventing fake test gaps.

## Review aggregation

Only feed accepted findings back into coding loops.

Accept a finding only when it has a concrete anchor such as a spec mismatch, failing command, reproducible manual failure, direct code-path evidence confirmed by the main agent, a broken rendered artifact, or a prompt/config behavior the main agent can verify.

Treat a finding as accepted when one of these is true:

1. Two or more reviewers independently identify the same underlying defect and at least one concrete anchor exists.
2. One reviewer reports a clearly severe issue such as broken core behavior, a reproducible crash, data loss or corruption, a security or privacy exposure, or failing checks tied to the change, and the main agent can confirm the anchor.
3. The main agent can directly verify the finding from the spec, code, artifact, or verification results even without reviewer overlap.

Reject or defer findings that are only style preferences, speculative refactors, duplicate wording for the same issue, or unsupported hypotheses.

Group findings by underlying defect, not by wording or exact line number. Record the owner, severity, evidence, and required verification for each accepted issue group. Use `blocking` for issues that must be resolved before completion, and `major` for issues that should enter the next fix loop unless the main agent explicitly downgrades them with rationale. Keep `minor` findings as non-blocking notes rather than accepted issue groups unless they are nearly free and clearly safe to fold into another fix.

Rewrite accepted findings into a clean fix brief instead of dumping raw reviewer output back onto coding owners.

If the same accepted issue survives two loops, tighten the brief, rotate the owner or reviewer, shrink the boundary, or fall back to one-owner serialized repair.

Use [`references/review-triage.md`](./references/review-triage.md) when overlap is not obvious or when another loop is being considered.

## Fix loop

For each iteration:

1. Keep only the accepted issue groups.
2. Map each group to one coding owner.
3. Send each coding owner a narrowed fix brief containing only the accepted issues in its boundary.
4. Re-run the verification tied to the changed boundary.
5. Re-run independent review on the updated result.

If multiple coding owners are active, prefer parallel fixes only when their write sets stay disjoint. If accepted issues cross ownership boundaries, handle them in sequence and re-baseline before the next split.

Prefer reusing the same coding-owner thread when the context still helps. Start a fresh thread when the context has drifted, the ownership boundary changes, or the owner repeatedly misses the same accepted issue.

Refresh review owners as needed to preserve independence.

After any overlapping or integration-sensitive changes, create one integration checkpoint before the next review pass.

## Stop condition

Stop only when all are true:

1. No accepted `blocking` issue groups remain.
2. No accepted `major` issue groups remain unless the main agent explicitly downgrades them to non-blocking notes with rationale.
3. No singleton finding is severe enough to promote into a blocking or major issue group.
4. Required verification for each changed boundary has passed. If a planned automated check is infeasible, replace it with one explicit manual verification note for that boundary and record the limitation.

If reviewers still produce comments but none clear the acceptance bar, treat them as non-blocking notes rather than another forced loop.

## Final verification

Before closing:

1. Inspect the final diff or changed files yourself.
2. Run the most relevant verification yourself when feasible.
3. Confirm the original request is satisfied.
4. Report residual risks, especially around untested integrations, manual-only flows, or non-automated artifact checks.

For non-code artifacts, use explicit sample scenarios rather than vague reassurance.

If a planned automated check is infeasible, replace it with one explicit manual verification note per changed area and record the limitation. If a required check was feasible but was not run, treat that as blocking until it is resolved. If coding owners report conflicting verification results, rerun the main-agent check or treat the disagreement as blocking until resolved.

## Response rhythm

Use a compact orchestration pattern in the main thread:

1. Confirm scope, acceptance target, and chosen topology.
2. Announce ownership assignments and execution mode.
3. Announce review pass.
4. Summarize accepted issue groups and whether another fix loop is required.
5. Finish with verification status and any non-blocking residual notes.

## Example triggers

1. "Use subagents to implement this across multiple modules, then keep reviewing and fixing until there are no real issues left."
2. "Do a whole-project audit with review agents, fix only high-confidence findings, and repeat until clean."
3. "I want multiple coding agents, but only accepted review findings should go back into the next round."
4. "Run a review-fix-review convergence loop for this feature instead of a single implementation pass."
