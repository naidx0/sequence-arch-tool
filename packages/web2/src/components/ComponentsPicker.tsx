/*
 * THE COMPONENTS PICKER: groups, each with its components and a one-line blurb.
 * Opened from the composer's + menu ("Components") and from `/components`.
 * Drawn with the menu parts the + menu already uses (s2-menu, s2-menu-sec,
 * s2-gh, s2-mi); nothing new. Picking one hands it back; the caller makes the
 * chip for the next message.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { S2Icon } from '../shell2/icons';
import { popupMaxHeight } from '../shell2/ModelMenu';
import { ComponentDetail } from './ComponentDetail';
import type { ComponentEntry, ComponentsListing } from './componentsClient';

/** What the picker leaves free above itself: the top bar (44px) and an 8px margin. */
const PICKER_TOP_CLEARANCE = 52;

/** A prompt tool offered beside the components (be-ambitious): it acts on the draft instead of adding a chip. */
export interface PickerTool {
  id: string;
  name: string;
  blurb: string;
  testId?: string;
  disabled?: boolean;
  onPick: () => void;
}

export function ComponentsPicker({
  listing,
  tools = [],
  onPick,
  onClose,
  onEnable,
}: {
  listing: ComponentsListing;
  /** Prompt tools, drawn as the first group ("Prompt tools"), whether Components are on or off. */
  tools?: readonly PickerTool[];
  onPick: (entry: ComponentEntry) => void;
  onClose: () => void;
  /** Turn Components back on (PUT settings); shown when they are off. */
  onEnable?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /* The component whose definition is open, in place of the list. */
  const [detailId, setDetailId] = useState<string | null>(null);
  /* Opening moves focus into the menu, onto its first row. */
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[data-testid="components-item"]') ?? ref.current?.querySelector<HTMLElement>('button:not(:disabled)');
    first?.focus();
  }, [listing.enabled, detailId]);
  /* The menu opens upward, so its bottom edge is fixed and its height is the room above it: the edge less the top bar
     (44px) and a margin. Measured on open and on every resize; the body scrolls from its top inside that. */
  useLayoutEffect(() => {
    const fit = () => {
      const menu = ref.current;
      if (!menu) return;
      const bottom = menu.getBoundingClientRect().bottom;
      if (bottom > 0) menu.style.setProperty('--s2-menu-max', `${popupMaxHeight(bottom, PICKER_TOP_CLEARANCE)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const groups = listing.groups.filter((g) => g.components.length > 0);
  return (
    <div
      ref={ref}
      className="s2-menu s2-menu-up s2-menu-plus"
      role="menu"
      aria-label="Components"
      data-testid="components-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (detailId) setDetailId(null);
          else onClose();
          return;
        }
        /* Right arrow on a component opens its definition (the details button is the pointer's way in). */
        const onItem = (e.target as HTMLElement).closest<HTMLElement>('[data-testid="components-item"]');
        if (e.key === 'ArrowRight' && onItem && !detailId) {
          e.preventDefault();
          setDetailId(onItem.getAttribute('data-component'));
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {

          e.preventDefault();
          const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button[role="menuitem"]:not(:disabled)') ?? []);
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <div className="s2-menu-body">
      {detailId ? (
        <ComponentDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onUse={(id) => {
            const entry = listing.groups.flatMap((g) => g.components).find((c) => c.id === id);
            if (entry) onPick(entry);
          }}
        />
      ) : null}
      {detailId ? null : tools.length > 0 ? (
        <div className="s2-menu-sec" data-group="prompt-tools">
          <p className="s2-gh s2-menu-gh" role="presentation">
            Prompt tools
          </p>
          {tools.map((t) => (
            <button key={t.id} type="button" role="menuitem" className="s2-mi" data-testid={t.testId ?? 'components-tool'} data-tool={t.id} disabled={t.disabled} onClick={t.onPick}>
              <S2Icon name="pen" />
              <span className="s2-mi-d">
                {t.name}
                <span className="s2-mi-blurb" title={t.blurb}>{t.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {detailId ? null : !listing.enabled ? (

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
              <div key={c.id} className="s2-mi-row">
                <button type="button" role="menuitem" className="s2-mi" data-testid="components-item" data-component={c.id} onClick={() => onPick(c)}>
                  <S2Icon name="spark" />
                  <span className="s2-mi-d">
                    {c.name}
                    <span className="s2-mi-blurb" title={c.blurb}>{c.blurb}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="s2-ibtn"
                  data-testid="components-details"
                  data-details={c.id}
                  aria-label={`Definition of ${c.name}`}
                  title="Definition"
                  onClick={() => setDetailId(c.id)}
                >
                  <S2Icon name="chevr" />
                </button>
              </div>
            ))}

          </div>
        ))
      )}
      </div>
    </div>
  );

}
