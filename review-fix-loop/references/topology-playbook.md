# Topology Playbook

Use this reference when the main `SKILL.md` is not enough to choose the
loop shape quickly.

## Choose The Mode

Pick in this order:

1. `audit-first` if a meaningful diff, patch, or in-flight artifact
   already exists.
2. `implementation-first` if the request is concrete and there is no
   meaningful existing diff.
3. `mixed handoff` if you must audit current work before adding more.

Tie-break:
if there is already in-flight work, start with `audit-first` on the
current boundary. Only switch to `implementation-first` for accepted
follow-on work.

## Choose The Topology

Use the smallest topology that can still catch real defects:

- Docs, prompts, configs, runbooks, or skills:
  one coding owner plus two review passes.
- Code or mixed artifacts:
  one coding owner plus three review passes.
- Several disjoint boundaries:
  split coding ownership by boundary, then add one integration review on
  the combined result.
- Large or mixed surfaces:
  split review coverage by subsystem or artifact slice, then add one
  cross-boundary integration pass.

Do not split multiple coding owners across the same module unless the
environment can isolate and merge their work safely.

Do not add extra reviewers just because they are available. Add another
pass only when one blind spot is still unowned.

## Map The Environment

Record the execution contract before delegation:

- exact base state: branch, ref, diff anchor, or worktree contract;
- owner-to-boundary mapping;
- edit mode: direct edits or patch proposals;
- verification each owner must run;
- whether owners share the same worktree state;
- how integration will be verified and reconciled.

If owners do not share one worktree, define the base ref or diff anchor
explicitly before work starts.

## Delegation Gate

Use this skill only when both are true:

1. The environment can start isolated subagents for coding and review.
2. Review passes can stay independent enough that findings are not just
   replayed from prior prompts.

If either condition fails, do not pretend this skill still applies.
Switch workflows and report that `review-fix-loop` was not applicable in
that environment.

## Artifact Review Lenses

Pick one lens per review pass when useful:

- Code: correctness, regressions, integration, verification depth.
- Docs or runbooks: factual accuracy, operator usability, stale steps,
  failure paths.
- Prompts: instruction conflicts, brittle assumptions, missing
  guardrails, sample-input behavior.
- Configs: syntax validity, unsafe defaults, missing integration
  updates.
- Skills: trigger wording, decision order, delegation gate, output
  contract, reference discoverability, closeout checkability.
- Mixed code plus docs: behavior-to-doc alignment and untouched adjacent
  artifacts that may now be stale.

## Keep Reviews Independent

- Give reviewers the scope and lens, not other reviewers' conclusions.
- Use separate threads, fresh prompts, or otherwise isolated review
  passes.
- Require findings-first output with one evidence anchor and one
  confirming check per finding.
- Require each delegated review pass to end with an explicit
  full-scope-completion statement. Missing or partial coverage means the
  pass is incomplete and cannot count toward closure.
- If true independence is unavailable, stop and choose another
  workflow.

## If The Loop Stalls

When the same accepted issue survives two loops:

1. Tighten the fix brief.
2. Shrink the ownership boundary.
3. Rotate the coding owner, reviewer, or both.
4. Increase verification depth.
5. Stop and change workflows if the loop is creating noise instead of
   convergence.
6. If a `blocking` or `major` issue still cannot be cleared, report the
   work as blocked instead of looping indefinitely.
