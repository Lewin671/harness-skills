// The provider registry. Adding a CLI: write a module with the shape of
// codex.mjs, list it here, and add references/providers/<id>.md plus its
// tests.

import codex from './codex.mjs'

export const PROVIDERS = new Map([codex].map((provider) => [provider.id, provider]))
