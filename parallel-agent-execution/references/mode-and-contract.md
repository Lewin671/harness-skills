# Mode And Contract

Use this reference when the main `SKILL.md` is not enough to choose a
mode quickly, when you need a reusable contract template, or when an
integration failure needs an explicit recovery path.

## Fast Mode Check

Use this decision order:

1. If one owner can finish faster than parallel setup and integration,
   switch to one-owner execution instead of forcing a parallel mode.
2. If helpers can work from files or diffs and do not need direct edits
   or a runnable checkout, choose `patch-only parallel`.
3. Otherwise, if direct edits or a runnable checkout are needed but one
   live tree is safer because ownership overlaps, dirty local state
   matters, or setup is fragile or heavy, choose
   `shared-tree serialized`.
4. Otherwise, if each coding owner needs direct edits, each owner has a
   clear path boundary, each owner branch/worktree can be created from
   the exact same `base sha`, and owner-local verification in parallel
   is materially useful, choose `isolated worktree parallel`.
5. If you are unsure whether isolated setup is safe or worth the setup
   cost, fall back to `shared-tree serialized`.

Do not choose `isolated worktree parallel` just because it is
available. Choose it only when it reduces total risk or total cycle
time.

## Preflight Checklist

Before delegation, confirm:

1. `git status --short`, and whether local user edits already exist.
2. `git branch --show-current` and the exact `git rev-parse HEAD`.
3. If the repo uses submodules, inspect their working state too.
4. Whether the task depends on uncommitted local edits that would not
   appear in a fresh worktree unless they are stabilized first.
5. Which files or directories each coding owner may touch.
6. Which files stay main-agent owned, especially lockfiles, root build
   configs, CI workflows, or shared generated outputs.
7. Whether local setup is lightweight, moderate, or heavy.
8. Whether submodules, generated outputs, shared prepared artifacts, or
   mutable caches need an explicit single-writer or read-only policy.
9. Whether the repo defines an agent policy under a documented location
   such as `AGENTS.md`, `.agents/`, or `docs/`.

If base state, ownership, dirty-state dependency, or shared-artifact
policy is ambiguous, do not open worktrees yet. Tighten the boundary
first.

## Contract Templates

### Shared-Tree Serialized

```text
Execution mode: shared-tree serialized

Base state:
- Branch: <branch>
- Base sha: <sha>

Ownership:
- active owner now: <owner-id -> paths>
- deferred owners or helpers: <review, patch prep, or waiting>
- main agent: <global files and integration>

Rules:
- Only one coding owner edits the shared worktree at a time.
- Re-baseline before switching owners if target files or branch state changed.
- Helpers may inspect or prepare patches, but they do not edit the live tree concurrently.

Verification:
1. <owner check if applicable>
2. <main-agent rerun after each owner pass>
```

### Patch-Only Parallel

```text
Execution mode: patch-only parallel

Base state:
- Branch: <branch>
- Base sha: <sha>
- Diff anchor or file context: <paths, commit, or target diff>

Ownership:
- helper-a -> <paths>
- helper-b -> <paths>
- main agent -> live tree, patch apply, verification, and integration

Patch contract:
- Helpers do not edit the live worktree.
- Output format: <unified diff | apply_patch block | explicit file edits>
- Out-of-scope files: <paths>
- Main agent applies one patch at a time and inspects scope before the next.

Verification:
1. <checks the main agent reruns after applying>
2. <integration check>
```

### Isolated Worktree Parallel

```text
Execution mode: isolated worktree parallel

Base state:
- Branch: <branch>
- Base sha: <sha>

Ownership:
- owner-a -> <paths>
- owner-b -> <paths>
- main agent -> <global files and integration>

Branching:
- Naming: agent/<task-slug>/<owner-id>
- Worktree path: <worktree-root>/wt-<repo-slug>-<task-slug>-<owner-id>
- Collision policy: <remove stale state first | add recorded suffix>
- Create each owner branch/worktree from: <exact base sha>

Environment:
- Bootstrap level: <minimal | partial | full>
- Shared caches: <read-only shared | isolated per owner | avoid>
- Heavy directories to avoid duplicating: <paths or none>
- Submodule policy: <none | init per owner | single-writer read-only prepared state>
- Generated output policy:
  <main-agent owned | rebuild per owner | single-writer artifact step with read-only consumers>

Owner handoff:
- owner-a -> <branch name + tip commit sha | patch artifact>
- owner-b -> <branch name + tip commit sha | patch artifact>
- Cleanup readiness: <must leave clean worktree | retention rule if not clean>
- Pre-integration check artifact: <diff | changed-file list | patch scope record>

Verification:
1. <owner-local check>
2. <main-agent integration check>

Reconciliation:
- Owners do not merge each other.
- Main agent integrates in sequence.
- Before each integration, compare the owner-reported `base sha` and
  changed-file scope against the contract using a concrete diff,
  changed-file list, or patch artifact. If base or scope drifted, stop
  before integrating and re-brief or re-baseline first. Record the
  artifact used for that check in the integration handoff notes.
- Conflict or drift: stop and re-baseline.

Failure recovery:
- If post-integration verification fails, stop integrating more owners.
- Retain the failing branch, worktree, or patch artifact for diagnosis.
- Undo the attempted integration on the target branch if that is safe.
- Treat undo as safe only when it will not discard unrelated user
  changes or already-accepted owner results. If that is unclear, retain
  the failing state and report `blocked` instead of guessing.
- If you undo attempted changes on the target branch, rerun
  target-branch verification immediately and record whether the rollback
  restored a stable target state.
- Post-rollback verification record: <command/check and result, or not applicable>
- Re-brief the boundary, switch mode, or report the task as blocked.
- If reporting `blocked`, record whether previously integrated owner
  results remain on the target branch, were rolled back, or were kept
  only as retained artifacts outside the target branch.

Cleanup:
- Remove worktrees after integration unless intentionally retained.
- Delete isolated caches after success unless intentionally retained.
- Delete merged short-lived branches after merge unless retained for diagnosis.
```

## Minimal Worktree Runbook

Use this when `isolated worktree parallel` is chosen:

1. Freeze the exact `base sha`.
2. Confirm the task does not depend on dirty local edits that are absent
   from a fresh worktree.
3. Resolve branch or worktree naming collisions before creation. Remove
   stale state first or choose a recorded suffix.
4. Create each owner branch and worktree from that exact `base sha`.
5. Bootstrap only the minimum environment each owner needs.
6. Delegate with explicit path ownership, handoff artifact, and local
   verification.
7. Integrate one owner at a time, re-running verification after each
   integration.
8. If integration verification fails, retain the failing owner state for
   diagnosis, undo the attempted integration if safe, and stop before
   the next owner.
9. Remove finished worktrees and isolated caches after success unless
   intentionally retained.
10. Delete merged short-lived branches unless intentionally retained.

If you cannot satisfy step 2, 3, or 4 safely, do not force worktrees.
Use `shared-tree serialized` or `patch-only parallel`.

## Repo Override Guidance

If a repository defines its own agent execution policy, prefer that over
defaults from this skill. A useful override can define:

- canonical base branch;
- standard bootstrap commands;
- standard verification commands;
- directories treated as heavy or non-portable;
- files that always require main-agent ownership.

Good overrides tighten defaults. They do not replace the need to record
an exact `base sha`, explicit ownership boundaries, a deterministic
handoff artifact, and recovery rules when integration fails.
