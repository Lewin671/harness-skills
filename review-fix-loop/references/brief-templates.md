# Brief Templates

Use these templates when you want the loop to stay repeatable instead
of prompt-by-prompt improvised.

## Contents

- [Scope brief](#scope-brief)
- [Coding or fix brief](#coding-or-fix-brief)
- [Review brief](#review-brief)
- [Accepted issue-group summary](#accepted-issue-group-summary)
- [Loop ledger](#loop-ledger)
- [Final status](#final-status)

## Scope brief

```text
Request: <what the user wants changed>

Constraints:
- <repo, environment, deadline, or policy constraint>

Acceptance target:
- <what must be true to finish>

Artifact type:
- <code | docs | prompt | config | skill | mixed>

Target scope:
- Files/modules/diff: <explicit scope>
- Adjacent artifacts reviewed:
  <docs, prompts, configs, generated files, or none>

Slice manifest if needed:
- <slice -> owner -> shared dependencies -> global files>

Verification plan:
1. <test, command, render check, sample scenario, or manual check>
2. <test, command, render check, sample scenario, or manual check>

Capabilities:
- Delegation: <subagents available | unavailable, use another workflow>
- Edit mode: <direct edits | patch proposals | mixed>
- Base state: <branch, ref, diff anchor, or current worktree contract>
- Review isolation: <separate threads/prompts available or not>

Topology:
- Mode: <implementation-first | audit-first | mixed handoff>
- Coding owners: <owner -> boundary>
- Review coverage: <whole diff, subsystem, integration, artifact usability, etc.>
- Review passes: <usually 2 for non-code, 3 for code or mixed>
```

## Coding or fix brief

```text
Task: <feature, fix, or issue-group summary>

Issue ids addressed:
- <IG-001>
- <IG-002>

Ownership:
- Files/modules: <explicit boundary>
- Integration surfaces not to break:
  <interfaces, callers, configs, docs, etc.>

Change mode:
- <edit directly | propose patch for main agent to apply>
- Base state or diff anchor:
  <branch, ref, diff, or worktree contract>

Requirements:
1. <required behavior>
2. <required behavior>

Verification:
1. <test or command>
2. <manual or artifact check if needed>
3. If a planned automated check is infeasible, replace it
   with one explicit manual check per changed area and note
   the residual risk.

Context packet:
- Relevant files/diff: <paths or diff>
- Invariants/interfaces: <what must stay true>
- Helpful commands: <build/test/lint/render commands>
- Adjacent artifacts to update or leave unchanged:
  <docs, prompts, configs, generated files>
- Out of scope: <areas this owner should not change>

Constraints:
- Other agents may be active; do not revert unrelated edits.
- Preserve existing patterns unless the task requires a deliberate change.
- Report changed files, verification results, and remaining risks.

Output:
- Changed files or patch ids: <list>
- Issue ids closed or updated: <list>
- Base state used: <branch, ref, diff anchor, or worktree contract>
- Verification: <ran | skipped | blocked> with result
- Residual risks: <brief note>
```

## Review brief

```text
Review the target scope independently.

Target scope:
- <files, modules, or diff>

Artifact type:
- <code | docs | prompt | config | skill | mixed>

Review mode:
- <independent delegated review>

Do not use prior reviewer conclusions or accepted issue summaries as
evidence unless the task is explicitly to validate one named issue.

Focus on:
1. Bugs, regressions, instruction conflicts, or prompt/config failures.
2. Missing verification or unsafe assumptions.
3. Integration, operator-usage, or AI-execution risks.

Optional lens:
- <correctness | integration | verification | usability | trigger quality>

Output rules:
1. Findings first, ordered by severity.
2. Include file/line references where possible.
3. Ignore style-only comments.
4. Do not defer to what other reviewers might think.
5. Say explicitly if no meaningful findings were found.
6. For each finding, include one evidence anchor and one
   confirming check the main agent can run.
7. Use this finding shape:
   - Severity: <blocking | major | minor>
   - Title: <short defect summary>
   - Evidence: <concrete anchor>
   - Confirming check: <command, scenario, or manual check>
```

## Accepted issue-group summary

```text
Loop: <number>

Accepted issue groups:
1. <issue> - id: <IG-001> - owner: <agent or module>
   Disposition: <open | fixed | disproved | downgraded>
   Severity: <blocking | major>
   Evidence: <concrete anchor plus shared review overlap,
   severe singleton, or main-agent confirmation>
   Secondary boundaries: <optional>
   Closure evidence: <required when not open>
   Verification: <tests/checks to rerun>
2. <issue> - id: <IG-002> - owner: <agent or module>
   Disposition: <open | fixed | disproved | downgraded>
   Severity: <blocking | major>
   Evidence: <concrete anchor plus shared review overlap,
   severe singleton, or main-agent confirmation>
   Secondary boundaries: <optional>
   Closure evidence: <required when not open>
   Verification: <tests/checks to rerun>

Non-blocking notes:
- <note>
- <note>

Convergence action if needed:
- <tighten brief | rotate owner | stop and change workflow | no extra loop needed>

Review confidence:
- <independent delegated review>

Stop decision:
- <another loop required | ready to close | blocked pending decision>
```

## Loop ledger

```text
Loop ledger: <number>

Work completed:
- <what changed this loop>

Issue status:
- <IG-001> - <open | fixed | disproved | downgraded> - <one-line reason>
- <IG-002> - <open | fixed | disproved | downgraded> - <one-line reason>

Verification rerun:
1. <command or manual check> - <pass | fail | infeasible>
2. <command or manual check> - <pass | fail | infeasible>

Review result:
- <no new meaningful findings | new issue ids created | follow-up needed>

Next action:
- <another fix loop | close | blocked pending decision>
```

## Final status

```text
Request satisfied:
- <yes | no | partially>

Verification:
1. <command or manual check> - <pass | fail | infeasible>
2. <command or manual check> - <pass | fail | infeasible>

Accepted issue ids:
- <IG-001> - <fixed | disproved | downgraded> - <closure evidence>
- <IG-002> - <fixed | disproved | downgraded> - <closure evidence>

Review confidence:
- <independent delegated review>

Residual risks:
- <risk or none>

Close decision:
- <ready to close | blocked | needs user decision>
```

Severity semantics:

- `blocking`: must be fixed, disproven, or downgraded before completion.
- `major`: send into the next fix loop unless the main
  agent explicitly downgrades it with rationale.
- `minor`: keep as a non-blocking note rather than an
  accepted issue group unless it is nearly free and clearly
  safe to fold into another fix.
