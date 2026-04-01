# Topology Playbook

Use this reference when the main `SKILL.md` is not enough to choose the
right loop shape.

## Contents

- [Choose The Mode](#choose-the-mode)
- [Choose The Topology](#choose-the-topology)
- [Map The Environment](#map-the-environment)
- [Artifact-Specific Review](#artifact-specific-review)
- [Keep Reviews Independent](#keep-reviews-independent)
- [If The Loop Stalls](#if-the-loop-stalls)

## Choose The Mode

- Use `implementation-first` when the request is concrete and there is no
  meaningful existing diff.
- Use `audit-first` when you are reviewing an existing diff, a PR-like
  change, or a broad subsystem where defects must be found before safe
  ownership can be assigned.
- Mixed case tie-break:
  if there is already meaningful in-flight work, start with
  `audit-first` on the current diff, then switch to
  `implementation-first` only for accepted follow-on work inside the
  chosen boundary.

## Choose The Topology

- Single-file or low-risk docs, prompts, configs, or runbooks:
  one coding owner plus two review passes.
- Medium- or high-risk code changes:
  one coding owner plus three review passes.
- Several disjoint boundaries:
  one coding owner per boundary plus one integration review on the
  combined result.
- Large repos or mixed artifacts:
  split review coverage by subsystem or artifact slice, then add one
  cross-cutting integration review.
- No safe concurrency:
  use one coding owner and serialize the rest of the loop.

Do not split multiple coding owners across the same module unless the
environment can isolate and merge their work safely.

For cross-boundary defects, assign one primary owner for the fix brief,
list the secondary affected boundaries, and handle the work in sequence
when ownership overlaps.

## Map The Environment

- Direct-edit delegates:
  assign explicit file ownership, a base ref or current branch contract,
  and require them to report changed files and verification results.
- Patch-only delegates:
  require a base ref or diff anchor for the patch, then have the main
  agent apply, inspect, and verify the change.
- Shared worktree with weak isolation:
  avoid parallel coding in overlapping areas and re-baseline before
  applying the next patch or fix brief.
- No subagent primitive:
  keep the same rules, but run the loop as serialized local passes with
  at least two fresh review phases after each coding pass.
  Change the review lens or prompt between passes so they are not
  effectively duplicates.
  Treat the result as self-reviewed, not independently reviewed.
- Weak review isolation:
  do not feed prior reviewer conclusions into the next review pass
  unless the task is to validate a specific named issue.

## Artifact-Specific Review

- Docs and runbooks:
  check factual correctness, operator usability, stale commands, and
  missing failure paths.
- Prompts:
  check instruction conflicts, brittle assumptions, missing guardrails,
  and sample-input behavior.
- Configs:
  validate with the target tool when possible and check for unsafe
  defaults or missing integration updates.
- Mixed code plus docs:
  assign at least one review pass to cross-check that the docs and the
  implemented behavior still match, and list which adjacent artifacts
  were updated or intentionally left unchanged.

For large-repo slicing, maintain a slice manifest that records owners,
shared dependencies, global files, and the verification matrix for each
slice.

## Keep Reviews Independent

- Give reviewers the target scope and a lens, not the conclusions of
  other reviewers.
- Prefer separate threads, clean prompts, or fresh agents for each review
  pass.
- Ask for findings first, ordered by severity, with one evidence anchor
  and one confirming check per finding.
- If true independence is unavailable, mark that limitation in the scope
  brief and in the final report.

## If The Loop Stalls

When the same accepted issue survives two loops:

1. Tighten the fix brief.
2. Shrink the ownership boundary.
3. Rotate the coding owner, reviewer, or both.
4. Increase verification depth.
5. Fall back to one-owner serialized repair if parallelism is creating
   noise.
6. If serialized repair still cannot clear a blocking or major issue,
   stop and report the work as blocked instead of looping indefinitely.
