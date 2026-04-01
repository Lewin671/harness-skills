---
name: parallel-agent-execution
description: Use this skill when multiple coding agents may need to work in parallel and the main agent must choose between shared-tree serialization, patch-only parallelism, or isolated git worktrees. This skill defines a portable execution, ownership, environment, reconciliation, and cleanup contract that can be reused across repositories.
---

# Parallel Agent Execution

Use this skill when parallel coding is desirable but shared-worktree
edits would create avoidable conflicts.

The goal is not "always use `git worktree`". The goal is to choose the
cheapest safe execution mode for the current repository and task, then
run it with a clear integration contract.

## Use It When

Use it for:

1. Multiple coding agents may edit files directly.
2. Ownership boundaries are mostly separable.
3. Agents need a real working copy to run commands or inspect local
   behavior.
4. The main agent must keep branching, cleanup, and final integration
   predictable.

Do not use it when:

1. Changes heavily overlap in the same files or module.
2. One main agent can apply patches cleanly from review or helper
   delegates.
3. Repo bootstrap cost is so heavy that extra worktrees would dominate
   the task.

## Start Here

1. Run a preflight check:
   - current branch and exact base sha;
   - clean or dirty worktree state;
   - whether uncommitted local changes must be committed, stashed, or
     kept out of the isolated execution path;
   - whether the task has safe path ownership boundaries;
   - whether the repo has expensive local setup, generated directories,
     submodules, or monorepo-wide global files.
2. Check for repo-local agent policy before choosing a mode if the repo
   documents one.
3. Choose one mode:
   - `shared-tree serialized`
   - `patch-only parallel`
   - `isolated worktree parallel`
4. Record one execution contract before delegation:
   - base sha;
   - owner to path boundary;
   - branch naming scheme;
   - verification expectations;
   - reconciliation and cleanup rules.

Read
[`references/mode-and-contract.md`](./references/mode-and-contract.md)
when the preflight result is ambiguous or the repo needs local override
rules.

## Mode Selection

- Use `shared-tree serialized` when ownership overlaps or when the repo
  is too heavy for parallel isolated setup.
- Use `patch-only parallel` when helpers can work from file context or a
  diff anchor without needing a runnable local checkout.
- Use `isolated worktree parallel` only when direct edits plus local
  verification are worth the setup cost and ownership boundaries are
  concrete.

Treat `patch-only parallel` as the default fallback when worktree
isolation is not clearly worth it.

## Worktree Contract

When using `isolated worktree parallel`, require all of the following:

- One exact `base sha` for every coding owner. Do not rely on branch
  names alone.
- If the original worktree is dirty, do not assume uncommitted changes
  carry into new worktrees. Stabilize them first or keep the task on a
  non-worktree path.
- One short-lived branch per coding owner.
- One explicit path ownership boundary per coding owner.
- Global files such as lockfiles, root configs, CI definitions, and
  shared generated artifacts default to the main agent unless explicitly
  assigned.
- Coding owners do not merge each other's branches. The main agent
  integrates, verifies, and resolves conflicts.

Recommended branch naming:

```text
agent/<task-slug>/<owner-id>
```

Sanitize `<repo-slug>`, `<task-slug>`, `<owner-id>`, and similar tokens
into short, lowercase filesystem-safe and ref-safe segments before using
them in branch or path names.

Recommended worktree naming:

```text
<worktree-root>/wt-<repo-slug>-<task-slug>-<owner-id>
```

Choose `<worktree-root>` from a writable location approved by the repo
or environment. A sibling directory can work, but do not assume it is
always available.

Keep names deterministic and short enough for common shell tools.

## Environment Rules

The main performance risk is usually not Git object storage. It is
duplicated local environment setup.

- Reuse global or external caches only when they are safe for concurrent
  use across the chosen base state. If a cache is mutable or not keyed
  by lockfile, toolchain, or base sha, isolate it per owner or avoid
  parallel worktrees.
- Avoid copying heavyweight generated directories into each worktree.
- Bootstrap the minimum environment needed for that owner's boundary.
- If full setup per worktree is too expensive, switch to
  `patch-only parallel` or reduce the number of coding owners.
- If the repo uses submodules, define whether each worktree must
  initialize or update them, how dirty submodule state will be detected
  during preflight, and how that cost will be controlled.
- If local verification depends on generated outputs, decide whether they
  are main-agent owned, rebuilt per owner, or handled by a shared
  reproducible artifact step before delegating.
- Any shared prepared submodule state or shared artifact step must be
  single-writer and read-only for consumers, or versioned by base sha and
  toolchain so owners cannot race through mutable shared state.
- If a repo-specific bootstrap or cache policy exists, follow it rather
  than inventing a new one.

## Reconciliation Rules

- Each coding owner reports:
  - changed files;
  - base sha used;
  - verification run;
  - residual risks.
- The main agent integrates one owner at a time onto the integration
  branch or current target branch.
- If an owner drifted from the agreed base or touched out-of-scope
  files, stop and re-baseline before continuing.
- If two owners need the same file after all, serialize the remainder of
  that boundary instead of forcing parallel merge churn.

## Cleanup

- Remove finished temporary worktrees.
- Delete merged short-lived branches unless the user asked to keep them.
- Keep failed worktrees only when needed for diagnosis.
- Record any skipped cleanup as explicit residual state in the final
  report.

## Repo Overrides

This skill is portable by default. If a repository documents an agent
execution policy, check it during preflight before final mode selection.
Repositories may override details such as:

- preferred base branch;
- bootstrap and verification commands;
- heavy directories or caches;
- files that must stay main-agent owned;
- branch naming exceptions.

Look for a repo-local contract in documented policy locations, for
example `AGENTS.md`, `.agents/`, `docs/`, or another repository-specific
operator guide.
