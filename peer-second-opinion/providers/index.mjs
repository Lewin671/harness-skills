// The provider registry. Adding a CLI: write a module with the shape of
// codex.mjs or agy.mjs, list it here, and add references/providers/<id>.md plus its
// tests.

import agy from './agy.mjs'
import codex from './codex.mjs'

export const PROVIDERS = new Map([codex, agy].map((provider) => [provider.id, provider]))
