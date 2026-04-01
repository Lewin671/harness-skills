---
name: parallel-agent-execution
description: Use this skill when the main agent needs to delegate coding or review work in parallel inside one repo and must choose between patch-only proposals, serialized edits on one live worktree, or isolated git worktrees. This skill defines safe defaults for base state, owner boundaries, handoff artifacts, verification, integration, and cleanup.
---

# Parallel Agent Execution

Use this skill when parallel help is desirable but the main agent still
needs one safe execution model for edits, verification, integration, and
cleanup.

The goal is not "use `git worktree`". The goal is to choose the cheapest
safe mode for the current repo and task, then record the contract before
delegating.

## Use It When

Use it for:

1. Multiple contributions may run in parallel, whether as direct edits,
   review passes, or patch proposals.
2. At least some ownership boundaries can be stated up front.
3. Some helpers may need file context, local commands, or a runnable
   checkout.
4. The main agent must keep base state, integration, and cleanup
   predictable.

Do not use it when:

1. The task is still exploratory and safe ownership boundaries are not
   known yet.
2. One owner can finish faster than setting up and integrating a
   parallel contract.
3. Overlap is so high that even serialized turns on one tree add little
   value.

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
   - If helpers can work from files or diffs and do not need direct
     edits or a runnable checkout, use `patch-only parallel`.
   - Otherwise, if helpers need direct edits or a runnable checkout but
     overlap, dirty-state dependence, or setup fragility makes isolated
     setup unsafe or wasteful, use `shared-tree serialized`.
   - Otherwise, if each coding owner needs direct edits and owner-local
     verification, each owner has an explicit path boundary, and the
     isolated setup cost is worth it, use `isolated worktree parallel`.
   - If the uncertainty is about worktree safety, cache policy, or setup
     weight, fall back to `shared-tree serialized`.
   - If the uncertainty is about whether parallel help is worth the
     coordination cost at all, reduce the number of owners or use a
     one-owner workflow instead.
4. Record one execution contract before delegation:
   - execution mode;
   - branch and exact `base sha`;
   - owner-to-path boundary;
   - which global files and shared artifacts stay main-agent or
     single-writer owned;
   - the owner handoff artifact;
   - verification each owner must run and what the main agent will
     rerun;
   - reconciliation, failure recovery, and cleanup rules.

Read
[`references/mode-and-contract.md`](./references/mode-and-contract.md)
when you need the contract templates, the worktree runbook, or the
failure-recovery checklist.

## Mode Rules

### Shared-tree Serialized

Use this when direct edits or a runnable checkout are needed, but one
live tree is still the safest place to do the work.

- Only one coding owner edits the shared tree at a time.
- Other helpers may review, inspect, or prepare patches, but they do not
  edit the same live tree concurrently.
- Ownership may still overlap across the overall task. What stays
  serialized is live-tree editing.
- Re-baseline between owners if the boundary, branch, or target files
  change.
- Keep global files with the main agent unless one pass is explicitly
  assigned to own them.

### Patch-Only Parallel

Treat this as the default parallel mode when a runnable checkout is not
required.

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
- Create each owner branch and worktree from that exact `base sha`.
- One short-lived branch per coding owner.
- One explicit path ownership boundary per coding owner.
- One explicit handoff artifact per coding owner:
  `branch name + tip commit sha` or another recorded patch artifact the
  main agent can integrate deterministically.
- Global files default to the main agent unless explicitly assigned.
- Shared prepared state, submodules, caches, or generated artifacts must
  be rebuilt per owner, owned by the main agent, or exposed as
  single-writer read-only inputs.
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
names. If a branch or worktree name already exists, either remove the
stale state first or add a recorded suffix instead of improvising
mid-run.

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
- If isolated caches or prepared state are created per owner, decide up
  front whether they will be deleted, retained for diagnosis, or handed
  off as explicit residual state.
- If a repo-specific bootstrap or cache policy exists, follow it rather
  than inventing a new one.

## Integration And Cleanup

Every coding owner must report:

- changed files;
- `base sha` used;
- handoff artifact used for integration, such as `branch + tip commit
  sha` or a recorded patch;
- verification run;
- residual risks;
- whether the owner worktree is clean enough for cleanup, or why it must
  be retained.

The main agent integrates one owner at a time onto the chosen target
branch. If an owner drifted from the agreed base or touched out-of-scope
files, stop and re-baseline before continuing. If two owners end up
needing the same file, serialize the rest of that boundary instead of
forcing parallel merge churn.

If post-integration verification fails, do not keep integrating. Keep
the failing owner result quarantined for diagnosis as a retained branch,
worktree, or patch artifact, undo the attempted integration on the
target branch if that is safe, then tighten the boundary, switch modes,
or report the task as blocked.

Before closing:

1. Run the most relevant integration verification yourself.
2. Remove finished temporary worktrees and owner-specific caches unless
   they were intentionally retained for diagnosis.
3. Delete merged short-lived branches unless the user asked to keep them
   or they are needed for failure analysis.
4. Record any skipped cleanup as explicit residual state.

Final status should make these explicit:

- chosen execution mode;
- branch and `base sha`;
- owner boundaries;
- owner handoff artifacts;
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
