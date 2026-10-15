---
name: with-command-code
description: >-
  Claude Code, Codex and Kiro harnesses — not Command Code itself.
  Requires command-code-second-opinion and an authenticated `cmd` CLI.
  Delegate a task to Command Code as a general-purpose subagent: it can
  write and change code, research a codebase, investigate a bug, or run
  commands, while the host briefs it, checks its work, sends feedback in
  the same session and reports back. Trigger only when the user explicitly
  asks to hand work to Command Code ("让 command code 去做", "交给 command
  code", "和 command code 一起完成这个任务", "run this task with-command-code").
  For a blind review or a second opinion on a question, use
  command-code-second-opinion instead.
harnesses: [claude-code, codex, kiro]  # not command-code: it would be delegating to itself
---

# With Command Code

Use Command Code like a general-purpose subagent. It does the work — code
changes, research, investigation, anything a coding agent can do — and the host
stays the lead: it writes the brief, checks the result, sends feedback and
reports to the user. Command Code runs on a cheaper model and can be wrong, so
nothing it reports counts as done until the host has checked it.

The command is the `task` mode of the sibling skill's script,
[command-code-second-opinion](../command-code-second-opinion/SKILL.md)
`/run-command-code-second-opinion.mjs`. That skill's Usage, Model and Exit Codes
sections apply unchanged; read them first.

```
run-command-code-second-opinion.mjs task [--repo DIR] [--worktree] [OPTIONS] [--] TASK
run-command-code-second-opinion.mjs task [--repo DIR] --resume ID [OPTIONS] [--] FEEDBACK
```

## Workflow

1. **Brief.** Write the task to stand alone; a fresh run has none of this
   conversation. Say what to achieve, which files or areas matter, the
   constraints, what "done" looks like (for example, which tests must pass), and
   what to report back. Say explicitly if it must not commit or push — and by
   default it must not.
2. **Choose where it works.** By default it works in `--repo`, the current
   directory. Pass `--worktree` when the work should be isolated — the user has
   other changes in progress, or several tasks run in parallel; Command Code
   creates a fresh git worktree on a new branch. Follow the user's preference
   when they state one.
3. **Run** it with `run_in_background: true` and end the turn; the completion
   notification resumes you. On exit `0`, read the file named by the last
   `result:` line. `workdir:` says where the work happened — for a worktree run,
   that is the new worktree.
4. **Check.** For code, read the diff in `workdir` and run the relevant tests or
   checks yourself. For research or investigation, verify the claims that carry
   the conclusion. A report that it ran something is not proof: the `log:` file
   holds what each command actually returned. Relay every unprefixed `warning:`
   line.
5. **Feed back** in the same session: copy the last `resume:` line and append
   `-- "concrete feedback"`. Name what is wrong and what to do, not just "try
   again". Repeat steps 3–5 until the result passes the check. If it is not
   converging after a few rounds, stop and tell the user what is left, rather
   than looping.
6. **Report.** Say what was done, where (`workdir` and, for a worktree, its
   branch), what you checked and how, and anything still open. Leave merging a
   worktree branch to the user unless they asked for it. Nothing removes a
   worktree automatically: once its branch is merged or abandoned, remove it
   with `git worktree remove <workdir>` and delete the branch, or tell the user
   it is still there.

The host may fix small things itself rather than round-tripping through
feedback; say so in the report.

## Permissions

Every run passes `--yolo`: Command Code can edit files and run any command with
the user's own permissions, not only inside `workdir`. Unlike the read-only
modes, a task also loads the repository's own skills, alongside its `AGENTS.md`
and the user's MCP servers — all of them can steer what it runs. Delegate only in
repositories the user trusts, and keep actions with effects outside the machine
— pushing, publishing, deploying, messaging — out of the brief unless the user
asked for them. Two tasks running at once in the same directory will collide;
give each its own `--worktree`.
