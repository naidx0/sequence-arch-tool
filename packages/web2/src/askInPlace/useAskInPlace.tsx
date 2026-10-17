/* ══════════════════════════════════════════════════════════════════════════
   THE TRIGGERS: HOVER, RIGHT-CLICK, A KEY
   packages/web2/src/askInPlace/useAskInPlace.tsx

   One hook both boards mount. It owns the three ways in and the popover they
   open; the board supplies what only it knows (what is selected, which item is
   under an element, where an item is on screen).

     hover        over a SELECTED item, a small "Ask" button appears beside it
     right-click  on an item or a selection, a menu with "Ask about this"
     keyboard     with something selected, Ctrl/Cmd+Enter or "/" opens it

   After a send, the referenced items glow briefly (`data-ask-flash`), so the
   reader sees what the agent was just told about.

   The hook renders into the board's own positioned container (a `layer` node
   the board places inside it), so the popover is sized and clamped by the
   BOARD, not the window.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Icon } from '../chat/Icon';
import './askInPlace.css';
import { AskPopover } from './AskPopover';
import type { AskReference, AskSurfaceName } from './askReference';
import { relativeTo, type Rect } from './placement';

/** How long the referenced items glow after a send. */
export const ASK_FLASH_MS = 1800;
/** How long the Ask button outlives the pointer leaving the item, so the pointer can cross the gap to it. */
export const ASK_HOVER_GRACE_MS = 400;

export interface AskPayload {
  text: string;
  reference: AskReference;
  image: Blob | null;
}

export interface AskHostConfig {
  /** False makes the hook inert (a board mounted with nowhere to send to). Default true. */
  enabled?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  surface: AskSurfaceName;
  /** Ids selected now. */
  selection: readonly string[];
  /** The item id under an element (the board's own DOM), or null. */
  idAt: (el: Element) => string | null;
  resolve: (ids: readonly string[]) => AskReference | null;
  /** The ids' bounding rect in VIEWPORT coordinates, or null when off screen. */
  rectOf: (ids: readonly string[]) => Rect | null;
  /** The board's DOM elements for these ids, for the highlight. */
  elementsOf: (ids: readonly string[]) => Element[];
  snapshot?: (ids: readonly string[]) => Promise<Blob | null>;
  /** Make these ids the selection (a right-click on an unselected item selects it). */
  select?: (ids: string[]) => void;
  /** Whether the hook owns the context menu for this element. Default: yes. */
  ownsContextMenu?: (el: Element) => boolean;
  onSend: (payload: AskPayload) => void | Promise<void>;
  /**
   * False keeps the menu but drops the ask itself (the hover button, the key and the "Ask agent about this" row): a
   * board with nowhere to send to still has its right-click menu. Default true. 0.1.8.1 C7.
   */
  ask?: boolean;
  /** More rows for an item's menu, after "Ask agent about this" (0.1.8.1 C7: Explain, Duplicate, Bring to front...). */
  menuItems?: (ids: readonly string[]) => AskMenuAction[];
  /** The menu on the empty board (0.1.8.1 C7). Absent: a right-click there is the browser's. */
  emptyMenuItems?: () => AskMenuAction[];
}

/** One row of the right-click menu. */
export interface AskMenuAction {
  id: string;
  label: string;
  run: (ids: readonly string[]) => void;
  disabled?: boolean;
}

/** The one ask row's words, everywhere a menu offers it (0.1.8.1 C7, audit P2-3: two Ask rows in one menu). */
export const ASK_AGENT_LABEL = 'Ask agent about this';

/** The rows a menu shows, ask first, each label once (a second row with the same words is dropped). */
export function menuRows(ask: AskMenuAction | null, more: readonly AskMenuAction[]): AskMenuAction[] {
  const seen = new Set<string>();
  const out: AskMenuAction[] = [];
  for (const row of ask ? [ask, ...more] : more) {
    const key = row.label.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export interface AskInPlace {
  /** Render this inside the board's positioned container. */
  layer: ReactNode;
  /** Open the popover for these ids (the menu item, the button and the key all land here). */
  open: (ids: readonly string[]) => void;
  /** Send a question about these ids straight away, as the popover's Send would ("Explain"). 0.1.8.1 C7. */
  askAbout: (ids: readonly string[], text: string) => void;
  close: () => void;
  isOpen: boolean;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return true;
  return false;
};

export function useAskInPlace(cfg: AskHostConfig): AskInPlace {
  const { containerRef } = cfg;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const [popover, setPopover] = useState<{ ids: string[]; returnFocus: HTMLElement | null } | null>(null);
  const [menu, setMenu] = useState<{ ids: string[]; left: number; top: number } | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [tick, setTick] = useState(0);
  const overBoard = useRef(false);
  const hideTimer = useRef<number | null>(null);

  const containerBox = () => containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };

  const open = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const active = document.activeElement;
      setMenu(null);
      setHover(null);
      setBounds((b) => {
        const box = containerRef.current?.getBoundingClientRect();
        return box && (box.width !== b.width || box.height !== b.height) ? { width: box.width, height: box.height } : b;
      });
      setPopover({
        ids: [...ids],
        returnFocus: active instanceof HTMLElement && active !== document.body ? active : containerRef.current,
      });
    },
    [containerRef],
  );
  const close = useCallback(() => setPopover(null), []);

  /* The container's size, kept current while anything is showing. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || (!popover && !menu && !hover) || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBounds((b) => (b.width === r.width && b.height === r.height ? b : { width: r.width, height: r.height }));
      setTick((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, popover, menu, hover]);

  /* Hover: the Ask button beside a selected item the pointer is over. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || cfgRef.current.enabled === false) return undefined;
    /* THE BRIDGE. The button sits a few pixels off the item, so the pointer
       crosses empty board on the way. Leaving the item starts a short grace
       (ASK_HOVER_GRACE_MS) instead of hiding at once; reaching the button, or
       the item again, cancels it. (No padded hit area: it would cover the item's own edge.) */
    const cancelHide = () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
    const hideSoon = () => {
      if (hideTimer.current !== null) return;
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null;
        setHover(null);
      }, ASK_HOVER_GRACE_MS);
    };
    const move = (event: PointerEvent) => {
      const c = cfgRef.current;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.ask-aff, .ask-pop, .ask-menu')) {
        cancelHide();
        return;
      }
      const id = c.idAt(target);
      if (id === null || !c.selection.includes(id) || (event.buttons ?? 0) !== 0) {
        if ((event.buttons ?? 0) !== 0) {
          cancelHide();
          setHover((h) => (h === null ? h : null));
        } else hideSoon();
        return;
      }
      cancelHide();
      const rect = c.rectOf(c.selection);
      if (!rect) {
        setHover(null);
        return;
      }
      const next = relativeTo(rect, el.getBoundingClientRect());
      setHover((h) => (h && h.left === next.left && h.top === next.top && h.width === next.width && h.height === next.height ? h : next));
    };
    const enter = () => {
      overBoard.current = true;
    };
    const leave = (event: PointerEvent) => {
      overBoard.current = false;
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.ask-aff')) return;
      /* Out of the board altogether (the button lives inside it): nothing to bridge to. */
      cancelHide();
      setHover(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      cancelHide();
    };
  }, [containerRef]);

  /* A selection that goes away takes the affordance with it. */
  const selectionKey = cfg.selection.join('\u0000');
  useEffect(() => {
    if (cfg.selection.length === 0) setHover(null);
  }, [selectionKey, cfg.selection.length]);

  /* Right-click on an item or a selection. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || cfgRef.current.enabled === false) return undefined;
    const onContext = (event: MouseEvent) => {
      const c = cfgRef.current;
      const target = event.target;
      /* Whoever owns this menu, the hover button steps aside for it. */
      setHover((h) => (h === null ? h : null));
      if (!(target instanceof Element)) return;
      if (target.closest('.ask-pop, .ask-menu')) return;
      if (c.ownsContextMenu && !c.ownsContextMenu(target)) return;
      const id = c.idAt(target);
      if (id === null) {
        /* The empty board has a menu of its own when the board gives one (0.1.8.1 C7). */
        if (!c.emptyMenuItems) return;
        event.preventDefault();
        const box = el.getBoundingClientRect();
        setPopover(null);
        setHover(null);
        setBounds({ width: box.width, height: box.height });
        setMenu({ ids: [], left: event.clientX - box.left, top: event.clientY - box.top });
        return;
      }
      event.preventDefault();
      const ids = c.selection.includes(id) && c.selection.length > 1 ? [...c.selection] : [id];
      c.select?.(ids);
      const box = el.getBoundingClientRect();
      setPopover(null);
      setHover(null);
      setBounds({ width: box.width, height: box.height });
      setMenu({ ids, left: event.clientX - box.left, top: event.clientY - box.top });
    };
    el.addEventListener('contextmenu', onContext);
    return () => el.removeEventListener('contextmenu', onContext);
  }, [containerRef]);

  /* The key: Ctrl/Cmd+Enter or "/" with something selected, on the board. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const c = cfgRef.current;
      if (c.enabled === false || c.ask === false || c.selection.length === 0 || isEditable(event.target)) return;
      const el = containerRef.current;
      const inside = el && event.target instanceof Node && el.contains(event.target);
      const idle = (event.target === document.body || event.target === null) && overBoard.current;
      if (!inside && !idle) return;
      const chord = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
      const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!chord && !slash) return;
      event.preventDefault();
      open(c.selection);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [containerRef, open]);

  /* While the popover is open its targets are marked; after a send they glow. */
  const flashTimer = useRef<number | null>(null);
  const marked = useRef<Element[]>([]);
  const unmark = (attr: string) => {
    for (const el of marked.current) el.removeAttribute(attr);
    marked.current = [];
  };
  useEffect(() => {
    if (!popover) return undefined;
    const els = cfgRef.current.elementsOf(popover.ids);
    for (const el of els) el.setAttribute('data-ask-target', 'true');
    return () => {
      for (const el of els) el.removeAttribute('data-ask-target');
    };
  }, [popover]);
  const flash = useCallback((ids: readonly string[]) => {
    unmark('data-ask-flash');
    const els = cfgRef.current.elementsOf(ids);
    for (const el of els) el.setAttribute('data-ask-flash', 'true');
    marked.current = els;
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => unmark('data-ask-flash'), ASK_FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      unmark('data-ask-flash');
    },
    [],
  );

  const send = useCallback(
    (ids: readonly string[], text: string) => {
      const c = cfgRef.current;
      const reference = c.resolve(ids);
      setPopover(null);
      if (!reference) return;
      flash(ids);
      void (async () => {
        const image = c.snapshot ? await c.snapshot(ids).catch(() => null) : null;
        await c.onSend({ text, reference, image });
      })();
    },
    [flash],
  );

  /* The menu closes on Escape and on any press outside it. */
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMenu(null);
        containerRef.current?.focus({ preventScroll: true });
      }
    };
    const down = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down, true);
    };
  }, [menu, containerRef]);

  /* Recomputed every render on purpose: the board's rects move with its camera,
     and `tick` (a resize) is one more reason to place again. */
  const layer = ((): ReactNode => {
    const box = containerBox();
    void tick;
    const popRef = popover ? cfg.resolve(popover.ids) : null;
    const popRectView = popover ? cfg.rectOf(popover.ids) : null;
    const popRect = popRectView ? relativeTo(popRectView, box) : null;
    const hoverRef = hover && !popover && !menu && cfg.ask !== false ? cfg.resolve(cfg.selection) : null;
    const rows = menu
      ? menuRows(
          menu.ids.length > 0 && cfg.ask !== false ? { id: 'ask', label: ASK_AGENT_LABEL, run: (ids) => open(ids) } : null,
          menu.ids.length > 0 ? (cfg.menuItems?.(menu.ids) ?? []) : (cfg.emptyMenuItems?.() ?? []),
        )
      : [];
    return (
      <>
        {hover && hoverRef ? (
          <button
            type="button"
            className="ask-aff"
            data-testid="ask-affordance"
            aria-label={`Ask about ${hoverRef.summary}`}
            style={{
              left: Math.max(8, Math.min(hover.left + hover.width + 6, bounds.width - 64)),
              top: Math.max(8, Math.min(hover.top - 6, bounds.height - 40)),
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => open(cfg.selection)}
          >
            <Icon name="chatbox" size={14} />
            <span>Ask</span>
          </button>
        ) : null}
        {menu ? (
          <div
            ref={menuRef}
            className="ask-menu"
            data-testid="ask-menu"
            role="menu"
            aria-label={menu.ids.length > 0 ? 'Item' : 'Board'}
            style={{
              left: Math.max(8, Math.min(menu.left, bounds.width - 188)),
              top: Math.max(8, Math.min(menu.top, bounds.height - 16 - 32 * Math.max(1, rows.length))),
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                role="menuitem"
                className="ask-menuitem"
                data-testid={row.id === 'ask' ? 'ask-menu-ask' : `ask-menu-${row.id}`}
                disabled={row.disabled}
                onClick={() => {
                  const ids = menu.ids;
                  if (row.id !== 'ask') setMenu(null);
                  row.run(ids);
                }}
              >
                {row.id === 'ask' ? <Icon name="chatbox" size={14} /> : null}
                <span>{row.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        {popover && popRef && popRect ? (
          <AskPopover
            reference={popRef}
            target={popRect}
            bounds={bounds.width > 0 ? bounds : { width: box.width, height: box.height }}
            returnFocus={popover.returnFocus}
            onClose={close}
            onSend={(text) => send(popover.ids, text)}
          />
        ) : null}
      </>
    );
  })();

  return { layer, open, askAbout: send, close, isOpen: popover !== null };
}
