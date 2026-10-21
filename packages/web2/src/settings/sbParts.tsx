/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS IN B's LANGUAGE (Decision 49)
   packages/web2/src/settings/sbParts.tsx

   The picked direction's components (the session's BArc.dc.html, uiarc.dev):
   soft glass pills, rounded menus, switches, grouped cards of rows. Built
   fresh for Settings; nothing here is the old panel's markup.

     SbIcon      B's glyphs, 16px at the 1.7 stroke, centred.
     MenuSelect  a pill that opens B's menu (rows with a label and an
                 optional one-line description, a check on the chosen one).
                 Its button carries `value`, so a reader of the control reads
                 the choice the way it read a <select>.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SbIconName = 'sliders' | 'spark' | 'bell' | 'branch' | 'folder' | 'split' | 'chev' | 'check' | 'nodes' | 'shield' | 'bolt';

const PATHS: Record<SbIconName, string[]> = {
  sliders: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M18 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M12 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'],
  spark: ['M12 5l1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4z', 'M10 21h4'],
  branch: ['M8.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M8.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M20.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M6 8.5v7M18 10.5c0 4-6 3-11 5.5'],
  folder: ['M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
  split: ['M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z', 'M12 4v16'],
  chev: ['m7 10 5 5 5-5'],
  check: ['m5 12 5 5 9-10'],
  shield: ['M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', 'm9 12 2 2 4-4'],
  bolt: ['M13 3 5 13.5h6L10 21l8-10.5h-6z'],
  nodes: ['M8.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M20.5 6a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M20.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M8.3 11l7.4-3.8M8.3 13l7.4 3.8'],
};

export function SbIcon({ name, size = 16 }: { name: SbIconName; size?: 14 | 16 }) {
  return (
    <svg className="sb-i" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon={name}>
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export interface MenuOption {
  value: string;
  label: string;
  /** One line under the label, B's menu row. */
  desc?: string;
}

/* Gap between the trigger and the menu, and the margin the menu keeps from the viewport edge. */
const GAP = 6;
const MARGIN = 8;

interface Place {
  top: number;
  left: number;
  maxHeight: number;
  up: boolean;
}

export function MenuSelect({
  value,
  options,
  onChange,
  testid,
  ariaLabel,
}: {
  value: string;
  options: readonly MenuOption[];
  onChange: (value: string) => void;
  testid: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const listId = useId();
  const chosen = options.find((o) => o.value === value);

  /* The menu is a fixed layer in a portal (a child of the overlay scrim, else the body): Settings' cards, groups and
     scroller all clip with overflow, so a menu inside them was cut at their borders. It is placed from the trigger's
     rect: below it, or above when there is more room there, shifted left when it would run off the right edge, and
     capped in height so a long list scrolls inside itself. Placed before paint, so it never flashes in the wrong spot. */
  const portalTo = (trigger.current?.closest('.v3-overlay-scrim') as HTMLElement | null) ?? document.body;

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return undefined;
    }
    const measure = () => {
      const t = trigger.current;
      const m = menu.current;
      if (!t || !m) return;
      const r = t.getBoundingClientRect();
      /* The right edge it may reach: the dialog's own border when the select lives in one (a menu that crosses the
         Settings border reads as detached from it), else the viewport. */
      const frame = t.closest('.v3-overlay-panel')?.getBoundingClientRect();
      const vw = Math.min(document.documentElement.clientWidth || window.innerWidth, frame ? frame.right : Infinity);
      const vh = window.innerHeight;
      const below = vh - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      /* scrollHeight is the menu's full height even while a max-height caps it; add the border (offset minus client). */
      const want = m.scrollHeight + (m.offsetHeight - m.clientHeight);
      const up = below < want && above > below;
      const room = up ? above : below;
      const width = m.offsetWidth;
      let left = r.left;
      if (left + width > vw - MARGIN) left = Math.min(r.right - width, vw - MARGIN - width);
      left = Math.max(MARGIN, left);
      const maxHeight = Math.max(96, Math.floor(room));
      const height = Math.min(want, maxHeight);
      const top = up ? Math.max(MARGIN, r.top - GAP - height) : r.bottom + GAP;
      setPlace((p) =>
        p && p.top === Math.round(top) && p.left === Math.round(left) && p.maxHeight === maxHeight && p.up === up
          ? p
          : { top: Math.round(top), left: Math.round(left), maxHeight, up },
      );
    };
    measure();
    /* Any scroll (the Settings body, the page) or a resize re-places it against the trigger's new rect. */
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, options.length]);

  const placed = open && place !== null;

  /* Focus moves into the menu once it is placed: the chosen option, else the first. */
  useEffect(() => {
    if (!placed) return;
    const opts = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    (menu.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]') ?? opts?.[0])?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const t = event.target as Node;
      if (host.current?.contains(t) || menu.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        /* The menu takes this Escape: it closes the menu and nothing behind it (the Settings overlay skips Escape
           while a .sb-menu is open). Focus goes back to the trigger. */
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
        trigger.current?.focus();
      } else if (event.key === 'Tab') {
        /* Tab leaves the menu: it closes, and the trigger takes focus so the Tab goes on from it (the menu is in a
           portal at the end of the document, so its own place in the tab order is not where the reader is). */
        setOpen(false);
        trigger.current?.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const opts = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
        if (opts.length === 0) return;
        event.preventDefault();
        const at = opts.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        opts[(at + step + opts.length) % opts.length]!.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <span className="sb-select" ref={host}>
      <button
        type="button"
        ref={trigger}
        className="sb-pill sb-select-btn"
        data-testid={testid}
        value={value}
        aria-label={`${ariaLabel}: ${chosen?.label ?? value}`}
        /* THE VALUE IS CUT. `.sb-select-v` is one line with an ellipsis, so a
           chosen value longer than the control shows a fragment and stops. The
           aria-label carries the full text to a screen reader; this carries it
           to the reader looking at the control. */
        title={chosen?.label ?? value}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sb-select-v">{chosen?.label ?? value}</span>
        <SbIcon name="chev" size={14} />
      </button>
      {open
        ? createPortal(
            <span
              ref={menu}
              className="sb-menu"
              role="listbox"
              id={listId}
              aria-label={ariaLabel}
              data-testid={`${testid}-menu`}
              data-side={place?.up ? 'up' : 'down'}
              style={place ? { top: place.top, left: place.left, maxHeight: place.maxHeight } : { top: 0, left: 0, visibility: 'hidden' }}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className="sb-mi"
                  data-testid={`${testid}-option`}
                  data-value={o.value}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <span className="sb-mi-d">
                    <span className="sb-mi-t">{o.label}</span>
                    {o.desc ? <span className="sb-mi-sub">{o.desc}</span> : null}
                  </span>
                  {o.value === value ? <SbIcon name="check" size={14} /> : null}
                </button>
              ))}
            </span>,
            portalTo,
          )
        : null}
    </span>
  );
}
