/* A drop-down for the workflow editor (0.1.6 B9), in place of the browser's own <select>: the app's menu (the .s2-menu / .s2-mi the
   composer's model menu uses, with its open and close animation, the shell's menu keys and exit presence), a trigger drawn like the
   editor's other fields, and the keys a select has: Enter, Space or an arrow opens it, the arrows move, Enter or Space picks, Escape
   closes it (and only it, not the pop-up) and focus goes back to the trigger. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import { useMenuKeys } from '../shell2/menuKeys';
import { useExitPresence } from '../shell2/ModelMenu';
import { ActionGlyph } from './WfeGlyphs';

import '../shell2/modelMenu.css';

export interface WfeOption {
  value: string;
  label: string;
}

interface Place {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

const GAP = 4;
const MARGIN = 8;

export function WfeSelect({ value, options, onChange, label, labelId, testId, className }: { value: string; options: readonly WfeOption[]; onChange: (value: string) => void; label: string; labelId?: string; testId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const shown = useExitPresence(open, menu);
  const current = options.find((o) => o.value === value) ?? options[0] ?? null;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  /* Arrow keys, Escape and focus on the first row: the shell's menu keys. Then the picked row, so the arrows start from it. */
  useMenuKeys(open, menu, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open, place]);

  /* Where it sits: under the trigger and as wide as it, or above it when there is more room there. Fixed, so the pop-up's own
     scrolling and clipping do not cut it. */
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const want = Math.min(options.length * 32 + 12, 280);
    const up = below < want && above > below;
    setPlace({
      top: up ? r.top - GAP : r.bottom + GAP,
      left: Math.round(r.left),
      width: Math.round(r.width),
      maxHeight: Math.max(96, Math.floor(up ? above : below)),
      up,
    });
  }, [open, options.length]);

  /* A press anywhere else, a scroll of anything but the menu, or a resize, closes it. */
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: Event) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || trigger.current?.contains(t)) return;
      setOpen(false);
    };
    const away = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setOpen(true);
    }
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      /* Tab goes on from the trigger, in the pop-up's own order (wrapping at its ends, as the pop-up's focus trap does), not from the menu */
      const trig = trigger.current;
      const scope = trig?.closest('.wfe') ?? document.body;
      const tabbable = [...scope.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]')].filter(
        (el) => !el.closest('.wfe-menu') && !el.hasAttribute('disabled') && el.tabIndex >= 0,
      );
      const at = trig ? tabbable.indexOf(trig) : -1;
      if (trig && at >= 0 && tabbable.length > 1) {
        e.preventDefault();
        tabbable[(at + (e.shiftKey ? -1 : 1) + tabbable.length) % tabbable.length]!.focus();
      } else trig?.focus();
      setOpen(false);
    }
    else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
      (e.key === 'Home' ? rows[0] : rows[rows.length - 1])?.focus();
    }
  };

  const host = trigger.current?.closest('.wfe') ?? document.body;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`wfe-sel ${className ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-labelledby={`${labelId ?? `${id}-l`} ${id}-v`}
        data-testid={testId}
        data-value={value}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        {labelId ? null : <span id={`${id}-l`} className="s2-sr">{label}</span>}
        <span id={`${id}-v`} className="wfe-sel-v">{current?.label ?? ''}</span>
        <ActionGlyph name="down" size={12} />
      </button>
      {shown && place
        ? createPortal(
            <div
              ref={menu}
              id={id}
              className="s2-menu wfe-menu"
              role={open ? 'menu' : undefined}
              aria-label={label}
              aria-hidden={open ? undefined : true}
              data-state={open ? 'open' : 'closing'}
              data-side={place.up ? 'up' : 'down'}
              data-testid={testId ? `${testId}-menu` : undefined}
              style={{ top: place.up ? undefined : place.top, bottom: place.up ? window.innerHeight - place.top : undefined, left: place.left, minWidth: place.width, maxHeight: place.maxHeight }}
              onKeyDown={onMenuKey}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.value === value}
                  className={`s2-mi wfe-mi${o.value === value ? ' is-on' : ''}`}
                  data-testid={testId ? `${testId}-opt-${o.value || 'default'}` : undefined}
                  onClick={() => {
                    if (o.value !== value) onChange(o.value);
                    close(true);
                  }}
                >
                  <span className="wfe-mi-l">{o.label}</span>
                  {o.value === value ? <ActionGlyph name="check" size={12} /> : null}
                </button>
              ))}
            </div>,
            host,
          )
        : null}
    </>
  );
}
