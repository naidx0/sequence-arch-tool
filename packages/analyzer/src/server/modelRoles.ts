/**
 * Model roles (MADR `docs/decisions/model-roles.md`). Sequence splits intent into
 * roles — `advisor` (frontier read-only reviewer), `vision` (image turns), `plan`
 * (work-mode structuring) — each optionally bound to its own model / host / key so
 * a local default can pair with an OpenRouter advisor. Roles are ADDITIVE: no
 * binding ⇒ chat and board still work (local-first stays intact).
 *
 * Key hygiene: a role binding MAY carry its own `apiKey`. It is stored verbatim
 * (mirroring the top-level `AiConfig.apiKey`) and is redacted by
 * {@link redactAiConfig} to `••••`+last4 — never returned raw. Errors raised here
 * NEVER echo a key.
 *
 * Cycle note: this module imports ONLY types (`ProviderKind`, `AiConfig`) from
 * `./provider.js` — type-only imports are erased at runtime, so there is no
 * runtime cycle even though `provider.js` imports {@link parseAiRoles} from here.
 */
import type { AiConfig, ProviderKind } from './provider.js';

/** The three role ids a binding may target (default/worker is NOT a role). */
export type AiRoleId = 'advisor' | 'vision' | 'plan';

/** A per-role binding. Every field is OPTIONAL — missing fields inherit default. */
export interface AiRoleBinding {
  model: string;
  provider?: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
}

/** Parsed role map; `error` is caller-safe and never contains a key. */
export interface ParsedAiRoles {
  roles?: Partial<Record<AiRoleId, AiRoleBinding>>;
  error?: string;
}

const KNOWN_ROLES: readonly AiRoleId[] = ['advisor', 'vision', 'plan'];

/**
 * Parse a raw `roles` object from a candidate AI config. Unknown keys are
 * ignored; a role with an empty model is skipped (treated as absent); a role
 * whose `model` is not a string is an error. Errors never echo the key.
 */
export function parseAiRoles(raw: unknown): ParsedAiRoles {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object') {
    return { error: 'roles must be a JSON object when present' };
  }
  const o = raw as Record<string, unknown>;
  const roles: Partial<Record<AiRoleId, AiRoleBinding>> = {};
  for (const key of Object.keys(o)) {
    if (!KNOWN_ROLES.includes(key as AiRoleId)) continue; // unknown keys ignored
    const val = o[key];
    if (!val || typeof val !== 'object') {
      return { error: `roles.${key} must be a JSON object` };
    }
    const b = val as Record<string, unknown>;
    if (typeof b.model !== 'string' || b.model.trim() === '') {
      // empty model → skip this role entirely (treated as absent)
      continue;
    }
    const binding: AiRoleBinding = { model: b.model.trim() };
    if (b.provider !== undefined) {
      if (b.provider !== 'anthropic' && b.provider !== 'openai-compatible') {
        return { error: `roles.${key}.provider must be 'anthropic' or 'openai-compatible'` };
      }
      binding.provider = b.provider;
    }
    if (b.baseUrl !== undefined) {
      if (typeof b.baseUrl !== 'string') {
        return { error: `roles.${key}.baseUrl must be a string when present` };
      }
      const baseUrl = b.baseUrl.trim();
      if (baseUrl !== '') binding.baseUrl = baseUrl;
    }
    if (b.apiKey !== undefined) {
      if (typeof b.apiKey !== 'string' || b.apiKey.trim() === '') {
        return { error: `roles.${key}.apiKey must be a non-empty string when present` };
      }
      binding.apiKey = b.apiKey;
    }
    roles[key as AiRoleId] = binding;
  }
  return Object.keys(roles).length > 0 ? { roles } : {};
}

/**
 * Resolve a role binding onto a base {@link AiConfig}, producing the config the
 * role's calls should use. Missing fields inherit from `cfg`; `roles` is stripped
 * from the result so a resolved config never re-enters role resolution.
 *
 * Returns `null` when the role is unbound OR the merged config is unusable —
 * specifically an `openai-compatible` provider with no `baseUrl` after merge
 * (a role that switched to openai-compatible without supplying a host cannot
 * be called).
 */
export function resolveRoleConfig(cfg: AiConfig, role: AiRoleId): AiConfig | null {
  const binding = cfg.roles?.[role];
  if (!binding) return null;
  const provider: ProviderKind = binding.provider ?? cfg.provider;
  const model = binding.model;
  const baseUrl = binding.baseUrl ?? cfg.baseUrl;
  const apiKey = binding.apiKey ?? cfg.apiKey;
  // openai-compatible without a baseUrl after merge is unusable.
  if (provider === 'openai-compatible' && (!baseUrl || baseUrl.trim() === '')) {
    return null;
  }
  const out: AiConfig = { provider, model };
  if (cfg.mode !== undefined) out.mode = cfg.mode;
  if (cfg.gatewayLive !== undefined) out.gatewayLive = cfg.gatewayLive;
  if (baseUrl) out.baseUrl = baseUrl;
  if (apiKey !== undefined) out.apiKey = apiKey;
  return out;
}

/**
 * True only when an `advisor` binding resolves AND its (model, provider, baseUrl)
 * differs from the default config — a same-model+host advisor would just echo
 * the worker, so we skip it (MADR honesty: "Same model+host as default ⇒ skip").
 */
export function shouldConsultAdvisor(cfg: AiConfig): boolean {
  const advisor = resolveRoleConfig(cfg, 'advisor');
  if (!advisor) return false;
  const sameModel = advisor.model === cfg.model;
  const sameProvider = advisor.provider === cfg.provider;
  const advisorBase = advisor.baseUrl;
  const cfgBase = cfg.baseUrl;
  const sameBase = (advisorBase ?? '') === (cfgBase ?? '');
  // All three equal ⇒ same endpoint ⇒ would echo ⇒ skip.
  return !(sameModel && sameProvider && sameBase);
}

/** Severity of an advisor note (MADR: aside / concern / blocker). */
export type AdvisorSeverity = 'aside' | 'concern' | 'blocker';

/** A single advisor note. `note` is capped at 280 chars. */
export interface AdvisorNote {
  severity: AdvisorSeverity;
  note: string;
}

const ADVISOR_NOTE_MAX = 280;
const ADVISOR_WORKER_MAX = 4000;

/** Marker string tests can match to confirm the advisor prompt was built here. */
export const ADVISOR_ROLE_PROMPT_MARKER = 'sequence-advisor-role';

/**
 * Build the tiny JSON-only advisor prompt. The advisor READS the worker's text
 * and returns a single `{severity, note}` object — it never edits. The worker
 * text is truncated to {@link ADVISOR_WORKER_MAX} chars so a long worker turn
 * cannot balloon the advisor's read cost.
 */
export function buildAdvisorPrompt(question: string, workerText: string): string {
  const trimmedQuestion = (question ?? '').trim();
  const trimmedWorker = (workerText ?? '').slice(0, ADVISOR_WORKER_MAX);
  return [
    `You are a code review advisor (${ADVISOR_ROLE_PROMPT_MARKER}).`,
    'You READ a worker model\'s draft answer to a user question about a codebase.',
    'You DO NOT rewrite the answer. You return ONE short JSON object judging the draft.',
    '',
    'Return ONLY a single JSON object — no prose, no markdown fences — with this exact shape:',
    '{"severity": "aside" | "concern" | "blocker", "note": "<<= 280 char review note>"}',
    '  - aside: a minor stylistic suggestion.',
    '  - concern: a real risk the worker should address.',
    '  - blocker: the draft is wrong or unsafe and must not ship as-is.',
    '',
    '--- USER QUESTION ---',
    trimmedQuestion,
    '',
    '--- WORKER DRAFT (truncated) ---',
    trimmedWorker,
  ].join('\n');
}

function isSeverity(v: unknown): v is AdvisorSeverity {
  return v === 'aside' || v === 'concern' || v === 'blocker';
}

/**
 * Parse the advisor's reply into an {@link AdvisorNote}. Accepts a bare JSON
 * object (optionally wrapped in markdown fences). On ANY parse failure falls
 * back to an `aside` carrying a truncated copy of the raw text — it NEVER
 * throws, so the ask pipeline can attach a non-fatal note instead of failing.
 */
export function parseAdvisorReply(text: string): AdvisorNote {
  const raw = (text ?? '').trim();
  try {
    // Tolerate ```json fences by extracting the first balanced object.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const obj = JSON.parse(slice) as { severity?: unknown; note?: unknown };
    const severity: AdvisorSeverity = isSeverity(obj.severity) ? obj.severity : 'aside';
    const note = typeof obj.note === 'string' ? obj.note : '';
    return { severity, note: note.slice(0, ADVISOR_NOTE_MAX) };
  } catch {
    return { severity: 'aside', note: raw.slice(0, ADVISOR_NOTE_MAX) };
  }
}
