// Contract tests for review-workflow.js.
//
// Stubs the Workflow globals (agent, parallel, phase, log, args, budget) and
// runs the script's deterministic logic end to end. It does not judge agent
// output quality — it checks the parts that must hold no matter what the
// agents say: control flow, budget arithmetic, fail-closed evidence handling,
// identity reconciliation and result shape.
//
// The harness also wraps the script the way the real harness does — an async
// function body, where top-level await and top-level return are both legal —
// which makes it a parse check as well.
//
// Run: ./tests/run-tests     Exit 0 clean, 1 on any failed invariant.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved relative to this file so the suite runs from any checkout.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, '..', 'review-workflow.js'), 'utf8')
  .replace(/^export const meta/m, 'const meta')

function expectedIds(prompt) {
  let m = prompt.match(/no other: ([^\n]+)/)
  if (!m) m = prompt.match(/one of: ([^\n]+?) — and no other/)
  if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean)
  const one = prompt.match(/Return candidate_id exactly: (\S+)/)
  return one ? [one[1]] : []
}

const predicate = (holds) => ({ finding: 'stub', cited_code: 'foo.js:1', holds })
const cand = (file, line, sev, kind, title) => ({
  file, line, title, proposed_severity: sev, confidence: 'high', evidence_kind: kind,
  evidence: kind === 'present_code'
    ? { anchor: `${file}:${line}`, quoted_code: 'x = y', observed_behavior: 'wrong' }
    : { anchor: `${file}:${line}`, obligation: 'must check', searched_scope: 'middleware', evidence_of_absence: 'absent' },
})

function makeAgent(state, s) {
  return async function agent(prompt, opts) {
    state.calls.push({ label: opts.label, model: opts.model, isolation: opts.isolation, phase: opts.phase })
    if (s.onCall) s.onCall()
    const l = opts.label

    if (l.startsWith('triage')) {
      if (s.triageNull) return null
      return {
        change_kind: 'bug_fix',
        lenses: ['logic correctness', 'boundary and error handling', 'security', 'concurrency and async'],
        high_risk_regions: [
          { file: 'pay.js', start_line: 10, end_line: 40, why: 'money arithmetic' },
          { file: 'auth.js', start_line: 5, end_line: 25, why: 'authorization check' },
          { file: 'jobs.js', start_line: 1, end_line: 90, why: 'retry logic' },
        ],
        probe_candidates: [{ area: 'pay', command: 'npm test -- pay', basis: 'package.json scripts' }],
        confidence: s.triageLowConfidence ? 'low' : 'high',
        uncertainties: [],
      }
    }

    if (l.startsWith('find:')) {
      const lens = l.slice('find:'.length)
      if (s.nullLens === lens) return null
      if (s.noCandidates) return { candidates: [], additional_high_risk_regions: [], recommended_missing_lens: 'performance' }
      const out = { candidates: [], additional_high_risk_regions: [], recommended_missing_lens: 'performance' }
      if (lens === 'security') {
        out.candidates.push(cand('auth.js', 12, 'critical', 'omission', 'missing authz check'))
        out.candidates.push({ file: 'auth.js', line: 99, title: 'bad evidence', proposed_severity: 'major', confidence: 'low', evidence_kind: 'omission', evidence: { anchor: 'auth.js:99' } })
      }
      if (lens === 'logic correctness') {
        out.candidates.push(cand('pay.js', 20, 'major', 'present_code', 'rounding drift'))
        out.candidates.push(cand('auth.js', 12, 'major', 'present_code', 'same line, different claim'))
      }
      if (lens === 'boundary and error handling') {
        out.candidates.push(cand('util.js', 7, 'minor', 'present_code', 'off by one'))
        out.candidates.push(cand('util.js', 8, 'minor', 'present_code', 'swallowed error'))
      }
      if (lens === 'concurrency and async') out.candidates.push(cand('jobs.js', 33, 'minor', 'present_code', 'unawaited promise'))
      return out
    }

    if (l.startsWith('verify:')) {
      if (s.verifierNull) return null
      if (s.escalatedVerifierNull && l.endsWith(':escalated')) return null
      if (s.escalatedVerifierStillWeak && l.endsWith(':escalated')) {
        const id = expectedIds(prompt)[0]
        return { candidate_id: id, semantics: predicate('unsettled'), reachability: predicate('unsettled'),
          contract_violation: predicate('unsettled'), strongest_refutation: 'still unclear', unsettled_predicates: ['semantics'], grounding: 'weak' }
      }
      const ids = expectedIds(prompt)
      const mk = (id) => ({
        candidate_id: id, semantics: predicate('supports_candidate'), reachability: predicate('supports_candidate'),
        contract_violation: predicate('supports_candidate'), strongest_refutation: 'could not refute', unsettled_predicates: [],
        grounding: s.weakCriticalVerifier && !l.endsWith(':escalated') ? 'weak' : 'strong',
      })
      return l.includes('minors') ? { verdicts: ids.map(mk) } : mk(ids[0])
    }

    if (l.startsWith('probe:')) {
      const id = l.split(':')[1]
      if (s.probeNull) return null
      if (s.probeWrongId) return { target_id: 'WRONG', outcome: 'counterexample_constructed', input: 'x', trace: 't', expected_vs_actual: 'a vs b', predicted_signature: 'E' }
      if (s.probeBareClaim) return { target_id: id, outcome: 'counterexample_constructed' }
      const built = s.probeAlwaysFails ? false : (id === 'R1' || id === 'C2')
      if (!built) return { target_id: id, outcome: 'no_counterexample_constructed' }
      const r = { target_id: id, outcome: 'counterexample_constructed', input: 'x=-1', trace: 'step', expected_vs_actual: 'a vs b', predicted_signature: 'AssertionError' }
      if (id.startsWith('R') && !s.regionProbeNoEmergent) {
        r.emergent_candidate = cand('pay.js', 15, 'critical', 'present_code', 'emergent: overflow no finder saw')
      }
      return r
    }

    if (l.startsWith('attack:')) {
      if (s.attackNull) return null
      const id = l.split(':')[1]
      if (s.bareReproduced) return { target_id: id, grade: 'reproduced', test_capability: 'ready', execution_status: 'executed' }
      if (s.bareHeld) return { target_id: id, grade: 'held', test_capability: 'unavailable', execution_status: 'executed' }
      if (s.barePlausible) return { target_id: id, grade: 'plausible', test_capability: 'unavailable', execution_status: 'unavailable' }
      if (s.attackWrongId) return { target_id: 'WRONG', grade: 'reproduced', test_capability: 'ready', execution_status: 'executed', bound_to_base_sha: true, patch_hash_verified: true, control_passed: true, patched_result: 'failed', predicted_signature: 'E', signature_matched: true, test_code: 't', command: 'c' }
      return {
        target_id: id, grade: 'reproduced', test_capability: 'ready', execution_status: 'executed',
        bound_to_base_sha: true, patch_hash_verified: true, control_result: 'passed', control_passed: true,
        patched_result: 'failed', predicted_signature: 'AssertionError', signature_matched: true,
        test_code: 'test(...)', command: 'npm test -- x',
      }
    }

    if (l.startsWith('adjudicate')) {
      if (s.adjNull) return null
      const ids = expectedIds(prompt)
      if (s.adjUnknownId) return { verdicts: [{ candidate_id: 'ZZ9', state: 'substantiated', final_severity: 'critical', decisive_evidence: 'stub', grounding: 'strong' }] }
      return { verdicts: ids.map((id, i) => ({
        candidate_id: id,
        state: s.adjAlwaysSubstantiate ? 'substantiated' : (i === 0 ? 'substantiated' : (i === 1 ? 'refuted' : 'unresolved')),
        final_severity: i === 0 ? 'critical' : 'minor',
        decisive_evidence: 'stub',
        grounding: s.weakAdjudication && !l.includes('escalated') ? 'weak' : 'strong',
      })) }
    }
    throw new Error(`unstubbed agent label: ${l}`)
  }
}

async function run(name, argv, s = {}, budgetGlobal = { total: null, spent: () => 0, remaining: () => Infinity }) {
  const state = { calls: [], logs: [], phases: [] }
  const agent = makeAgent(state, s)
  const parallel = async (thunks) => Promise.all(thunks.map(async (t) => { try { return await t() } catch { return null } }))
  const pipeline = async () => { throw new Error('pipeline not expected') }
  const phase = (t) => state.phases.push(t)
  const log = (m) => state.logs.push(m)
  const workflow = async () => { throw new Error('workflow not expected') }
  const fn = new Function('args', 'budget', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow',
    `"use strict"; return (async () => {\n${SRC}\n})()`)
  try {
    return { name, res: await fn(argv, budgetGlobal, agent, parallel, pipeline, phase, log, workflow), state }
  } catch (e) {
    return { name, error: e, state }
  }
}

const BASE = {
  scope: 'uncommitted changes', intent: 'no behaviour change', base_sha: 'abc123',
  patch_path: '/tmp/p.diff', patch_sha256: 'deadbeef', repo_root: '/repo',
}

const R = []
R.push(await run('missing args', { scope: 'x' }))
R.push(await run('balanced', { ...BASE }))
R.push(await run('recall-first', { ...BASE, profile: 'recall-first' }))
R.push(await run('precision-first', { ...BASE, profile: 'precision-first' }))
R.push(await run('zero finder candidates', { ...BASE }, { noCandidates: true }))
R.push(await run('triage null', { ...BASE }, { triageNull: true }))
R.push(await run('adjudicator null', { ...BASE }, { adjNull: true }))
R.push(await run('attack null', { ...BASE }, { attackNull: true }))
R.push(await run('verifier null', { ...BASE }, { verifierNull: true }))
R.push(await run('verifier null + adj substantiates', { ...BASE }, { verifierNull: true, adjAlwaysSubstantiate: true }))
R.push(await run('bare reproduced claim', { ...BASE }, { bareReproduced: true }))
R.push(await run('adjudicator unknown id', { ...BASE }, { adjUnknownId: true }))
R.push(await run('probe null', { ...BASE }, { probeNull: true }))
R.push(await run('region probe, no emergent', { ...BASE }, { regionProbeNoEmergent: true }))
R.push(await run('one lens dead', { ...BASE }, { nullLens: 'security' }))
R.push(await run('weak critical verifier', { ...BASE }, { weakCriticalVerifier: true }))
R.push(await run('weak adjudication', { ...BASE }, { weakAdjudication: true }))
R.push(await run('low-confidence triage', { ...BASE }, { triageLowConfidence: true }))
R.push(await run('tiny budget', { ...BASE, budget_wu: 8 }))
R.push(await run('token target nearly spent', { ...BASE }, {}, { total: 100000, spent: () => 99000, remaining: () => 1000 }))
R.push(await run('held without binding', { ...BASE }, { bareHeld: true }))
R.push(await run('plausible without counterexample', { ...BASE }, { barePlausible: true }))
R.push(await run('probe returns wrong id', { ...BASE }, { probeWrongId: true }))
R.push(await run('probe asserts CE with no fields', { ...BASE }, { probeBareClaim: true }))
R.push(await run('attack returns wrong id', { ...BASE }, { attackWrongId: true }))
R.push(await run('zero candidates, 5wu', { ...BASE, budget_wu: 5 }, { noCandidates: true }))
R.push(await run('emergent hit at 14wu', { ...BASE, budget_wu: 14 }))
{
  // Codex's repro: WU fits but the token projection for the owed floor does
  // not. The optional lens must not be bought.
  let spent = 0
  const draining = { total: 20000, spent: () => spent, remaining: () => Math.max(0, 20000 - spent) }
  R.push(await run('recall-first, tokens tight', { ...BASE, profile: 'recall-first', budget_wu: 20 },
    { onCall: () => { spent += 2000 } }, draining))
}
{
  // Tokens suffice for adjudication but not for adjudication PLUS an
  // execution. The execution must yield; adjudication is owed those tokens.
  let spent = 0
  const draining = { total: 48000, spent: () => spent, remaining: () => Math.max(0, 48000 - spent) }
  R.push(await run('execution must not eat adjudication tokens', { ...BASE },
    { onCall: () => { spent += 2500 } }, draining))
}
R.push(await run('recall-first, floor-tight budget', { ...BASE, profile: 'recall-first', budget_wu: 26 }))
R.push(await run('recall-first, roomy budget', { ...BASE, profile: 'recall-first', budget_wu: 60 }))
R.push(await run('weak verifier, escalation dies', { ...BASE }, { weakCriticalVerifier: true, escalatedVerifierNull: true, adjAlwaysSubstantiate: true }))
R.push(await run('weak verifier, rerun still weak', { ...BASE }, { weakCriticalVerifier: true, escalatedVerifierStillWeak: true, adjAlwaysSubstantiate: true }))
R.push(await run('low-confidence triage, 5wu', { ...BASE, budget_wu: 5 }, { triageLowConfidence: true }))
R.push(await run('low-confidence triage discloses risk', { ...BASE }, { triageLowConfidence: true }))
{
  // Tokens drain as the run proceeds, so the pre-paid adjudication wave meets
  // a genuinely exhausted ceiling rather than the value it saw two waves ago.
  let spent = 0
  const draining = { total: 200000, spent: () => spent, remaining: () => Math.max(0, 200000 - spent) }
  const r = await run('tokens drain mid-run', { ...BASE }, { onCall: () => { spent += 14000 } }, draining)
  R.push(r)
}

let fail = 0
const problems = []
for (const r of R) {
  if (r.error) {
    fail++
    console.log(`\nCRASH  ${r.name}\n  ${r.error.stack.split('\n').slice(0, 3).join('\n  ')}`)
    continue
  }
  if (r.res.status !== 'ok' && r.res.search_breadth && r.res.search_breadth.supplemental_lens_bought) {
    fail++; problems.push(`${r.name}: bought an optional supplemental lens and then failed with ${r.res.status}`)
  }
  if (r.res.run && r.res.run.triage_confidence === 'low'
      && !(r.res.ledger.coverage_risks || []).some((x) => x.source === 'triage')) {
    fail++; problems.push(`${r.name}: triage was low-confidence but no coverage risk was disclosed`)
  }
  const starved = (r.res.ledger && r.res.ledger.agent_failures || []).some((f) => /token target exhausted before adjudication/.test(f.why))
  if (starved && r.res.verification_depth && r.res.verification_depth.executed > 0) {
    fail++; problems.push(`${r.name}: an execution ran, then adjudication starved on tokens it was owed`)
  }
  const c = r.res.cost
  const over = c && c.committed_wu > c.budget_wu + 1e-9
  if (over) { fail++; problems.push(`${r.name}: overspend`) }

  for (const x of r.res.candidate_results || []) {
    const a = x.attack
    if (a && a.grade === 'held' && !(a.execution_status === 'executed' && a.bound_to_base_sha === true && a.patch_hash_verified === true)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} graded held without executed+bound evidence`)
    }
    if (x.attack_grade === 'inconclusive' && !x.probe) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} graded inconclusive but was never probed`)
    }
    if (a && a.grade === 'plausible' && !(x.probe && x.probe.constructed)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} graded plausible with no validated counterexample`)
    }
  }
  // Invariant: nothing may be substantiated without either a completed
  // verifier or a normalized controlled reproduction.
  for (const x of r.res.substantiated || []) {
    if (!x.verifier_completed && !(x.attack_grade === 'reproduced' && x.execution_status === 'executed')) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} substantiated with no verifier and no reproduction`)
    }
  }
  console.log(`\n${over ? 'OVERSPEND' : 'ok'}  ${r.name}`)
  console.log(`  status=${r.res.status} launches=${r.state.calls.length}` + (c ? ` committed=${c.committed_wu}/${c.budget_wu}wu` : ''))
  if (r.res.candidate_results) {
    console.log(`  results:  ${r.res.candidate_results.map((x) => `${x.candidate_id}:${x.state}/${x.attack_grade}/${x.execution_status}`).join(' ') || '(none)'}`)
    console.log(`  classes:  subst=${r.res.substantiated.length} unres=${r.res.unresolved.length} refut=${r.res.refuted.length}`)
    console.log(`  regions:  ${r.res.regions.map((x) => `${x.target_id}:${x.probed ? x.probe_outcome : x.not_probed_because}${x.emergent_candidate_id ? `->${x.emergent_candidate_id}` : ''}`).join(' ')}`)
    console.log(`  breadth:  lenses=${r.res.search_breadth.lenses_run.length} suppl=${r.res.search_breadth.supplemental_lens_bought} regions=${r.res.search_breadth.regions_probed}/${r.res.search_breadth.regions_total} emergent=${r.res.search_breadth.emergent_candidates}`)
    console.log(`  depth:    verified=${r.res.verification_depth.verified} adjudicated=${r.res.verification_depth.adjudicated} executed=${r.res.verification_depth.executed}`)
    const L = r.res.ledger
    console.log(`  ledger:   invalid=${L.invalid_candidates.length} deferred=${L.deferred.length} agentfail=${L.agent_failures.length} malformed=${L.malformed_results.length} forced=${L.forced_unresolved.length} override=${L.terminal_evidence_overrides.length} unknownid=${L.unknown_verdict_ids.length}`)
    console.log(`  frontier: ${r.res.frontier}`)
  } else {
    console.log(`  detail: ${r.res.detail || (r.res.missing || []).join(',')}`)
  }
}
console.log(`\n${fail ? `${fail} PROBLEMS:\n  ${problems.join('\n  ')}` : 'all scenarios completed: no crash, no overspend, no unsupported substantiation'}`)
