/**
 * FIRST-GLANCE ENGLISH — what earns the one subtitle line on a board card.
 *
 * Owner (2026-08-25): at first glance the card should read via icon, shape,
 * and clear English — not a path dump, inventory list, or second echo of the
 * name. Detail (paths, parts, provenance) waits for select / expand.
 *
 * Pure. Used by `boardNodeFrom` and by the card when choosing between a scan
 * subtitle and an `/api/annotate` line.
 */

/** Path / inventory / line-count dumps — useful later, not at first glance. */
export function isGlanceNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  /* `frontend/src/App.tsx (ts, 728 lines)` */
  if (/[/\\].*\(\s*\w+\s*,?\s*\d+\s*lines?\s*\)/i.test(t)) return true;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php)(\s|$|\()/i.test(t) && /[/\\]/.test(t)) {
    return true;
  }
  /* `lib · build · types · 2 more` */
  if ((t.match(/·/g) ?? []).length >= 2) return true;
  /* `18 ts files in frontend, defining …` — inventory, not a role */
  if (/^\d+\s+\w+\s+files?\b/i.test(t)) return true;
  return false;
}

/**
 * WHERE A GLANCE LINE CAME FROM — `scan` was read, `ai` was written.
 *
 * `scan` is the analyzer's own derived summary: `whatItDoes`, computed off the
 * structural tree, traceable to files it counted. `ai` is a bullet from
 * `/api/annotate`, and the server validates only that its KEY is a node id the
 * request asked about — the STRING is trimmed, length-capped and never checked
 * against any evidence. The prompt asks the model not to invent; nothing
 * enforces it.
 *
 * The two therefore carry different warrants, and this type is what makes the
 * difference survive the trip to the card. Before it, the ONE English sentence
 * a reader actually reads on every card was model prose rendered in the same
 * ink, in the same slot, as the analyzer's own — on the product whose first
 * non-negotiable is grounded, not guessed.
 */
export type GlanceSource = 'scan' | 'ai';

export interface Glance {
  text: string;
  source: GlanceSource;
}

/**
 * One short English line for the card AND where it came from, or null.
 * Prefers annotate English over scan subtitle; drops glance noise either way.
 *
 * ONE FUNCTION, so the text and its provenance cannot be computed by two rules
 * that agree today. `glanceLine` below is this function with the source thrown
 * away, kept because `cardBox` asks only "is there a line" — a question about
 * height, which the source does not change.
 */
export function glanceWithSource(
  subtitle: string | null | undefined,
  annotation: string | null | undefined,
): Glance | null {
  const annotate = annotation?.trim() || null;
  if (annotate && !isGlanceNoise(annotate)) return { text: annotate, source: 'ai' };
  const sub = subtitle?.trim() || null;
  if (sub && !isGlanceNoise(sub)) return { text: sub, source: 'scan' };
  return null;
}

export function glanceLine(
  subtitle: string | null | undefined,
  annotation: string | null | undefined,
): string | null {
  return glanceWithSource(subtitle, annotation)?.text ?? null;
}
