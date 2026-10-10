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

import { useEffect, useId, useRef, useState } from 'react';

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
  const host = useRef<HTMLSpanElement>(null);
  const listId = useId();
  const chosen = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
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
        className="sb-pill sb-select-btn"
        data-testid={testid}
        value={value}
        aria-label={`${ariaLabel}: ${chosen?.label ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sb-select-v">{chosen?.label ?? value}</span>
        <SbIcon name="chev" size={14} />
      </button>
      {open ? (
        <span className="sb-menu" role="listbox" id={listId} aria-label={ariaLabel} data-testid={`${testid}-menu`}>
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
              }}
            >
              <span className="sb-mi-d">
                <span className="sb-mi-t">{o.label}</span>
                {o.desc ? <span className="sb-mi-sub">{o.desc}</span> : null}
              </span>
              {o.value === value ? <SbIcon name="check" size={14} /> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
