---
name: delegate-to-codex
description: >-
  Claude Code ONLY — requires codex-second-opinion and an authenticated
  codex CLI. Delegate a task to Codex as a general-purpose subagent: it
  writes and changes code, researches a codebase, investigates a bug, or
  runs commands (including over the network), while Claude briefs it,
  checks its work, sends feedback in the same session and reports back.
  Trigger only when the user explicitly asks to hand work to Codex
  ("让 codex 去做", "交给 codex", "delegate this to codex", "run this task
  with delegate-to-codex"). Not for "和 codex 一起完成这个任务" — that is
  with-codex, where Claude implements and Codex reviews. For a review or
  a second opinion, use codex-second-opinion.
harnesses: [claude-code]
---

# Delegate to Codex

Use Codex like a general-purpose subagent. It does the work — code changes,
research, investigation, measurements, anything a coding agent can do — and
Claude stays the lead: it writes the brief, checks the result, sends feedback
and reports to the user. Nothing Codex reports counts as done until Claude has
checked it.

The command is the `task` mode of the sibling skill's script, usually
`~/.claude/skills/codex-second-opinion/run-codex-second-opinion.mjs`. Never
hand-roll `codex exec` instead: the script closes Codex's stdin (a bare
`codex exec` in a background shell can wait on it forever while looking busy),
streams progress, enforces a timeout and prints authoritative result and resume
markers.

```
run-codex-second-opinion.mjs task [--repo DIR] [OPTIONS] [--] TASK
run-codex-second-opinion.mjs task [--repo DIR] --continue ID [OPTIONS] [--] FEEDBACK
```

- TASK is one argument; put it after `--`. Options: `--timeout N` (seconds,
  default 7200), `--model M --effort L` (always a pair; omit both for the
  pinned default unless the user asked for another model).
- It needs an authenticated `codex` on `PATH`, or `CODEX_BIN` set to its
  absolute path; exit `3` with "could not find 'codex'" means neither holds
  in this shell. Prerequisites, capacity retries and model rejections:
  [execution.md](../codex-second-opinion/references/execution.md).
- Progress streams to stderr: `codex> ` lines are Codex, unprefixed lines are
  the script. Trust the exit code, not the prose: `0` result produced, `3` bad
  arguments or environment, `4` no usable result (read stderr), `5` timed out
  (still resumable, step 5), `129`/`130`/`143` interrupted. When the merged
  output must be interpreted, use the last marker of each kind
  ([output-protocol.md](../codex-second-opinion/references/output-protocol.md)).

## Workflow

1. **Brief.** Write the task to stand alone; a fresh run has none of this
   conversation. Say what to achieve, which files, machines or areas matter,
   the constraints, what "done" looks like (for example, which tests must
   pass), and what to report back. A long brief goes in a file outside the
   repository, with the TASK pointing at its absolute path. Say explicitly if
   it must not commit or push — and by default it must not.
2. **Choose where it works.** `--repo` (default: the current directory) is its
   working directory. When the work should be isolated — the user has other
   changes in progress, or several tasks run in parallel — create a worktree
   yourself (`git worktree add -b <branch> <path>`) and pass it as `--repo`.
   Follow the user's preference when they state one.
3. **Run** it with `run_in_background: true` and end the turn; the completion
   notification resumes you. On exit `0`, read the file named by the last
   `result:` line; `workdir:` says where the work happened.
4. **Check.** For code, read the diff in `workdir` and run the relevant tests or
   checks yourself. For research, investigation or measurements, verify the
   claims that carry the conclusion. A report that it ran something is not
   proof: the `log:` file holds what each command actually returned. Relay
   every unprefixed `warning:` line.
5. **Feed back** in the same session: copy the last `resume:` line and append
   `-- "concrete feedback"`. Name what is wrong and what to do, not just "try
   again". A timed-out run (exit `5`) still prints `workdir:` and `resume:` —
   the work so far is on disk and the session keeps its history — so resume it
   the same way, asking it first to check the current state: an interrupted
   step may be half done, and a killed local `ssh` does not prove the remote
   command stopped. For a task likely to need more than two hours, raise
   `--timeout` up front. Repeat steps 3–5 until the result passes the check. If
   it is not converging after a few rounds, stop and tell the user what is
   left, rather than looping.
6. **Report.** Say what was done, where (`workdir` and, for a worktree, its
   branch), what you checked and how, and anything still open. Leave merging a
   worktree branch to the user unless they asked for it; once it is merged or
   abandoned, remove it with `git worktree remove <path>` and delete the
   branch, or tell the user it is still there.

Claude may fix small things itself rather than round-tripping through
feedback; say so in the report.

## Permissions

Every task runs with `sandbox_mode="danger-full-access"` and
`approval_policy="never"`: Codex can edit files, use the network and run any
command with the user's own permissions, not only inside `workdir`. Unlike the
read-only modes, a task keeps the user's normal codex setup — hooks, plugins,
memories, notify and MCP servers — and the repository's own `AGENTS.md`; all of
them can steer what it runs. Delegate only in repositories the user trusts, and
keep actions with effects outside the machine — pushing, publishing,
deploying, messaging — out of the brief unless the user asked for them. Two
tasks running at once in the same directory will collide; give each its own
worktree.
