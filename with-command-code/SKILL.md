---
name: with-command-code
description: >-
  Claude Code, Codex and Kiro harnesses — not Command Code itself, which
  has its own /review. Requires command-code-second-opinion and an
  authenticated `cmd` CLI. Complete a task with an independent Command
  Code design opinion and whole-task code review. The host implements;
  disagreements receive evidence-backed dispositions and fixes receive
  impact-scoped verification. Trigger only when the user explicitly asks
  to work with Command Code ("和 command code 一起完成这个任务", "build this
  with command code", "run this task with-command-code"). Both checkpoints
  always run once invoked. For a standalone review or question, use
  command-code-second-opinion directly.
harnesses: [claude-code, codex, kiro]  # not command-code: that harness has its own /review
---

# With Command Code

Complete one task through two checkpoints: an independent design opinion, then an
independent review of the whole task change. The host writes all code. Completion
requires evidence-backed dispositions and verification of the final change;
identical model preferences are not required. Independent analysis can expose
different blind spots, but agreement alone does not establish correctness.

Invocation authorizes the bounded Command Code calls below, implementation,
in-scope fixes and verification. It does not expand the user's scope or
external-action permissions. Preserve any stricter review scope or approval
requirement the user explicitly sets.

Read [command-code-second-opinion](../command-code-second-opinion/SKILL.md) and
the relevant mode reference before composing commands. Its execution, model,
boundary, marker and exit-code rules apply unchanged — including the fact that a
run is **not sandboxed** (a delegated sub-agent can still write), which is why
every run here carries an identity value. Within this workflow, the bounded
follow-ups, targeted fix verification and compact reporting below specialize its
standalone interaction rules; no extra approval is needed for those
already-authorized steps.

## 1. Record the task and initial position

Before the first Command Code call, briefly state the host's approach, key reason
and main uncertainty in the conversation. Include an alternative only when it is
materially plausible; do not manufacture a trade-off.

Keep a compact task record in a durable task-owned location outside the reviewed
repository, and give its path in the conversation. Update it after each decision,
invocation and fix:

- Original requirements, task scope, design decision and unresolved objections.
- Each call's mode, scope, model, independence label, result/log paths, the
  `identity:` value it reported, outcome, and the exact `resume:` command when
  available.
- Stable finding IDs, priority, location, evidence, disposition, fix identity
  and verification status.
- Review attempts used/limit (default five), design follow-up attempts used/limit
  (two), and remaining blockers.

Preserve full successful answers/reports beside the record before their original
temporary files disappear. Keep the record and design discussion out of
independent review prompts. Use commit IDs for committed code; for working
changes retain a base ID and the reported identity covering all task files,
including untracked ones. A scope name alone does not identify reviewed bytes,
and neither does an identity from a different run — it is only comparable with
the state it was taken from.

On recovery, read the record and compare current task code with the last verified
identity. Retain spent attempts and invalidate verification for new changes; do
not silently restart the budget or repeat completed calls.

## 2. Design checkpoint

Always obtain a blind consult: send the user's original requirements,
user-decided constraints, repository references and mechanical facts. Exclude the
host's position, inferred constraints and summaries. If the user prescribed the
approach, ask Command Code to assess it against the requirements rather than
reopen the user's decision.

Briefly relay Command Code's position and load-bearing arguments before giving
the host's comparison. Check factual claims before presenting them as
established. Classify any disagreement:

| Type | Disposition |
|---|---|
| Checkable fact: feasibility, API behaviour, compliance with a requirement | Inspect sources or run a minimal relevant experiment. Record the evidence and resolve the objection. |
| Engineering preference among approaches satisfying the requirements | The host chooses and explains the trade-off; retain Command Code's alternative and reason. Agreement is unnecessary. |
| Undecided user preference, scope or authorization | Prepare concrete options and consequences, then ask the user. Continue only independent authorized work while waiting. |

An unresolved material objection about safety, data integrity, core behaviour or
a required constraint blocks implementation of the affected approach. Never
relabel it a preference. Investigate within scope; if it cannot be resolved,
present the evidence and options to the user.

Use at most two consult follow-up attempts, including failures and recovery
calls. Each must add evidence, a clarified requirement or a revised proposal
addressing an objection; repeating positions does not justify another call.
Resume the same session with the copied `resume:` line and label the answer
**deliberation**. Two is a ceiling, not a target. When discussion ends, apply the
disposition rules above, not a vote count. If the approach materially changes,
assess the new risks; if another discussion is needed but the budget is
exhausted, report that and request more budget.

Pass this checkpoint when the chosen approach meets requirements and has no
unresolved material objection. Record any remaining preference split without
claiming consensus.

## 3. Implement and pre-register the code review

The host implements and performs checks appropriate to the change. If
implementation exposes a material design change or objection, revisit the design
disposition rules before proceeding, retaining spent attempts. Before calling
Command Code, briefly record expected risk areas and doubts in the host's
self-review. This stays out of the review prompt.

Use a fresh review invocation for the entire task change, including all its
commits and working changes. Follow the parent's scope reference; isolate the
task when unrelated work would pollute the review. Never stash, commit or revert
another task's changes to simplify scope.

The prompt may contain original requirements, user decisions and mechanical scope
facts. Exclude the host's rationale, self-review, suspected defects, task record
and design transcript. A fresh run carries no conversation history, so nothing
seeds it — but a prompt that contains the host's analysis is still not blind.

A review run leaves **no session to continue**. To have a finding adjudicated,
start a consult carrying that finding — labelled **deliberation** — or run a
`--custom` cross-check; do not look for a review session to resume.

**After every review run, check the reviewed paths for edits.** The run is not
sandboxed: a delegated sub-agent can write. A drift `warning:` means the identity
does not describe a single state, and any unexpected edit is the host's to
reconcile before continuing. An **unflagged** identity is not the opposite
verdict: it covers the reviewed paths, the index and the working-tree status
(created or deleted paths included), but not an in-place rewrite of an existing
ignored file and not writes under `.git/`. Treat it as "the reviewed change did
not shift", never as "nothing was touched".

## 4. Disposition findings and verify fixes

Relay the overall verdict (including an affirmative zero-finding result), scope,
model and compact finding list before fixing. Account for every finding with its
ID, priority and location. Then record:

- **Confirmed**: reproduced or evident from code → fix within scope.
- **Refuted**: contrary evidence → retain the finding and refutation; Command
  Code need not retract it.
- **Uncertain**: investigate proportionally; unresolved P0/P1 blocks completion,
  while unresolved P2/P3 may remain explicitly open.

A wording change cannot downgrade a material blocker. A fix requiring new scope
or authorization goes to the user with concrete consequences.

After each batch of fixes, choose Command Code verification scope by impact:

| Fix impact | Required review |
|---|---|
| Local and demonstrably bounded | Fix delta, original finding, related callers and relevant tests. Explain why this scope is sufficient. |
| Interfaces, shared state, permissions, architecture, cross-module effects, or uncertain impact | Review the whole task change again. |

Use review mode for both. For a targeted verification, `--custom` carries the
exact before/after comparison, paths, finding and expected behaviour; the wrapper
supplies the current diff alongside it. Require an explicit disposition of each
targeted finding plus prioritized new defects or an affirmative zero-new-finding
statement. This invocation is authorized by the workflow. It reads the live tree:
hold edits for its duration, and treat a drift `warning:` as **voiding** that
verification — rerun it rather than recording a pass.

Label targeted calls **fix verification (deliberation)**, never blind review. A
whole-task re-review carrying prior findings is also **deliberation**; only a
fresh, unseeded review is **independent**. Investigate new findings under the same
rules. Refuted findings and open P2/P3s alone do not require another round.

### Completion and budget

Every code-review invocation consumes one of five attempts by default, including
the initial review, targeted checks, failures and unusable results. Increment
before launching. The user may specify another positive finite limit; never reset
it when narrowing scope or recovering.

The code checkpoint passes only when:

- The initial whole-task review succeeded.
- Every finding has an evidence-backed disposition; confirmed findings are fixed
  and no unresolved P0/P1 remains.
- Every subsequent task-code change has received successful Command Code
  verification at the required impact scope, relevant local checks have passed,
  and no verification is qualified by a drift warning. Local checks cannot
  replace missing Command Code verification.
- The final task-code identity matches that coverage. Say whether coverage
  combines an initial review with targeted checks or a final whole-task review.

If attempts run out after a fix, mark it **Command-Code-unverified** and stop with
the checkpoint incomplete. Report blockers and offer more review budget,
acceptance of the disclosed incomplete result, or a revised approach. User
acceptance does not retroactively make it verified.

## Failure exits

The parent's exit-code and marker rules govern each call. `note:` lines are
operational facts; relay every wrapper `warning:` line — those qualify the
result. Exit `0` means a usable answer, not approval; a truncated run (`8`,
reported as a warning on exit `0`) is usable as information but cannot close a
verification budget.

- Review exit `2`: empty scope, not a pass. Correct the scope within the remaining
  budget or report an incomplete checkpoint.
- Exit `5` (rate limited) and `10` (insufficient credits) are not retried
  automatically: wait or pick a model the account can run, then continue.
- Exit `6`/`7` (transport or upstream failure) produced no answer; rerunning the
  same invocation is reasonable and consumes an attempt as usual.
- A failed consult follow-up: do not reuse that session. One fresh recovery
  consult may restate the context, labelled **deliberation**, only if a follow-up
  slot remains. Failed recovery stops.
- No priority findings and no affirmative zero-finding statement: unparseable.
  Relay it verbatim; allow one rerun within the remaining review budget,
  otherwise stop incomplete. A targeted answer that omits a requested finding's
  disposition leaves that fix unverified.
- A task producing no reviewable repository change cannot pass the code
  checkpoint. State that limitation rather than claiming completion.

## Final report and boundaries

Summarize checkpoint outcomes, scope and final code identity, model and
independence labels, attempts used, substantive disagreements, and every
finding's priority, location and disposition, including open P2/P3s. Link the
task record and preserved raw reports. Keep summaries faithful; full repeated
transcripts are unnecessary unless requested. Disclose failed checks, unverified
fixes, truncated runs and coverage limitations explicitly.

The host remains the only writer. Never pass `--yolo`, `--accept-edits`,
`--dangerously-skip-permissions` or a permission mode, and never use Command Code
to apply a fix. This workflow grants no additional external mutation authority —
and, because a run can still write through a delegated sub-agent, the identity
markers and the post-review path check above are what keep that from being
silent.
