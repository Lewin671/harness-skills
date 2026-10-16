// Transient-failure retries in lib/run.mjs, driven through the codex
// provider (the one with capacity retries). A fake node script stands in for
// the CLI; ctx.build supplies its argv directly.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { runAgent } from '../lib/run.mjs'
import codex from '../providers/codex.mjs'

const capacity = 'Selected model is at capacity. Please try a different model.'
const sessionId = '11111111-2222-3333-4444-555555555555'
const runUrl = new URL('../lib/run.mjs', import.meta.url).href
const codexUrl = new URL('../providers/codex.mjs', import.meta.url).href

function fixture(mode, timeout = 5, delays = [1, 2, 3]) {
  const dir = mkdtempSync(join(tmpdir(), 'peer-retry-'))
  const out = join(dir, 'result')
  const log = join(dir, 'progress')
  const count = join(dir, 'calls')
  const fake = join(dir, 'fake.mjs')
  writeFileSync(out, '')
  writeFileSync(log, '')
  writeFileSync(fake, `
    import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
    const [out, count, mode] = process.argv.slice(2);
    appendFileSync(count, JSON.stringify(process.argv.slice(2)) + '\\n');
    const n = readFileSync(count, 'utf8').trim().split('\\n').length;
    const resumeAt = process.argv.indexOf('resume');
    const session = resumeAt >= 0 ? process.argv[resumeAt + 1] : ${JSON.stringify(sessionId)};
    const resumable = ['session', 'partialsession', 'mismatch', 'missingconfirmation', 'ephemeral', 'known'].includes(mode);
    if ((mode !== 'missingconfirmation' || n === 1) && (mode !== 'known' || n > 1)) {
      console.log(JSON.stringify({type:'thread.started', thread_id: mode === 'mismatch' && n > 1 ? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' : resumable ? session : n === 1 ? 'old' : 'new'}));
    }
    if (mode === 'known' && n > 1 || (mode === 'session' || mode === 'partialsession') && n > 2 || mode === 'missingconfirmation' && n > 1 || mode === 'recover' && n > 2 || mode === 'quoted') {
      console.log(JSON.stringify({type:'item.completed', item:{type:'agent_message', text:${JSON.stringify(capacity)}}}));
      writeFileSync(out, 'success');
      process.exit(0);
    }
    if (mode === 'partial' || mode === 'partialsession' || mode === 'ephemeral') {
      console.log(JSON.stringify({type:'item.started', item:{type:'command_execution'}}));
    }
    if (mode === 'result') writeFileSync(out, 'partial answer');
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 80));
    if (mode === 'generic') console.error('authentication failed');
    else if (mode === 'stdoutquote') console.log(${JSON.stringify(capacity)});
    else if (mode === 'error') console.log(JSON.stringify({type:'error',message:${JSON.stringify(capacity)}}));
    else if (mode === 'json') console.log(JSON.stringify({type:'turn.failed',error:{message:${JSON.stringify(capacity)}}}));
    else console.error(${JSON.stringify(capacity)});
    process.exit(mode === 'error' ? 0 : 1);
  `)
  const f = {
    dir, out, log, count,
    mode: 'consult',
    env: { bin: process.execPath, cwd: dir, baseEnv: process.env },
    policy: { timeout, sessionId: '', model: 'same-model', effort: 'high', modelSource: 'default' },
    artifacts: { out, log },
    retryDelays: delays,
    // argv for (sessionId, continuing); the default ignores both, like a
    // provider whose sessions cannot be resumed.
    args: [fake, out, count, mode],
    build: null,
    onTimeout: undefined,
    calls() { return readFileSync(count, 'utf8').trim().split('\n').map(JSON.parse) },
    cleanup() { rmSync(dir, { recursive: true, force: true }) },
  }
  return f
}

function run(f) {
  return runAgent({
    provider: codex, env: f.env, mode: f.mode, policy: f.policy, artifacts: f.artifacts,
    retryDelays: f.retryDelays, onTimeout: f.onTimeout,
    build: f.build || (() => ({ args: f.args, prompt: null })),
  })
}

for (const mode of ['recover', 'json', 'error']) {
  test(`capacity ${mode}: bounded retry, same arguments, isolated successful events`, async () => {
    const f = fixture(mode)
    try {
      if (mode === 'recover') {
        const result = await run(f)
        assert.equal(result.output, 'success')
        // the session comes from the successful attempt, not an earlier one
        assert.equal(result.sessionId, 'new')
        assert.equal(f.calls().length, 3)
      } else {
        await assert.rejects(run(f), e => e.code === 4)
        assert.equal(f.calls().length, 4)
        assert.equal(existsSync(f.out), false)
      }
      for (const call of f.calls()) assert.deepEqual(call, f.args.slice(1))
      assert.match(readFileSync(f.log, 'utf8'), /thread.started/)
    } finally { f.cleanup() }
  })
}

for (const mode of ['generic', 'partial', 'result', 'quoted', 'stdoutquote']) {
  test(`${mode}: no capacity replay`, async () => {
    const f = fixture(mode)
    try {
      if (mode === 'quoted') assert.equal((await run(f)).output, 'success')
      else await assert.rejects(run(f), e => e.code === 4)
      assert.equal(f.calls().length, 1)
    } finally { f.cleanup() }
  })
}

test('capacity wait cannot extend the original timeout', async () => {
  const f = fixture('always', 1, [2000])
  try {
    await assert.rejects(run(f), e => e.code === 5)
    assert.equal(f.calls().length, 1)
  } finally { f.cleanup() }
})

test('SIGTERM during capacity wait interrupts without another launch', async () => {
  const f = fixture('always', 10, [5000])
  try {
    const driver = `import {runAgent} from ${JSON.stringify(runUrl)}; import codex from ${JSON.stringify(codexUrl)};
      try {await runAgent({provider: codex, env: ${JSON.stringify(f.env)}, mode: 'consult', policy: ${JSON.stringify(f.policy)},
        artifacts: ${JSON.stringify(f.artifacts)}, retryDelays: ${JSON.stringify(f.retryDelays)},
        build: () => ({ args: ${JSON.stringify(f.args)}, prompt: null })});}
      catch(e) {process.exitCode=e.code;}`
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let signalled = false
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (!signalled && stderr.includes('retry 1/1')) {
        signalled = true
        child.kill('SIGTERM')
      }
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000)
    const code = await new Promise(resolve => child.once('close', resolve))
    clearTimeout(timer)
    assert.equal(code, 143, stderr)
    assert.equal(f.calls().length, 1)
  } finally { f.cleanup() }
})


test('capacity attempts share one deadline rather than resetting it', async () => {
  const f = fixture('slow', 0.4, [80, 80, 80])
  try {
    await assert.rejects(run(f), e => e.code === 5)
    assert.ok(f.calls().length >= 1 && f.calls().length < 4)
  } finally { f.cleanup() }
})


for (const mode of ['session', 'partialsession']) {
  test(`${mode}: continue the same session, preserving flags and replacing only the prompt`, async () => {
    const f = fixture(mode)
    const flags = ['-m', 'same-model', '-c', 'sandbox_mode="read-only"', '--json']
    const prefix = f.args
    f.build = (id) => id
      ? { args: [...prefix, 'exec', 'resume', id, ...flags], prompt: 'Continue' }
      : { args: [...prefix, 'exec', ...flags], prompt: 'original question' }
    try {
      const result = await run(f)
      assert.equal(result.output, 'success')
      const calls = f.calls()
      assert.equal(calls.length, 3)
      assert.equal(calls[0].at(-1), 'original question')
      for (const call of calls.slice(1)) {
        assert.deepEqual(call.slice(3), ['exec', 'resume', sessionId, ...flags, '--', 'Continue'])
      }
    } finally { f.cleanup() }
  })
}

for (const mode of ['mismatch', 'missingconfirmation']) {
  test(`${mode}: reject an unconfirmed continuation rather than adopting a different session`, async () => {
    const f = fixture(mode)
    const prefix = f.args
    f.build = (id) => ({ args: id ? [...prefix, 'exec', 'resume', id] : prefix, prompt: id ? 'Continue' : null })
    try {
      await assert.rejects(run(f), e => e.code === 4 && /resume|could not be confirmed/.test(e.message))
      assert.equal(f.calls().length, 2)
      assert.equal(existsSync(f.out), false)
    } finally { f.cleanup() }
  })
}

test('ephemeral review does not resume a thread id or replay partial work', async () => {
  const f = fixture('ephemeral')
  f.mode = 'review'
  try {
    await assert.rejects(run(f), e => e.code === 4 && /no recoverable session/.test(e.message))
    assert.equal(f.calls().length, 1)
  } finally { f.cleanup() }
})


test('known resumed session continues even when capacity failure reports no thread id', async () => {
  const f = fixture('known')
  const prefix = f.args
  f.policy.sessionId = sessionId
  f.build = (id, continuing) => ({ args: [...prefix, 'exec', 'resume', id], prompt: continuing ? 'Continue' : 'original follow-up' })
  try {
    const result = await run(f)
    assert.equal(result.output, 'success')
    assert.equal(f.calls().length, 2)
    assert.deepEqual(f.calls()[1].slice(3), ['exec', 'resume', sessionId, '--', 'Continue'])
  } finally { f.cleanup() }
})

test('no valid session repeats the original question instead of sending Continue', async () => {
  const f = fixture('recover')
  f.build = (id) => { if (id) throw new Error('must not resume an invalid session'); return { args: f.args, prompt: null } }
  try {
    assert.equal((await run(f)).output, 'success')
    for (const call of f.calls()) assert.deepEqual(call, f.args.slice(1))
  } finally { f.cleanup() }
})

test('a capacity retry that cannot fit the timeout still reports the recoverable session', async () => {
  const f = fixture('session', 1, [2000])
  const prefix = f.args
  f.build = (id) => ({ args: id ? [...prefix, 'exec', 'resume', id] : prefix, prompt: id ? 'Continue' : null })
  let reported = null
  f.onTimeout = state => { reported = state.sessionId }
  try {
    await assert.rejects(run(f), e => e.code === 5)
    assert.equal(reported, sessionId)
  } finally { f.cleanup() }
})

test('exhausted retries report the CLI status as provider-exit', async () => {
  const f = fixture('always', 10, [1])
  try {
    const driver = `import {runAgent} from ${JSON.stringify(runUrl)}; import codex from ${JSON.stringify(codexUrl)};
      try {await runAgent({provider: codex, env: ${JSON.stringify(f.env)}, mode: 'consult', policy: ${JSON.stringify(f.policy)},
        artifacts: ${JSON.stringify(f.artifacts)}, retryDelays: ${JSON.stringify(f.retryDelays)},
        build: () => ({ args: ${JSON.stringify(f.args)}, prompt: null })});}
      catch(e) {process.exitCode=e.code;}`
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    const code = await new Promise(resolve => child.once('close', resolve))
    assert.equal(code, 4, stderr)
    assert.match(stderr, /^provider-exit: 1$/m)
  } finally { f.cleanup() }
})

test('a transient failure after work began still reports provider-exit', async () => {
  const f = fixture('ephemeral', 10, [1])
  f.mode = 'review'
  try {
    const driver = `import {runAgent} from ${JSON.stringify(runUrl)}; import codex from ${JSON.stringify(codexUrl)};
      try {await runAgent({provider: codex, env: ${JSON.stringify(f.env)}, mode: 'review', policy: ${JSON.stringify(f.policy)},
        artifacts: ${JSON.stringify(f.artifacts)}, retryDelays: ${JSON.stringify(f.retryDelays)},
        build: () => ({ args: ${JSON.stringify(f.args)}, prompt: null })});}
      catch(e) {for (const l of e.lines || []) process.stderr.write(l + '\\n'); process.exitCode=e.code;}`
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    const code = await new Promise(resolve => child.once('close', resolve))
    assert.equal(code, 4, stderr)
    assert.match(stderr, /no recoverable session/)
    assert.match(stderr, /^provider-exit: 1$/m)
  } finally { f.cleanup() }
})
