// What providers/command-code.mjs adds: the argv per mode, the wrapper-built
// review prompt, the turn cap, worktree tasks, and how cmd's frames and exit
// codes are read. Shared wrapper behaviour is in wrapper.test.mjs.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createFixture, marker, NOTE, SESSION } from './helpers.mjs'

const P = 'command-code'
let f
before(() => { f = createFixture() })
after(() => f.cleanup())

test('every mode runs with --yolo and no other permission flag; skills only in a task', () => {
  for (const args of [['review'], ['consult', 'q'], ['task', 'do it']]) {
    const result = f.dirty(() => f.run(P, args))
    assert.equal(result.status, 0, result.stderr)
    const line = result.calls[0].argv.join(' ')
    assert.ok(line.startsWith('-p --yolo --output-format json --skip-onboarding'), line)
    for (const flag of ['--dangerously-skip-permissions', '--accept-edits', '--permission-mode', '--plan']) {
      assert.ok(!line.includes(flag), `${flag} in ${line}`)
    }
    assert.equal(line.includes('--no-skills'), args[0] !== 'task', line)
    assert.match(line, / --max-turns 200( |$)/)
    assert.ok(!line.includes('--model') && !line.includes('--effort'), 'the configured model runs unless one is asked for')
  }
})

test('the review prompt carries scope, status, untracked list, diff, report contract and note', () => {
  writeFileSync(join(f.repo, 'fresh.txt'), 'new\n')
  let result
  try {
    result = f.dirty(() => f.run(P, ['review']))
  } finally {
    rmSync(join(f.repo, 'fresh.txt'))
  }
  const { prompt } = result.calls[0]
  for (const pattern of [/^Review the uncommitted changes/, /git status --porcelain/, /Untracked files[^]*fresh\.txt/,
    /-committed\n\+changed/, /\[P0\] most severe/, NOTE]) {
    assert.match(prompt, pattern)
  }
  const consult = f.run(P, ['consult', '--', 'a question'])
  assert.match(consult.calls[0].prompt, /^a question\n\n---\n/)
  assert.match(consult.calls[0].prompt, NOTE)
  assert.equal(f.run(P, ['task', '--', 'implement it']).calls[0].prompt, 'implement it')
})

test('model and effort are independent; the model that answered is pinned on resume', () => {
  const effort = f.run(P, ['consult', '--effort', 'high', 'q'])
  assert.ok(effort.calls[0].argv.join(' ').endsWith('--effort high'))
  const resume = marker(effort.stderr, 'resume')[0]
  assert.match(resume, / --model fake\/model-1 /)
  assert.doesNotMatch(resume, /--effort/)
  const pinned = f.run(P, ['consult', '--model', 'fake/model-9', 'q'], { env: { FAKE_MODEL: 'fake/model-9' } })
  assert.ok(pinned.calls[0].argv.join(' ').endsWith('--model fake/model-9'))
  const follow = f.run(P, ['consult', '--resume', SESSION, '--', 'more'])
  assert.ok(follow.calls[0].argv.join(' ').startsWith(`-p --resume ${SESSION} `))
  assert.ok(!follow.calls[0].argv.includes('--model'), 'an unpinned resume invents no model')
})

test('an explicit turn cap is passed and travels in the resume line', () => {
  const capped = f.run(P, ['task', '--max-turns', '50', '--', 'x'])
  assert.match(capped.calls[0].argv.join(' '), / --max-turns 50( |$)/)
  assert.match(marker(capped.stderr, 'resume')[0], / --max-turns 50 /)
  assert.doesNotMatch(marker(f.run(P, ['consult', 'x']).stderr, 'resume')[0], /--max-turns/)
  assert.equal(f.run(P, ['review', '--max-turns', 'x']).status, 3)
})

test('a turn-capped or partly refused run is flagged, not passed off as complete', () => {
  for (const env of [{ FAKE_EXIT: '8' }, { FAKE_SUBTYPE: 'max_turns' }]) {
    const result = f.dirty(() => f.run(P, ['review'], { env }))
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /^warning: the run hit its turn cap/m)
    assert.match(result.stdout, /the fake result body/)
  }
  const refused = f.run(P, ['task', 'do it'], { env: { FAKE_BLOCKED: '1' } })
  assert.match(refused.stderr, /^warning: the permission engine refused 1 tool call/m)
})

test('a worktree task resumes where the CLI says it ran, never at a guess', () => {
  assert.equal(f.run(P, ['consult', '--worktree', 'q']).status, 3)
  assert.equal(f.run(P, ['task', '--worktree', '--resume', SESSION, 'more']).status, 3)
  const wt = join(f.root, 'some-worktree')
  const reported = f.run(P, ['task', '--worktree', 'do it'], { env: { FAKE_WORKDIR: wt } })
  assert.ok(reported.calls[0].argv.includes('--worktree'))
  assert.deepEqual(marker(reported.stderr, 'workdir'), [wt])
  assert.match(marker(reported.stderr, 'resume')[0], new RegExp(`--repo ${wt}$`))
  const unreported = f.run(P, ['task', '--worktree', 'do it'])
  assert.match(unreported.stderr, /^warning: the worktree path was not reported/m)
  assert.match(unreported.stderr, /^workdir: unavailable/m)
  assert.match(unreported.stderr, /^resume: unavailable/m)
  assert.deepEqual(marker(unreported.stderr, 'session'), [SESSION])
  const timedOut = f.run(P, ['task', '--worktree', '--timeout', '1', '--', 'x'], { env: { FAKE_SLEEP: '30' } })
  assert.equal(timedOut.status, 5)
  assert.match(timedOut.stderr, /^resume: unavailable — the session lives in the unreported worktree/m)
})

test('cmd exit codes become wrapper exit 4 with the documented remedy', () => {
  for (const [code, hint] of [['3', /run `cmd login`/], ['5', /rate limited/], ['6', /transport or upstream failure/], ['10', /insufficient credits/]]) {
    const result = f.run(P, ['consult', 'q'], { env: { FAKE_EXIT: code, FAKE_SUBTYPE: 'error' } })
    assert.equal(result.status, 4, result.stderr)
    assert.match(result.stderr, new RegExp(`^provider-exit: ${code}$`, 'm'))
    assert.match(result.stderr, hint)
  }
  const reason = 'Unknown effort "medium". Supported: low, high, max.'
  const rejected = f.run(P, ['consult', 'q'], { env: { FAKE_EXIT: '1', FAKE_NO_RESULT: '1', FAKE_STDERR_TEXT: reason } })
  assert.ok(rejected.stderr.split('\n').includes(`error: cmd: ${reason}`), rejected.stderr)
  const chatter = f.run(P, ['consult', 'q'], { env: { FAKE_STDERR_TEXT: 'Reasoning effort set to high.' } })
  assert.equal(chatter.status, 0)
  assert.doesNotMatch(chatter.stderr, /^error: cmd: /m)
  const gone = f.run(P, ['consult', '--resume', SESSION, 'q'], {
    env: { FAKE_EXIT: '1', FAKE_SUBTYPE: 'error', FAKE_ERROR_TEXT: `Error: No session "${SESSION}" found to resume.` },
  })
  assert.match(gone.stderr, /no longer exists; start a fresh consultation/)
})

test('tool calls are summarised and usage is reported; raw frames stay in the log', () => {
  const result = f.run(P, ['consult', 'q'])
  assert.match(result.stderr, /^cmd> tool: shell_command git log --oneline -1$/m)
  assert.ok(!/^cmd> \{/m.test(result.stderr))
  assert.match(result.stderr, /^model: fake\/model-1$/m)
  assert.match(result.stderr, /^usage: input=11 output=3 cacheRead=1 durationMs=7$/m)
})
