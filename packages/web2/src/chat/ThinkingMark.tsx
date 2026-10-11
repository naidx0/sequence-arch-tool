/**
 * INLINE REASONING GLYPH: the compact activity loader (a braille ring with a turning comet) in the
 * tool-row icon slot (14px). The slot centres it; the loader's box is the slot's box, so the glyph
 * cannot sit off-centre. Never a brand mark.
 */
import { ActivityLoader } from '../shell2/ActivityLoader';

export interface ReasoningGlyphProps {
  /** When false, render nothing. */
  active?: boolean;
}

export function ReasoningGlyph({ active = true }: ReasoningGlyphProps) {
  if (!active) return null;

  return (
    <span className="braille reasonglyph" data-testid="chat-reasoning-glyph" aria-hidden="true">
      <ActivityLoader variant="cell" />
    </span>
  );
}

/** @deprecated Use ReasoningGlyph — kept for imports during rename. */
export const ThinkingMark = ReasoningGlyph;
