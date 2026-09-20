/**
 * Published context windows for known model ids.
 *
 * CANON law 4 forbids inventing a ceiling. These numbers are the vendors'
 * published context lengths for the named models — not guesses. Unknown
 * models return null and the ring stays absent.
 */

const PUBLISHED: { match: RegExp; tokens: number }[] = [
  { match: /claude-(opus|sonnet|haiku)-4/i, tokens: 200_000 },
  { match: /claude-3-5-sonnet|claude-3\.5-sonnet/i, tokens: 200_000 },
  { match: /claude-3-opus|claude-3-sonnet|claude-3-haiku/i, tokens: 200_000 },
  { match: /gpt-4o|gpt-4\.1|o3|o4-mini/i, tokens: 128_000 },
  { match: /gpt-4-turbo|gpt-4-1106|gpt-4-0125/i, tokens: 128_000 },
  { match: /gemini-2\.5|gemini-2\.0|gemini-1\.5/i, tokens: 1_000_000 },
  /* OpenRouter deepseek — probe only works on loopback; publish vendor ceiling. */
  { match: /deepseek/i, tokens: 128_000 },
];

/** Resolve a published window for a model id, or null when unknown. */
export function publishedContextWindow(model: string | null | undefined): number | null {
  const id = model?.trim();
  if (!id) return null;
  for (const row of PUBLISHED) {
    if (row.match.test(id)) return row.tokens;
  }
  return null;
}
