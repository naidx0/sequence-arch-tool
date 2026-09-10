/**
 * Provider / metering / generation — the provider, metering and generation routes
 * in `server/repoServer.ts`.
 *
 * KEY HYGIENE IS PART OF THE CONTRACT: the full API key is written by `PUT
 * /api/ai-config` and never comes back. Every GET answers with the redacted view
 * (`provider.ts:444-455`), and `apiKey` on a response is a `••••`+last4 MASK, not
 * a credential.
 */

import type { ArchGraph, PlainKind } from '@sequence/schema';
import type { GraphSummary } from './attach.js';

/* --------------------------- /api/ai-config — :2330 ----------------------- */

export type ProviderKind = 'anthropic' | 'openai-compatible';

/** Absent `mode` means `'api-key'` — a mode-less config is the pre-v9 shape. */
export type AiMode = 'api-key' | 'default';

export type AiRoleId = 'advisor' | 'vision' | 'plan';

/** A per-role model binding (MADR model-roles). Missing fields inherit the worker's. */
export interface AiRoleBinding {
  model: string;
  provider?: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * The knobs around the model. EVERY FIELD IS OPTIONAL AND OMITTED WHEN UNSET —
 * several openai-compatible servers reject unexpected request fields with a 400,
 * so a config with no `params` puts byte-identical bytes on the wire to the
 * build before knobs existed. `maxRetries` defaults to 0.
 */
export interface AiParams {
  /** 0-2. */
  temperature?: number;
  /** 0-1. */
  topP?: number;
  /** 1-1,000,000. On the anthropic wire this replaces the hardcoded 8192. */
  maxTokens?: number;
  /** 1,000-3,600,000. ABSENT means no deadline — a stalled call hangs. */
  timeoutMs?: number;
  /** 0-5. Only ever taken when NOT ONE delta has reached the caller. */
  maxRetries?: number;
}

/**
 * ONE SAVED MODEL. The single-config shape plus a stable `id` and a name a human
 * chose. The ACTIVE profile (`defaultProfileId`) is resolved into the flat
 * fields of {@link AiConfigApiKeyModeResponse}, so a reader that only knows the
 * old shape still sees who answers.
 */
export interface AiProfileView {
  id: string;
  name: string;
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  /** `••••`+last4 on a response; the FULL key on a request. Absent = keyless loopback. */
  apiKey?: string;
  params?: AiParams;
}

/**
 * What a client SENDS. `apiKey` is required for remote direct providers,
 * absent for a keyless loopback OpenAI-compatible provider, and absent for
 * `'default'` mode. `baseUrl` is required for `openai-compatible`.
 *
 * `profiles` is the saved-model list. When it is present the flat fields are
 * ignored — the list is the file's meaning — and a profile sent WITHOUT an
 * `apiKey` keeps the key already stored under that id, exactly as an empty key
 * box has always meant "leave the stored key alone".
 */
export interface AiConfigRequest {
  mode?: AiMode;
  provider: ProviderKind;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  roles?: Partial<Record<AiRoleId, AiRoleBinding>>;
  params?: AiParams;
  profiles?: AiProfileView[];
  defaultProfileId?: string;
}

/**
 * SWITCH WHICH SAVED MODEL ANSWERS — the whole body, and deliberately so.
 *
 * A picker only ever holds MASKED keys, so a switch expressed as "PUT the whole
 * list back" would write `••••9f3a` over a working credential. One field in,
 * one field changed, every key untouched on disk.
 */
export interface AiConfigSelectRequest {
  selectProfileId: string;
}

/**
 * Prefill hints when `OPENROUTER_*` / `SEQUENCE_AI_*` env is set but the config
 * file is not. Names the ENV VAR that holds the key — never the key value.
 */
export interface AiEnvPrefill {
  provider: ProviderKind;
  baseUrl?: string;
  model: string;
  keyEnv: string;
}

export interface AiConfigNotConfiguredResponse {
  configured: false;
  envPrefill?: AiEnvPrefill;
}

/**
 * Default (hosted free-tier) mode redacts to four fields with NO key field at all
 * — there is no user key to mask. `gatewayLive` is a BOOLEAN ONLY: never the
 * funded key, never the gateway URL.
 */
export interface AiConfigDefaultModeResponse {
  configured: true;
  mode: 'default';
  model: string;
  gatewayLive: boolean;
}

/** Direct-provider mode. `apiKey`, when present, is a mask and never the real key. */
export interface AiConfigApiKeyModeResponse {
  configured: true;
  provider: ProviderKind;
  baseUrl?: string;
  model: string;
  /** Absent for keyless loopback; otherwise `••••`+last4. */
  apiKey?: string;
  roles?: Partial<Record<AiRoleId, AiRoleBinding>>;
  /**
   * How many tokens this model's window holds, when the provider will say.
   *
   * ABSENT MEANS UNKNOWN, and the surface must render that as silence rather
   * than as a default. Only Ollama reports it (`/api/show` carries the real
   * `<arch>.context_length` the model was built with); no OpenAI-compatible
   * route exposes it, so every other provider leaves this out. A meter drawn
   * against an invented ceiling would be the confident wrong number this
   * product exists to catch elsewhere.
   */
  contextWindow?: number;
  /** The knobs, verbatim. {@link AiParams} holds no secret, so none is masked. */
  params?: AiParams;
  /**
   * EVERY SAVED MODEL, keys masked.
   *
   * A config written before profiles existed is presented as the one-entry list
   * it is, so a picker never tells a reader they have no saved model when they
   * plainly do. Reading writes nothing.
   */
  profiles?: AiProfileView[];
  /** Which profile answers. Always one of {@link profiles} when that is present. */
  defaultProfileId?: string;
}

export type GetAiConfigRequest = void;

export type GetAiConfigResponse =
  | AiConfigNotConfiguredResponse
  | AiConfigDefaultModeResponse
  | AiConfigApiKeyModeResponse;

export type PutAiConfigRequest = AiConfigRequest;

/**
 * The PUT answers with the view a GET would give for what was just stored —
 * reloaded through `loadAiConfig` so the runtime `gatewayLive` stamp is applied.
 * It is therefore never the `configured:false` variant.
 */
export type PutAiConfigResponse = AiConfigDefaultModeResponse | AiConfigApiKeyModeResponse;

/**
 * `POST /api/ai-config` — does this model actually answer?
 *
 * Sends the real body a real ask sends (same wire, same headers, same knobs)
 * with a trivial prompt, under a deadline. Before it, the first evidence that a
 * model id was misspelled or a local server was down was a failed chat turn.
 */
export interface PostAiConfigTestRequest {
  /** Must be `true`. The literal is the whole request, not a flag to branch on. */
  test: true;
  /** Probe a saved model other than the active one. Omitted ⇒ the active one. */
  profileId?: string;
}

/**
 * ALWAYS HTTP 200. A model that refused is a fact about the CONFIGURATION, not a
 * server fault, so the failure arrives as `ok:false` carrying the provider's own
 * message beside the model it names.
 */
export interface PostAiConfigTestResponse {
  ok: boolean;
  model: string;
  /** Wall time of the probe. */
  ms: number;
  /** First ~120 characters of the answer, when it answered. */
  sample?: string;
  /** The provider's own words, when it did not. */
  error?: string;
}

/* ----------------------------- GET /api/usage — :2398 --------------------- */

export type GetUsageRequest = void;

/**
 * User-level, no repo required. The soft cap NEVER hard-blocks here — it is
 * surfaced as `softCapped` only. api-key mode is not metered but still reports the
 * (zeroed) meter.
 */
export interface GetUsageResponse {
  usedThisMonth: number;
  allotment: number;
  softCapped: boolean;
}

/* --------------------- generate / prompt-file — :2936, :3065 -------------- */

/**
 * The human's answer to "may this replace files that already have content?".
 * `true` = all · a string array = exactly those repo-relative paths ·
 * OMITTED MEANS NO. Anything else is a 400, deliberately: a consent flag we half
 * understand is the one field that must never be guessed at.
 */
export type OverwriteConsent = boolean | string[];

export interface PostGenerateRequest {
  /** Extra instruction appended to the brief-derived prompt. */
  prompt?: string;
  /** Use this design instead of the stored `.sequence/spec.json`. */
  specOverride?: ArchGraph;
  /** Node ids to carve a coherent sub-spec from. Must be an array of strings. */
  scope?: string[];
  overwrite?: OverwriteConsent;
}

/** `diffGraphs` (`diff.ts:217`) — service-level conformance against the spec. */
export interface ConformanceDiff {
  added: string[];
  removed: string[];
  mismatched: string[];
  markdown: string;
}

/**
 * The 200 body. `scan` is the post-write rescan's {@link GraphSummary}. `diff` is
 * `null` when there was no spec to measure against. `diffScope` says WHICH
 * baseline was measured, so the report cannot quietly change meaning.
 * `droppedEdges` appears only on a scoped generate that cut boundary edges.
 */
export interface PostGenerateResponse {
  written: string[];
  scan: GraphSummary;
  diff: ConformanceDiff | null;
  diffScope: 'scoped' | 'full';
  notes?: string;
  droppedEdges?: string[];
}

/** **422** — the model returned paths outside the jail; nothing was written. */
export interface PostGenerateUnsafePathsError {
  error: string;
  rejected: string[];
}

/**
 * **409** — the no-silent-data-loss gate. Nothing was written, and every file that
 * WOULD have been replaced is named so the answer is actionable.
 */
export interface PostGenerateOverwriteRefusedError {
  error: string;
  wouldOverwrite: string[];
}

/** **422** — the spec failed `validateGraph` or `checkScaffoldability`, before any provider call. */
export interface PostGenerateSpecRejectedError {
  error: string;
  problems: string[];
  droppedEdges: string[];
}

export interface PostPromptFileRequest {
  /** The one file the human pointed at. Pointing at it IS consent to rewrite it. */
  path: string;
  prompt: string;
  overwrite?: OverwriteConsent;
}

/** Identical body to `/api/generate` — both go through the same `generateAndApply`. */
export type PostPromptFileResponse = PostGenerateResponse;

/* ------------------------ POST /api/design-suggest — :2887 ---------------- */

/**
 * Design INTENT, not a detection claim: these describe things that do not exist
 * yet. No ids and no `sourceRefs` — the client materialises them into the `d:`
 * designed-node namespace with EMPTY sourceRefs.
 */
export interface DesignSuggestNode {
  title: string;
  kind: PlainKind;
  children?: DesignSuggestNode[];
}

/** Works with NO repo attached — that is the point of the route. */
export interface PostDesignSuggestRequest {
  description: string;
  parentTitle?: string;
  repoName?: string;
}

export interface PostDesignSuggestResponse {
  nodes: DesignSuggestNode[];
  /** Always `true`. The literal is the honesty marker, not a flag to branch on. */
  proposed: true;
}

/* --------------------------- POST /api/research — :1771 ------------------- */

export interface PostResearchRequest {
  query: string;
  /** Explicit URLs. Omitted ⇒ URLs are extracted from the query, else searched for. */
  urls?: string[];
}

/** One source. `ok:false` with an `error` means it was NOT fetched — and is cited as such. */
export interface LiveResearchCitation {
  url: string;
  ok: boolean;
  title?: string;
  error?: string;
}

/**
 * A durable brief that cites ONLY what was actually fetched. `path` is a PROPOSED
 * repo-relative destination under `.sequence/decisions/`, derived from the title —
 * this route writes nothing, so a caller that wants the brief on disk has to save
 * it (`PUT /api/file` refuses `.sequence/` except for decision-record paths).
 */
export interface PostResearchResponse {
  title: string;
  path: string;
  markdown: string;
  citations: LiveResearchCitation[];
  /** Short assistant bubble text. */
  text: string;
}
