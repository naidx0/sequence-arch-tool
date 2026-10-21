/* The short block of flat navigation rows under New chat (Devin's format: one line, a 16 px glyph, a sentence-case
   label, no boxes). A row opens its section in the rail; pressing it again closes it. Arrow keys, Home and End move
   between rows; the rows stay one tab stop each so nothing is hidden from a keyboard. */

import type { KeyboardEvent } from 'react';

import { S2Icon } from '../shell2/icons';
import { RAIL_SECTIONS, type RailSectionId } from './railSections';

export function RailNav({ active, onSelect, navRef }: { active: RailSectionId | null; onSelect: (id: RailSectionId) => void; navRef?: React.RefObject<HTMLElement> }) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button.rail-nav-row'));
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  };
  return (
    <nav ref={navRef} className="rail-nav" aria-label="Sections" data-testid="rail-nav" onKeyDown={onKeyDown}>
      {RAIL_SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`rail-nav-row${active === s.id ? ' is-on' : ''}`}
          aria-label={s.label}
          aria-expanded={active === s.id}
          aria-controls="rail-section"
          data-testid={`rail-nav-${s.id}`}
          data-rail-section={s.id}
          onClick={() => onSelect(s.id)}
        >
          <S2Icon name={s.icon} />
          <span className="rail-nav-t">{s.label}</span>
        </button>
      ))}
    </nav>
  );
}
