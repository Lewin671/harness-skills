# Mode And Contract

Use this reference when the main `SKILL.md` is not enough to decide
between serialization, patch-only parallelism, and isolated worktrees.

## Preflight

Before delegation, confirm:

1. `git status --short` and whether local user edits already exist.
2. `git branch --show-current` and the exact `git rev-parse HEAD`.
3. If the repo uses submodules, inspect their working state too, not
   just the superproject view.
4. Whether the task depends on uncommitted local edits that will not
   appear in a fresh worktree unless they are stabilized first.
5. Which files or directories each coding owner may touch.
6. Whether the task includes global files such as lockfiles, root build
   configs, CI workflows, or shared generated outputs.
7. Whether local setup is lightweight, moderate, or heavy.
8. Whether the repo defines an agent policy or bootstrap contract under
   a documented location such as `AGENTS.md`, `.agents/`, or `docs/`.
9. Whether submodules, generated outputs, or mutable caches need an
   explicit per-owner policy before parallel setup.

If base state or ownership is ambiguous, do not open worktrees yet.
Tighten the task boundary first.

## Mode Matrix

- Choose `shared-tree serialized` when:
  - the work overlaps;
  - the repo has fragile local state;
  - only one owner needs runnable verification.
- Choose `patch-only parallel` when:
  - helpers can inspect files or diffs without editing in place;
  - the main agent can apply and verify patches centrally;
  - environment setup is expensive.
- Choose `isolated worktree parallel` when:
  - each owner needs direct edits;
  - each owner has a clear path boundary;
  - local verification in parallel is materially useful.

Do not choose `isolated worktree parallel` just because it is available.
Choose it only when it reduces total risk or total cycle time.

## Portable Contract Template

```text
Execution mode: <shared-tree serialized | patch-only parallel | isolated worktree parallel>

Base state:
- Branch: <branch>
- Base sha: <sha>

Ownership:
- owner-a -> <paths>
- owner-b -> <paths>
- main agent -> <global files and integration>

Branching:
- Naming: agent/<task-slug>/<owner-id>
- Sanitize repo, task, and owner tokens to ref-safe, filesystem-safe
  slugs before use.

Environment:
- Bootstrap level: <minimal | partial | full>
- Shared caches: <package manager / compiler / venv policy>
  only if safe for concurrent use across the chosen base state
- Heavy directories to avoid duplicating: <paths or none>
- Submodule policy: <none | init per owner | shared prepared state>
- Generated output policy:
  <main-agent owned | rebuild per owner | shared artifact step>
- Shared prepared state or artifacts:
  <single-writer read-only input | versioned per base sha/toolchain>

Verification:
1. <owner-local check>
2. <main-agent integration check>

Reconciliation:
- Owners do not merge each other.
- Main agent integrates in sequence.
- Conflict on owned paths: stop and re-baseline.

Cleanup:
- Remove worktrees after integration.
- Delete short-lived branches after merge unless retained for diagnosis.
```

## Repo Override Guidance

If a repository defines its own agent execution policy, prefer that over
defaults from this skill. A useful override can define:

- canonical base branch;
- standard bootstrap commands;
- standard verification commands;
- directories treated as heavy or non-portable;
- files that always require main-agent ownership.

Good overrides tighten defaults. They should not replace the need to
record an exact base sha, ownership boundaries, and reconciliation
rules.
