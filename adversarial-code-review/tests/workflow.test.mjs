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
// ACR_WORKFLOW lets run-mutation-tests point the suite at a deliberately
// broken copy without ever touching the real script.
const TARGET = process.env.ACR_WORKFLOW || path.join(HERE, '..', 'review-workflow.js')
const SRC = fs.readFileSync(TARGET, 'utf8').replace(/^export const meta/m, 'const meta')

function expectedIds(prompt) {
  let m = prompt.match(/no other: ([^\n]+)/)
  if (!m) m = prompt.match(/one of: ([^\n]+?) — and no other/)
  if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean)
  const one = prompt.match(/Return candidate_id exactly: (\S+)/)
  return one ? [one[1]] : []
}

// Charge each launch roughly what the script's own weighted-unit priors say
// it costs. A drain that contradicts those priors tests prior-mismatch, not
// the token ceiling, and the script explicitly does not promise to absorb a
// bad prior — the real harness throws for that.
const WU_BY_LABEL = (label) => label.startsWith('attack:') ? 10
  : label.startsWith('adjudicate') ? 3.6
  : label.startsWith('probe:') ? 1.5
  : label.startsWith('verify:') ? 2.0
  : label.startsWith('find:') ? 1.0
  : 0.75
// `factor` is actual-cost / estimated-cost. The priors are documented as
// estimates to be calibrated, so a factor above 1 is the realistic case and a
// large one is exactly what the token ceiling exists to survive.
// `heavy` lets drift arrive LATE — after the floors are already committed —
// which is the only regime where the prepaid-adjudication gate and the escrow
// draw are the binding checks rather than reserve().
const drainer = (total, budgetWU, factor = 1, heavy = {}) => {
  let spent = 0
  const mult = (label) => {
    for (const prefix of Object.keys(heavy)) if (label.startsWith(prefix)) return heavy[prefix]
    return factor
  }
  return {
    budget: { total, spent: () => spent, remaining: () => Math.max(0, total - spent) },
    onCall: (label) => { spent += mult(label) * WU_BY_LABEL(label) * (total / budgetWU) },
  }
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
    state.calls.push({
      label: opts.label, model: opts.model, isolation: opts.isolation, phase: opts.phase,
      remainingBefore: state.budget && state.budget.total ? state.budget.remaining() : null,
    })
    if (s.onCall) s.onCall(opts.label)
    const l = opts.label

    if (l.startsWith('triage')) {
      if (s.triageNull) return null
      state.lensCount = 4
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
      if (s.allEvidenceInvalid) {
        return { candidates: [{ file: 'a.js', line: 1, title: 'no evidence', proposed_severity: 'critical', confidence: 'high', evidence_kind: 'present_code', evidence: { anchor: 'a.js:1' } }],
          additional_high_risk_regions: [], recommended_missing_lens: 'performance' }
      }
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
      if (s.manyCandidates) {
        for (let i = 0; i < 4; i++) out.candidates.push(cand(`extra-${lens[0]}.js`, 100 + i, 'minor', 'present_code', `bulk ${i}`))
      }
      return out
    }

    if (l.startsWith('verify:')) {
      if (s.verifierNull) return null
      if (s.escalatedVerifierNull && l.endsWith(':escalated')) return null
      if (s.escalatedVerifierWrongId && l.endsWith(':escalated')) {
        return { candidate_id: 'ZZ9', semantics: predicate('falsifies_candidate'), reachability: predicate('falsifies_candidate'),
          contract_violation: predicate('falsifies_candidate'), strongest_refutation: 'wrong target', unsettled_predicates: [], grounding: 'strong' }
      }
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
      if (s.probeUnknownOutcome) return { target_id: id, outcome: 'no_counterexample_constructed', input: 'x', trace: 't', expected_vs_actual: 'a', predicted_signature: 'E' }
      // Three of the four fields present, so each completeness check is
      // individually detectable rather than masked by omitting all of them.
      if (s.probeOmit) {
        const q = { target_id: id, outcome: 'counterexample_constructed', input: 'x=-1', trace: 'step', expected_vs_actual: 'a vs b', predicted_signature: 'AssertionError' }
        delete q[s.probeOmit]
        if (id.startsWith('R')) q.emergent_candidate = cand('pay.js', 15, 'critical', 'present_code', 'emergent')
        return q
      }
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
      const fullReproduced = {
        target_id: id, grade: 'reproduced', test_capability: 'ready', execution_status: 'executed',
        bound_to_base_sha: true, patch_hash_verified: true, control_result: 'passed', control_passed: true,
        patched_result: 'failed', predicted_signature: 'AssertionError', signature_matched: true,
        test_code: 'test(...)', command: 'npm test -- x',
      }
      // Mutation testing: a reproduction complete except for ONE field. If the
      // script stops checking that field, this scenario starts passing it as
      // terminal evidence and the suite notices. `bareReproduced` alone cannot
      // detect the loss of any single check.
      if (s.attackOmit) {
        const m = { ...fullReproduced }
        if (s.attackOmit === 'control') { delete m.control_passed; delete m.control_result; delete m.specification_citation }
        else if (s.attackOmit === 'bound') m.bound_to_base_sha = false
        else if (s.attackOmit === 'hash') m.patch_hash_verified = false
        else if (s.attackOmit === 'capability') m.test_capability = 'unavailable'
        else if (s.attackOmit === 'signature_matched') m.signature_matched = false
        else delete m[s.attackOmit]
        return m
      }
      if (s.attackFalseExecution) return { target_id: id, grade: s.attackFalseExecution, test_capability: 'ready', execution_status: 'executed' }
      // A `held` record complete except for ONE requirement, so deleting any
      // single check in the held branch is individually detectable.
      if (s.heldOmit) {
        const h = { ...fullReproduced, grade: 'held', vectors_attempted: ['fuzz'] }
        if (s.heldOmit === 'executed') h.execution_status = 'unavailable'
        else if (s.heldOmit === 'bound') h.bound_to_base_sha = false
        else if (s.heldOmit === 'hash') h.patch_hash_verified = false
        else if (s.heldOmit === 'capability') h.test_capability = 'unavailable'
        else if (s.heldOmit === 'vectors') h.vectors_attempted = []
        else delete h[s.heldOmit]
        return h
      }
      if (s.reproducedUnavailable) return { ...fullReproduced, execution_status: 'unavailable' }
      if (s.plausibleClaimingExecution) return { target_id: id, grade: 'plausible', test_capability: 'ready', execution_status: 'executed' }
      if (s.bareReproduced) return { target_id: id, grade: 'reproduced', test_capability: 'ready', execution_status: 'executed' }
      if (s.bareHeld) return { target_id: id, grade: 'held', test_capability: 'unavailable', execution_status: 'executed' }
      if (s.barePlausible) return { target_id: id, grade: 'plausible', test_capability: 'unavailable', execution_status: 'unavailable' }
      if (s.attackWrongId) return { target_id: 'WRONG', grade: 'reproduced', test_capability: 'ready', execution_status: 'executed', bound_to_base_sha: true, patch_hash_verified: true, control_passed: true, patched_result: 'failed', predicted_signature: 'E', signature_matched: true, test_code: 't', command: 'c' }
      return fullReproduced
    }

    if (l.startsWith('adjudicate')) {
      if (s.adjNull) return null
      const ids = expectedIds(prompt)
      if (s.adjUnknownId) return { verdicts: [{ candidate_id: 'ZZ9', state: 'substantiated', final_severity: 'critical', decisive_evidence: 'stub', grounding: 'strong' }] }
      if (l.includes('escalated')) {
        if (s.adjEscalatedNull) return null
        if (s.adjEscalatedWrongId) return { verdicts: [{ candidate_id: 'ZZ9', state: 'substantiated', final_severity: 'critical', decisive_evidence: 'stub', grounding: 'strong' }] }
      }
      if (s.adjDuplicateIds && ids.length > 1) {
        return { verdicts: [
          { candidate_id: ids[0], state: 'substantiated', final_severity: 'critical', decisive_evidence: 'first', grounding: 'strong' },
          { candidate_id: ids[0], state: 'refuted', final_severity: 'minor', decisive_evidence: 'duplicate', grounding: 'strong' },
        ] }
      }
      return { verdicts: ids.map((id, i) => ({
        candidate_id: id,
        state: s.adjAlwaysSubstantiate ? 'substantiated' : (i === 0 ? 'substantiated' : (i === 1 ? 'refuted' : 'unresolved')),
        final_severity: i === 0 ? 'critical' : 'minor',
        decisive_evidence: 'stub',
        grounding: (s.adjAlwaysWeak || (s.weakAdjudication && !l.includes('escalated'))) ? 'weak' : 'strong',
      })) }
    }
    throw new Error(`unstubbed agent label: ${l}`)
  }
}

async function run(name, argv, s = {}, budgetGlobal = { total: null, spent: () => 0, remaining: () => Infinity }, expectFn = null) {
  const state = { calls: [], logs: [], phases: [], budget: budgetGlobal, lensCount: 0 }
  const agent = makeAgent(state, s)
  const parallel = async (thunks) => Promise.all(thunks.map(async (t) => { try { return await t() } catch { return null } }))
  const pipeline = async () => { throw new Error('pipeline not expected') }
  const phase = (t) => state.phases.push(t)
  const log = (m) => state.logs.push(m)
  const workflow = async () => { throw new Error('workflow not expected') }
  const fn = new Function('args', 'budget', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow',
    `"use strict"; return (async () => {\n${SRC}\n})()`)
  try {
    return { name, res: await fn(argv, budgetGlobal, agent, parallel, pipeline, phase, log, workflow), state, expect: expectFn || s.expect, drift: Boolean(s.drift) }
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
R.push(await run('adjudicator unknown id', { ...BASE }, { adjUnknownId: true,
  expect: (res) => res.ledger.unknown_verdict_ids.length > 0 || 'an unknown verdict id was accepted instead of ledgered' }))
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
R.push(await run('probe returns wrong id', { ...BASE }, { probeWrongId: true,
  expect: (res) => (res.search_breadth.regions_probed === 0
    && res.ledger.malformed_results.some((m) => m.role === 'probe'))
    || 'a probe answering for another target was accepted' }))
R.push(await run('probe asserts CE with no fields', { ...BASE }, { probeBareClaim: true }))
R.push(await run('attack returns wrong id', { ...BASE }, { attackWrongId: true,
  expect: (res) => res.ledger.malformed_results.some((m) => m.role === 'attack')
    || 'an attack answering for another target was accepted' }))
R.push(await run('zero candidates, 5wu', { ...BASE, budget_wu: 5 }, { noCandidates: true }))
R.push(await run('emergent hit at 14wu', { ...BASE, budget_wu: 14 }))
{
  // Codex's repro: WU fits but the token projection for the owed floor does
  // not. The optional lens must not be bought.
  const d = drainer(20000, 20)
  R.push(await run('recall-first, tokens tight', { ...BASE, profile: 'recall-first', budget_wu: 20 },
    { onCall: d.onCall }, d.budget))
}
{
  // Tokens suffice for adjudication but not for adjudication PLUS an
  // execution. The execution must yield; adjudication is owed those tokens.
  // Priced from the priors: an attack costs ten finder-units, so a budget
  // sized just above the floors leaves room for adjudication OR an attack,
  // and the run must choose adjudication.
  // Sized so the ceiling admits an attack only if it forgets what adjudication
  // is still owed: 10 units fit, 10 + the 7.2 units of prepaid debt do not.
  const d = drainer(42000, 48, 1.4)
  R.push(await run('execution must not eat adjudication tokens', { ...BASE },
    { onCall: d.onCall, drift: true }, d.budget,
    (res) => (res.verification_depth.executed === 0 && res.verification_depth.adjudicated > 0)
      || `an attack was bought with adjudication still owed its tokens (executed=${res.verification_depth.executed}, adjudicated=${res.verification_depth.adjudicated})`))
}
// Mutation coverage: each reproduction requirement, omitted alone. Deleting
// any single check in normalizeAttack makes exactly one of these fail.
for (const field of ['control', 'bound', 'hash', 'capability', 'signature_matched', 'test_code', 'command', 'patched_result', 'predicted_signature']) {
  R.push(await run(`reproduced missing ${field}`, { ...BASE }, { attackOmit: field }))
}
// The attacked critical must have NO counterexample, or the guard is untested.
R.push(await run('plausible with no counterexample', { ...BASE }, { probeAlwaysFails: true, barePlausible: true }))
for (const field of ['executed', 'bound', 'hash', 'capability', 'vectors', 'patched_result']) {
  R.push(await run(`held missing ${field}`, { ...BASE }, { heldOmit: field }))
}
for (const field of ['input', 'trace', 'expected_vs_actual', 'predicted_signature']) {
  R.push(await run(`probe missing ${field}`, { ...BASE }, { probeOmit: field }))
}
R.push(await run('reproduced but not executed', { ...BASE }, { reproducedUnavailable: true }))
R.push(await run('plausible claiming execution', { ...BASE }, { plausibleClaimingExecution: true }))
R.push(await run('escalated adjudication still weak', { ...BASE }, { adjAlwaysWeak: true }))
// Enough candidates for multi-batch adjudication, so escalation must reach
// past its single escrowed batch and hit the real ceiling.
R.push(await run('many candidates, weak adjudication', { ...BASE, budget_wu: 90 }, { manyCandidates: true, weakAdjudication: true }))
R.push(await run('many candidates, tight budget', { ...BASE, budget_wu: 40 }, { manyCandidates: true }))
R.push(await run('escalated verifier answers wrong id', { ...BASE }, { weakCriticalVerifier: true, escalatedVerifierWrongId: true, adjAlwaysSubstantiate: true }))
R.push(await run('probe outcome says none constructed', { ...BASE }, { probeUnknownOutcome: true }))
R.push(await run('all finder evidence invalid', { ...BASE }, { allEvidenceInvalid: true,
  // Emergent candidates from region probes are legitimately still there; it
  // is the finder-produced ones that must all have been dropped.
  expect: (res) => (res.candidate_results.every((x) => x.origin !== 'finder')
    && res.ledger.invalid_candidates.length > 0)
    || 'a finder candidate with no evidence body reached verification' }))
R.push(await run('one lens dead discloses gap', { ...BASE }, { nullLens: 'security',
  expect: (res) => res.search_breadth.lenses_unrun.includes('security')
    || 'a finder that never returned was not disclosed as an unrun lens' }))
R.push(await run('blocked claiming execution', { ...BASE }, { attackFalseExecution: 'blocked' }))
R.push(await run('inconclusive claiming execution', { ...BASE }, { attackFalseExecution: 'inconclusive' }))
R.push(await run('weak adjudication, rerun null', { ...BASE }, { weakAdjudication: true, adjEscalatedNull: true }))
R.push(await run('weak adjudication, rerun wrong id', { ...BASE }, { weakAdjudication: true, adjEscalatedWrongId: true }))
R.push(await run('duplicate verdict ids', { ...BASE }, { adjDuplicateIds: true,
  expect: (res) => res.ledger.malformed_results.some((m) => /duplicate/.test(m.why))
    || 'a duplicated verdict was silently accepted' }))
// Budget below the cost of triage itself: the weighted-unit ceiling is the
// only thing standing between this and a run that spends what it does not have.
R.push(await run('budget below triage cost', { ...BASE, budget_wu: 0.5 }, {
  expect: (res, state) => (res.status === 'budget_too_small' && state.calls.length === 0)
    || `a budget below the cost of triage still launched ${state.calls.length} agent(s) and returned ${res.status}` }))
{
  // Because tokensPerWU is total/budgetWU, the token check is arithmetically
  // identical to the weighted-unit check whenever actuals match the priors —
  // it earns its keep only when they do not. Past roughly 6.6x the accuracy
  // floor stops fitting in tokens while still fitting in units, so this is
  // the regime where the token half of the ceiling is the only thing left.
  const d = drainer(48000, 48, 7)
  R.push(await run('priors underestimate by 7x', { ...BASE }, { onCall: d.onCall, drift: true }, d.budget,
    (res) => res.status === 'budget_too_small'
      || `priors were 7x off and the run proceeded anyway as ${res.status}`))
}
{
  // Drift arrives with the attack, after adjudication's units are already
  // committed. Only the prepaid-admission gate can still refuse the wave.
  const d = drainer(48000, 48, 1, { 'attack:': 3.4 })
  R.push(await run('late drift starves adjudication', { ...BASE }, { onCall: d.onCall, drift: true }, d.budget,
    (res) => (res.status === 'adjudication_failed'
      && res.ledger.agent_failures.some((f) => /token target exhausted before adjudication/.test(f.why)))
      || `adjudication ran past an exhausted token target and returned ${res.status}`))
}
{
  // Drift arrives with the verifiers, so the escalation must draw its escrow
  // against a target that no longer has room for it.
  const d = drainer(48000, 48, 1, { 'verify:': 4.2 })
  R.push(await run('late drift blocks escrowed escalation', { ...BASE },
    { weakCriticalVerifier: true, onCall: d.onCall, drift: true }, d.budget,
    // Checked against the launch log: a deferral entry alone cannot
    // discriminate, because the escrow covers only the first escalation and
    // the second is refused by reserve() either way.
    (res, state) => state.calls.every((k) => !k.label.endsWith(':escalated'))
      || 'an escrowed escalation was launched with no token headroom for it'))
}
R.push(await run('recall-first, floor-tight budget', { ...BASE, profile: 'recall-first', budget_wu: 26 }))
R.push(await run('recall-first, roomy budget', { ...BASE, profile: 'recall-first', budget_wu: 60 }))
R.push(await run('weak verifier, escalation dies', { ...BASE }, { weakCriticalVerifier: true, escalatedVerifierNull: true, adjAlwaysSubstantiate: true }))
R.push(await run('weak verifier, rerun still weak', { ...BASE }, { weakCriticalVerifier: true, escalatedVerifierStillWeak: true, adjAlwaysSubstantiate: true }))
R.push(await run('low-confidence triage, 5wu', { ...BASE, budget_wu: 5 }, { triageLowConfidence: true }))
R.push(await run('low-confidence triage discloses risk', { ...BASE }, { triageLowConfidence: true }))
{
  // Priced from the script's own priors, so exhaustion is real rather than an
  // artefact of charging more per launch than the scheduler was ever told.
  const d = drainer(60000, 48)
  R.push(await run('tokens drain mid-run', { ...BASE }, { onCall: d.onCall }, d.budget))
}

let fail = 0
const problems = []
for (const r of R) {
  if (r.error) {
    fail++
    console.log(`\nCRASH  ${r.name}\n  ${r.error.stack.split('\n').slice(0, 3).join('\n  ')}`)
    continue
  }
  // Optional spending must never precede a floor failure. Checked against the
  // LAUNCH LOG, not the result shape — the early returns omit search_breadth,
  // which is exactly how the previous version of this check missed the case.
  if (r.res.status === 'budget_too_small' || r.res.status === 'scope_too_large') {
    const optional = r.state.calls.filter((k) => k.label.startsWith('probe:') || k.label.startsWith('attack:'))
    const finds = r.state.calls.filter((k) => k.label.startsWith('find:'))
    if (optional.length) {
      fail++; problems.push(`${r.name}: bought ${optional.length} optional launch(es) and then failed with ${r.res.status}`)
    }
    if (r.state.lensCount && finds.length > r.state.lensCount) {
      fail++; problems.push(`${r.name}: bought a supplemental lens and then failed with ${r.res.status}`)
    }
  }
  // Nothing may be launched once the token target is exhausted: the real
  // harness throws there, so admitting work is a promised-bound violation.
  for (const k of r.drift ? [] : r.state.calls) {
    if (k.remainingBefore === 0) {
      fail++; problems.push(`${r.name}: launched ${k.label} with zero remaining tokens`)
      break
    }
  }
  if (r.res.run && r.res.run.triage_confidence === 'low'
      && !(r.res.ledger.coverage_risks || []).some((x) => x.source === 'triage')) {
    fail++; problems.push(`${r.name}: triage was low-confidence but no coverage risk was disclosed`)
  }
  // The next three hold only when actual spend matches the weighted-unit
  // priors. A wave is admitted atomically and cannot be re-checked in flight,
  // so under prior drift the script can promise correct ADMISSION and nothing
  // about actual spend. Drift scenarios carry their own expectations instead.
  const starved = !r.drift && (r.res.ledger && r.res.ledger.agent_failures || []).some((f) => /token target exhausted before adjudication/.test(f.why))
  if (starved && r.res.verification_depth && r.res.verification_depth.executed > 0) {
    fail++; problems.push(`${r.name}: an execution ran, then adjudication starved on tokens it was owed`)
  }
  if (r.expect) {
    const verdict = r.expect(r.res, r.state)
    if (verdict !== true) { fail++; problems.push(`${r.name}: ${verdict}`) }
  }
  const c = r.res.cost
  const over = c && c.committed_wu > c.budget_wu + 1e-9
  if (over) { fail++; problems.push(`${r.name}: weighted-unit overspend`) }
  if (!r.drift && c && c.token_target && c.output_tokens > c.token_target) {
    fail++; problems.push(`${r.name}: spent ${c.output_tokens} tokens against a ${c.token_target} target`)
  }

  for (const x of r.res.candidate_results || []) {
    const a = x.attack
    if (a && a.grade === 'held' && !(a.execution_status === 'executed' && a.bound_to_base_sha === true
        && a.patch_hash_verified === true && a.test_capability === 'ready' && a.patched_result
        && a.vectors_attempted && a.vectors_attempted.length)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} graded held without the full executed-and-bound evidence set`)
    }
    // Grades that carry no information about the code may not dress
    // themselves up as executed runs.
    if (a && (a.grade === 'blocked' || a.grade === 'inconclusive') && a.execution_status === 'executed') {
      fail++; problems.push(`${r.name}: ${x.candidate_id} graded ${a.grade} while claiming execution`)
    }
    // Evidence identity, on the refutation side as well as the attack side.
    if (x.verifier && x.verifier.candidate_id !== x.candidate_id) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} carries a refutation labelled ${x.verifier.candidate_id}`)
    }
    // "Constructed" must mean the probe said so, not merely that it returned.
    if (x.probe && x.probe.constructed && x.probe.outcome !== 'counterexample_constructed') {
      fail++; problems.push(`${r.name}: ${x.candidate_id} probe counted as constructed while reporting ${x.probe.outcome}`)
    }
    if (a && a.grade === 'plausible' && a.execution_status === 'executed') {
      fail++; problems.push(`${r.name}: ${x.candidate_id} graded plausible while claiming execution`)
    }
    // Evidence must belong to the candidate it is filed under.
    if (a && a.target_id !== x.candidate_id) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} carries attack evidence labelled ${a.target_id}`)
    }
    // A probe counted as having built a counterexample must actually contain
    // one: it is what authorises a ten-weighted-unit execution.
    if (x.probe && x.probe.constructed
        && !(x.probe.input && x.probe.trace && x.probe.expected_vs_actual && x.probe.predicted_signature)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} probe counted as constructed without the fields that constitute one`)
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
  const controlled = (a) => Boolean(a && a.grade === 'reproduced' && a.execution_status === 'executed'
    && a.bound_to_base_sha === true && a.patch_hash_verified === true && a.test_capability === 'ready'
    && a.signature_matched === true && a.test_code && a.command && a.patched_result && a.predicted_signature
    && (a.control_passed === true || a.specification_citation))
  for (const x of r.res.substantiated || []) {
    if (!x.verifier_completed && !controlled(x.attack)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} substantiated with no verifier and no CONTROLLED reproduction`)
    }
    // A weakly grounded refutation is not a settled one. The record is
    // deliberately retained for the report, so what must never happen is
    // COUNTING it: reporting a completed verifier for a candidate nobody
    // could stand behind checking.
    if (x.verifier_completed && x.verifier_grounding !== 'strong') {
      fail++; problems.push(`${r.name}: ${x.candidate_id} reports a completed verifier whose refutation was ${x.verifier_grounding}`)
    }
    if (x.verifier && x.verifier.grounding === 'weak' && !controlled(x.attack)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} substantiated on a weakly grounded refutation`)
    }
    if (x.grounding === 'weak' && !controlled(x.attack)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} substantiated on a weakly grounded verdict`)
    }
  }
  // Wherever the grade survives as `reproduced`, the full evidence must be
  // there — otherwise a deleted field in normalizeAttack goes unnoticed.
  for (const x of r.res.candidate_results || []) {
    if (x.attack_grade === 'reproduced' && !controlled(x.attack)) {
      fail++; problems.push(`${r.name}: ${x.candidate_id} kept grade reproduced without complete controlled evidence`)
    }
    // The other direction of the same contract clause: a controlled
    // reproduction is terminal evidence and outranks any refutation.
    if (controlled(x.attack) && x.state !== 'substantiated') {
      fail++; problems.push(`${r.name}: ${x.candidate_id} has a controlled reproduction but is ${x.state}`)
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

// The suite is the only guard on these invariants, so it must be usable as
// one: a failing assertion has to make the process exit nonzero.
process.exitCode = fail ? 1 : 0
