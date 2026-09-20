/**
 * ADR-013 Phase B — versioned, cache-friendly prompt envelope.
 *
 * Stable prefix (deterministic order, normalized whitespace, versioned hashes):
 *   1. Sequence policy + response contract
 *   2. Tool schemas (sorted) + grounded architecture snapshot (content-addressed)
 *   3. Compacted prior-session state
 *
 * Volatile suffix (never hashed into the stable prefix):
 *   4. Recent turns + current request
 *   5. Volatile metadata (dates / request IDs allowed here only)
 */

import { createHash } from 'node:crypto';

export const PROMPT_ENVELOPE_VERSION = 1;

export interface PromptEnvelopeSections {
  /** Sequence policy and response contract (stable). */
  policy: string;
  /** Tool JSON schemas — sorted deterministically before assembly (stable). */
  toolSchemas?: string[];
  /** Grounded architecture snapshot body (stable; hashed for diagnostics). */
  snapshotContent?: string;
  /** Compacted prior-session state (stable when present). */
  compactedState?: string;
  /** Recent dialog turns (volatile). */
  recentTurns?: string[];
  /** Current user request (volatile). */
  currentRequest: string;
  /** Volatile metadata — dates and request IDs belong here, not in the stable prefix. */
  volatileMetadata?: Record<string, string>;
}

/** Secret-free cache-key diagnostics for the envelope (ADR-013 §3). */
export interface PromptEnvelopeDiagnostics {
  version: number;
  stablePrefixHash: string;
  snapshotHash?: string;
  stablePrefixChars: number;
  volatileSuffixChars: number;
}

/** Normalize whitespace for deterministic stable-prefix assembly. */
export function normalizeEnvelopeText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
}

function hashUtf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Content-addressed hash of a grounded snapshot body. */
export function computeSnapshotHash(content: string): string {
  return hashUtf8(normalizeEnvelopeText(content));
}

/** Build the stable prefix only — excludes volatile suffix sections. */
export function buildStablePrefix(
  sections: Pick<PromptEnvelopeSections, 'policy' | 'toolSchemas' | 'snapshotContent' | 'compactedState'>,
): string {
  const parts: string[] = [];
  parts.push(`@seq-envelope v${PROMPT_ENVELOPE_VERSION}`);
  parts.push('--- POLICY ---');
  parts.push(normalizeEnvelopeText(sections.policy));
  if (sections.toolSchemas && sections.toolSchemas.length > 0) {
    parts.push('--- TOOL SCHEMAS ---');
    const sorted = [...sections.toolSchemas].map(normalizeEnvelopeText).sort();
    for (const s of sorted) parts.push(s);
  }
  if (sections.snapshotContent) {
    const snapHash = computeSnapshotHash(sections.snapshotContent);
    parts.push('--- GROUNDED SNAPSHOT ---');
    parts.push(`hash:${snapHash}`);
    parts.push(normalizeEnvelopeText(sections.snapshotContent));
  }
  if (sections.compactedState) {
    parts.push('--- COMPACTED STATE ---');
    parts.push(normalizeEnvelopeText(sections.compactedState));
  }
  return parts.join('\n');
}

/** Build the volatile suffix — recent turns, current request, metadata. */
export function buildVolatileSuffix(
  sections: Pick<PromptEnvelopeSections, 'recentTurns' | 'currentRequest' | 'volatileMetadata'>,
): string {
  const parts: string[] = [];
  if (sections.recentTurns && sections.recentTurns.length > 0) {
    parts.push('--- RECENT TURNS ---');
    for (const t of sections.recentTurns) parts.push(normalizeEnvelopeText(t));
  }
  parts.push('--- CURRENT REQUEST ---');
  parts.push(normalizeEnvelopeText(sections.currentRequest));
  if (sections.volatileMetadata && Object.keys(sections.volatileMetadata).length > 0) {
    parts.push('--- METADATA ---');
    const keys = Object.keys(sections.volatileMetadata).sort();
    for (const k of keys) parts.push(`${k}:${sections.volatileMetadata[k]}`);
  }
  return parts.join('\n');
}

/** Hash of the stable prefix — cache-key diagnostic; volatile suffix excluded. */
export function stablePrefixHash(
  sections: Pick<PromptEnvelopeSections, 'policy' | 'toolSchemas' | 'snapshotContent' | 'compactedState'>,
): string {
  return hashUtf8(buildStablePrefix(sections));
}

/** Assemble the full prompt and return secret-free envelope diagnostics. */
export function assemblePromptEnvelope(sections: PromptEnvelopeSections): {
  prompt: string;
  diagnostics: PromptEnvelopeDiagnostics;
} {
  const stable = buildStablePrefix(sections);
  const volatile = buildVolatileSuffix(sections);
  const prompt = stable + '\n\n' + volatile;
  const diagnostics: PromptEnvelopeDiagnostics = {
    version: PROMPT_ENVELOPE_VERSION,
    stablePrefixHash: hashUtf8(stable),
    snapshotHash: sections.snapshotContent ? computeSnapshotHash(sections.snapshotContent) : undefined,
    stablePrefixChars: stable.length,
    volatileSuffixChars: volatile.length,
  };
  return { prompt, diagnostics };
}
