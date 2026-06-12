---
name: codex-model-routing
description: Codex ONLY - use when delegating to Codex subagents and a model override may be useful. This skill helps choose whether to omit `model` and inherit the parent model, or explicitly set `gpt-5.3-codex-spark`, `gpt-5.4-mini`, `gpt-5.4`, or `gpt-5.5` for a spawned subagent. Scope is subagents only: never use it to change, judge, or comment on the main-loop model.
---

# Codex Model Routing

Use this skill only after subagent delegation is already allowed by the
user or by the active workflow. It does not authorize spawning agents.
It only decides whether a `spawn_agent` call should set `model`,
`reasoning_effort`, or omit overrides and inherit the parent defaults.

Default posture: omit `model`. Codex subagents inherit the parent model
by default, and that is usually the right choice. Override only when the
subtask has a clear task-specific reason to be cheaper, faster, or
stronger than the parent default.

## Routing Table

| Setting | Use for | Signatures |
|---------|---------|------------|
| omit `model` | Normal Codex delegation | The task fits the current run, the user did not ask for a specific model, or the agent type already has a tuned default |
| `gpt-5.3-codex-spark` | Ultra-fast coding support | Mechanical search, inventory, straightforward file edits, narrow formatting sweeps, simple deterministic checks |
| `gpt-5.4-mini` | Cheap bounded coding | Small implementations, test additions for known behavior, narrow refactors, simple docs updates with modest judgment |
| `gpt-5.4` | Strong standard engineering | Routine feature work, bug fixes with a plausible root cause, single-dimension reviews, integration support across a few files |
| `gpt-5.5` | Hard or high-stakes judgment | Unknown-root-cause debugging, architecture tradeoffs, ambiguous planning, security-sensitive review, final synthesis across many agents |

Resolution order, before the table:

- An explicit user model choice wins.
- If there is no clear reason to override, omit `model`.
- If the subtask fits multiple rows, either split it or choose the
  strongest row that matches the risky part.
- If the chosen agent type has its own tuned default, omit `model`
  unless the task clearly needs a different tier.

## Reasoning Effort

Omit `reasoning_effort` unless the prompt has a clear reason:

- Use `low` for simple deterministic tasks where speed matters.
- Use `medium` for normal bounded coding.
- Use `high` for debugging, nontrivial review, or integration judgment.
- Use `xhigh` only for rare final synthesis or high-risk analysis where
  the user benefits more from depth than latency.

Do not use effort as a substitute for a well-scoped prompt. First make
the subtask concrete, bounded, and independently checkable.

## Rules

1. **Delegation gate.** This skill never grants permission to spawn.
   Use it only after the user explicitly asked for subagents,
   delegation, or parallel agent work, or after another active workflow
   has authorized delegation.
2. **Default inheritance.** Omit `model` for ordinary worker and
   explorer tasks. Set `model` only when there is a concrete
   task-specific reason.
3. **Cheap models need tight prompts.** Use `spark` or `mini` only when
   the file scope, expected output, and verification are explicit. If
   the prompt is vague, tighten it before escalating the model.
4. **Verification floor.** A subagent that judges, refutes, or gates
   another agent's result should run at least as strong as the agent
   that produced that result, and stronger when its verdict is final.
5. **Escalate once.** If a cheaper agent returns an uncertain or weak
   result, rerun that subtask one tier up. If the rerun is still weak,
   stop delegating and surface the uncertainty.
6. **Split mixed tasks.** If one subtask has mechanical and
   judgment-heavy parts, split it into separate agents instead of
   sending the whole task to the highest tier.

## Pairing With Parallel Execution

Use `parallel-agent-execution` to decide whether parallel work is worth
it, which execution mode is safe, and what ownership boundaries apply.
Use this skill only after that to choose the model override, if any, for
each delegated Codex subagent.

## When Invoked Directly

If the user invokes this skill by name, list the subtasks you are about
to delegate, the model setting for each (`omit` is a valid setting), any
reasoning effort override, and a one-line reason. Proceed with
delegation only if the user asked for the work itself; if they asked
only for the routing plan, stop there.
