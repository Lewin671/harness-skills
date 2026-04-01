---
name: parallel-agent-execution
description: Use this skill when multiple coding contributions may happen in parallel and the main agent must choose between shared-tree serialization, patch-only parallelism, or isolated git worktrees. This skill defines a portable decision order plus execution, ownership, environment, reconciliation, and cleanup contracts.
---

# Parallel Agent Execution

Use this skill when parallel help is desirable but the main agent still
needs one safe execution model for edits, verification, integration, and
cleanup.

The goal is not "use `git worktree`". The goal is to choose the cheapest
safe mode for the current repo and task, then write down the contract
before delegating.

## Use It When

Use it for:

1. Multiple coding contributions may run in parallel, whether as direct
   edits or patch proposals.
2. Ownership boundaries are mostly separable.
3. Some contributors may need file context, local commands, or runnable
   verification.
4. The main agent must keep base state, integration, and cleanup
   predictable.

Do not use it when:

1. The work heavily overlaps in the same files or module.
2. The task is still exploratory and safe ownership boundaries are not
   known yet.
3. One owner can finish faster than setting up a parallel contract.

## Start Here

1. Check for repo-local agent policy first if the repo documents one.
2. Run preflight and record:
   - current branch and exact `base sha`;
   - clean or dirty worktree state;
   - whether the task depends on uncommitted local edits that would not
     appear in a fresh worktree;
   - safe owner-to-path boundaries;
   - global files such as lockfiles, root configs, CI files, or shared
     generated outputs;
   - setup cost, submodules, caches, or heavy generated directories.
3. Choose the mode in this order:
   - If helpers do not need direct edits or a runnable checkout, use
     `patch-only parallel`.
   - Otherwise, if ownership overlaps, the repo is dirty in a way the
     task depends on, or the environment is too fragile or heavy for
     isolated setup, use `shared-tree serialized`.
   - Otherwise, if owners need direct edits and owner-local verification
     in parallel is materially useful, use
     `isolated worktree parallel`.
   - If unsure, fall back to `patch-only parallel`, not worktrees.
4. Record one execution contract before delegation:
   - execution mode;
   - branch and exact `base sha`;
   - owner-to-path boundary;
   - which global files stay main-agent owned;
   - verification each owner must run;
   - reconciliation and cleanup rules.

Read
[`references/mode-and-contract.md`](./references/mode-and-contract.md)
when the mode is ambiguous or you need the contract templates.

## Mode Rules

### Shared-tree Serialized

Use this when direct edits are needed but concurrency on one live tree
would create churn.

- Only one coding owner edits the shared tree at a time.
- Other helpers may review, inspect, or prepare patches, but they do not
  edit the same live tree concurrently.
- Re-baseline between owners if the boundary, branch, or target files
  change.
- Keep global files with the main agent unless one pass is explicitly
  assigned to own them.

### Patch-Only Parallel

Treat this as the default parallel mode.

- Helpers do not edit the live worktree.
- Give each helper a `base sha`, the exact file or diff anchor, a narrow
  ownership boundary, the required patch format, and the verification
  the main agent will rerun after applying.
- The main agent applies patches one at a time, inspects scope, and
  verifies centrally.
- If a helper ends up needing direct local edits or runnable debugging,
  stop and re-choose the mode instead of stretching the patch-only
  contract.

### Isolated Worktree Parallel

Use this only when direct edits plus owner-local verification are worth
the setup cost.

Require all of the following:

- One exact `base sha` for every coding owner. Do not rely on branch
  names alone.
- One short-lived branch per coding owner.
- One explicit path ownership boundary per coding owner.
- Global files default to the main agent unless explicitly assigned.
- Coding owners never merge each other's branches. The main agent
  integrates, verifies, and resolves conflicts.

If the original worktree is dirty, do not assume uncommitted changes
carry into new worktrees. Do not stash, reset, or commit user changes
just to make worktrees convenient. Either stabilize the needed baseline
explicitly or choose `shared-tree serialized` or `patch-only parallel`.

Recommended branch naming:

```text
agent/<task-slug>/<owner-id>
```

Recommended worktree naming:

```text
<worktree-root>/wt-<repo-slug>-<task-slug>-<owner-id>
```

Sanitize repo, task, and owner tokens into short, lowercase,
filesystem-safe and ref-safe slugs before using them in branch or path
names.

## Environment Rules

The main cost is usually duplicated setup, not Git object storage.

- Reuse caches only when they are safe for concurrent use across the
  chosen base state. If a cache is mutable or not keyed by lockfile,
  toolchain, or `base sha`, isolate it per owner or avoid worktrees.
- Avoid copying heavyweight generated directories into each worktree.
- Bootstrap only the minimum environment needed for that owner's
  boundary.
- If full setup per worktree is too expensive, switch to
  `patch-only parallel`, reduce the number of owners, or serialize the
  risky boundary.
- If the repo uses submodules, generated outputs, or shared prepared
  artifacts, define whether they are rebuilt per owner, main-agent
  owned, or exposed as single-writer read-only inputs.
- If a repo-specific bootstrap or cache policy exists, follow it rather
  than inventing a new one.

## Integration And Cleanup

Every coding owner must report:

- changed files;
- `base sha` used;
- verification run;
- residual risks.

The main agent integrates one owner at a time onto the chosen target
branch. If an owner drifted from the agreed base or touched out-of-scope
files, stop and re-baseline before continuing. If two owners end up
needing the same file, serialize the rest of that boundary instead of
forcing parallel merge churn.

Before closing:

1. Run the most relevant integration verification yourself.
2. Remove finished temporary worktrees.
3. Delete merged short-lived branches unless the user asked to keep
   them.
4. Record any skipped cleanup as explicit residual state.

Final status should make these explicit:

- chosen execution mode;
- branch and `base sha`;
- owner boundaries;
- verification run by owners and rerun by the main agent;
- cleanup completed, skipped, or intentionally retained.

## Repo Overrides

This skill is portable by default. If a repository documents its own
agent execution policy, prefer that policy over defaults from this
skill.

Look for repo-local guidance in `AGENTS.md`, `.agents/`, `docs/`, or
another repository-specific operator guide. Useful overrides include:

- canonical base branch;
- standard bootstrap or verification commands;
- heavy directories or caches;
- files that must stay main-agent owned;
- branch or worktree naming exceptions.
