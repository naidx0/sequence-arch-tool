/**
 * Context windows of hosted models, for sizing how much prior chat a turn may carry.
 *
 * Mirrors `packages/web2/src/chat/publishedContextWindow.ts` (the ring's
 * denominator): vendor-published lengths, never guesses. An unknown model
 * returns null and the caller uses {@link UNKNOWN_HOSTED_WINDOW}, deliberately
 * the smallest window any listed hosted model has, so an unlisted model is
 * under-filled rather than overrun.
 */

const PUBLISHED: { match: RegExp; tokens: number }[] = [
  { match: /claude-(opus|sonnet|haiku)-[45]|claude-3/i, tokens: 200_000 },
  { match: /gpt-5/i, tokens: 400_000 },
  { match: /gpt-4\.1/i, tokens: 1_000_000 },
  { match: /gpt-4o|o3|o4-mini|gpt-4-turbo|gpt-4-1106|gpt-4-0125/i, tokens: 128_000 },
  { match: /gemini-(2|1\.5|3)/i, tokens: 1_000_000 },
  { match: /deepseek/i, tokens: 128_000 },
];

/** The window to assume for a hosted model not in the table. */
export const UNKNOWN_HOSTED_WINDOW = 128_000;

/** The published window for a model id, or null when it is not listed. */
export function hostedContextWindow(model: string | null | undefined): number | null {
  const id = model?.trim();
  if (!id) return null;
  for (const row of PUBLISHED) if (row.match.test(id)) return row.tokens;
  return null;
}
