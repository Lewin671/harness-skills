---
name: review-fix-loop
description: Use this skill when a code change, diff, PR-like patch, skill, doc, prompt, config, or runbook needs repeated review, triage, fix, and verification loops until only verified issues or explicit residual risks remain. Use it when acceptance criteria and ownership boundaries are concrete, and the environment can run isolated subagents for coding and review.
---

# Review-Fix Loop

Use this skill when the main agent should drive convergence through a
repeatable `review -> triage -> fix -> verify` loop instead of treating
the task as one-pass implementation.

This skill has one hard gate: use it only when coding and review can be
delegated to isolated subagent passes. If you cannot keep review
independent, do not simulate this skill locally. Switch to another
workflow and say why.

The target is not review volume. The target is a small accepted issue
set with strong anchors, fast repair handoffs, explicit verification,
and a clean stop condition.

## Use It When

Use it for:

1. Existing diffs, PR-like changes, or in-flight artifacts that need
   review-fix-review until clean.
2. New code work where the user wants review-driven convergence instead
   of one pass plus light self-review.
3. Skills, docs, prompts, configs, or runbooks where operator behavior
   and instruction quality matter as much as prose quality.
4. Cross-module fixes or refactors where ownership can be made explicit.

Do not use it when the task is exploratory, acceptance is vague, safe
ownership boundaries are unknown, or the environment cannot run
independent delegated review.

If you are improving a skill itself, default to `audit-first` and treat
it as a mixed doc-plus-prompt artifact. Review trigger wording,
decision order, defaults, reference discoverability, output contracts,
and stop conditions, not just writing quality.

## Start Here

1. Confirm the delegation gate:
   - one coding owner can fix;
   - two or three review owners can critique only;
   - review passes can stay isolated enough to count as independent.
2. Write a short scope brief before substantive work. Include the
   request, constraints, acceptance target, artifact type, exact review
   boundary, verification anchors, edit mode, and base state. Use
   [`references/brief-templates.md`](./references/brief-templates.md).
3. Choose the mode in this order:
   - `audit-first` when there is already a meaningful diff or artifact
     to inspect;
   - `implementation-first` when the request is concrete and there is no
     meaningful existing diff;
   - `mixed handoff` when you must audit the current state before adding
     follow-on work.
4. Choose the cheapest topology that can still catch real defects:
   - non-code artifacts: one coding owner plus two review passes;
   - code or mixed artifacts: one coding owner plus three review passes;
   - disjoint boundaries: split coding ownership by boundary, then add
     one integration review on the combined result.
5. Freeze the base state, diff anchor, or worktree contract before
   delegation.
6. Decide the verification anchors before review starts. A review loop
   without concrete reruns is only commentary.

## Default Posture

Use these defaults unless the task clearly needs something else:

- Prefer `audit-first` for any in-flight artifact.
- Prefer narrower boundaries and fewer accepted findings over broader
  scope and speculative comments.
- Prefer file paths, diff anchors, interfaces, and commands over pasted
  transcripts.
- Give each reviewer one useful lens at most. Extra framing usually
  lowers independence.
- Do not add extra review passes once the default topology is satisfied
  and no accepted `blocking` or `major` issues remain.
- Treat missing delegation or weak review isolation as a hard stop for
  this skill.

Use
[`references/topology-playbook.md`](./references/topology-playbook.md)
when the mode, topology, or environment contract is ambiguous.

## Execution Contract

### 1. Scope Brief

The scope brief is the source of truth for the loop. It should name:

- request and acceptance target;
- artifact type and exact boundary;
- verification anchors for each changed boundary;
- edit mode: direct edits or patch proposal;
- base state: branch, ref, diff anchor, or worktree contract;
- topology: mode, coding owner, and review coverage.

If any of these are missing, inspect the environment and infer them
before delegation. Do not start a multi-pass loop against a vague
boundary.

### 2. Review Passes

Reviewers critique only. They do not fix and they do not see other
reviewer conclusions unless the task is explicitly to validate one named
issue.

Each review brief should stay short:

- target scope;
- artifact type;
- optional lens;
- exact output contract.

Require findings-first output. A valid finding includes:

- severity: `blocking`, `major`, or `minor`;
- one concrete evidence anchor;
- one confirming check the main agent can run.

Reject:

- style-only comments;
- vague discomfort;
- speculation without a checkable anchor;
- duplicate wording that does not add new evidence.

For skills, docs, prompts, and configs, concrete anchors include:

- contradictory instructions;
- a missing decision rule that forces guessing;
- an impossible or unverifiable step;
- a stop condition that cannot actually be checked.

### 3. Triage

Only accepted findings move into the next fix pass.

Accept a finding only when the main agent can anchor it to one of these:

- spec mismatch;
- failing command or verification;
- reproducible manual behavior;
- direct code-path evidence;
- broken rendered or produced artifact;
- prompt, config, or skill failure the main agent can confirm.

Do not accept a finding only because:

- multiple reviewers said similar things without an anchor;
- it sounds plausible;
- it is a style preference without correctness, usability, or
  integration consequence.

Merge accepted overlap into stable issue ids such as `IG-001`.
Reuse the same id across loops unless it is genuinely a different
defect. Rewrite accepted findings into a clean issue summary; never dump
raw reviewer transcripts into a fix brief.

Use
[`references/review-triage.md`](./references/review-triage.md)
for overlap, severity, disposition, and stalled-loop rules.

### 4. Fix Briefs

Every fix brief should name:

- issue ids addressed;
- ownership boundary;
- base state or diff anchor;
- invariants and integration surfaces not to break;
- exact verification to rerun;
- what is out of scope.

Keep one coding owner per issue group or boundary unless the environment
can isolate and merge multiple owners safely.

### 5. Loop Ledger

After each fix iteration, record:

- what changed;
- each issue id with disposition: `open`, `fixed`, `disproved`, or
  `downgraded`;
- what verification reran and whether it passed, failed, or was
  infeasible;
- whether another loop is required.

The ledger is what prevents the loop from reopening already-disproved
issues under new wording.

## Loop

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Assign each accepted open issue group to one coding owner.
3. Send narrowed fix briefs, not reviewer transcripts.
4. Re-run verification tied to the changed boundary.
5. Re-run isolated review on the updated result.
6. Update issue dispositions and write the loop ledger.
7. Stop, continue, or change topology based on the accepted issue set.

Fast path:
if review finds no accepted `blocking` or `major` issues and required
verification already passes, close instead of inventing another loop.

Stalled loop rule:
if the same accepted issue survives two loops, tighten the brief, shrink
the boundary, rotate the owner or reviewer, deepen verification, or
stop and switch workflows.

Blocked rule:
if delegated repair still cannot clear a `blocking` or `major` issue,
stop looping and report the current evidence, verification status, and
decision needed.

## Stop Only When

Close the loop only when all are true:

1. No accepted `blocking` issue groups remain.
2. No accepted `major` issue groups remain unless explicitly
   downgraded with rationale.
3. No severe singleton finding still needs promotion.
4. Required verification passed for each changed boundary.
5. Independent delegated review actually ran for the chosen topology.

If an automated check is infeasible, replace it with one explicit manual
verification note for that boundary and record the limitation. If
independent delegated review could not be run, stop and report that this
skill was not applicable in the environment.

## Final Closeout

Before closing:

1. Inspect the final diff or changed files yourself.
2. Re-run the most relevant verification yourself when feasible.
3. Confirm the original request is satisfied.
4. Record residual risks, especially around integrations, manual-only
   checks, or behavior that remained unverified.

Final status should always make these explicit:

- whether the original request is satisfied;
- which verification ran and what passed, failed, or was infeasible;
- the final disposition of each accepted issue id;
- whether review confidence came from isolated delegated reviewers;
- any residual risks that still matter.

## Common Failure Modes

Avoid these:

- mixing implementation and review in one pass when isolation is
  available;
- reviewing a vague boundary;
- handing raw reviewer transcripts to the coding owner;
- widening scope mid-loop without a new brief;
- reopening disproved issues because the wording changed;
- closing on "looks good" without rerunning verification;
- claiming independent review without isolated delegated reviewers;
- looping forever instead of reporting a real block.

## Read Next

- Use
  [`references/brief-templates.md`](./references/brief-templates.md)
  for scope, review, fix, ledger, and final-status templates.
- Use
  [`references/topology-playbook.md`](./references/topology-playbook.md)
  for mode selection, topology sizing, environment mapping, and
  artifact-specific review.
- Use
  [`references/review-triage.md`](./references/review-triage.md)
  for overlap handling, severity rules, dispositions, and loop
  decisions.
