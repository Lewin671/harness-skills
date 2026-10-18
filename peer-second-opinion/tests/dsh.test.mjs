// Smoke tests for `peer.mjs dsh`, run with `node --test`. A fake dsh binary
// stands in for the real CLI and emits the headless --json event shapes
// recorded from dsh 0.2.1-rc.2; FAKE_* variables steer it, and it records its
// argv, stdin, sandbox mode and the overlay it was handed.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'peer.mjs')

const FAKE_DSH = `#!/usr/bin/env node
const fs = require('node:fs')
const argv = process.argv.slice(2)
const record = { argv, mode: process.env.DSH_PERMISSION_MODE || '' }
const patch = argv[argv.indexOf('--patch') + 1]
record.patch = patch && fs.existsSync(patch) ? fs.readFileSync(patch, 'utf8') : ''
record.prompt = fs.readFileSync(0, 'utf8')
fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify(record) + '\\n')
const out = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
if (process.env.FAKE_STDERR_TEXT) {
  process.stderr.write('dsh: ' + process.env.FAKE_STDERR_TEXT + '\\n')
  process.exitCode = 1
  return
}
const asked = argv.includes('--session-id') ? argv[argv.indexOf('--session-id') + 1] : ''
const session = process.env.FAKE_SESSION || asked || 'session-11111111-2222-3333-4444-555555555555'
out({ type: 'session', sessionId: session, cwd: process.cwd() })
out({ type: 'status', phase: 'turn_start', turn: 1 })
out({ type: 'tool_call', callId: 'c1', tool: 'bash', input: { command: 'git log --oneline -1' } })
out({ type: 'tool_result', callId: 'c1', status: 'completed', result: 'abc init' })
out({ type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 5 } })
out({ type: 'text', text: 'model text' })
out({ type: 'status', phase: 'step_end', turn: 1, step: 2, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 } })
const error = process.env.FAKE_ERROR ? JSON.parse(process.env.FAKE_ERROR) : null
out({ type: 'status', phase: 'turn_end', turn: 1, reason: error ? { kind: 'error', error } : { kind: process.env.FAKE_REASON || 'completed' } })
out({ type: 'final', text: process.env.FAKE_FINAL ?? (error ? '' : 'the fake answer') })
process.exitCode = Number(process.env.FAKE_EXIT ?? (error ? 1 : 0))
`

let root
let repo
let dshBin

function sh(command, options = {}) {
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, `setup command failed: ${command}\n${result.stderr}`)
  return result
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'peer-dsh-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  sh('git init -q', { cwd: repo })
  writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  sh('git add tracked.txt && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: repo })
  dshBin = join(root, 'bin', 'dsh')
  mkdirSync(dirname(dshBin))
  writeFileSync(dshBin, FAKE_DSH)
  chmodSync(dshBin, 0o755)
  mkdirSync(join(root, 'home'))
})

after(() => {
  rmSync(root, { recursive: true, force: true })
})

function env(extra = {}) {
  return { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: root, DSH_BIN: dshBin, ...extra }
}

function run(args, extra = {}) {
  const recordFile = join(mkdtempSync(join(root, 'rec-')), 'record.jsonl')
  const result = spawnSync(process.execPath, [SCRIPT, 'dsh', ...args], {
    cwd: repo, encoding: 'utf8', timeout: 60000, env: env({ FAKE_RECORD: recordFile, ...extra }),
  })
  result.records = existsSync(recordFile)
    ? readFileSync(recordFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  return result
}

test('the default is deepseek-flash at high effort, passed as an overlay on the headless profile', () => {
  const result = run(['consult', '--', 'q'])
  assert.equal(result.status, 0, result.stderr)
  const [record] = result.records
  assert.deepEqual(record.argv.slice(0, 2), ['headless', '--patch'])
  assert.ok(record.argv.includes('--json'))
  assert.equal(record.argv.at(-1), '-', 'the prompt travels on stdin')
  assert.match(record.patch, /id: agent-default-model/)
  assert.match(record.patch, /provider: "deepseek-official"/)
  assert.match(record.patch, /model: "deepseek-flash"/)
  assert.match(record.patch, /reasoningEffort: "high"/)
  assert.match(result.stderr, /^model: deepseek-flash$/m)
})

test('--model and --effort replace the defaults independently', () => {
  const result = run(['consult', '--model', 'deepseek-v4-pro', '--', 'q'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.records[0].patch, /model: "deepseek-v4-pro"/)
  assert.match(result.records[0].patch, /reasoningEffort: "high"/)
  const effort = run(['consult', '--effort', 'max', '--', 'q'])
  assert.match(effort.records[0].patch, /model: "deepseek-flash"/)
  assert.match(effort.records[0].patch, /reasoningEffort: "max"/)
})

test('review and consult run in the read-only sandbox with the note; a task gets full access', () => {
  writeFileSync(join(repo, 'tracked.txt'), 'changed\n')
  try {
    const review = run(['review'])
    assert.equal(review.status, 0, review.stderr)
    assert.equal(review.records[0].mode, 'read-only')
    assert.match(review.records[0].prompt, /read-only sandbox/)
    assert.match(review.records[0].prompt, /Authoritative diff for this review/)
    assert.match(review.records[0].prompt, /-committed\n\+changed/)
  } finally {
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
  const consult = run(['consult', '--', 'q'])
  assert.equal(consult.records[0].mode, 'read-only')
  assert.match(consult.records[0].prompt, /^q\n\n---\nThis is a read-only second opinion/)
  const task = run(['task', '--', 'do it'])
  assert.equal(task.status, 0, task.stderr)
  assert.equal(task.records[0].mode, 'danger-full-access')
  assert.equal(task.records[0].prompt, 'do it')
})

test('the session prefix is stripped for the resume line and restored for dsh', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const result = run(['consult', '--', 'q'], { FAKE_SESSION: `session-${id}` })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, new RegExp(`^session: ${id}$`, 'm'))
  const resume = /^resume: (.*)$/m.exec(result.stderr)[1]
  assert.ok(resume.includes(` dsh consult --resume ${id} --model deepseek-flash --effort high `), resume)

  const recordFile = join(mkdtempSync(join(root, 'rec-')), 'record.jsonl')
  const follow = sh(`${resume} -- "follow-up"`, { env: env({ FAKE_RECORD: recordFile }) })
  assert.match(follow.stdout, /the fake answer/)
  const record = JSON.parse(readFileSync(recordFile, 'utf8').trim())
  const at = record.argv.indexOf('--session-id')
  assert.equal(record.argv[at + 1], `session-${id}`)
})

test('a review resumes as a consult', () => {
  writeFileSync(join(repo, 'tracked.txt'), 'changed\n')
  try {
    const result = run(['review'])
    assert.match(result.stderr, /^resume: .* dsh consult --resume /m)
  } finally {
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n')
  }
})

test('a resumed consult answered in another session is discarded', () => {
  const result = run(['consult', '--resume', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '--', 'q'],
    { FAKE_SESSION: 'session-99999999-8888-7777-6666-555555555555' })
  assert.equal(result.status, 4, result.stderr)
  assert.match(result.stderr, /did not resume session/)
  assert.equal(result.stdout, '')
})

test('markers: tool calls are summarised, usage is summed, events stay in the log', () => {
  const result = run(['consult', '--', 'q'])
  assert.match(result.stderr, /^dsh> tool: bash git log --oneline -1$/m)
  assert.match(result.stderr, /^usage: input=11 output=3 cacheRead=5 tools=1$/m)
  assert.ok(!/model text/.test(result.stderr), 'model text is not echoed live')
  assert.match(result.stderr, /^body: begin$/m)
  assert.equal(result.stdout, 'the fake answer\n')
})

test('a run that did not complete is flagged as partial', () => {
  const result = run(['consult', '--', 'q'], { FAKE_REASON: 'max_steps' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /^warning: the run ended with reason 'max_steps' rather than completing/m)
})

test('an empty final answer is no result', () => {
  const result = run(['consult', '--', 'q'], { FAKE_FINAL: '' })
  assert.equal(result.status, 4, result.stderr)
  assert.match(result.stderr, /DeepSeek Harness produced no result/)
})

test('a turn that ended in error is no result, even with text and exit 0', () => {
  const result = run(['consult', '--', 'q'], { FAKE_ERROR: JSON.stringify({ message: 'stream cut' }), FAKE_FINAL: 'half an answer', FAKE_EXIT: '0' })
  assert.equal(result.status, 4, result.stderr)
  assert.match(result.stderr, /^error: stream cut$/m)
  assert.equal(result.stdout, '')
})

test('failures relay the reason and name the remedy', () => {
  const cases = [
    [{ FAKE_ERROR: JSON.stringify({ code: 'INVALID_REQUEST', status: 400, message: 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed x.' }) },
      /error: INVALID_REQUEST: The supported API model names/, /hint: the API rejected model/],
    [{ FAKE_ERROR: JSON.stringify({ code: 'UNSUPPORTED_REASONING_EFFORT', message: 'model "deepseek-flash" does not support reasoning effort "medium"' }) },
      /error: UNSUPPORTED_REASONING_EFFORT/, /hint: dsh rejected effort/],
    [{ FAKE_ERROR: JSON.stringify({ code: 'UNAUTHORIZED', status: 401, message: 'bad key' }) },
      /error: UNAUTHORIZED: bad key/, /hint: not authenticated/],
    [{ FAKE_STDERR_TEXT: 'session "session-x" was recorded in "/a", not "/b"' },
      /error: dsh: session "session-x" was recorded in/, /hint: the session belongs to another directory/],
    [{ FAKE_STDERR_TEXT: 'session "session-x" does not exist; omit --session-id to start a new Session' },
      /error: dsh: session "session-x" does not exist/, /hint: the session to resume no longer exists/],
  ]
  for (const [extra, error, hint] of cases) {
    const result = run(['consult', '--', 'q'], extra)
    assert.equal(result.status, 4, result.stderr)
    assert.match(result.stderr, /^provider-exit: 1$/m)
    assert.match(result.stderr, error)
    assert.match(result.stderr, hint)
  }
})

test('model and effort cannot smuggle YAML into the overlay', () => {
  const result = run(['consult', '--model', 'a"\n- id: x', '--', 'q'])
  assert.equal(result.status, 3, 'a line break in the model is refused before the run')
  const quoted = run(['consult', '--model', 'a": b', '--', 'q'])
  assert.equal(quoted.status, 0, quoted.stderr)
  assert.match(quoted.records[0].patch, /model: "a\\": b"/)
})
