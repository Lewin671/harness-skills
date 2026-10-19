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

Complete one task through two checkpoints: a blind design consult, then a
blind review of the whole task change. **The host writes all code; the peer
only advises and reviews.** Peer choice, commands, output handling and labels
follow [peer-second-opinion](../peer-second-opinion/SKILL.md) — read its
SKILL.md first, then [consult.md](../peer-second-opinion/references/consult.md)
before the design call and
[review.md](../peer-second-opinion/references/review.md) before the first
review. Where with-peer differs (follow-ups, fixes, reruns), with-peer wins.

Invocation authorizes the bounded peer calls below, implementation,
in-scope fixes and verification — no extra approval is needed for
those steps. It does not expand the user's scope or external-action
permissions; preserve any stricter review scope or approval requirement
the user sets.

**Blind prompts.** Both checkpoints start with a fresh call whose prompt
holds only the user's requirements and decisions, repository references
and mechanical scope facts — never the host's position, self-review,
notes or design discussion.

## 1. Record the task and initial position

Before the first peer call, write down the host's approach, key reason and
main uncertainty (an alternative only when materially plausible), and keep
it out of the prompt. It is the record the later comparison is checked
against. Keep a short task record as
[references/task-record.md](./references/task-record.md) describes:
requirements, base commit, calls, findings and budgets.

## 2. Design checkpoint

Always obtain a blind consult. If the user prescribed the approach, ask
the peer to assess it against the requirements rather than reopen the
decision. Relay and check it as the parent's Independence Contract says,
then classify any disagreement:

| Type | Disposition |
|---|---|
| Checkable fact: feasibility, API behaviour, compliance with a requirement | Inspect sources or run a minimal experiment; record the evidence and resolve the objection. |
| Engineering preference among approaches satisfying the requirements | The host chooses and explains the trade-off; retain the peer's alternative and reason. Agreement is unnecessary. |
| Undecided user preference, scope or authorization | Present concrete options and consequences to the user; meanwhile continue only independent authorized work. |

An unresolved material objection about safety, data integrity, core
behaviour or a required constraint blocks the affected approach; never
relabel it a preference. If investigation within scope cannot resolve
it, present the evidence and options to the user.

At most two consult follow-ups (their reruns included), each labelled
**deliberation**, each adding evidence, a clarified requirement or a
revised proposal — repeating positions does not justify a call. Two is a
ceiling, not a target. If the approach materially changes and needs more
discussion than that, report it and request more budget.

The checkpoint passes when the chosen approach meets requirements with
no unresolved material objection. Record any remaining preference split
without claiming consensus.

## 3. Implement and review the whole task

The host implements and runs checks appropriate to the change. If
implementation exposes a material design change, return to the design
disposition rules, retaining spent attempts.

Run a fresh review over the entire task change — all its commits and
working changes. Pick the scope from the recorded base; rows 1–2 assume no
unrelated work in the tree:

| Task change | Scope |
|---|---|
| Only uncommitted | `--uncommitted` |
| Commits since the base, plus tracked edits; no new untracked task files | `--base <base>` |
| Anything else — untracked task files beside commits, unrelated work in the tree | `--custom` naming the base, the commits and every task path (new files included), and telling the peer to diff against the base and read the listed new files |

Never stash, commit or revert another task's changes to simplify scope.

## 4. Disposition findings and verify fixes

Relay the verdict (including an affirmative zero-finding result), scope,
model and every finding (numbered F1, F2, … as you relay) with its
priority and location before fixing. Then record each as:

- **Confirmed** — reproduced or evident from code → fix within scope.
- **Refuted** — contrary evidence → keep the finding and refutation;
  the peer need not retract it.
- **Uncertain** — investigate proportionally; unresolved P0/P1 blocks
  completion, unresolved P2/P3 may stay explicitly open.
- **Accepted limit** — a real P2/P3 whose fix cost outweighs its expected
  benefit in the user's intended use → record the impact and trade-off
  and disclose it in the final report. Never for P0/P1, unmet
  requirements or material blockers.

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
commit SHA if committed, otherwise what changed in which paths), and asks
for a disposition of each targeted finding plus any new defects, or an
explicit "no new findings"; a missing disposition leaves that fix
unverified. It reads the live tree: confirm the delta exists, hold edits
during the call, and label it **deliberation**. A drift warning on any
review leaves the changed paths unverified. Investigate new findings
under the same rules.

After two consecutive targeted checks on the same fix area, do not answer
a new finding there with another patch-and-verify by default: disposition
it first, batch any confirmed fixes, and verify the batch at its impact
scope. Findings that keep escalating point to the approach, not to one
more patch.

### Completion and budget

Agreement alone is not correctness. The code checkpoint passes only when:

- The initial whole-task review succeeded.
- Every finding has an evidence-backed disposition; confirmed defects
  are fixed unless they qualify as Accepted limits, and no unresolved
  P0/P1 remains.
- Every task-code change made after its last relevant peer verification
  has been verified at its impact scope, and relevant local checks pass —
  local checks cannot replace missing peer verification. Where coverage
  cannot be established, the change is unverified.

Stop when they hold, or when attempts run out — then report the
checkpoint incomplete (unverified fixes are **peer-unverified**) and
offer more budget, acceptance of the disclosed result, or a revised
approach; acceptance does not make it verified.

Every review invocation — initial, targeted, rerun, failed, unparseable,
turn-capped or cancelled — consumes one of five attempts by default;
settle its scope first, then count it before launching. The user may set
another positive finite limit; never reset it when narrowing scope or
recovering. Refuted findings and open P2/P3s alone never justify another
call. If no code changed since the last successful review, make no
further call.

## Failure exits

Exit `0` means a usable result, not approval. Never replace a missing
peer checkpoint with the host's own answer.

- **Review exit `2`:** empty scope, not a pass — fix the scope within
  budget or report the checkpoint incomplete.
- **Failed, unparseable or turn-capped:** rerun once only for a transient
  cause (the parent's § Exit Codes); if it fails again, the checkpoint is
  incomplete. A missing design checkpoint blocks implementation.
- **Budgets:** rerunning the first blind consult uses no budget and stays
  **independent**; reruns of follow-ups count toward their two; every
  review invocation counts toward the five.
- **No reviewable repository change:** the code checkpoint cannot pass;
  say so.

## Final report and boundaries

Summarize checkpoint outcomes, scope and coverage (an initial review plus
targeted checks, or ending in a whole-task review), model and independence
labels, attempts used by outcome (for example "5 attempts: 3 succeeded,
1 failed, 1 cancelled" — never "five review rounds"), substantive
disagreements, and every finding's priority, location and disposition,
including open P2/P3s and Accepted limits. Link the task record and
preserved reports. Disclose failed checks, unverified fixes and coverage
limits explicitly.

The host remains the only writer: never use `codex apply`, bypass flags
or the wrapper's `task` mode here. This workflow grants no external
mutation authority.
