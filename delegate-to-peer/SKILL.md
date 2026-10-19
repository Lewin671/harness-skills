---
name: delegate-to-peer
description: >-
  Requires peer-second-opinion and an authenticated peer CLI — Codex (`codex`),
  Command Code (`cmd`) or DeepSeek Harness (`dsh`). Delegate a task to the peer as a general-purpose
  subagent: it writes and changes code, researches a codebase, investigates a
  bug, or runs commands (including over the network), while the host briefs
  it, checks its work, sends feedback in the same session and reports back.
  Trigger only when the user explicitly asks to hand work to the peer ("让 codex
  去做", "交给 command code", "让 codex 去排查", "delegate this to codex"). Not for "和 codex 一起完成这个任务"
  — that is with-peer, where the host implements and the peer reviews. For a
  review, a second opinion, or advice on how to fix something ("让 codex 看看怎么修"),
  use peer-second-opinion. Never delegate to the CLI you are running inside.
---

# Delegate to Peer

Use the peer like a general-purpose subagent: it does the work — code
changes, research, investigation, measurements — and the host stays the lead.
It writes the brief, checks the result, sends feedback and reports to the
user. Nothing the peer reports counts as done until the host has checked it.

**Do not ask the peer to review its own work** — not in the same session,
not in a fresh one. The host's own checks (step 4) are the verification. If
the user also wants an independent review, run peer-second-opinion's review
mode with a different model from the one that did the work.

The command is the `task` mode of
[peer-second-opinion](../peer-second-opinion/SKILL.md)'s `peer.mjs` (in that
skill's directory, not this one). Read its SKILL.md first: provider choice,
running, output and exit codes all apply here. **Never hand-roll the CLI;
use `peer.mjs`.**

```
peer.mjs <provider> task [--repo DIR] [OPTIONS] [--] TASK
peer.mjs <provider> task [--repo DIR] --resume ID [OPTIONS] [--] FEEDBACK
```

TASK is one argument; put it after `--`. The default timeout is 7200 s.

## Workflow

1. **Brief.** Write the task to stand alone; a fresh run has none of this
   conversation. Say what to achieve, which files, machines or areas matter,
   the constraints, what "done" looks like (for example, which tests must
   pass), and what to report back. A long brief goes in a file outside the
   repository, with the TASK pointing at its absolute path. Tell it not to
   commit or push unless the user asked for that.
2. **Choose where it works.** `--repo` (default: the current directory) is its
   working directory. When the work should be isolated — the user has other
   changes in progress, or several tasks run in parallel — give it a worktree:
   create one yourself (`git worktree add -b <branch> <path>`) and pass it as
   `--repo`, or, with Command Code, pass `--worktree` and let the CLI create it.
   Without a worktree, note `HEAD` and `git status` first. Follow the user's
   preference when they state one.
3. **Run** it as the parent's § Running it from your harness says —
   `peer.mjs` itself as the host's background task, never detached or
   polled. For a task likely to need more than two hours (or, with Command
   Code, 200 turns), raise `--timeout` or `--max-turns` up front. On exit
   `0`, read the file named by the last `result:` line; `workdir:` says
   where the work happened.
4. **Check.** For code, read the diff against that starting point (or the
   worktree's base) and run the relevant tests or checks yourself. For
   research, investigation or measurements, verify the claims that carry
   the conclusion. A report that it ran something is not proof: the `log:`
   file holds what each command actually returned. Relay every unprefixed
   `warning:` line.
5. **If the check fails or the run is cut short** (exit `4`/`5`, turn cap),
   feed back in the same session — the last `resume:` line plus
   `-- "concrete feedback"`, naming what is wrong and what to do — then
   repeat steps 3–4.
   - **Cut short:** the work so far is on disk. Have it check the current
     state first — a step may be half done, and a killed local `ssh` does
     not prove the remote command stopped.
   - **No usable `resume:`:** nothing is rolled back. Inspect the working
     directory for partial edits, then start a fresh task whose brief says
     what is done, where it failed and what to check. If the line says to
     resume from inside a worktree, do that instead (see
     [command-code.md § Worktree tasks](../peer-second-opinion/references/providers/command-code.md#worktree-tasks)).
   - **Not transient** (usage limit, content refusal): do not resume or
     rerun; report it to the user.
   - **Stop** when the check still fails after three follow-up runs
     (feedback, resume or restart), and tell the user what is left.
6. **Report.** Say what was done, where (`workdir`), what you checked and
   how, and anything still open. If a worktree was used, report its path and
   branch, and leave merging and removing it to the user unless they asked.

The host may fix small things itself rather than round-tripping through
feedback; say so in the report.

## Permissions

**A task runs with full access**: the peer can edit files, use the network
and run any command with the user's own permissions, not only inside
`workdir`. It keeps the user's normal CLI setup — hooks, plugins, memories,
skills, MCP servers — and the repository's `AGENTS.md`, all of which can steer
it. Delegate only in repositories the user trusts. Delegation grants no new
authority: keep actions with effects outside the machine — pushing,
publishing, deploying, messaging — out of the brief unless the user asked for
them. Two tasks running at once in the same directory will collide; give each
its own worktree.
