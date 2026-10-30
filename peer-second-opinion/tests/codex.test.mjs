// What providers/codex.mjs adds: the argv per mode, the scope as prose, the
// pinned model pair, and how codex's events and failures are read. Shared
// wrapper behaviour is in wrapper.test.mjs; capacity retries in retry.test.mjs.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createFixture, marker, NOTE, OTHER_SESSION, SESSION } from './helpers.mjs'

const P = 'codex'
let f
before(() => { f = createFixture() })
after(() => f.cleanup())

const has = (argv, ...pairs) => pairs.every((pair) => argv.join(' ').includes(pair))

test('review runs with full access, the second-opinion switches, and the scope as prose', () => {
  writeFileSync(join(f.repo, 'untracked.txt'), 'new\n')
  let uncommitted
  try {
    uncommitted = f.run(P, ['review'])
  } finally {
    rmSync(join(f.repo, 'untracked.txt'))
  }
  assert.equal(uncommitted.status, 0, uncommitted.stderr)
  const { argv, prompt } = uncommitted.calls[0]
  assert.deepEqual(argv.slice(0, 2), ['exec', 'review'])
  assert.ok(has(argv,
    'sandbox_mode="danger-full-access"', 'approval_policy="never"',
    '--disable hooks', '--disable apps', '--disable plugins', '--disable memories', 'notify=[]',
    '--ephemeral', '--strict-config', '--json', '-m gpt-6.1-sol', 'model_reasoning_effort="high"'), argv.join(' '))
  // exec review takes a scope flag or a prompt, never both
  for (const flag of ['--uncommitted', '--base', '--commit']) assert.ok(!argv.includes(flag), flag)
  assert.match(prompt, /Review the uncommitted changes in this repository/)
  assert.match(prompt, NOTE)

  for (const [args, pattern] of [
    [['review', '--commit', 'HEAD'], /Review only the changes introduced by root commit [0-9a-f]{40}/],
    [['review', '--custom', 'Check only the guard'], /^Check only the guard\n/],
  ]) {
    const result = f.run(P, args)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.calls[0].prompt, pattern)
    assert.match(result.calls[0].prompt, NOTE)
  }
  const withContext = f.dirty(() => f.run(P, ['review', '--base', 'HEAD', '--context', 'behaviour must be unchanged']))
  assert.match(withContext.calls[0].prompt, /merge base [0-9a-f]{40} to the working tree[^]*CALLER-BACKGROUND[^]*behaviour must be unchanged/)
  // a review leaves no session to resume
  assert.equal(marker(withContext.stderr, 'resume').length, 0)
})

test('consult carries the note on every turn; outside git it skips the repo check', () => {
  const fresh = f.run(P, ['consult', '--', 'What do you think?'])
  assert.equal(fresh.status, 0, fresh.stderr)
  const { argv, prompt } = fresh.calls[0]
  assert.ok(has(argv, 'sandbox_mode="danger-full-access"', '--disable hooks'), argv.join(' '))
  assert.ok(!argv.includes('--ephemeral') && !argv.includes('--skip-git-repo-check'), argv.join(' '))
  assert.match(prompt, /^What do you think\?\n\n---\n/)
  assert.match(prompt, NOTE)
  assert.match(marker(fresh.stderr, 'resume')[0], new RegExp(` codex consult --resume ${SESSION} --model gpt-6.1-sol --effort high `))

  const follow = f.run(P, ['consult', '--resume', SESSION, '--', 'follow-up'])
  assert.equal(follow.status, 0, follow.stderr)
  assert.deepEqual(follow.calls[0].argv.slice(0, 3), ['exec', 'resume', SESSION])
  assert.match(follow.calls[0].prompt, NOTE)

  const plain = f.run(P, ['consult', 'q'], { cwd: f.root })
  assert.ok(plain.calls[0].argv.includes('--skip-git-repo-check'))
})

test('a task runs in the normal codex setup, with no note', () => {
  const task = f.run(P, ['task', '--', 'Do the work'])
  assert.equal(task.status, 0, task.stderr)
  const { argv, prompt } = task.calls[0]
  assert.ok(has(argv, 'sandbox_mode="danger-full-access"', 'approval_policy="never"', '--strict-config'), argv.join(' '))
  for (const absent of ['--disable', 'notify=', '--ephemeral']) assert.ok(!argv.join(' ').includes(absent), absent)
  assert.equal(prompt, 'Do the work')
  const follow = f.run(P, ['task', '--resume', SESSION, '--', 'feedback'])
  assert.deepEqual(follow.calls[0].argv.slice(0, 3), ['exec', 'resume', SESSION])
  assert.equal(follow.calls[0].prompt, 'feedback')
})

test('the model and effort travel as a pair, from flags or both env variables', () => {
  assert.equal(f.run(P, ['consult', '--model', 'gpt-x', 'q']).status, 3)
  const pair = f.run(P, ['consult', '--model', 'gpt-x', '--effort', 'low', 'q'])
  assert.ok(has(pair.calls[0].argv, '-m gpt-x', 'model_reasoning_effort="low"'))
  assert.match(marker(pair.stderr, 'resume')[0], / --model gpt-x --effort low /)
  const env = f.run(P, ['consult', 'q'], { env: { PEER_CODEX_MODEL: 'gpt-y', PEER_CODEX_EFFORT: 'medium' } })
  assert.ok(has(env.calls[0].argv, '-m gpt-y', 'model_reasoning_effort="medium"'))
  const half = f.run(P, ['consult', 'q'], { env: { PEER_CODEX_MODEL: 'gpt-y' } })
  assert.equal(half.status, 3)
  assert.match(half.stderr, /must be set together/)
  assert.equal(f.run(P, ['consult', '--help'], { env: { PEER_CODEX_MODEL: 'gpt-y' } }).status, 0)
})

test('MCP servers are left alone', () => {
  const result = f.run(P, ['consult', 'q'])
  assert.equal(result.calls.length, 1, 'no `codex mcp` listing')
  assert.ok(!result.calls[0].argv.join(' ').includes('mcp_servers'))
})

test('failures get the matching hint, read from CLI output and never from model text', () => {
  const rejected = "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."
  const usage = "You've hit your usage limit. Try again later."
  const flagged = 'This content was flagged for possible cybersecurity risk.'
  const failedTurn = (message) => JSON.stringify({ type: 'turn.failed', error: { message } })
  for (const [args, env, expected, absent] of [
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_STDERR_TEXT: 'Error: Unknown feature flag: memories' }, /rejected a configuration key or feature flag/],
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_STDERR_TEXT: rejected }, /rejected the selected model 'gpt-6\.1-sol'[^]*pinned default in providers\/codex\.mjs/],
    [['consult', '--model', 'gpt-old', '--effort', 'high', 'q'], { FAKE_EXIT: '1', FAKE_STDERR_TEXT: 'The model `gpt-old` does not exist or you do not have access to it.' }, /rerun with a supported --model M --effort L pair/, /pinned default/],
    [['consult', '--resume', SESSION, 'q'], { FAKE_EXIT: '1', FAKE_STDERR_TEXT: rejected }, /do not resume this session under a different model/],
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_STDERR_TEXT: 'HTTP 400: malformed request for model gpt-6.1-sol' }, /error: the consult failed/, /rejected the selected model/],
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_STDERR_TEXT: 'The file `x` does not exist or you do not have access to it.' }, /error: the consult failed/, /rejected the selected model/],
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_EVENT: failedTurn(usage) }, /^error: You've hit your usage limit[^]*^hint: the codex account hit its usage limit; not transient/m],
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_EVENT: failedTurn(flagged) }, /^hint: codex refused the content; not transient/m],
    [['consult', 'q'], { FAKE_EXIT: '1', FAKE_EVENT: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: flagged } }) }, /error: the consult failed/, /hint: codex refused/],
  ]) {
    const result = f.run(P, args, { env })
    assert.equal(result.status, 4, result.stderr)
    assert.match(result.stderr, expected)
    if (absent) assert.doesNotMatch(result.stderr, absent)
    assert.equal(result.calls.length, 1, 'no fallback or retry')
  }
})

test('a failed turn is no answer even when codex exits zero', () => {
  const result = f.run(P, ['consult', 'q'], { env: { FAKE_EVENT: JSON.stringify({ type: 'turn.failed', error: { message: 'stream disconnected' } }) } })
  assert.equal(result.status, 4, result.stderr)
  assert.match(result.stderr, /^error: stream disconnected$/m)
})

test('the session comes from thread.started, and a non-UUID one is not advertised', () => {
  const bogus = f.run(P, ['consult', 'q'], { env: { FAKE_SESSION_ID: 'not-a-uuid' } })
  assert.equal(bogus.status, 0, bogus.stderr)
  assert.match(bogus.stderr, /^resume: unavailable/m)
  const timedOut = f.run(P, ['task', '--resume', SESSION, '--timeout', '1', '--', 'more'], { env: { FAKE_SESSION_ID: OTHER_SESSION, FAKE_SLEEP: '30' } })
  assert.equal(timedOut.status, 5)
  assert.match(timedOut.stderr, /^resume: unavailable/m, 'a timed-out follow-up in another session advertises none')
})
