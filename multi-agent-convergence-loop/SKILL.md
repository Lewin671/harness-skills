---
name: multi-agent-convergence-loop
description: Use this skill when the main agent should run a managed
  implementation-review-fix loop across one or more coding and review
  agents or isolated local passes for new features, cross-module fixes,
  PR-like diffs, audits, or concrete non-code artifacts, accepting only
  high-confidence findings and repeating until the result converges,
  when the acceptance target and ownership boundaries are concrete.
---

# Multi-Agent Convergence Loop

Use this skill when the main agent should coordinate a repeatable
review-fix loop instead of doing all work in one pass.

The goal is convergence, not comment volume: keep only
high-confidence problems, route them to the right owner, and stop only
when accepted issues are gone and verification has passed.

## Use It When

Use it for:

1. New feature work where the user wants review-driven convergence.
2. Bug fixes or refactors that cross modules or integration points.
3. Existing diffs, PR-like changes, or audits that need review-fix-review
   until clean.
4. Non-code artifacts such as docs, prompts, configs, or runbooks when
   the acceptance target is concrete.

Do not use it when the task is exploratory, the acceptance target is
unclear, or safe ownership boundaries cannot be identified yet.

## Start Here

1. Restate the request, constraints, acceptance target, artifact type,
   and verification anchors in one scope brief. Use
   [`references/brief-templates.md`](./references/brief-templates.md)
   for the canonical scope and fix-brief format.
2. Choose the execution shape:
   - `implementation-first` for concrete new work with no meaningful
     existing diff.
   - `audit-first` for an existing diff, a PR-like change, or a broad
     area where defects must be discovered before ownership can be
     assigned cleanly.
   - `mixed handoff` for in-flight work: audit the existing diff first,
     then implement accepted follow-on changes inside the chosen
     boundary.
3. Map the environment before delegating:
   - can delegates edit directly or only propose patches;
   - what base state, diff anchor, or branch each delegate must use;
   - can you run them in parallel;
   - can you isolate review from implementation;
   - can delegates inspect diffs and line numbers or only named files.
4. Pick the smallest topology that can converge reliably.
5. Give each owner the smallest context packet that still lets it
   succeed.

Use
[`references/topology-playbook.md`](./references/topology-playbook.md)
when you need the decision matrix for topology, environment limits,
artifact-specific review, or stalled-loop recovery.

## Capability Rules

Treat roles as capabilities, not product names:

- A coding owner may edit files directly or return a patch for the main
  agent to apply.
- A review owner critiques only.
- If one system must alternate between coding and review roles, separate
  those passes with distinct prompts, threads, or self-review phases.
- If delegates do not share the same worktree state, define the base
  ref, diff anchor, or reconciliation contract before work starts.

Keep handoffs tight:

- point to files, diffs, commands, interfaces, and invariants instead of
  pasting long transcripts;
- do not dump raw reviewer output into coding briefs;
- tell each coding owner what is in scope, what is out of scope, and
  what verification it must run.

## Core Loop

### Implementation-first

1. Assign the coding owners.
2. Wait for code or artifact changes to exist.
3. Run isolated review passes on the resulting diff or target scope.

### Audit-first

1. Run isolated review passes on the target scope first.
2. Normalize confirmed findings into issue groups.
3. Assign each accepted issue group to one coding owner.

## Acceptance Rules

Feed only accepted findings back into the next coding pass.

Accept a finding only when it has a concrete anchor such as a spec
mismatch, failing command, reproducible manual behavior, direct
code-path evidence, a broken rendered artifact, or a prompt/config
failure the main agent can verify.

Use
[`references/review-triage.md`](./references/review-triage.md)
to merge overlap, assign severity, and decide whether another loop is
required.

Rewrite accepted findings into a clean fix brief instead of forwarding
raw reviewer output.

## Fix Loop

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Carry forward each issue id with a disposition of `open`, `fixed`,
   `disproved`, or `downgraded`.
3. Map each accepted open issue group to one coding owner.
4. Send narrowed fix briefs with the exact issue id, evidence, ownership
   boundary, base state, and verification to rerun.
5. Re-run boundary-specific verification.
6. Re-run isolated review on the updated result.

If the same accepted issue survives two loops, do not keep the topology
unchanged. Tighten the brief, shrink the boundary, rotate the owner or
reviewer, deepen verification, or fall back to one-owner serialized
repair.

If one-owner serialized repair still cannot clear a blocking or major
issue, stop looping and report the work as blocked with the last
evidence, verification status, and the next decision the user must make.

If independent reviewers are unavailable and the loop is running as
serialized self-review, say that explicitly in the final status and
carry it as a residual risk rather than presenting the result as fully
independently reviewed.

## Stop Only When

All are true:

1. No accepted `blocking` issue groups remain.
2. No accepted `major` issue groups remain unless they were explicitly
   downgraded with rationale.
3. No singleton finding is severe enough to promote.
4. Required verification passed for each changed boundary.

If a planned automated check is infeasible, replace it with one explicit
manual verification note for that boundary and record the limitation.
If the loop ran without independent reviewers, include an explicit
single-agent review limitation before closing.

## Final Verification

Before closing:

1. Inspect the final diff or changed files yourself.
2. Run the most relevant verification yourself when feasible.
3. Confirm the original request is satisfied.
4. Report residual risks, especially around integrations, manual-only
   flows, or artifact checks that could not be automated.

## Read Next

- Use
  [`references/brief-templates.md`](./references/brief-templates.md)
  for scope, coding, review, and issue-group briefs.
- Use
  [`references/topology-playbook.md`](./references/topology-playbook.md)
  for mode selection, topology sizing, environment-specific fallbacks,
  and artifact-specific review.
- Use
  [`references/review-triage.md`](./references/review-triage.md)
  for overlap handling, severity rules, and loop decisions.
