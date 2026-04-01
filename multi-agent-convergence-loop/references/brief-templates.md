# Brief Templates

Use these templates when you want the loop to be more repeatable and less prompt-by-prompt improvised.

## Scope brief

```text
Request: <what the user wants changed>

Constraints:
- <repo, environment, or deadline constraint>

Acceptance target:
- <what must be true to finish>

Target scope:
- Files/modules/diff: <explicit scope>

Verification plan:
1. <test, command, or manual check>
2. <test, command, or manual check>

Topology:
- Mode: <implementation-first | audit-first>
- Coding owners: <owner -> boundary>
- Review coverage: <whole diff, subsystem, integration, etc.>
```

## Coding brief

```text
Task: <feature, fix, or issue-group summary>

Ownership:
- Files/modules: <explicit boundary>

Requirements:
1. <required behavior>
2. <required behavior>

Verification:
1. <test or command>
2. <manual check if needed>
3. If no reliable automated check exists, use one explicit manual check per changed area and note the residual risk.

Constraints:
- Other agents may be active; do not revert unrelated edits.
- Preserve existing patterns unless the task requires a deliberate change.
- Report changed files, verification results, and remaining risks.
```

## Review brief

```text
Review the target scope independently.

Focus on:
1. Bugs and regressions.
2. Missing tests or unsafe assumptions.
3. Integration risks.

Output rules:
1. Findings first, ordered by severity.
2. Include file/line references where possible.
3. Ignore style-only comments.
4. Do not defer to what other reviewers might think.
```

## Accepted issue-group summary

```text
Accepted issue groups:
1. <issue> - owner: <agent or module>
   Severity: <blocking | major | minor>
   Evidence: <shared review overlap, severe singleton, or local reproduction>
   Verification: <tests/checks to rerun>
2. <issue> - owner: <agent or module>
   Severity: <blocking | major | minor>
   Evidence: <shared review overlap, severe singleton, or local reproduction>
   Verification: <tests/checks to rerun>

Non-blocking notes:
- <note>
- <note>
```
