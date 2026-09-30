/* ══════════════════════════════════════════════════════════════════════════
   WHERE THE MODEL RUNS — the six answers, and what each one costs
   packages/web2/src/settings/providerPresets.ts

   Max, 2026-09-18: "make sure Settings is a proper setup for everyone's local
   setup — local models, easy to set up new models with API keys, see if they
   can open or add their OpenAI subscription."

   THE FORM ASKED FOR A WIRE AND THE READER HAS A PRODUCT. Before this, adding
   a model meant knowing that "OpenRouter" is spelled `openai-compatible`, that
   its base is `https://openrouter.ai/api/v1`, that Ollama's is
   `http://127.0.0.1:11434/v1`, and that Anthropic's must NOT carry `/v1`
   because `resolveEndpoint` appends `/v1/messages` itself
   (analyzer/src/server/provider.ts:1871-1881). Four facts, none of them on
   screen, and getting any one wrong produces an HTTP 404 several screens later
   — which is the shape of failure this product exists to catch.

   A PRESET IS A PREFILL, NEVER A LOCK. Every field it fills stays editable and
   the server remains the authority: `validateAiConfig` refuses what it refuses
   whatever this file says. Nothing here widens what the server accepts, and
   `provider` is typed as {@link ProviderKind} so a preset naming a wire the
   analyzer does not have is a COMPILE ERROR rather than a runtime 400 a reader
   discovers for us. That is the same lock `PROVIDERS` in `SettingsPanel` put on
   the old dropdown, for the same reason.

   ONLY TWO WIRES EXIST. `anthropic` and `openai-compatible` — the analyzer
   accepts nothing else. Six presets over two wires is not six providers: it is
   six ADDRESSES a reader recognises, four of which resolve to the same wire.
   Saying so here is what stops a seventh card being added for a service that
   would need server work nobody has done.

   PURE. Ids and probe results in, plain data out. No React, no fetch, no state.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ProviderKind } from '@sequence/api-types';

/** The six cards, by id. `other` is the escape hatch, not a service. */
export type PresetId = 'ollama' | 'lm-studio' | 'openai' | 'anthropic' | 'openrouter' | 'other';

export interface ProviderPreset {
  id: PresetId;
  /** What the reader calls it. */
  label: string;
  /** The wire the analyzer will actually speak. */
  provider: ProviderKind;
  /** Prefilled into the Base URL box. Empty ⇒ the reader supplies it. */
  baseUrl: string;
  /** Runs on this machine: no key, nothing leaves the computer, and a daemon we can ask. */
  local: boolean;
  /**
   * Whether the key box is shown at all.
   *
   * FALSE IS A CLAIM ABOUT THE SERVER, not a convenience. `parseDirectAiFields`
   * accepts a keyless config ONLY for an `openai-compatible` baseUrl on
   * loopback (provider.ts:621-641); every other preset here would be refused
   * without one, so hiding the box anywhere else would hide the reason a save
   * failed.
   */
  needsKey: boolean;
  /** Where a person gets one. Present exactly where {@link needsKey} is true. */
  keyUrl?: string;
  /** The name `detectLocalProviders` reports for this daemon. Local presets only. */
  probeName?: string;
  /** What a model id looks like here — the box is otherwise a guess. */
  modelPlaceholder: string;
  /** One line, shown when the card is chosen. */
  note: string;
}

/**
 * THE ONE QUESTION EVERY READER ASKS, ANSWERED BEFORE THEY ASK IT.
 *
 * There is no public API for a ChatGPT Plus/Pro account. The sign-in Codex CLI
 * performs is OpenAI's own first-party client flow and is not something a third
 * party may implement; an OAuth button here would either be a lie or a
 * violation. So the panel says the true thing in one muted line instead, and
 * this constant is exported so the test asserts the SENTENCE rather than a
 * paraphrase that could drift into implying a subscription works.
 */
export const OPENAI_SUBSCRIPTION_NOTE =
  'Uses an API key (platform.openai.com), billed by usage — a ChatGPT subscription cannot sign in here.';

/**
 * Local first, deliberately.
 *
 * CLAUDE.md's second non-negotiable is that the app delivers its core with no
 * network and no key, and the engine honours it. A row of cards that opened
 * with OpenAI would put a bill in front of a capability already running on the
 * reader's machine.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    local: true,
    needsKey: false,
    probeName: 'Ollama',
    modelPlaceholder: 'granite4-hermes:latest',
    note: 'Runs on this machine. No key, no bill, and nothing leaves your computer.',
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    local: true,
    needsKey: false,
    probeName: 'LM Studio',
    modelPlaceholder: 'qwen3-8b',
    note: 'Runs on this machine. Start its local server from LM Studio’s Developer tab.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    local: false,
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    modelPlaceholder: 'gpt-4.1-mini',
    note: OPENAI_SUBSCRIPTION_NOTE,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    provider: 'anthropic',
    /*
     * NO `/v1`, AND THAT IS NOT AN OVERSIGHT. `resolveEndpoint` builds
     * `${base}/v1/messages` for this wire (provider.ts:1872-1876), so a base
     * ending in `/v1` becomes `/v1/v1/messages` and 404s. The other five
     * presets go through `openaiCompatChatUrl`, which joins without doubling —
     * the two rules differ, so the two bases differ.
     */
    baseUrl: 'https://api.anthropic.com',
    local: false,
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    modelPlaceholder: 'claude-sonnet-4-5',
    note: 'Claude on Anthropic’s own wire — tools and streaming included. Billed by usage.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    local: false,
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    modelPlaceholder: 'deepseek/deepseek-v4-flash',
    note: 'One key, many models. Model ids are namespaced — `vendor/model`, not a bare name.',
  },
  {
    id: 'other',
    label: 'Other OpenAI-compatible',
    provider: 'openai-compatible',
    /* EMPTY IS THE POINT: vLLM, llama.cpp, Together, DeepSeek, a colleague's
       box. Inventing a default here would put somebody else's host in the field
       of a person who came to type their own. */
    baseUrl: '',
    local: false,
    needsKey: true,
    modelPlaceholder: 'the id that server uses',
    note: 'Any server that speaks the OpenAI chat-completions wire. A key is required unless the address is loopback.',
  },
];

/**
 * MODELS THAT THINK BEFORE THEY ANSWER, BY DEFAULT.
 *
 * Measured on Ollama 0.33.2, 2026-09-18: these families answer
 * `/v1/chat/completions` with `content: ""` and the whole reply on `reasoning`,
 * and `finish_reason: length` once max_tokens is spent thinking. One real turn
 * — 6,746 tokens in, 0 out, 27 seconds — reached the reader as "I did not
 * produce an answer".
 *
 * A NOTE ON A ROW, NEVER A REFUSAL. The analyzer now retries such a turn once
 * with `reasoning_effort: none` and answers (measured: 35 tokens,
 * finish_reason stop), so the model WORKS — this only tells a reader why their
 * first question took two round trips, before they conclude the model is
 * broken. A family list cannot be complete and does not need to be: a model it
 * misses is handled by the retry exactly as one it names.
 */
const THINKS_BY_DEFAULT = /qwen3|deepseek|r1|gpt-oss|magistral/i;

/** Does this model id name a family that reasons unless told not to? */
export function thinksByDefault(model: unknown): boolean {
  return typeof model === 'string' && THINKS_BY_DEFAULT.test(model);
}

/** The card, or undefined for a string that names none. */
export function presetById(id: string | null | undefined): ProviderPreset | undefined {
  if (typeof id !== 'string') return undefined;
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * The four names one machine answers to.
 *
 * Copied in meaning from `LOOPBACK_HOSTS` in
 * analyzer/src/server/localProviders.ts:381 — not imported, because that module
 * is server-only and this one runs in the browser.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * `host:port` for a base URL, with every loopback spelling collapsed to one —
 * or null when it is not a URL.
 *
 * WHY THIS IS NOT `URL.origin`. The first cut returned `parsed.origin`, and the
 * test caught it: `http://localhost:11434` and `http://127.0.0.1:11434` are ONE
 * machine and two origins, so a reader who typed the single most natural thing
 * got the `Other` chip and a key box for a daemon on their own laptop. That is
 * exactly the failure `matchLocalOllama` records at
 * analyzer/src/server/localProviders.ts:365-379, where comparing the literal
 * turned a whole context planner off with no signal anywhere.
 *
 * The SCHEME is dropped with it: `http` vs `https` on loopback is a choice
 * about a certificate, not about which daemon is listening.
 */
function originOf(url: string | undefined): string | null {
  const raw = (url ?? '').trim();
  if (raw === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port;
  if (LOOPBACK_HOSTS.has(host)) return `loopback:${port}`;
  return `${parsed.protocol}//${host}:${port}`;
}

/** One daemon as `GET /api/ai-config` reports it. */
export interface ProbedProvider {
  name: string;
  baseUrl: string;
  models: string[];
}

/**
 * Does this probe result belong to this card?
 *
 * By NAME first — that is what the server's own probe table says it is — and by
 * origin as the fallback, so a daemon reported under a name this file has not
 * heard of still lands on the right card when it answers at the right address.
 */
export function probeMatchesPreset(preset: ProviderPreset, probed: ProbedProvider): boolean {
  if (!preset.local) return false;
  const name = (probed.name ?? '').trim().toLowerCase();
  if (preset.probeName !== undefined && name === preset.probeName.toLowerCase()) return true;
  const want = originOf(preset.baseUrl);
  const got = originOf(probed.baseUrl);
  return want !== null && want === got;
}

/** Every daemon answering for this card, in the order the server reported them. */
export function probesForPreset(
  preset: ProviderPreset,
  probed: readonly ProbedProvider[],
): ProbedProvider[] {
  return probed.filter((entry) => probeMatchesPreset(preset, entry));
}

/**
 * WHICH CARD A SAVED MODEL CAME FROM — for the chip on its row.
 *
 * A best-effort READING, never a claim about how it was created: a profile
 * saved by hand before presets existed still reads `OpenRouter` when it points
 * at OpenRouter, because that is what it IS. The fallback names the wire rather
 * than guessing a product, which is the honest answer for a host nobody here
 * recognises.
 */
export function presetForProfile(
  provider: string | undefined,
  baseUrl: string | undefined,
): PresetId {
  if (provider === 'anthropic') return 'anthropic';
  const origin = originOf(baseUrl);
  if (origin !== null) {
    for (const p of PROVIDER_PRESETS) {
      if (p.id === 'other' || p.provider !== 'openai-compatible') continue;
      if (originOf(p.baseUrl) === origin) return p.id;
    }
  }
  return 'other';
}

/** What the chip on a saved-model row says. */
export function presetChipLabel(
  provider: string | undefined,
  baseUrl: string | undefined,
): string {
  const id = presetForProfile(provider, baseUrl);
  if (id === 'other') return 'OpenAI-compatible';
  return presetById(id)?.label ?? 'OpenAI-compatible';
}

/**
 * Is the key box shown?
 *
 * No card chosen means the reader is editing by hand or looking at what is
 * already stored, and the box has always been there — hiding it on a state this
 * file knows nothing about would remove a control nobody asked to remove.
 */
export function keyFieldVisible(preset: ProviderPreset | undefined): boolean {
  return preset === undefined ? true : preset.needsKey;
}
