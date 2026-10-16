---
name: with-peer
description: >-
  Requires peer-second-opinion and an authenticated peer CLI — Codex (`codex`,
  the default) or Command Code (`cmd`). Complete a task with an independent
  peer design opinion and whole-task code review. The host implements;
  disagreements receive evidence-backed dispositions and fixes receive
  impact-scoped verification. Trigger only when the user explicitly asks to
  work with the peer ("和 codex 一起完成这个任务", "build this with codex", "run
  this task with-peer"). Both checkpoints always run once invoked. For a
  standalone review or question, use peer-second-opinion directly; to hand the
  peer the work itself, use delegate-to-peer.
---

# With Peer

Complete one task through two checkpoints: an independent design
opinion, then an independent review of the whole task change. The host
writes all code; the peer only advises and reviews. Completion requires evidence-backed dispositions and
verification of the final change, not identical model preferences;
agreement alone does not establish correctness.

The peer is Codex unless the user names another provider. Never use the
CLI you are running inside: from Codex, use the provider the user names,
or ask which — do not substitute one silently. The checkpoints are only as good as the
reviewer, so the chosen model must be capable enough to act as a gate.

Invocation authorizes the bounded peer calls below, implementation,
in-scope fixes and verification — no extra approval is needed for
those steps. It does not expand the user's scope or external-action
permissions; preserve any stricter review scope or approval requirement
the user sets.

Read [peer-second-opinion](../peer-second-opinion/SKILL.md), the
provider's reference and the relevant mode reference before composing
commands; its execution, model, permission, marker and exit-code rules
apply unchanged.

**Independent prompts.** Both checkpoints start with a fresh, unseeded
call whose prompt holds only the user's original requirements and
decisions, repository references and mechanical scope facts — never
the host's position, rationale, self-review, suspected defects, task
record or design transcript. A new session does not make a seeded
prompt independent: every call carrying prior findings or positions is
**deliberation**.

## 1. Record the task and initial position

Before the first peer call, briefly state the host's approach, key reason
and main uncertainty. Include an alternative only when it is materially
plausible. Keep a durable task record as specified in
[references/task-record.md](./references/task-record.md) — requirements,
every call and finding, attempt budgets, code identities — and follow
its recovery rule after any interruption.

## 2. Design checkpoint

Always obtain a blind consult. If the user prescribed the approach, ask
the peer to assess it against the requirements rather than reopen the
decision. Relay the peer's position and load-bearing arguments before
the host's comparison, checking factual claims first. Classify any
disagreement:

| Type | Disposition |
|---|---|
| Checkable fact: feasibility, API behaviour, compliance with a requirement | Inspect sources or run a minimal experiment; record the evidence and resolve the objection. |
| Engineering preference among approaches satisfying the requirements | The host chooses and explains the trade-off; retain the peer's alternative and reason. Agreement is unnecessary. |
| Undecided user preference, scope or authorization | Present concrete options and consequences to the user; meanwhile continue only independent authorized work. |

An unresolved material objection about safety, data integrity, core
behaviour or a required constraint blocks the affected approach; never
relabel it a preference. If investigation within scope cannot resolve
it, present the evidence and options to the user.

At most two consult follow-ups (failures and recovery calls included),
each resuming the same session and labelled **deliberation**. Each must
add evidence, a clarified requirement or a revised proposal; repeating
positions does not justify a call. Two is a ceiling, not a target. End
by the disposition rules, not a vote count. If the approach materially
changes and needs more discussion than the budget allows, report that
and request more budget.

The checkpoint passes when the chosen approach meets requirements with
no unresolved material objection. Record any remaining preference split
without claiming consensus.

## 3. Implement and review the whole task

The host implements and runs checks appropriate to the change. If
implementation exposes a material design change, return to the design
disposition rules, retaining spent attempts. Before calling the peer,
record expected risk areas in the host's self-review (kept out of the
prompt).

Run a fresh review invocation over the entire task change — all its
commits and working changes — following the parent's scope reference.
Isolate the task when unrelated work would pollute the review; never
stash, commit or revert another task's changes to simplify scope.

## 4. Disposition findings and verify fixes

Relay the verdict (including an affirmative zero-finding result), scope,
model and every finding's ID, priority and location before fixing. Then
record each as:

- **Confirmed** — reproduced or evident from code → fix within scope.
- **Refuted** — contrary evidence → keep the finding and refutation;
  the peer need not retract it.
- **Uncertain** — investigate proportionally; unresolved P0/P1 blocks
  completion, unresolved P2/P3 may stay explicitly open.

Rewording cannot downgrade a material blocker. A fix needing new scope
or authorization goes to the user with concrete consequences. After each
batch of fixes, verify by impact:

| Fix impact | Required review |
|---|---|
| Local and demonstrably bounded | Fix delta, original finding, related callers and relevant tests; explain why this scope suffices. |
| Interfaces, shared state, permissions, architecture, cross-module effects, or uncertain impact | The whole task change again. |

Both use review mode. Targeted verification uses `--custom` with the
exact before/after comparison, paths, finding and expected behaviour,
and requires a disposition of each targeted finding plus prioritized
new defects or an affirmative zero-new-finding statement. It has no
empty-scope precheck and reads the live tree: confirm the delta exists
and hold edits during the call. Label it **fix verification
(deliberation)**. Any code drift invalidates verification of the
affected changes. Investigate new findings under the same rules;
refuted findings and open P2/P3s alone do not require another round.

### Completion and budget

Every review invocation — initial, targeted, failed or unparseable —
consumes one of five attempts by default; increment before launching.
The user may set another positive finite limit; never reset it when
narrowing scope or recovering. Re-review until a round confirms nothing
new or the budget runs out.

The code checkpoint passes only when:

- The initial whole-task review succeeded.
- Every finding has an evidence-backed disposition; confirmed findings
  are fixed and no unresolved P0/P1 remains.
- Every later task-code change has successful peer verification at the
  required impact scope, and relevant local checks pass — local checks
  cannot replace missing peer verification.
- The final task-code identity matches that coverage; say whether it
  combines an initial review with targeted checks or ends in a
  whole-task review.

If attempts run out after a fix, mark it **peer-unverified** and stop
with the checkpoint incomplete. Offer more budget, acceptance of the
disclosed incomplete result, or a revised approach; acceptance does not
make it verified.

## Failure exits

The parent's exit-code and marker rules govern each call; relay every
wrapper warning. Exit `0` means a usable result, not approval.

- Review exit `2`: empty scope, not a pass. Correct the scope within the
  remaining budget or report an incomplete checkpoint.
- Retries (Codex capacity) happen inside one wrapper invocation (one
  review attempt). If they exhaust or cannot fit the timeout, stop and
  report; do not start another retry cycle.
- A Command Code turn-cap `warning:` makes the result partial: it cannot
  pass a checkpoint. Count it as an attempt.
- Other exit `3`–`5`: at most one retry when the parent's rules justify
  it, within the remaining budget; otherwise stop and report. Never
  replace a missing peer checkpoint with the host's own answer.
- Failed consult follow-up (overrides the rule above): do not resume the
  possibly contaminated session. One fresh recovery consult may restate
  context, labelled **deliberation**, only if a follow-up slot remains;
  a failed recovery stops.
- No priority findings and no affirmative zero-finding statement:
  unparseable. Relay verbatim; one rerun within the remaining budget,
  otherwise stop incomplete. A targeted answer omitting a requested
  finding's disposition leaves that fix unverified.
- A task with no reviewable repository change cannot pass the code
  checkpoint; say so rather than claiming completion.

## Final report and boundaries

Summarize checkpoint outcomes, scope and final code identity, model and
independence labels, attempts used, substantive disagreements, and every
finding's priority, location and disposition, including open P2/P3s.
Link the task record and preserved reports. Disclose failed checks,
unverified fixes and coverage limits explicitly.

The host remains the only writer: never use `codex apply`, bypass flags
or the wrapper's `task` mode here. Codex's read-only sandbox does not
restrict MCP servers' external effects, and Command Code is read-only by
prompt only — relay any `identity:` drift warning and check the tree.
Mention MCP use when the output shows it. This workflow grants no
external mutation authority.
