# Running From Other Hosts

SKILL.md § Running it from your harness covers Claude Code and Command Code.
Read the section for your host.

## Codex, or any host without background tasks

Run it in the foreground with the shell tool's longest timeout. If the tool
returns before the process exits, keep waiting on that same process (its
session or task id) — never start a second run. A model can be silent for
minutes; never kill a run because it looks idle.

## A sandboxed host shell

Codex in `read-only` or `workspace-write`: run the command outside the sandbox
through the host's own escalation mechanism. Inside it, the run typically fails
— exit `3` (scratch files cannot be written) or exit `4` with a network or
`EPERM` error in the log tail — because of the host's sandbox, not the peer. If
the host forbids escalation, report that the peer cannot run here and stop; do
not retry or work around it.
