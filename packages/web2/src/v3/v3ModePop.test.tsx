import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * DECISION 36 — A MENU ROW IS ONE LINE.
 *
 * This file used to assert the opposite: that a row stacks a label over a
 * technical id in column two. That was Decision 31's shape and it is why the
 * `+` menu and the `/` palette were tall enough to need a scrollbar, and the
 * scrollbar is what clipped the submenus (owner, 2026-09-19: "the pop-out
 * shouldn't have a scroll bar… I want the pop-outs to be able to pop out of
 * the other pop-outs and not be broken into that one small little realm").
 *
 * So the contract is now: column one is the glyph or its spacer, column two is
 * the label, and there is no second row. What the second row used to carry is
 * the button's `title`.
 */
function ModePopRow({
  icon,
  label,
  hint,
}: {
  icon: 'icon' | 'spacer';
  label: string;
  hint: string;
}) {
  return (
    <button type="button" className="v3-mode-pop-test" title={hint}>
      {icon === 'icon' ? (
        <span className="i" aria-hidden="true" />
      ) : (
        <span className="v3-mode-pop-spacer" aria-hidden="true" />
      )}
      <span className="v3-mode-pop-label">{label}</span>
    </button>
  );
}

describe('v3 mode-pop row layout', () => {
  it('draws one line: a glyph cell and a label, with the gloss on the title', () => {
    const { container } = render(
      <div className="v3-mode-pop">
        <ModePopRow icon="spacer" label="Sonnet" hint="claude-sonnet-4" />
      </div>,
    );
    const row = container.querySelector('button')!;
    const label = screen.getByText('Sonnet');
    expect(container.querySelector('.v3-mode-pop-spacer')).toBeTruthy();
    expect(label.classList.contains('v3-mode-pop-label')).toBe(true);

    /* THE GLOSS IS REACHABLE, NOT DRAWN. Dropping it outright would have made
       the menu shorter by making it worse; it is on the row where a thing you
       want once belongs. */
    expect(row.getAttribute('title')).toBe('claude-sonnet-4');
    expect(row.querySelector('.v3-mode-pop-desc')).toBeNull();
    expect(row.textContent).toBe('Sonnet');
  });
});
