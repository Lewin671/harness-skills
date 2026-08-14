import { die, flat, hasLineBreak, shellQuote } from './util.mjs'

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
    repoSet: 0,
    timeout: null,
    sessionId: '',
  }
}

export function validatePolicy(policy) {
  if (hasLineBreak(policy.model) || hasLineBreak(policy.effort)) {
    die(3, 'error: the model and effort must not contain line breaks')
  }
  // The effort is the one selection value embedded in config SYNTAX rather
  // than passed as its own argv element: safetyArgs writes it inside the
  // quotes of -c model_reasoning_effort="...". The model travels via -m and
  // needs no such check. A quote or backslash in the effort cannot define a
  // second config key (the whole -c value is one argv element, split at its
  // first '='), but it would reach codex as broken TOML and fail there,
  // minutes and a spawn later, with a config error naming this script's own
  // key -- when the policy promise is that an invalid selection is refused
  // before anything is spawned.
  if (!policy.inheritSet && !/^[A-Za-z0-9._-]+$/.test(policy.effort)) {
    die(3,
      `error: the effort may contain only letters, digits, '.', '_' and '-', got '${flat(policy.effort)}'.`,
      'error: the effort is embedded in a quoted codex config value, so other characters would reach codex as config syntax instead of failing here.')
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
      if (policy.repoSet) {
        die(3,
          'error: --repo may be given only once.',
          'hint: repeating it makes the effective repository depend on flag order.')
      }
      policy.repo = value; policy.repoSet += 1; return index + 2
    default:
      return null
  }
}

export function resumeModelFlags(policy) {
  if (policy.modelSelection.kind === 'inherit') return ' --inherit'
  return ` --model ${shellQuote(policy.modelSelection.model)} --effort ${shellQuote(policy.modelSelection.effort)}`
}
