---
name: review-fix-loop
description: Use this skill when a code change, diff, PR-like patch, skill, doc, prompt, config, or runbook needs repeated review, triage, fix, and verification loops until only verified issues or explicit residual risks remain. Use it when acceptance criteria and ownership boundaries are concrete, and the environment can run isolated subagents for coding and review.
---

# Review-Fix Loop

Use this skill for repeatable `review -> triage -> fix -> verify`
convergence instead of one-pass implementation.

This skill has one hard gate: use it only when coding and review can be
delegated to isolated subagent passes. If you cannot keep review
independent, do not simulate this skill locally. Switch to another
workflow and say why.

Target a small accepted issue set with strong anchors, fast repair
handoffs, explicit verification, and a clean stop condition.

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

When improving a skill, default to `audit-first` and treat it as a
mixed doc-plus-prompt artifact. Review trigger wording, decision order,
defaults, reference discoverability, output contracts, and stop
conditions.

## Start Here

1. Confirm the delegation gate:
   - one coding owner can fix;
   - two or three review owners can critique only;
   - review passes can stay isolated enough to count as independent.
2. Decide the verification anchors and whether each changed boundary has
   a feasible rerun before choosing a topology. If not, define the
   manual verification note that will replace them at closeout.
3. Write a short scope brief before substantive work. Include the
   request, constraints, acceptance target, artifact type, exact review
   boundary, verification anchors, edit mode, base state, and review
   isolation model. Use
   [`references/brief-templates.md`](./references/brief-templates.md).
4. Choose the mode in this order:
   - `audit-first` when there is already a meaningful diff or artifact
     to inspect;
   - `implementation-first` when the request is concrete and there is no
     meaningful existing diff;
   - `mixed handoff` when you must audit the current state before adding
     follow-on work.
5. Choose the cheapest topology that can still catch real defects:
   - non-code artifacts: one coding owner plus two review passes;
   - code or mixed artifacts: one coding owner plus three review passes;
   - disjoint boundaries: split coding ownership by boundary, then add
     one integration review on the combined result.
6. Freeze the base state, diff anchor, or worktree contract before
   delegation.
7. Do not start review until the verification plan, closeout fallback,
   and review-isolation contract are concrete.

## Default Posture

Use these defaults unless the task clearly needs otherwise:

- Prefer `audit-first` for any in-flight artifact.
- Prefer narrower boundaries and fewer accepted findings over broader
  scope and speculative comments.
- Prefer file paths, diff anchors, interfaces, and commands over pasted
  transcripts.
- Give each reviewer one useful lens at most. Extra framing usually
  lowers independence.
- When multiple models are available, assign different models to each
  review pass; process isolation alone does not prevent correlated
  blind spots from the same model.
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
- topology: mode, coding owner, review coverage, and review isolation
  model.

If any are missing, inspect the environment and infer them before
delegation.

### 2. Review Passes

Reviewers critique only. They do not fix and they do not see other
reviewer conclusions.

Only use a non-independent validation pass after triage to confirm one
named accepted issue or proposed fix. Do not count it toward the
required independent review topology.

Each review brief should stay short:

- target scope;
- artifact type;
- optional lens;
- exact output contract.

Require findings-first output. A valid finding includes:

- severity: `blocking`, `major`, or `minor`;
- one concrete evidence anchor;
- one confirming check the main agent can run.

Count a delegated review pass only when it ends with findings or an
explicit `no meaningful findings` statement plus a declared-scope
completion statement. If the agent exits early, times out, or omits that
signal, mark the pass incomplete and rerun or replace that reviewer.

Partial findings from an incomplete pass are usable in triage but do
not count toward topology. A complete replacement pass is still
required.

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
- whether closure needs an independent re-review or a named-issue
  validation pass after the fix;
- what is out of scope.

Keep one coding owner per issue group or boundary unless the environment
can isolate and merge multiple owners safely. Do not advance to
verification until the coding owner satisfied the requested output
contract or was recorded as incomplete or blocked.

### 5. Loop Ledger

After each fix iteration, record:

- what changed;
- the exact verification rerun for each changed boundary and whether it
  passed, failed, or was infeasible;
- each issue id with disposition: `open`, `fixed`, `disproved`, or
  `downgraded`;
- whether another loop is required.

The ledger is what prevents the loop from reopening already-disproved
issues under new wording.
Do not record `close` as the next action until that loop's verification
reruns and independent review result are both fully recorded.

## Loop

For each iteration:

1. Freeze the accepted issue list for that loop.
2. Assign each accepted open issue group to one coding owner.
3. Send narrowed fix briefs, not reviewer transcripts.
4. Confirm the delegated fix pass satisfied its output contract. If not,
   apply the incomplete delegated pass rule before moving on.
5. Re-run verification tied to the changed boundary.
6. Re-run isolated review on the updated result. Do not start this step
   until step 5 completed and that loop's verification result is
   recorded. A partial or incomplete delegated pass does not satisfy
   this step; apply the incomplete delegated pass rule before moving on.
7. Triage the re-review output using `Execution Contract` section
   `3. Triage` before changing issue dispositions.
8. Update issue dispositions and write the loop ledger.
9. Check the stop decision in this order:
   - mark the loop `ready to close` only if this loop already recorded
      the required verification
      reruns, this loop already recorded the required independent
      delegated review result for the updated artifact, and the fast path
       or stop conditions below are satisfied;
    - continue if accepted `blocking` or `major` issues remain;
    - otherwise change topology or workflow and record why.

Fast path:
if this loop reran the required verification for each changed boundary
before closure, this same loop reran the required independent delegated
review on the updated result after the last fix affecting that boundary,
that review result is recorded in the loop ledger, and that review finds
no accepted `blocking` or `major` issues, and no concrete singleton
`blocking` or `major` candidate remains untriaged,
 mark the loop `ready to close` instead of inventing another loop. The
 fast path does not bypass the `Stop Only When` conditions below. After
 marking `ready to close`, proceed immediately to `Final Closeout`.

Stalled loop rule:
if the same accepted issue survives two loops, tighten the brief, shrink
the boundary, rotate the owner or reviewer, deepen verification, or
stop and switch workflows.

Incomplete delegated pass rule:
if a delegated coding or review pass exits early, times out, or returns
without the brief's required output, record an incomplete pass, do not
count it toward topology, and retry with the same brief up to two more
times (three total attempts per slot). If all three attempts fail,
replace that slot with a fresh subagent using the same brief; prefer a
different model when available to avoid repeating the same failure mode. If the
replacement also fails, mark the workflow blocked and report which slot
is stuck and how many attempts were made.

Blocked rule:
if delegated repair still cannot clear a `blocking` or `major` issue,
stop looping and report the current evidence, verification status,
whether the target artifact remains partially updated or was rolled
back, and the decision needed next, such as re-briefing, changing
topology, explicit operator direction, or stopping the workflow.

## Stop Only When

Close the loop only when all are true:

1. No accepted `blocking` issue groups remain.
2. No accepted `major` issue groups remain unless explicitly
   downgraded with rationale.
3. No concrete singleton `blocking` or `major` candidate remains
   untriaged, undisproved, or undowngraded.
4. Required verification passed for each changed boundary.
5. Independent delegated review actually ran for the chosen topology.
   That required review must have rerun in the closing loop on the
   updated result after the last relevant fix, not only in an earlier
   loop.

If an automated check is infeasible, replace it with one explicit manual
verification note for that boundary and record the limitation. If
independent delegated review could not be run, stop and report that this
skill was not applicable in the environment.
If required verification status or independent review status is missing,
skipped, or negative, do not close the loop.

## Final Closeout

Before final closeout after a loop is marked `ready to close`:

1. Inspect the final diff or changed files yourself.
2. Re-run the most relevant verification yourself when feasible, or
   confirm the explicit manual verification note used for any boundary
   where automated reruns were infeasible.
3. Confirm the original request is satisfied.
4. Record residual risks, especially around integrations, manual-only
   checks, or behavior that remained unverified.

Executing `Final Closeout` is mandatory once a loop is marked
`ready to close`.

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
