/**
 * PLUG-AND-PLAY MODEL PROVIDERS. Settings offered six presets (Ollama, LM Studio, OpenAI, Anthropic,
 * OpenRouter, other) and "other" meant knowing a base URL, a wire and a model id by heart. models.dev
 * (the open catalog OpenCode and others read) lists every provider with its endpoint, the environment
 * variable its key lives in, and its models with context and price. This module carries that catalog,
 * trimmed to what Sequence can speak (providerCatalogSnapshot.ts), and answers three questions:
 *
 *   - which providers are there (the picker);
 *   - which of them already have a key on this machine, by NAME only (the "found your key" offer);
 *   - may a config read its key from variable X for endpoint Y (`apiKeyEnv`, see provider.ts).
 *
 * KEYS BY NAME. A config may say `apiKeyEnv: "DEEPSEEK_API_KEY"` instead of holding the key: the key
 * stays in the environment, is read when the config is loaded, and is never written to disk by this
 * path. The name is accepted only when the catalog says that variable belongs to that endpoint, so a
 * repository's config cannot send, say, GITHUB_TOKEN to a host it chose.
 *
 * AN OFFER, NOT A CHOICE (the ai-config route's rule): nothing here picks a provider for anyone. A
 * detected key is shown; the person presses Use.
 */

import { PROVIDER_SNAPSHOT } from './providerCatalogSnapshot.js';

export interface CatalogModel {
  id: string;
  name: string;
  context?: number;
  /** USD per million tokens, [input, output]. */
  cost?: [number, number];
  reasoning?: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  wire: 'anthropic' | 'openai-compatible';
  /** The base URL the analyzer's wire expects (no trailing slash). */
  api: string;
  /** The variables its key may live in. */
  env: string[];
  doc?: string;
  /** Current tool-calling models, newest first. */
  models: CatalogModel[];
}

export function providerCatalog(): readonly CatalogProvider[] {
  return PROVIDER_SNAPSHOT;
}

/** `https://api.deepseek.com/` and `https://api.deepseek.com` are one endpoint. */
function sameEndpoint(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.protocol === y.protocol && x.host.toLowerCase() === y.host.toLowerCase() && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
}

/** The catalog provider that owns this endpoint on this wire, if any. */
export function providerForEndpoint(wire: string, baseUrl: string | undefined): CatalogProvider | undefined {
  return PROVIDER_SNAPSHOT.find((p) => p.wire === wire && (baseUrl ? sameEndpoint(p.api, baseUrl) : p.wire === 'anthropic' && p.id === 'anthropic'));
}

/** Whether a config may read its key from `name` for this endpoint: only a variable the catalog gives that provider. */
export function keyEnvAllowed(wire: string, baseUrl: string | undefined, name: string): boolean {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(name)) return false;
  /* Every provider at this endpoint counts: two catalog entries can share one address with different variables. */
  return PROVIDER_SNAPSHOT.some((p) => p.wire === wire && (baseUrl ? sameEndpoint(p.api, baseUrl) : p.id === 'anthropic') && p.env.includes(name));
}

export interface DetectedProvider {
  id: string;
  name: string;
  /** The variable that is set (its value is never read out). */
  keyEnv: string;
}

const GENERAL_TOKENS = new Set(['GITHUB_TOKEN', 'GH_TOKEN']);

/** Providers whose key is already in this environment: the name of the variable, never its value. */
export function detectEnvProviders(env: NodeJS.ProcessEnv = process.env): DetectedProvider[] {
  const out: DetectedProvider[] = [];
  for (const p of PROVIDER_SNAPSHOT) {
    /* A GitHub token is set for git and gh far more often than for a model: it is never offered as a model key. */
    const keyEnv = p.env.find((k) => !GENERAL_TOKENS.has(k) && (env[k] ?? '').trim() !== '');
    if (keyEnv) out.push({ id: p.id, name: p.name, keyEnv });
  }
  return out;
}
