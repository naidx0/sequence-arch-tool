/* One section opened in the rail: a head (a labelled "Back to chats" row, then the section's name) over the list that section browses.
   It replaces the chats while open (232 px has no room for a flyout beside the chats, and a drill-in keeps focus
   and scrolling inside the rail); the collapsed icon rail shows the same view in a floating panel. */

import type { KeyboardEvent, ReactNode } from 'react';

import { S2Icon } from '../shell2/icons';
import { RAIL_SECTIONS, type RailSectionId } from './railSections';

export interface RailSectionProps {
  id: RailSectionId;
  onClose: () => void;
  children: ReactNode;
  variant?: 'panel' | 'fly';
}

export function RailSection({ id, onClose, children, variant = 'panel' }: RailSectionProps) {
  const def = RAIL_SECTIONS.find((s) => s.id === id)!;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <section id="rail-section" className={`rail-section rail-section-${variant}`} aria-label={def.label} data-testid="rail-section" data-rail-section={id} onKeyDown={onKeyDown}>
      <div className="rail-section-head">
        <button type="button" className="rail-nav-row" aria-label="Back to chats" data-testid="rail-back" onClick={onClose}>
          <S2Icon name="chevl" />
          <span className="rail-nav-t">Back to chats</span>
        </button>
        <h2 className="rail-section-title">{def.label}</h2>
      </div>
      {children}
    </section>
  );
}

/** The lists share one quiet empty / error line. */
export function RailNote({ kind = 'empty', children, testId }: { kind?: 'empty' | 'error' | 'loading'; children: ReactNode; testId?: string }) {
  return (
    <p className="s2-empty" role={kind === 'error' ? 'alert' : 'status'} data-testid={testId ?? `rail-${kind}`}>
      {children}
    </p>
  );
}
