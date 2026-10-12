import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { runCodex } from '../lib/runtime.mjs'

const capacity = 'Selected model is at capacity. Please try a different model.'
const sessionId = '11111111-2222-3333-4444-555555555555'
const runtimeUrl = new URL('../lib/runtime.mjs', import.meta.url).href

function fixture(mode, timeout = 5, delays = [1, 2, 3]) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-capacity-'))
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
  return {
    dir, out, log, count,
    env: { codexBin: process.execPath, cwd: dir, baseEnv: process.env },
    invocation: { args: [fake, out, count, mode], diagnostic: 'running: fake codex' },
    options: { out, log, timeout, runNoun: 'consultation', resultNoun: 'answer', model: 'same-model', capacityRetryDelays: delays },
    calls() { return readFileSync(count, 'utf8').trim().split('\n').map(JSON.parse) },
    cleanup() { rmSync(dir, { recursive: true, force: true }) },
  }
}

for (const mode of ['recover', 'json', 'error']) {
  test(`capacity ${mode}: bounded retry, same arguments, isolated successful events`, async () => {
    const f = fixture(mode)
    try {
      if (mode === 'recover') {
        const result = await runCodex(f.env, f.invocation, f.options)
        assert.equal(result.output, 'success')
        assert.equal(result.events.includes('"thread_id":"old"'), false)
        assert.equal(result.events.includes('"thread_id":"new"'), true)
        assert.equal(f.calls().length, 3)
      } else {
        await assert.rejects(runCodex(f.env, f.invocation, f.options), e => e.code === 4)
        assert.equal(f.calls().length, 4)
        assert.equal(existsSync(f.out), false)
      }
      for (const call of f.calls()) assert.deepEqual(call, f.invocation.args.slice(1))
      assert.match(readFileSync(f.log, 'utf8'), /thread.started/)
    } finally { f.cleanup() }
  })
}

for (const mode of ['generic', 'partial', 'result', 'quoted', 'stdoutquote']) {
  test(`${mode}: no capacity replay`, async () => {
    const f = fixture(mode)
    try {
      if (mode === 'quoted') assert.equal((await runCodex(f.env, f.invocation, f.options)).output, 'success')
      else await assert.rejects(runCodex(f.env, f.invocation, f.options), e => e.code === 4)
      assert.equal(f.calls().length, 1)
    } finally { f.cleanup() }
  })
}

test('capacity wait cannot extend the original timeout', async () => {
  const f = fixture('always', 1, [2000])
  try {
    await assert.rejects(runCodex(f.env, f.invocation, f.options), e => e.code === 5)
    assert.equal(f.calls().length, 1)
  } finally { f.cleanup() }
})

test('SIGTERM during capacity wait interrupts without another launch', async () => {
  const f = fixture('always', 10, [5000])
  try {
    const driver = `import {runCodex} from ${JSON.stringify(runtimeUrl)};
      try {await runCodex(${JSON.stringify(f.env)},${JSON.stringify(f.invocation)},${JSON.stringify(f.options)});}
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
    await assert.rejects(runCodex(f.env, f.invocation, f.options), e => e.code === 5)
    assert.ok(f.calls().length >= 1 && f.calls().length < 4)
  } finally { f.cleanup() }
})


for (const mode of ['session', 'partialsession']) {
  test(`${mode}: continue the same session, preserving flags and replacing only the prompt`, async () => {
    const f = fixture(mode)
    const flags = ['-m', 'same-model', '-c', 'sandbox_mode="read-only"', '--json']
    const prefix = f.invocation.args
    f.invocation.args = [...prefix, 'exec', ...flags, '--', 'original question']
    f.options.resumeInvocation = id => ({
      args: [...prefix, 'exec', 'resume', id, ...flags, '--', 'Continue'],
      diagnostic: 'running: fake resume Continue',
    })
    try {
      const result = await runCodex(f.env, f.invocation, f.options)
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
    const prefix = f.invocation.args
    f.options.resumeInvocation = id => ({ args: [...prefix, 'exec', 'resume', id, '--', 'Continue'], diagnostic: 'running: fake resume' })
    try {
      await assert.rejects(runCodex(f.env, f.invocation, f.options), e => e.code === 4 && /resume/.test(e.message))
      assert.equal(f.calls().length, 2)
      assert.equal(existsSync(f.out), false)
    } finally { f.cleanup() }
  })
}

test('ephemeral review does not resume a thread id or replay partial work', async () => {
  const f = fixture('ephemeral')
  try {
    await assert.rejects(runCodex(f.env, f.invocation, f.options), e => e.code === 4 && /no recoverable session/.test(e.message))
    assert.equal(f.calls().length, 1)
  } finally { f.cleanup() }
})


test('known resumed session continues even when capacity failure reports no thread id', async () => {
  const f = fixture('known')
  const prefix = f.invocation.args
  f.invocation.args = [...prefix, 'exec', 'resume', sessionId, '--', 'original follow-up']
  f.options.expectedSessionId = sessionId
  f.options.resumed = true
  f.options.resumeInvocation = id => ({ args: [...prefix, 'exec', 'resume', id, '--', 'Continue'], diagnostic: 'running: known resume' })
  try {
    const result = await runCodex(f.env, f.invocation, f.options)
    assert.equal(result.output, 'success')
    assert.equal(f.calls().length, 2)
    assert.deepEqual(f.calls()[1].slice(3), ['exec', 'resume', sessionId, '--', 'Continue'])
  } finally { f.cleanup() }
})

test('no valid session repeats the original question instead of sending Continue', async () => {
  const f = fixture('recover')
  f.options.resumeInvocation = () => { throw new Error('must not resume an invalid session') }
  try {
    assert.equal((await runCodex(f.env, f.invocation, f.options)).output, 'success')
    for (const call of f.calls()) assert.deepEqual(call, f.invocation.args.slice(1))
  } finally { f.cleanup() }
})
