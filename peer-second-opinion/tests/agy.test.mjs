// What providers/agy.mjs adds: the argv per mode, the prompt in --print=,
// the review prompt (scope as prose plus the report contract), the pinned
// model pair, and how agy's stream-json events and failures are read.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { createFixture, marker, NOTE, OTHER_SESSION, SESSION } from './helpers.mjs'

let f
before(() => { f = createFixture() })
after(() => f.cleanup())

const agy = (args, options = {}) => f.run(args, { ...options, provider: 'agy' })
const joined = (argv) => argv.join(' ')

test('review is a prompt: scope as prose, the report contract and the note', () => {
  const result = f.dirty(() => agy(['review']))
  assert.equal(result.status, 0, result.stderr)
  const { argv, prompt } = result.calls[0]
  assert.match(joined(argv), /^--output-format stream-json --dangerously-skip-permissions --disable-slash-commands --model gemini-4-hydrogen --effort high --print=/)
  assert.equal(argv.filter((arg) => arg.startsWith('--print=')).length, 1)
  assert.ok(!argv.includes('--'), 'the prompt never follows --')
  assert.match(prompt, /^Review the uncommitted changes in this repository/)
  assert.match(prompt, /- \[P1\] <title> — <path>:<line-range>[^]*never invent a finding/)
  assert.match(prompt, NOTE)
  assert.match(result.stderr, /^running: .* --print=<prompt: \d+ chars>$/m)
  assert.equal(marker(result.stderr, 'resume').length, 0, 'review advertises no follow-up')

  const custom = agy(['review', '--custom', 'Check only the guard'])
  assert.match(custom.calls[0].prompt, /^Check only the guard\n\n[^]*\[P0\] most severe/)
  const withContext = f.dirty(() => agy(['review', '--base', 'HEAD', '--context', 'behaviour must be unchanged']))
  assert.match(withContext.calls[0].prompt, /merge base [0-9a-f]{40} to the working tree[^]*CALLER-BACKGROUND[^]*behaviour must be unchanged/)
})

test('consult carries the note; a follow-up continues the conversation with the pinned pair', () => {
  const fresh = agy(['consult', '--', '-starts with a dash?'])
  assert.equal(fresh.status, 0, fresh.stderr)
  assert.match(fresh.calls[0].prompt, /^-starts with a dash\?\n\n---\n/)
  assert.match(fresh.calls[0].prompt, NOTE)
  assert.ok(!fresh.calls[0].argv.includes('--conversation'))
  assert.match(marker(fresh.stderr, 'resume')[0], new RegExp(` agy consult --resume ${SESSION} --model gemini-4-hydrogen --effort high `))
  assert.deepEqual(marker(fresh.stderr, 'model'), ['gemini-4-hydrogen'])
  assert.match(fresh.stdout, /^the fake result body\n$/)
  // streamed answer deltas stay in the log, out of the progress stream
  assert.doesNotMatch(fresh.stderr, /streamed answer text/)

  const follow = agy(['consult', '--resume', SESSION, '--', 'follow-up'])
  assert.equal(follow.status, 0, follow.stderr)
  assert.ok(joined(follow.calls[0].argv).includes(`--conversation ${SESSION}`))
  assert.match(follow.calls[0].prompt, NOTE)

  // agy starts a new conversation for an id it does not know
  const lost = agy(['consult', '--resume', OTHER_SESSION, '--', 'follow-up'])
  assert.equal(lost.status, 4)
  assert.match(lost.stderr, /did not resume session/)
})

test('a task gets the prompt verbatim', () => {
  const task = agy(['task', '--', 'Do the work'])
  assert.equal(task.status, 0, task.stderr)
  assert.equal(task.calls[0].prompt, 'Do the work')
  assert.ok(joined(task.calls[0].argv).includes('--dangerously-skip-permissions'))
  const follow = agy(['task', '--resume', SESSION, '--', 'feedback'])
  assert.ok(joined(follow.calls[0].argv).includes(`--conversation ${SESSION}`))
  assert.equal(follow.calls[0].prompt, 'feedback')
})

test('the model and effort travel as a pair, from flags or both env variables', () => {
  const lone = agy(['consult', '--model', 'gemini-4-argon', 'q'])
  assert.equal(lone.status, 3)
  assert.match(lone.stderr, /^hint: omit both to run the pinned default, gemini-4-hydrogen at effort high, or pass both\.$/m)
  const loneEnv = agy(['consult', '--effort', 'low', 'q'], { env: { PEER_AGY_MODEL: 'm', PEER_AGY_EFFORT: 'low' } })
  assert.equal(loneEnv.status, 3)
  assert.match(loneEnv.stderr, /^hint: omit both to run m at effort low \(from PEER_AGY_MODEL and PEER_AGY_EFFORT\)/m)
  const pair = agy(['consult', '--model', 'gemini-4-argon', '--effort', 'medium', 'q'])
  assert.ok(joined(pair.calls[0].argv).includes('--model gemini-4-argon --effort medium'))
  const env = agy(['consult', 'q'], { env: { PEER_AGY_MODEL: 'm', PEER_AGY_EFFORT: 'low' } })
  assert.ok(joined(env.calls[0].argv).includes('--model m --effort low'))
  const half = agy(['consult', 'q'], { env: { PEER_AGY_EFFORT: 'low' } })
  assert.equal(half.status, 3)
  assert.match(half.stderr, /must be set together/)
})

test('only a complete SUCCESS result is an answer', () => {
  const rejected = 'invalid model selection (--model "gemini-4-hydrogen" --effort "max"): gemini-4-hydrogen has no "max" effort (available: low, medium, high, xhigh)'
  for (const [args, env, expected, absent] of [
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_NO_SESSION: '1', FAKE_RESULT_STATUS: 'ERROR', FAKE_RESULT_ERROR: rejected }, /^error: invalid model selection[^]*^hint: agy rejected the model selection[^]*pinned default in providers\/agy\.mjs/m],
    [['consult', '--model', 'x', '--effort', 'high', 'q'], { FAKE_EXIT: '1', FAKE_RESULT_STATUS: 'ERROR', FAKE_RESULT_ERROR: rejected }, /rerun with a supported --model M --effort L pair/, /pinned default/],
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_RESULT_STATUS: 'ERROR', FAKE_RESULT_ERROR: 'backend unavailable' }, /^error: backend unavailable$[^]*error: the consult failed/m, /hint: agy rejected/],
    [['consult', 'q'], { FAKE_FINISHED_REASON: 'interrupted' }, /^error: agy ended the turn early: interrupted$[^]*error: agy produced no result/m],
    [['consult', 'q'], { FAKE_NO_RESULT: '1' }, /error: agy produced no result/],
    [['consult', 'q'], { FAKE_RESULT_STATUS: 'ERROR' }, /error: agy produced no result/],
  ]) {
    const result = agy(args, { env })
    assert.equal(result.status, 4, result.stderr)
    assert.match(result.stderr, expected)
    if (absent) assert.doesNotMatch(result.stderr, absent)
    assert.equal(result.calls.length, 1, 'no fallback or retry')
  }
})

test('the session comes from the events, and a non-UUID one is not advertised', () => {
  const bogus = agy(['consult', 'q'], { env: { FAKE_SESSION_ID: 'not-a-uuid' } })
  assert.equal(bogus.status, 0, bogus.stderr)
  assert.match(bogus.stderr, /^resume: unavailable/m)
  const timedOut = agy(['task', '--timeout', '1', '--', 'work'], { env: { FAKE_SLEEP: '30' } })
  assert.equal(timedOut.status, 5)
  assert.match(marker(timedOut.stderr, 'resume')[0], new RegExp(` agy task --resume ${SESSION} `))
})
