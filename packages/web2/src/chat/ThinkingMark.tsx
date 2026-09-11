/**
 * INLINE REASONING GLYPH — braille orbit in the tool-row icon slot (14px).
 * Owner pick (2026-08-27): fusion option 1 — braille on reasoning row only;
 * file/search rows keep kind glyph + glimmer, no second spinner.
 */

export interface ReasoningGlyphProps {
  /** When false, render nothing. */
  active?: boolean;
}

export function ReasoningGlyph({ active = true }: ReasoningGlyphProps) {
  if (!active) return null;

  return (
    <span
      className="spin braille reasonglyph"
      data-testid="chat-reasoning-glyph"
      aria-hidden="true"
    />
  );
}

/** @deprecated Use ReasoningGlyph — kept for imports during rename. */
export const ThinkingMark = ReasoningGlyph;
