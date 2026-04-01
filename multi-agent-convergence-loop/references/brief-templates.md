# Brief Templates

Use these templates when you want the loop to be more repeatable and less prompt-by-prompt improvised.

## Scope brief

```text
Request: <what the user wants changed>

Constraints:
- <repo, environment, deadline, or policy constraint>

Acceptance target:
- <what must be true to finish>

Artifact type:
- <code | docs | prompt | config | mixed>

Target scope:
- Files/modules/diff: <explicit scope>

Verification plan:
1. <test, command, render check, sample scenario, or manual check>
2. <test, command, render check, sample scenario, or manual check>

Capabilities:
- Delegation: <parallel delegates | serialized fallback>
- Edit mode: <direct edits | patch proposals | mixed>
- Review isolation: <separate threads/prompts available or not>

Topology:
- Mode: <implementation-first | audit-first>
- Coding owners: <owner -> boundary>
- Review coverage: <whole diff, subsystem, integration, artifact usability, etc.>
```

## Coding brief

```text
Task: <feature, fix, or issue-group summary>

Ownership:
- Files/modules: <explicit boundary>
- Integration surfaces not to break: <interfaces, callers, configs, docs, etc.>

Change mode:
- <edit directly | propose patch for main agent to apply>

Requirements:
1. <required behavior>
2. <required behavior>

Verification:
1. <test or command>
2. <manual or artifact check if needed>
3. If a planned automated check is infeasible, replace it with one explicit manual check per changed area and note the residual risk.

Context packet:
- Relevant files/diff: <paths or diff>
- Invariants/interfaces: <what must stay true>
- Helpful commands: <build/test/lint/render commands>
- Out of scope: <areas this owner should not change>

Constraints:
- Other agents may be active; do not revert unrelated edits.
- Preserve existing patterns unless the task requires a deliberate change.
- Report changed files, verification results, and remaining risks.

Output:
- Changed files or patch ids: <list>
- Verification: <ran | skipped | blocked> with result
- Residual risks: <brief note>
```

## Review brief

```text
Review the target scope independently.

Focus on:
1. Bugs, regressions, or prompt/config failures.
2. Missing verification or unsafe assumptions.
3. Integration or operator-usage risks.

Optional lens:
- <correctness | integration | verification | usability>

Output rules:
1. Findings first, ordered by severity.
2. Include file/line references where possible.
3. Ignore style-only comments.
4. Do not defer to what other reviewers might think.
5. Say explicitly if no meaningful findings were found.
6. For each finding, include one evidence anchor and one confirming check the main agent can run.
```

## Accepted issue-group summary

```text
Accepted issue groups:
1. <issue> - owner: <agent or module>
   Severity: <blocking | major>
   Evidence: <concrete anchor plus shared review overlap, severe singleton, or main-agent confirmation>
   Verification: <tests/checks to rerun>
2. <issue> - owner: <agent or module>
   Severity: <blocking | major>
   Evidence: <concrete anchor plus shared review overlap, severe singleton, or main-agent confirmation>
   Verification: <tests/checks to rerun>

Non-blocking notes:
- <note>
- <note>

Convergence action if needed:
- <tighten brief | rotate owner | serialize boundary | no extra loop needed>
```

Severity semantics:
- `blocking`: must be fixed, disproven, or downgraded before completion.
- `major`: send into the next fix loop unless the main agent explicitly downgrades it with rationale.
- `minor`: keep as a non-blocking note rather than an accepted issue group unless it is nearly free and clearly safe to fold into another fix.
