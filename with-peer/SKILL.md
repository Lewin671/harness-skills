---
name: with-peer
description: >-
  Requires peer-second-opinion and an authenticated peer CLI — Codex (`codex`),
  Command Code (`cmd`) or DeepSeek Harness (`dsh`); either one is enough. Complete a code-changing task with the
  peer as advisor and reviewer: the host writes all the code, the peer gives a
  blind design opinion first and then reviews the whole change, and every
  disagreement is settled by evidence rather than by vote. Trigger only when
  the user explicitly asks to work with the peer ("和 codex 一起完成这个任务",
  "build this with codex", "run this task with-peer"). Both checkpoints always
  run once invoked; a task that changes no repository code cannot pass the
  second. For a standalone review or question, use peer-second-opinion
  directly; to hand the peer the work itself, use delegate-to-peer.
---

# With Peer

Complete one task through two checkpoints: an independent design
opinion, then an independent review of the whole task change. The host
writes all code; the peer only advises and reviews.

Peer choice follows peer-second-opinion § Providers.

Invocation authorizes the bounded peer calls below, implementation,
in-scope fixes and verification — no extra approval is needed for
those steps. It does not expand the user's scope or external-action
permissions; preserve any stricter review scope or approval requirement
the user sets.

Read [peer-second-opinion](../peer-second-opinion/SKILL.md), the
provider's reference and the relevant mode reference before composing
commands. Use its commands, output rules and § Exit Codes; where with-peer
says otherwise (follow-ups, fixes, reruns), with-peer wins.

**Independent prompts.** Both checkpoints start with a fresh, unseeded
call whose prompt holds only the user's requirements and decisions,
repository references and mechanical scope facts — never the host's
position, self-review, task record or design transcript. Labels follow
the parent's Independence Contract.

## At a glance

1. Record requirements, base commit and an initial position (§1).
2. Blind consult → relay → disposition each disagreement; at most two
   follow-ups (§2).
3. Implement, check locally, then a blind review of the whole task
   change (§3).
4. Relay findings → disposition each → fix confirmed ones → verify fixes
   at their impact scope; at most five review attempts (§4).
5. Done when the checkpoint conditions in §4 hold; otherwise stop and
   report what is incomplete. Final report (last section).

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
decision. Relay the peer's position and load-bearing arguments first,
then check its factual claims before comparing. Classify any
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

At most two consult follow-ups (reruns of a follow-up included),
each labelled **deliberation**. Each must
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
record expected risk areas in the task record (never in a prompt).

Run a fresh review invocation over the entire task change — all its
commits and working changes — following the parent's scope reference.
Pick the scope from the recorded base; rows 1–2 assume no unrelated work
in the tree:

| Task change | Scope |
|---|---|
| Only uncommitted | `--uncommitted` |
| Commits since the base, plus tracked edits; no new untracked task files | `--base <base>` |
| Anything else — untracked task files beside commits, unrelated work in the tree | `--custom` naming the base, the commits and every task path (new files included), and telling the peer to diff against the base and read the listed new files |

Never stash, commit or revert another task's changes to simplify scope.

## 4. Disposition findings and verify fixes

Relay the verdict (including an affirmative zero-finding result), scope,
model and every finding (numbered F1, F2, … as you relay) with its
priority and location before fixing. Then
record each as:

- **Confirmed** — reproduced or evident from code → fix within scope.
- **Refuted** — contrary evidence → keep the finding and refutation;
  the peer need not retract it.
- **Uncertain** — investigate proportionally; unresolved P0/P1 blocks
  completion, unresolved P2/P3 may stay explicitly open.
- **Accepted limit** — a real P2/P3 whose fix cost outweighs its expected
  benefit in the user's intended use → record the impact and trade-off,
  disclose the open limit in the final report and the task record.
  Never for P0/P1, unmet requirements or material blockers.

Re-rate a priority only on evidence of impact or likelihood, never on
fix cost, budget or rewording; record both ratings. A fix needing new
scope or authorization goes to the user with concrete consequences.
After each batch of fixes, verify by impact:

| Fix impact | Required review |
|---|---|
| Local and demonstrably bounded | Fix delta, original finding, related callers and relevant tests; explain why this scope suffices. |
| Interfaces, shared state, permissions, architecture, cross-module effects, or uncertain impact | The whole task change again. |

Both use review mode. For targeted verification, the `--custom` text
names the finding, the paths, the expected behaviour and the fix (its
commit SHA if committed, otherwise what changed in which paths). It
asks for a disposition of each targeted finding plus any new defects, or
an explicit "no new findings"; a missing disposition leaves that fix
unverified. It has no empty-scope precheck and reads the live tree:
confirm the delta exists and hold edits during the call. Label it
**deliberation**. Code drift invalidates
verification of the affected changes. Investigate new findings under the
same rules.

### Completion and budget

Agreement alone is not correctness. The code checkpoint passes only when:

- The initial whole-task review succeeded.
- Every finding has an evidence-backed disposition; confirmed defects
  are fixed unless they qualify as Accepted limits, and no unresolved
  P0/P1 remains.
- Every later task-code change has successful peer verification at the
  required impact scope, and relevant local checks pass — local checks
  cannot replace missing peer verification.
- The final task-code identity equals the one recorded at the last
  successful review call.

Stop when they hold, or when attempts run out — then report the
checkpoint incomplete (unverified fixes are **peer-unverified**) and
offer more budget, acceptance of the disclosed result, or a revised
approach; acceptance does not make it verified.

Every review invocation — initial, targeted, rerun, failed, unparseable
or turn-capped — consumes one of five attempts by default; increment
before launching. The user may set another positive finite limit; never
reset it when narrowing scope or recovering. Refuted findings and open
P2/P3s alone never justify another call. If no code changed since the
last successful review, make no further call: apply the pass conditions
above and report.

## Failure exits

Exit `0` means a usable result, not approval. Never replace a missing
peer checkpoint with the host's own answer.

| Case | Handling |
|---|---|
| Review exit `2` | Empty scope, not a pass: fix the scope within budget or report the checkpoint incomplete. |
| Failed (exit `4`/`5`), unparseable or turn-capped | Rerun once unless the cause is permanent (auth, credits, a model rejected twice); if it fails again, the checkpoint is incomplete — for the design checkpoint, do not implement. Rerunning the first blind consult uses no budget and stays **independent**. |
| No reviewable repository change | Cannot pass the code checkpoint; say so. |

## Final report and boundaries

Summarize checkpoint outcomes, scope and final code identity (and
whether its coverage combines an initial review with targeted checks or
ends in a whole-task review), model and
independence labels, attempts used, substantive disagreements, and every
finding's priority, location and disposition, including open P2/P3s.
Link the task record and preserved reports. Disclose failed checks,
unverified fixes and coverage limits explicitly.

The host remains the only writer: never use `codex apply`, bypass flags
or the wrapper's `task` mode here. Codex's read-only sandbox does not
restrict MCP servers' external effects, and Command Code is read-only by
prompt only — relay any drift warning and check the tree.
Mention MCP use when the output shows it. This workflow grants no
external mutation authority.
