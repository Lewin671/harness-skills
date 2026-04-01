# Mode And Contract

Use this reference when the main `SKILL.md` is not enough to decide
between serialization, patch-only parallelism, and isolated worktrees,
or when you need a reusable contract template.

## Preflight

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
8. Whether the repo defines an agent policy under a documented location
   such as `AGENTS.md`, `.agents/`, or `docs/`.
9. Whether submodules, generated outputs, or mutable caches need an
   explicit per-owner policy before parallel setup.

If base state, ownership, or dirty-state dependency is ambiguous, do not
open worktrees yet. Tighten the boundary first.

## Ordered Mode Choice

Use this decision order:

1. If helpers can work from files or diffs and do not need direct local
   edits, choose `patch-only parallel`.
2. Otherwise, if the task depends on dirty local state, ownership still
   overlaps, or the environment is too heavy or fragile for isolated
   setup, choose `shared-tree serialized`.
3. Otherwise, if each owner needs direct edits, each owner has a clear
   path boundary, and owner-local verification in parallel is materially
   useful, choose `isolated worktree parallel`.
4. If the answer is still ambiguous, fall back to
   `patch-only parallel`.

Do not choose `isolated worktree parallel` just because it is
available. Choose it only when it reduces total risk or total cycle
time.

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

Environment:
- Bootstrap level: <minimal | partial | full>
- Shared caches: <policy>
- Heavy directories to avoid duplicating: <paths or none>
- Submodule policy: <none | init per owner | shared prepared state>
- Generated output policy:
  <main-agent owned | rebuild per owner | shared artifact step>

Verification:
1. <owner-local check>
2. <main-agent integration check>

Reconciliation:
- Owners do not merge each other.
- Main agent integrates in sequence.
- Conflict or drift: stop and re-baseline.

Cleanup:
- Remove worktrees after integration.
- Delete short-lived branches after merge unless retained for diagnosis.
```

## Minimal Worktree Runbook

Use this when `isolated worktree parallel` is chosen:

1. Freeze the exact `base sha`.
2. Confirm the task does not depend on dirty local edits that are absent
   from a fresh worktree.
3. Create one short-lived branch and one worktree per coding owner.
4. Bootstrap only the minimum environment each owner needs.
5. Delegate with explicit path ownership plus local verification.
6. Integrate one owner at a time, re-running verification after each
   integration.
7. Remove finished worktrees and delete merged short-lived branches
   unless intentionally retained.

If you cannot satisfy step 2 safely, do not force worktrees. Use
`shared-tree serialized` or `patch-only parallel`.

## Repo Override Guidance

If a repository defines its own agent execution policy, prefer that over
defaults from this skill. A useful override can define:

- canonical base branch;
- standard bootstrap commands;
- standard verification commands;
- directories treated as heavy or non-portable;
- files that always require main-agent ownership.

Good overrides tighten defaults. They do not replace the need to record
an exact `base sha`, explicit ownership boundaries, and reconciliation
rules.
