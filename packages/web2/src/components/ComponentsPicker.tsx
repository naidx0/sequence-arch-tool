/*
 * THE COMPONENTS PICKER: groups, each with its components and a one-line blurb.
 * Opened from the composer's + menu ("Components") and from `/components`.
 * Drawn with the menu parts the + menu already uses (s2-menu, s2-menu-sec,
 * s2-gh, s2-mi); nothing new. Picking one hands it back; the caller makes the
 * chip for the next message.
 */
import { useEffect, useRef } from 'react';

import { S2Icon } from '../shell2/icons';
import type { ComponentEntry, ComponentsListing } from './componentsClient';

export function ComponentsPicker({
  listing,
  onPick,
  onClose,
  onEnable,
}: {
  listing: ComponentsListing;
  onPick: (entry: ComponentEntry) => void;
  onClose: () => void;
  /** Turn Components back on (PUT settings); shown when they are off. */
  onEnable?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /* Opening moves focus into the menu, onto its first row. */
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, [listing.enabled]);
  const groups = listing.groups.filter((g) => g.components.length > 0);
  return (
    <div
      ref={ref}
      className="s2-menu s2-menu-up"
      role="menu"
      aria-label="Components"
      data-testid="components-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button') ?? []);
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      {!listing.enabled ? (
        <>
          <p className="s2-mi s2-mi-foot" data-testid="components-off">Components are off</p>
          {onEnable ? (
            <button type="button" role="menuitem" className="s2-mi" data-testid="components-turn-on" onClick={onEnable}>
              <S2Icon name="spark" />
              <span className="s2-mi-d">Turn components on<span>Same as /components on</span></span>
            </button>
          ) : null}
        </>
      ) : groups.length === 0 ? (
        <p className="s2-mi s2-mi-foot" data-testid="components-empty">No components in this workspace yet</p>
      ) : (
        groups.map((g) => (
          <div key={g.id} className="s2-menu-sec" data-group={g.id}>
            <p className="s2-gh s2-menu-gh" role="presentation" title={g.blurb}>
              {g.name}
            </p>
            {g.components.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitem"
                className="s2-mi"
                data-testid="components-item"
                data-component={c.id}
                onClick={() => onPick(c)}
              >
                <S2Icon name="spark" />
                <span className="s2-mi-d">
                  {c.name}
                  <span>{c.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
