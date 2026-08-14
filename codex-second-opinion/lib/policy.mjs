import { die, hasLineBreak, shellQuote } from './util.mjs'

const validatedPolicies = new WeakSet()

export function createPolicy(mode) {
  const envModel = process.env.CODEX_SECOND_OPINION_MODEL || ''
  const envEffort = process.env.CODEX_SECOND_OPINION_EFFORT || ''
  return {
    mode,
    runNoun: mode === 'review' ? 'review' : 'consultation',
    resultNoun: mode === 'review' ? 'report' : 'answer',
    model: envModel || 'gpt-5.6-sol',
    effort: envEffort || 'high',
    envModelSet: Boolean(envModel),
    envEffortSet: Boolean(envEffort),
    modelSet: 0,
    effortSet: 0,
    inheritSet: 0,
    allowMcp: false,
    repo: '.',
    timeout: null,
    sessionId: '',
  }
}

export function validatePolicy(policy) {
  if (hasLineBreak(policy.model) || hasLineBreak(policy.effort)) {
    die(3, 'error: the model and effort must not contain line breaks')
  }
  if (policy.envModelSet !== policy.envEffortSet) {
    die(3,
      'error: CODEX_SECOND_OPINION_MODEL and CODEX_SECOND_OPINION_EFFORT must be set together.',
      "hint: set both, or unset both and pass '--model M --effort L' for a single run.")
  }
  if (policy.modelSet > 1 || policy.effortSet > 1 || policy.inheritSet > 1) {
    die(3,
      'error: --model, --effort, and --inherit may each be given only once.',
      'hint: repeating one makes the effective setting depend on flag order.')
  }
  if (policy.inheritSet && (policy.modelSet || policy.effortSet)) {
    die(3,
      'error: --inherit cannot be combined with --model or --effort.',
      "hint: pick one — no flags for the pinned defaults, '--model M --effort L' for an explicit pair, or --inherit for your codex config.")
  }
  if (policy.modelSet && !policy.effortSet) {
    die(3, 'error: --model needs an explicit --effort.')
  }
  if (policy.effortSet && !policy.modelSet) {
    die(3, 'error: --effort needs an explicit --model.')
  }
  const validated = Object.freeze({
    ...policy,
    modelSelection: policy.inheritSet
      ? Object.freeze({ kind: 'inherit' })
      : Object.freeze({
          kind: policy.modelSet ? 'explicit' : 'pinned',
          model: policy.model,
          effort: policy.effort,
        }),
  })
  validatedPolicies.add(validated)
  return validated
}

export function assertValidatedPolicy(policy) {
  if (!validatedPolicies.has(policy)) throw new TypeError('policy was not produced by validatePolicy')
}

export function commonOption(policy, args, index) {
  const option = args[index]
  const value = args[index + 1]
  switch (option) {
    case '--model':
      if (value === undefined || value === '') die(3, "error: --model needs a non-empty value (use --inherit for your config's model)")
      policy.model = value; policy.modelSet += 1; return index + 2
    case '--effort':
      if (value === undefined || value === '') die(3, 'error: --effort needs a non-empty value')
      policy.effort = value; policy.effortSet += 1; return index + 2
    case '--inherit':
      policy.model = ''; policy.effort = ''; policy.inheritSet += 1; return index + 1
    case '--allow-mcp':
      policy.allowMcp = true; return index + 1
    case '--repo':
      if (value === undefined) die(3, 'error: --repo needs a value')
      policy.repo = value; return index + 2
    default:
      return null
  }
}

export function resumeModelFlags(policy) {
  if (policy.modelSelection.kind === 'inherit') return ' --inherit'
  return ` --model ${shellQuote(policy.modelSelection.model)} --effort ${shellQuote(policy.modelSelection.effort)}`
}
