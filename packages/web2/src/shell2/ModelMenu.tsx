/* ══════════════════════════════════════════════════════════════════════════
   THE MODEL PILL AND ITS MENU (Decision 49)
   packages/web2/src/shell2/ModelMenu.tsx

   Moved out of v3/V3Chat.tsx whole (round 7), so the agents lane owns it and
   the shell lane owns the composer around it. The pill names the model; its
   menu lists Sequence's models, then each agent's, then the reasoning slider.
   Open/close state stays with the composer, which also closes the other menus.

   0.1.6 (owner: "connect an agent... You can click on Codex and then it opens up
   to the right all the models you can choose. Another expandable"): the agents
   are one section, "Connect an agent". A connected agent is a row that opens a
   flyout to its right (or its left when there is no room) listing its models;
   one not yet connected shows its state with Connect or Sign in on the row
   (ConnectAgents). The mode menu is not in this popup: the mode icon owns it.
   ══════════════════════════════════════════════════════════════════════════ */

import { createPortal } from 'react-dom';
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';

import { activeAgentModel, type ActiveModel } from '../agents/activeModel';
import { agentDisplayName } from '../agents/agentLabels';
import { defaultNickname } from '../chat/modelNames';
import { displayModelName, tidyModelName } from '../chat/modelNickname';
import { agentRuns, type AgentRunsState } from '../agents/agentRuns';
import { chatPick, modelOffered, setChatPick } from '../agents/chatConfig';
import { CONNECT_AGENT_LABEL, effortLabelOf } from '../chat/composerModel';
import { ReasoningTrack } from './ReasoningTrack';
import type { ModelPickerProfile, ReasoningEffort } from '../chat/modelPicker';
import { useStore } from '../state';
import { ProviderIcon, brandOf, modelGroupOf, type ModelIdentity, type ProviderKey } from './brandIcons';
import { S2Icon, type S2IconName } from './icons';
import { queueMarkCut } from './softEdge';

import './modelMenu.css';

import { FailureNote } from '../components/FailureNote';

const ConnectAgents = lazy(() => import('./ConnectAgents'));

/** A saved model plus what the picker's list does not carry: its endpoint, and whether it holds a key. */
export type ModelMenuProfile = ModelPickerProfile & Pick<ModelIdentity, 'baseUrl' | 'keyed'>;

export interface ModelMenuProps {
  wrapRef: RefObject<HTMLDivElement>;
  open: boolean;
  onTrigger: () => void;
  onClose: () => void;
  sessionId: string;
  agentRun: string | undefined;
  /** The chat host validates agent changes between turns before this menu writes a model. */
  onPickAgent?: (ref: string) => Promise<boolean>;
  /** Seeds an editable command; scheduling still requires Send. */
  onScheduleAgent?: (ref: string) => void;
  profiles: readonly ModelMenuProfile[];
  pickModel: (id: string) => Promise<void> | void;
  modelErr: string | null;
  effort: ReasoningEffort;
  effortRows: readonly { key: ReasoningEffort; label: string; description: string }[];
  pickEffort: (key: ReasoningEffort) => void;
  modelChip: string;
  modelChipShort: string;
  modelChipTitle: string;
  /** The one resolved model the chip names (its icon comes from here, its text from the same record). */
  chipIdentity?: ModelIdentity | null;
  effortLabel: string;
  /** The modes, the one in force, and the pick (the composer owns what picking means, Full access's confirmation included). */
  modes: readonly { key: string; label: string; desc: string; icon: S2IconName }[];
  currentMode: string;
  onMode: (key: string) => void;
  /** Hover/focus on a mode row: lets the composer warm what the pick will need. */
  onModeIntent?: (key: string) => void;
}

/** A mode's icon, plain: no circle, no colour. It takes the ink of the text beside it (modelMenu.css). */
export function ModeGlyph({ mode, icon }: { mode: string; icon: S2IconName }) {
  return (
    <span className="s2-mode-ico" data-mode={mode} data-testid="s2-mode-icon" aria-hidden="true">
      <S2Icon name={icon} />
    </span>
  );
}

/**
 * Which group a saved model belongs to: the shared classifier (brandIcons'
 * `modelGroupOf`), the same one the status bar and the chip use. Returns the
 * group key: 'local', 'claude', 'openai' or `host:<vendor>`.
 */
export function profileGroupOf(provider: string | null | undefined, model: string | null | undefined, extra?: Pick<ModelIdentity, 'baseUrl' | 'keyed'>): string {
  return modelGroupOf({ provider, model, ...extra }).key;
}

/** The mark a saved model wears: its group's (Local is the Sequence mark, a hosted gateway the neutral glyph). */
export function sequenceRowProvider(provider: string | null | undefined, model?: string | null, extra?: Pick<ModelIdentity, 'baseUrl' | 'keyed'>): ProviderKey {
  return modelGroupOf({ provider, model, ...extra }).icon;
}

/** What the popup says when there is nothing to list and the model route gave no error: nothing, the one action row below says it. */
export const EMPTY_MODELS_COPY = '';

/* One row of a model list: a saved model, or an agent's model (or its default, when it has no list). */
type Row = { id: string; kind: 'profile' | 'agent' | 'agentDefault'; agent?: string; name: string; note: string; provider: ProviderKey; active: boolean; title: string; pick: () => void };
/** A connected agent: its row in the menu and the models its flyout lists. */
export type AgentEntry = { ref: string; label: string; provider: ProviderKey; active: boolean; note: string; rows: Row[]; failed?: string };

/** An agent by the label it was registered with, else the vendor's name, else its id capitalised (agents/agentLabels.ts). */
export function agentName(ref: string, labels?: Readonly<Record<string, string>>): string {
  return agentDisplayName(ref, labels);
}

/** The reasoning levels this chat's agent offers, the one in force, and the one the model recommends. The pill, the menu's slider and the overview all read it. */
export function resolveAgentEffort(
  runsState: Pick<AgentRunsState, 'caps' | 'config' | 'chatConfig'>,
  agentRun: string | undefined,
  sessionId: string | null,
): { efforts: string[]; effort: string | undefined; recommended: string | undefined } {
  if (!agentRun) return { efforts: [], effort: undefined, recommended: 'medium' };
  const caps = (runsState.caps ?? {})[agentRun];
  const chatCfg = sessionId ? chatPick(runsState, agentRun, sessionId) : (runsState.config?.[agentRun] ?? {});
  const chosen = chatCfg.model ?? caps?.models.find((m) => m.isDefault)?.id;
  const m = caps?.models.find((x) => x.id === chosen);
  const efforts = m?.efforts.length ? m.efforts : (caps?.efforts ?? []);
  const chosenModel = chatCfg.model ?? caps?.models.find((x) => x.isDefault)?.id ?? caps?.models[0]?.id;
  const def = caps?.models.find((x) => x.id === chosenModel)?.defaultEffort;
  const recommended = def && efforts.includes(def) ? def : efforts.includes('medium') ? 'medium' : undefined;
  const set = chatCfg.effort;
  const effort = set && efforts.includes(set) ? set : (recommended ?? efforts[0]);
  return { efforts, effort, recommended };
}

/** The model text the composer pill shows for an agent's model. */
export function agentPillText(model: ActiveModel): string {
  return model.source === 'unknown' ? pillAgentText(tidyModelName(model.label)) : tidyModelName(model.label);
}

/** The pill's name for an agent that has not said which model it runs: the name alone when "<name> default" would be cut mid-word. */
export function pillAgentText(text: string, max = 14): string {
  return text.length > max && / default$/.test(text) ? text.slice(0, -' default'.length) : text;
}

/** At or below this window width the agent's models drill in, as an iOS menu does: a flyout beside the menu would sit over it. */
export const COMPACT_MENU_W = 720;

function useCompactMenu(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= COMPACT_MENU_W);
  useEffect(() => {
    const on = () => setCompact(window.innerWidth <= COMPACT_MENU_W);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return compact;
}

const GROUP_ORDER: readonly string[] = ['local', 'claude', 'openai'];

/** The tallest the popup may be: the room above the chip less a margin, never past `cap`, never below `floor`. */
export function popupMaxHeight(bottomEdge: number, margin = 8, cap = 960, floor = 120): number {
  return Math.max(floor, Math.min(cap, Math.floor(bottomEdge - margin)));
}

/** The menu items in document order (the slider and headings are not items). */
export function menuItemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].filter((el) => !el.hasAttribute('disabled'));
}

/** Arrow/Home/End roving focus across a menu's items; returns true when it moved focus. */
export function moveMenuFocus(menu: HTMLElement, key: string, active: Element | null = document.activeElement): boolean {
  const items = menuItemsOf(menu);
  if (items.length === 0) return false;
  const at = items.findIndex((el) => el === active);
  let next: number;
  if (key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
  else if (key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = items.length - 1;
  else return false;
  items[next]!.focus();
  return true;
}

/** Whether a closing menu may play its exit: a browser that animates, and motion not reduced. */
export function exitMotionAllowed(win: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win || typeof win.Element?.prototype?.getAnimations !== 'function') return false;
  return !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 0.1.5 G1 (the owner: "add like an animation, like a smoothing animation"):
 * a menu that closes stays on the page for its exit (modelMenu.css
 * `[data-state='closing']`, --s2-switch-dur), then goes. Where nothing animates
 * (reduced motion, a test DOM) it goes at once, as before. While closing it is
 * not a menu: no role, hidden from assistive tech, no pointer.
 */
export function useExitPresence(open: boolean, ref: RefObject<HTMLElement>, maxMs = 260): boolean {
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open && exitMotionAllowed());
  }
  useEffect(() => {
    if (!closing) return undefined;
    const el = ref.current;
    const done = (ev?: Event) => {
      /* Only the menu's own exit, not a row's check or a spinner inside it. */
      if (!ev || ev.target === el) setClosing(false);
    };
    const timer = window.setTimeout(done, maxMs);
    el?.addEventListener('animationend', done);
    return () => {
      window.clearTimeout(timer);
      el?.removeEventListener('animationend', done);
    };
  }, [closing, ref, maxMs]);
  return open || closing;
}

/**
 * The effort section's height follows its content (owner, 2026-10-11: picking a model changes the effort below it
 * "smoothly, not rigid and quick"). A model with no efforts, or with a "Recommended" caption the last one lacked,
 * changes how tall the section is; this holds the section's box at a measured height that the CSS (.s2-efold)
 * transitions with the picker's own motion, and keeps a section that is going away on the page until it has folded.
 * Where nothing animates (reduced motion, a test DOM) it is the plain section, there or not, at once.
 */
export function EffortFold({ show, children }: { show: boolean; children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const kept = useRef<ReactNode>(children);
  if (show) kept.current = children;
  const [leaving, setLeaving] = useState(false);
  const [wasShown, setWasShown] = useState(show);
  /* Focus inside a section that is about to go: noted before the commit, handed to the menu's agent row after it. */
  const focusInside = useRef(false);
  if (wasShown !== show) {
    setWasShown(show);
    setLeaving(!show && exitMotionAllowed());
    focusInside.current = !show && !!innerRef.current && innerRef.current.contains(document.activeElement);
  }
  useLayoutEffect(() => {
    if (!focusInside.current) return;
    focusInside.current = false;
    const menu = innerRef.current?.closest<HTMLElement>('[data-testid="s2-model-menu"]');
    const target = menu?.querySelector<HTMLElement>('[data-testid="s2-agent-row"]') ?? menu;
    target?.focus({ preventScroll: true });
  }, [show]);
  useEffect(() => {
    if (!leaving) return undefined;
    const t = window.setTimeout(() => setLeaving(false), 300);
    return () => window.clearTimeout(t);
  }, [leaving]);
  const [height, setHeight] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver !== 'function' || !exitMotionAllowed()) return undefined;
    let timer: number | undefined;
    let last: number | null = null;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (last !== null && last !== h) {
        setMoving(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setMoving(false), 320);
      }
      last = h;
      setHeight(h);
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);
  const shown = show || leaving;
  return (
    <div
      className="s2-efold"
      data-testid="s2-effort-fold"
      data-empty={!shown && height === 0 ? 'true' : 'false'}
      data-moving={moving ? 'true' : 'false'}
      style={height === null ? undefined : { height: `${height}px` }}
    >
      <div ref={innerRef} className="s2-efold-in" data-state={show ? 'open' : 'closing'} aria-hidden={show ? undefined : true}>
        {shown ? kept.current : null}
      </div>
    </div>
  );
}

/** A saved model's name: the one the person gave it, else the auto nickname. */
export function profileName(pr: { nickname: string; model: string; provider: string }): string {
  return displayModelName(pr.model, pr.nickname === defaultNickname(pr.model, pr.provider) ? null : pr.nickname);
}

/** A stop's label: decided once, in chat/composerModel.ts, and re-exported here for the menu's callers. */
export { effortLabelOf };

export function ModelMenu({
  wrapRef,
  open,
  onTrigger,
  onClose,
  sessionId,
  agentRun,
  onPickAgent,
  onScheduleAgent,
  profiles,
  pickModel,
  modelErr,
  effort,
  effortRows: EFFORT_ROWS,
  pickEffort,
  modelChip,
  modelChipShort,
  modelChipTitle,
  chipIdentity,
  effortLabel,
  modes,
  currentMode,
  onMode,
  onModeIntent,
}: ModelMenuProps) {
  const store = useStore();
  const compact = useCompactMenu();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerEl = () => wrapRef.current?.querySelector<HTMLElement>('[data-testid="v3-model-trigger"]') ?? null;
  const modeTriggerEl = () => wrapRef.current?.querySelector<HTMLElement>('[data-testid="s2-mode-trigger"]') ?? null;
  /* THE SMALL MODE MENU: the mode half of the pill opens three rows and nothing else. */
  const [modeOpen, setModeOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const closeModeMenu = useCallback((returnFocus: boolean) => {
    /* Focus moves to the icon first, so it is never left on a row that is about to unmount. */
    if (returnFocus) modeTriggerEl()?.focus();
    setModeOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* Opening it puts focus on the row in force; a click outside or Esc closes it (Esc hands focus back to the icon). */
  useLayoutEffect(() => {
    if (!modeOpen) return undefined;
    const menu = modeMenuRef.current;
    (menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
    const onDoc = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setModeOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeOpen]);
  /* The model popup opening closes it. */
  useEffect(() => {
    if (open) setModeOpen(false);
  }, [open]);
  const onModeMenuKey = (ev: ReactKeyboardEvent<HTMLElement>) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeModeMenu(true);
      return;
    }
    if (ev.key === 'Tab') {
      setModeOpen(false);
      return;
    }
    if (modeMenuRef.current && moveMenuFocus(modeMenuRef.current, ev.key)) ev.preventDefault();
  };
  const onModeTriggerKey = (ev: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (open) onClose();
      setModeOpen(true);
    }
  };
  /* The scrolling body shows a bottom fade only while there is more below it. */
  const bodyRef = useRef<HTMLDivElement>(null);
  const syncMore = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const more = body.scrollHeight - body.clientHeight - body.scrollTop > 1;
    body.parentElement?.setAttribute('data-more', more ? 'true' : 'false');
  }, []);
  /* Size the popup from the real room above it: its bottom edge is fixed (it opens upward), so the
     height it may take is that edge less a margin. Measured on open and on every resize; it scrolls inside. */
  const fit = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bottom = menu.getBoundingClientRect().bottom;
    menu.style.setProperty('--s2-menu-max', `${popupMaxHeight(bottom)}px`);
    syncMore();
  }, [syncMore]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, fit]);
  /* Esc closes (the composer owns the state) and hands focus back to the chip, not <body>. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') triggerEl()?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const onMenuKey = (ev: ReactKeyboardEvent<HTMLElement>) => {
    const menu = menuRef.current;
    /* The reasoning slider keeps its own keys. */
    if ((ev.target as HTMLElement).closest?.('[role="slider"], input')) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      /* Escape closes the innermost: an open flyout first, then the menu. */
      if (fly) {
        ev.nativeEvent.stopImmediatePropagation();
        closeFly(true);
        return;
      }
      onClose();
      triggerEl()?.focus();
      return;
    }
    if (ev.key === 'ArrowLeft' && fly) {
      ev.preventDefault();
      closeFly(true);
      return;
    }
    if (menu && moveMenuFocus(menu, ev.key)) ev.preventDefault();
  };
  /* From the chip, ArrowDown/ArrowUp step into the open menu. */
  const onChipKey = (ev: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open || !menuRef.current) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End') {
      if (moveMenuFocus(menuRef.current, ev.key === 'ArrowUp' ? 'End' : ev.key === 'ArrowDown' ? 'Home' : ev.key, null)) ev.preventDefault();
    }
  };
  /* ── THE AGENT FLYOUT: the models of the agent whose row is hovered, clicked or opened with ArrowRight.
     Hover opens it unpinned (it leaves with the pointer); click or ArrowRight pins it (Escape, ArrowLeft or a second click close it). */
  const [fly, setFly] = useState<{ ref: string; pinned: boolean } | null>(null);
  const [unconnected, setUnconnected] = useState(0);
  const [flyTick, setFlyTick] = useState(0);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const flyTimer = useRef<number | undefined>(undefined);
  const flyFocus = useRef(false);
  const aimTimer = useRef<number | undefined>(undefined);
  /* The pointer's last few places inside the menu, and the row it rests on: the aim test reads them. */
  const trail = useRef<{ x: number; y: number }[]>([]);
  const hoverItem = useRef<Element | null>(null);
  const lastMoveAt = useRef(0);
  /* Where the last click on an agent row landed. The menu can grow under a click (the Schedule switch row appears), which
     slides another row under a pointer that has not moved; the browser then reports it entering that row. */
  const clickPt = useRef<{ x: number; y: number } | null>(null);
  const holdFly = useCallback(() => {
    window.clearTimeout(flyTimer.current);
    window.clearTimeout(aimTimer.current);
  }, []);
  const openFly = useCallback(
    (ref: string, pinned: boolean, focusFirst = false) => {
      holdFly();
      flyFocus.current = focusFirst;
      setFly((prev) => ({ ref, pinned: pinned || (prev?.ref === ref && prev.pinned) }));
    },
    [holdFly],
  );
  const releaseFly = useCallback(() => {
    holdFly();
    flyTimer.current = window.setTimeout(() => setFly((f) => (f && !f.pinned ? null : f)), 180);
  }, [holdFly]);
  const closeFly = useCallback(
    (returnFocus: boolean) => {
      holdFly();
      const ref = fly?.ref;
      setFly(null);
      if (returnFocus && ref) rowEls.current.get(ref)?.focus();
    },
    [holdFly, fly],
  );
  useEffect(() => () => holdFly(), [holdFly]);
  /* Closing the menu closes its flyout. */
  useEffect(() => {
    if (!open) setFly(null);
  }, [open]);
  /* MENU AIM: a pointer on its way to the flyout, inside the triangle from where it was to the flyout's near corners, is
     not choosing the rows it crosses. The open flyout stays and a switch waits AIM_MS; only a pointer that rests on the
     other row switches it. */
  const aiming = (pt: { x: number; y: number }): boolean => {
    const f = document.querySelector<HTMLElement>('[data-testid="s2-agent-flyout"]');
    if (!f || trail.current.length === 0) return false;
    return aimingAtFlyout(pt, trail.current[0]!, f.getBoundingClientRect(), f.dataset.side === 'left' ? 'left' : 'right');
  };
  /* After AIM_MS on the other row: switch only if the pointer has stopped there. One still crossing it toward the flyout
     (moving, and inside the triangle) is not choosing it; ask again. */
  const afterAim = (item: Element, then: () => void) => {
    window.clearTimeout(aimTimer.current);
    aimTimer.current = window.setTimeout(() => {
      if (hoverItem.current !== item) return;
      const last = trail.current[trail.current.length - 1];
      const moving = !!last && performance.now() - lastMoveAt.current < AIM_MS * 0.7 && aiming(last);
      if (moving) afterAim(item, then);
      else then();
    }, AIM_MS);
  };
  const onMenuPointerMove = (ev: { clientX: number; clientY: number }) => {
    lastMoveAt.current = performance.now();
    if (clickPt.current && (clickPt.current.x !== ev.clientX || clickPt.current.y !== ev.clientY)) clickPt.current = null;
    trail.current = [...trail.current, { x: ev.clientX, y: ev.clientY }].slice(-4);
  };
  const hoverAgent = (ref: string, item: Element, pt: { x: number; y: number }) => {
    /* A drill-in has no pointer to aim: the row opens on a click only. */
    if (compact) return;
    /* The pointer has not moved since the click: a row that slid under it is not a choice, and must not take the flyout the click opened. */
    if (clickPt.current && clickPt.current.x === pt.x && clickPt.current.y === pt.y) return;
    hoverItem.current = item;
    if (fly && fly.ref !== ref && aiming(pt)) afterAim(item, () => openFly(ref, false));
    else {
      window.clearTimeout(aimTimer.current);
      openFly(ref, false);
    }
  };
  /* Pointing at any other row of the menu lets go of a hover-opened flyout (unless the pointer is aiming at it). */
  const onMenuPointerOver = (ev: { target: EventTarget; clientX: number; clientY: number }) => {
    if (!fly || fly.pinned) return;
    const item = (ev.target as HTMLElement).closest?.('[role="menuitem"], [role="menuitemradio"]');
    if (!item || item.hasAttribute('data-agent-row')) return;
    hoverItem.current = item;
    if (aiming({ x: ev.clientX, y: ev.clientY })) afterAim(item, () => setFly(null));
    else setFly(null);
  };
  /* The body scrolls under the flyout's row: the flyout follows it. */
  const onBodyScroll = () => {
    syncMore();
    if (fly) setFlyTick((t) => t + 1);
  };
  const menuShown = useExitPresence(open, menuRef);
  const modeMenuShown = useExitPresence(modeOpen, modeMenuRef);
  const runsState = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const chipName = agentRun ? (runsState.agentLabels?.[agentRun] ? agentName(agentRun, runsState.agentLabels) : agentRun) : modelChipShort;
  /* ── THE MODEL MENU'S ROWS (Decision 49): Sequence's own models, then the
     agents this page knows. Picking an agent's model makes this chat talk to
     that agent; picking a Sequence one is choosing it over the agent.
     Reasoning shows the efforts of what is chosen, as Codex's slider. */
  const allCaps = runsState.caps ?? {};
  /* What the agent offers (models, efforts, its / commands), asked once it is attached; the runner loads lazily. */
  useEffect(() => {
    if (agentRun) void import('../agents/agentRunner').then((m) => m.loadCapabilities(agentRuns, agentRun, (input, init) => fetch(input, init)));
  }, [agentRun]);
  /* Round 7 (A3): the agent's model as it stated it, or "<Agent> default" until it has. */
  const agentModel = agentRun ? activeAgentModel(runsState, agentRun, sessionId || null) : null;
  const capsError = agentRun ? runsState.capsError?.[agentRun] : undefined;
  type Group = { key: string; label: string; provider: ProviderKey; rows: Row[] };
  const byKey = new Map<string, Group>();
  const groupFor = (key: string, label: string, provider: ProviderKey): Group => {
    let g = byKey.get(key);
    if (!g) {
      g = { key, label, provider, rows: [] };
      byKey.set(key, g);
    }
    return g;
  };
  /* The saved models, by provider. The agents are their own section below (their rows open a flyout). */
  for (const pr of profiles) {
    const grp = modelGroupOf(pr);
    const g = groupFor(grp.key, grp.label, grp.icon);
    const name = profileName(pr);
    g.rows.push({
      id: pr.id,
      kind: 'profile',
      name,
      note: '',
      provider: grp.icon,
      active: !agentRun && pr.active,
      title: `${pr.model}, ${pr.provider}`,
      pick: () => void pickModel(pr.id),
    });
  }
  /* 0.1.5 G1: every connected agent is offered, whatever its model list says. Before, an agent
     whose list was empty, unreadable or not yet back had no row at all, so a Codex that Settings
     called Connected could not be chosen anywhere. Once the page has read the registry, that list
     decides (a disconnected agent leaves at once); until then, what the page has asked about.
     0.1.6: each is one row of the Agents section; its flyout lists these models. */
  const agentRefs = [...new Set([...(runsState.registered ?? [...Object.keys(allCaps), ...Object.keys(runsState.capsError ?? {})]), ...(agentRun ? [agentRun] : [])])].sort();
  const agentEntries: AgentEntry[] = [];
  for (const ref of agentRefs) {
    const caps = allCaps[ref];
    const prov = brandOf(ref);
    const icon: ProviderKey = prov === 'codex' ? 'openai' : prov;
    const label = agentName(ref, runsState.agentLabels);
    const failedWhy = runsState.capsError?.[ref];
    const rows: Row[] = [];
    if (!caps || caps.models.length === 0) {
      /* No list to choose from: the agent itself, on the model it picks by default. One click attaches it. */
      rows.push({
        id: `${ref}:`,
        kind: 'agentDefault',
        agent: ref,
        name: 'Default model',
        note: caps ? `${label} picks it` : failedWhy ? `${label} picks it (list unreadable)` : 'Reading its models…',
        provider: icon,
        active: agentRun === ref,
        title: `${label}, on the model it uses by default`,
        pick: async () => {
          const sid = sessionId;
          if (onPickAgent && !(await onPickAgent(ref))) return;
          if (onPickAgent) { onClose(); return; }
          agentRuns.patch((st) => ({ ...st, agents: { ...st.agents, [sid]: ref } }));
          onClose();
        },
      });
    } else {
      const chosen = activeAgentModel(runsState, ref, sessionId || null).id ?? caps.models[0]?.id;
      for (const m of caps.models) {
        rows.push({
          id: `${ref}:${m.id}`,
          kind: 'agent',
          agent: ref,
          name: tidyModelName(m.name || m.id),
          note: m.description ?? '',
          provider: icon,
          active: agentRun === ref && chosen === m.id,
          title: m.id,
          pick: async () => {
            const sid = sessionId;
            /* Guard only a real agent change: picking a model from the active agent's flyout must not run the readiness check. */
            if (onPickAgent && agentRun !== ref && !(await onPickAgent(ref))) return;
            agentRuns.patch((st) => {
              const next = setChatPick({ ...st, agents: { ...st.agents, [sid]: ref } }, sid, { model: m.id });
              return { ...next, config: { ...st.config, [ref]: { ...st.config?.[ref], model: m.id } } };
            });
            /* The menu stays open: the effort below is the model's, chosen next. */
          },
        });
      }
    }
    const on = agentRun === ref;
    agentEntries.push({ ref, label, provider: icon, active: on, note: on && agentModel ? tidyModelName(agentModel.label) : 'Registered', rows, ...(failedWhy ? { failed: failedWhy } : {}) });
  }
  const modelGroups = [...byKey.values()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.key);
    const ib = GROUP_ORDER.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const { efforts: agentEfforts, effort: agentEffort, recommended: recommendedEffort } = resolveAgentEffort(runsState, agentRun, sessionId);
  /* A saved model the agent no longer offers is cleared when an effort is picked, so the pick lands on the default model and the pill lights. */
  const deadModel = (st: typeof runsState): boolean => {
    const saved = st.chatConfig?.[sessionId]?.model;
    return !!agentRun && !!saved && !modelOffered(st.caps?.[agentRun], saved);
  };
  const effortChoices: { key: string; label: string; title: string; on: boolean; pick: () => void }[] = agentRun
    ? agentEfforts.map((e) => ({
        key: e,
        /* "Off" where the agent reports none or minimal reasoning. */
        label: effortLabelOf(e),
        title: `${effortLabelOf(e)} reasoning`,
        on: e === agentEffort,
        pick: () => agentRuns.patch((st) => ({ ...setChatPick(st, sessionId, { effort: e, ...(deadModel(st) ? { model: undefined } : {}) }), config: { ...st.config, [agentRun]: { ...st.config?.[agentRun], effort: e } } })),
      }))
    : EFFORT_ROWS.map((row) => ({
        key: row.key,
        label: effortLabelOf(row.key),
        title: row.description,
        on: effort === row.key,
        pick: () => pickEffort(row.key),
      }));

  /* The pill reads the level the slider shows (an agent's own, not the composer's), by the same label. */
  const effortNow = effortChoices.find((e) => e.on)?.label ?? effortLabel;

  /* THE COMPOSER PILL: one plain pill, two buttons: [mode icon] [provider icon] [model nickname].
     The mode is its icon only (its word is the accessible name); the model part ellipsises, its full name in the title.
     Everything else is in the popup. */
  const activeProfile = profiles.find((p) => p.active);
  const chipProvider: ProviderKey = agentRun ? (brandOf(agentRun) === 'codex' ? 'openai' : brandOf(agentRun)) : chipIdentity ? modelGroupOf(chipIdentity).icon : activeProfile ? modelGroupOf(activeProfile).icon : 'sequence';
  const noModel = !agentRun && modelChipShort === CONNECT_AGENT_LABEL;
  /* Nickname first: a saved model's is already one (profileName); an agent's label is tidied the same way. */
  const chipText = agentModel ? agentPillText(agentModel) : modelChipShort === CONNECT_AGENT_LABEL ? modelChipShort : modelChip;
  const mode = modes.find((m) => m.key === currentMode) ?? modes[0];
  /* The name is capped at 12ch (modelMenu.css) and fades at its edge when longer: mark it cut only then, so a short name keeps its last letters. */
  const labelRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return undefined;
    const mark = () => queueMarkCut(el.parentElement ?? el, '[data-testid="v3-model-label"]');
    if (typeof ResizeObserver === 'undefined') {
      mark();
      return undefined;
    }
    /* A ResizeObserver reports once when it starts watching a box that has a size, before the frame is painted, so the
       first mark comes from it: marking here as well forced a layout in the middle of boot (about 15 ms of the first
       commit). A name that changes inside an unchanged box is covered by the observer on the re-run of this effect. */
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chipText]);
  const fullTitle = agentRun ? `${chipName}, ${agentModel?.label}${agentModel?.id ? ` (${agentModel.id})` : ''}` : modelChipTitle;
  return (
    <div className="s2-anchor" ref={wrapRef}>
      <div className="s2-pill s2-pillbar" role="group" aria-label="Mode and model" data-testid="s2-pillbar" data-action={agentRun ? 'agent' : noModel ? 'connect' : undefined}>
        {mode ? (
          <button
            type="button"
            className="s2-pb s2-pb-mode"
            aria-haspopup="menu"
            aria-expanded={modeOpen}
            data-testid="s2-mode-trigger"
            data-mode={currentMode}
            title={`Mode: ${mode.label}. ${mode.desc}`}
            aria-label={`Mode: ${mode.label}`}
            onClick={() => {
              if (open) onClose();
              setModeOpen((v) => !v);
            }}
            onKeyDown={onModeTriggerKey}
            onPointerEnter={() => onModeIntent?.('full')}
            onFocus={() => onModeIntent?.('full')}
          >
            <ModeGlyph mode={currentMode} icon={mode.icon} />
            <span className="s2-sr" data-testid="v3-mode-label">{mode.label}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="s2-pb s2-pb-model s2-pill-model"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="v3-model-trigger"
          data-action={agentRun ? 'agent' : noModel ? 'connect' : undefined}
          data-effort={effort}
          data-mode={currentMode}
          data-model-source={agentModel?.source}
          title={`${fullTitle}, ${effortNow} reasoning`}
          aria-label={`${agentRun ? `Agent: ${chipName}, model: ${agentModel?.label}` : `Model: ${modelChip}`}, reasoning ${effortNow}`}

          onClick={() => {
            setModeOpen(false);
            onTrigger();
          }}
          onKeyDown={onChipKey}
        >
          <ProviderIcon provider={chipProvider} />
          <span className="s2-pill-l" ref={labelRef} data-testid="v3-model-label">{chipText}</span>
        </button>
      </div>
      {modeMenuShown && mode ? (
        <div
          ref={modeMenuRef}
          className="s2-menu s2-menu-up s2-menu-right s2-menu-modes"
          role={modeOpen ? 'menu' : undefined}
          aria-label="Mode"
          aria-hidden={modeOpen ? undefined : true}
          data-state={modeOpen ? 'open' : 'closing'}
          data-testid={modeOpen ? 's2-quickmode-menu' : 's2-quickmode-menu-closing'}
          onKeyDown={onModeMenuKey}
        >
          <p className="s2-gh s2-menu-gh s2-modes-gh" role="presentation" data-testid="s2-quickmode-head">
            <span className="s2-grow">Mode</span>
            <span className="s2-kbd" title="Shift+Tab in the message box cycles the mode">⇧ Tab</span>
            <span className="s2-sr">Cycle modes</span>
          </p>
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              role="menuitemradio"
              aria-checked={currentMode === m.key}
              className={`s2-mi s2-mi-model s2-mi-mode${currentMode === m.key ? ' is-on' : ''}`}
              data-testid={`s2-quickmode-${m.key}`}
              data-mode={m.key}
              title={`${m.label}: ${m.desc}`}
              onPointerEnter={() => onModeIntent?.(m.key)}
              onFocus={() => onModeIntent?.(m.key)}
              onClick={() => {
                onMode(m.key);
                closeModeMenu(true);
              }}
            >
              <ModeGlyph mode={m.key} icon={m.icon} />
              <span className="s2-mi-name">{m.label}</span>
              <span className="s2-mi-note">{m.desc}</span>
              {currentMode === m.key ? <S2Icon name="check" small /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {menuShown ? (
        <div
          ref={menuRef}
          className="s2-menu s2-menu-up s2-menu-right s2-menu-model"
          role={open ? 'menu' : undefined}
          aria-label="Model and reasoning"
          aria-hidden={open ? undefined : true}
          data-state={open ? 'open' : 'closing'}
          data-page={compact && fly ? 'agent' : undefined}
          data-testid={open ? 's2-model-menu' : 's2-model-menu-closing'}
          onKeyDown={onMenuKey}
          onPointerOver={onMenuPointerOver}
          onPointerMove={onMenuPointerMove}
          onPointerLeave={releaseFly}
        >
          <div className="s2-menu-body" ref={bodyRef} onScroll={onBodyScroll} data-testid="s2-menu-body">
          {modelGroups.map((g) => (
            <div key={g.key} className="s2-menu-sec" data-testid={`s2-model-group-${g.key}`}>
              <p className="s2-gh s2-menu-gh s2-group-h" role="presentation">
                <ProviderIcon provider={g.provider === 'codex' ? 'openai' : g.provider} />
                {g.label}
              </p>
              {g.rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r.active}
                  className={`s2-mi s2-mi-model${r.active ? ' is-on' : ''}`}
                  data-testid={r.kind === 'profile' ? 'v3-model-row' : r.kind === 'agentDefault' ? 'agent-default-model' : 'agent-model'}
                  data-agent={r.agent}
                  data-model={r.kind === 'profile' ? r.id : r.id.slice(r.id.indexOf(':') + 1)}
                  title={r.note ? `${r.name}, ${r.note}` : r.title}
                  onClick={r.pick}
                >
                  <span className="s2-slot">
                    <ProviderIcon provider={r.provider} />
                  </span>
                  <span className="s2-mi-name">{r.name}</span>
                  {r.note ? <span className="s2-mi-note">{r.note}</span> : <span className="s2-grow" />}
                  {r.active ? <S2Icon name="check" small /> : null}
                </button>
              ))}
            </div>
          ))}
          {modelGroups.length === 0 && !capsError && modelErr ? (
            <FailureNote testid="s2-model-empty" className="failure-note s2-empty s2-failnote" message="The model list could not be loaded." detail={modelErr} />
          ) : null}
          {/* THE AGENTS: one section. A connected agent is a row that opens its models to the right; one first run found
              and this machine has not registered shows its state with Connect or Sign in on the row (ConnectAgents). */}
          <div className="s2-menu-sec" data-testid="s2-connect" hidden={agentEntries.length === 0 && unconnected === 0}>
            {/* Connected agents head their own section: "Connect an agent" above a Cursor that is already connected read as a to-do. */}
            <p className="s2-gh s2-menu-gh" role="presentation">
              {agentEntries.length > 0 ? 'Agents' : 'Connect an agent'}
            </p>
            {agentEntries.map((e) => (
              <button
                key={e.ref}
                ref={(el) => {
                  if (el) rowEls.current.set(e.ref, el);
                  else rowEls.current.delete(e.ref);
                }}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={!!fly && fly.ref === e.ref}
                aria-controls={fly && fly.ref === e.ref ? `s2-agent-flyout-${e.ref}` : undefined}
                className={`s2-mi s2-mi-model s2-mi-agent${e.active ? ' is-on' : ''}`}
                data-testid="s2-agent-row"
                data-agent={e.ref}
                data-agent-row="true"
                title={`${e.label}: choose a model`}
                onPointerEnter={(ev) => {
                  if (ev.pointerType !== 'touch') hoverAgent(e.ref, ev.currentTarget, { x: ev.clientX, y: ev.clientY });
                }}
                onPointerLeave={() => {
                  hoverItem.current = null;
                  releaseFly();
                }}
                onClick={(ev) => {
                  clickPt.current = ev.detail > 0 ? { x: ev.clientX, y: ev.clientY } : null;
                  if (fly?.ref === e.ref && fly.pinned) closeFly(false);
                  else openFly(e.ref, true, ev.detail === 0);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'ArrowRight') {
                    ev.preventDefault();
                    openFly(e.ref, true, true);
                  }
                }}
              >
                <span className="s2-slot">
                  <ProviderIcon provider={e.provider} />
                </span>
                <span className="s2-mi-name">{e.label}</span>
                <span className="s2-mi-note" data-testid="s2-agent-note">{e.note}</span>
                <S2Icon name="chevr" small />
              </button>
            ))}
            <Suspense fallback={null}>
              <ConnectAgents
                inSection
                sessionId={sessionId}
                onRows={setUnconnected}
                onClose={onClose}
                onConnected={(id) => {
                  /* Connected: its models are what to choose next. */
                  openFly(id, true, false);
                }}
              />
            </Suspense>
          </div>
          </div>
          {/* The pinned foot: reasoning (only with a model chosen) and the add row stay in view whatever scrolls above. */}
          <div className="s2-menu-foot" data-testid="s2-menu-foot">
          {onScheduleAgent && fly && fly.ref !== agentRun ? (
            <button type="button" role="menuitem" className="s2-mi s2-mi-model" data-testid="schedule-agent-switch" onClick={() => { onScheduleAgent(fly.ref); onClose(); }}>
              <span className="s2-mi-name">Schedule switch to {agentName(fly.ref, runsState.agentLabels)}</span>
              <span className="s2-mi-note">After successful turns…</span>
            </button>
          ) : null}
          <EffortFold show={effortChoices.length > 0 && !noModel}>
            <div className="s2-menu-sec s2-effort" data-testid="s2-effort">
              <p className="s2-gh s2-menu-gh s2-effort-gh" role="presentation">
                <span className="s2-effort-word">Effort</span>
                <span className="s2-effort-now" key={effortChoices.find((e) => e.on)?.label ?? ''} data-testid="v3-effort-read">{effortChoices.find((e) => e.on)?.label ?? ''}</span>
                <span className="s2-grow" />
                <span
                  className="s2-effort-help"
                  data-testid="s2-effort-help"
                  title="How long the model thinks before it answers. Faster answers sooner; Smarter thinks longer and costs more."
                  aria-label="About effort"
                  tabIndex={0}

                >
                  ?
                </span>
              </p>
              <ReasoningTrack
                stops={effortChoices}
                recommended={recommendedEffort}
                testidFor={(e) => (agentRun ? 'agent-effort' : `v3-effort-${e.key}`)}
              />
            </div>
          </EffortFold>
          {agentRun ? (
            <button type="button" role="menuitem" className="s2-mi s2-mi-model s2-mi-muted" data-testid="agent-detach" onClick={() => { onClose(); agentRuns.patch((st) => ({ ...st, agents: { ...st.agents, [sessionId]: '' } })); }}>
              <span className="s2-slot">
                <ProviderIcon provider="sequence" />
              </span>
              <span className="s2-mi-name">Use a model instead</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="s2-mi s2-mi-model s2-mi-muted"
            data-testid="s2-add-model"
            onClick={() => {
              onClose();
              store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'provider' } });
            }}
          >
            <span className="s2-slot">
              <S2Icon name="plus" small />
            </span>
            <span className="s2-mi-name">Add a model or agent</span>
          </button>
          </div>
          {compact ? (
            <AgentPage
              entry={open && fly ? agentEntries.find((e) => e.ref === fly.ref) ?? null : null}
              focusFirst={flyFocus}
              onBack={() => closeFly(true)}
              onSchedule={onScheduleAgent && fly && fly.ref !== agentRun ? () => { onScheduleAgent(fly.ref); onClose(); } : undefined}
            />
          ) : null}
        </div>
      ) : null}
      <AgentFlyout
        entry={open && fly && !compact ? agentEntries.find((e) => e.ref === fly.ref) ?? null : null}
        getRow={() => (fly ? rowEls.current.get(fly.ref) ?? null : null)}
        getMenu={() => menuRef.current}
        tick={flyTick}
        focusFirst={flyFocus}
        onLeave={closeFly}
        onHold={holdFly}
        onRelease={releaseFly}
      />
    </div>
  );
}

/**
 * Where the flyout goes: beside the MENU (not over it), top-aligned with its row, kept inside the window.
 * It opens to the right; with no room there it flips to the left (the side with more room when neither fits).
 */
export function flyoutPlacement(
  row: { top: number },
  menu: { left: number; right: number },
  size: { w: number; h: number },
  view: { w: number; h: number },
  gap = 6,
  margin = 8,
): { left: number; top: number; side: 'right' | 'left' } {
  const roomRight = view.w - margin - (menu.right + gap);
  const roomLeft = menu.left - gap - margin;
  const side: 'right' | 'left' = roomRight >= size.w || roomRight >= roomLeft ? 'right' : 'left';
  const raw = side === 'right' ? menu.right + gap : menu.left - gap - size.w;
  const left = Math.max(margin, Math.min(raw, view.w - margin - size.w));
  const top = Math.max(margin, Math.min(row.top - 6, view.h - margin - size.h));
  return { left, top, side };
}

/** The flyout stops growing at about ten rows (32px each, plus its padding) and scrolls inside: a small box, easy to navigate. */
export const FLY_MAX_H = 10 * 32 + 12;

/** How long a pointer must rest on another row before it takes the flyout from the one it was heading to. */
export const AIM_MS = 150;

/**
 * Is the pointer at `pt` inside the triangle from where it was (`from`) to the flyout's near top and bottom corners?
 * Then it is on its way there, whatever rows it crosses.
 */
export function aimingAtFlyout(pt: { x: number; y: number }, from: { x: number; y: number }, fly: { left: number; right: number; top: number; bottom: number }, side: 'right' | 'left'): boolean {
  const x = side === 'right' ? fly.left : fly.right;
  const a = { x, y: fly.top };
  const b = { x, y: fly.bottom };
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y);
  const d1 = cross(pt, from, a);
  const d2 = cross(pt, a, b);
  const d3 = cross(pt, b, from);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

interface AgentFlyoutProps {
  entry: AgentEntry | null;
  getRow: () => HTMLElement | null;
  getMenu: () => HTMLElement | null;
  tick: number;
  focusFirst: { current: boolean };
  onLeave: (returnFocus: boolean) => void;
  onHold: () => void;
  onRelease: () => void;
}

/** The submenu of one agent's models: the same menu surface and rows, set beside the menu. */
function AgentFlyout({ entry, getRow, getMenu, tick, focusFirst, onLeave, onHold, onRelease }: AgentFlyoutProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastEntry = useRef<AgentEntry | null>(entry);
  if (entry) lastEntry.current = entry;
  const shownEntry = entry ?? lastEntry.current;
  const present = useExitPresence(entry !== null, elRef);
  const rowsKey = entry ? entry.rows.map((r) => `${r.name}\u0000${r.note ?? ''}`).join('\u0001') + (entry.failed ?? '') : '';
  /* The latest getters: place() is also a resize listener, and a stale one would still look for the row of the render it was made in. */
  const getters = useRef({ getRow, getMenu });
  getters.current = { getRow, getMenu };
  const place = useCallback(() => {
    const el = elRef.current;
    const row = getters.current.getRow();
    const menu = getters.current.getMenu();
    if (!el || !row || !menu) return;
    const view = { w: window.innerWidth, h: window.innerHeight };
    el.style.maxHeight = `${Math.min(view.h - 16, FLY_MAX_H)}px`;
    const m = menu.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const at = flyoutPlacement(r, m, { w: el.offsetWidth, h: el.offsetHeight }, view);
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
    el.dataset.side = at.side;
  }, []);
  useLayoutEffect(() => {
    if (!entry) return undefined;
    place();
    window.addEventListener('resize', place);
    /* The box is as wide as its rows, so a row that changes (a name, a note, a failure line) changes the width and the
       side it flips to: place again whenever the box itself changes size. */
    const ro = typeof ResizeObserver === 'function' && elRef.current ? new ResizeObserver(() => place()) : null;
    if (ro && elRef.current) ro.observe(elRef.current);
    /* The menu folds (the effort section) and moves the row the flyout is beside: follow it frame by frame. */
    const menuEl = getters.current.getMenu();
    if (ro && menuEl) ro.observe(menuEl);
    return () => {
      window.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, [entry?.ref, entry?.rows.length, rowsKey, tick, place]);
  /* Opened from the keyboard: focus lands on the model in force, else the first. */
  useLayoutEffect(() => {
    if (!entry || !focusFirst.current) return;
    focusFirst.current = false;
    const el = elRef.current;
    (el?.querySelector<HTMLElement>('[aria-checked="true"]') ?? el?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
  }, [entry?.ref, focusFirst]);
  if (!present || !shownEntry) return null;
  const open = entry !== null;
  const onKey = (ev: ReactKeyboardEvent<HTMLElement>) => {
    if (ev.key === 'Escape' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      ev.stopPropagation();
      /* The page's own Escape listeners would close the whole menu: this one only closes the flyout. */
      ev.nativeEvent.stopImmediatePropagation();
      onLeave(true);
      return;
    }
    if (elRef.current && moveMenuFocus(elRef.current, ev.key)) ev.preventDefault();
  };
  /* Not inside the composer: the surface bar and the board dock paint over anything that is, so the flyout is its own
     layer on the page (the .s2 scope carries the tokens, as ConfirmDialog's does). */
  return createPortal(
    <div className="s2 s2-fly-layer">
    <div
      id={`s2-agent-flyout-${shownEntry.ref}`}
      key={shownEntry.ref}
      ref={elRef}
      className="s2-menu s2-menu-fly"
      role={open ? 'menu' : undefined}
      aria-label={`${shownEntry.label} models`}
      aria-hidden={open ? undefined : true}
      data-state={open ? 'open' : 'closing'}
      data-testid={open ? 's2-agent-flyout' : 's2-agent-flyout-closing'}
      data-agent={shownEntry.ref}
      onKeyDown={onKey}
      onPointerEnter={onHold}
      onPointerLeave={onRelease}
    >
      <AgentModelRows entry={shownEntry} />
    </div>
    </div>,
    document.body,
  );
}

/** One agent's models as menu rows, with the one sentence and Retry when it could not list them: the flyout's body, and the drill-in page's. */
function AgentModelRows({ entry: shownEntry }: { entry: AgentEntry }) {
  return (
    <>
    {shownEntry.rows.map((r) => (
      <button
        key={r.id}
        type="button"
        role="menuitemradio"
        aria-checked={r.active}
        className={`s2-mi s2-mi-model${r.active ? ' is-on' : ''}`}
        data-testid={r.kind === 'agentDefault' ? 'agent-default-model' : 'agent-model'}
        data-agent={shownEntry.ref}
        data-model={r.id.slice(r.id.indexOf(':') + 1)}
        title={r.note ? `${r.name}, ${r.note}` : r.kind === 'agent' ? `${r.name}, ${r.title}` : r.title}
        onClick={r.pick}
      >
        <span className="s2-slot">
          <ProviderIcon provider={r.provider} />
        </span>
        <span className="s2-mi-name">{r.name}</span>
        {r.note ? <span className="s2-mi-note">{r.note}</span> : <span className="s2-grow" />}
        {r.active ? <S2Icon name="check" small /> : null}
      </button>
    ))}
    {/* Round 7 (A1), 0.1.5 G1: an agent that could not list its models says so, once, with one Retry; the row above still attaches it. */}
    {shownEntry.failed ? (
      <div className="s2-caps-err" role="presentation" data-testid="s2-model-caps-error" data-agent={shownEntry.ref}>
        <FailureNote className="failure-note s2-failnote s2-caps-err-text" message="This agent's models could not be loaded." detail={shownEntry.failed} />
        <button
          type="button"
          role="menuitem"
          className="s2-btn s2-btn-sm"
          data-testid="s2-model-caps-retry"
          onClick={() => void import('../agents/agentRunner').then((m) => m.loadCapabilities(agentRuns, shownEntry.ref, (input, init) => fetch(input, init), true))}
        >
          Retry
        </button>
      </div>
    ) : null}
    </>
  );
}

/**
 * THE DRILL-IN (narrow windows): an agent's page slides in over the menu with a back row at its top, as an iOS menu does.
 * A flyout beside the menu would cover the row that opened it (the sweep: Cursor's models over Cursor's row at 390 px).
 */
function AgentPage({ entry, focusFirst, onBack, onSchedule }: { entry: AgentEntry | null; focusFirst: { current: boolean }; onBack: () => void; onSchedule?: () => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastEntry = useRef<AgentEntry | null>(entry);
  if (entry) lastEntry.current = entry;
  const shown = entry ?? lastEntry.current;
  const present = useExitPresence(entry !== null, elRef);
  useLayoutEffect(() => {
    if (!entry || !focusFirst.current) return;
    focusFirst.current = false;
    const el = elRef.current;
    (el?.querySelector<HTMLElement>('[aria-checked="true"]') ?? el?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
  }, [entry?.ref, focusFirst]);
  if (!present || !shown) return null;
  const open = entry !== null;
  return (
    <div
      ref={elRef}
      className="s2-menu-page"
      role={open ? 'menu' : undefined}
      aria-label={`${shown.label} models`}
      aria-hidden={open ? undefined : true}
      data-state={open ? 'open' : 'closing'}
      data-testid={open ? 's2-agent-page' : 's2-agent-page-closing'}
      data-agent={shown.ref}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape' || ev.key === 'ArrowLeft') return;
        if (elRef.current && moveMenuFocus(elRef.current, ev.key)) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      }}
    >
      <button type="button" role="menuitem" className="s2-mi s2-mi-model s2-mi-back" data-testid="s2-agent-back" aria-label="Back to the model menu" onClick={onBack}>
        <span className="s2-slot">
          <S2Icon name="chevl" small />
        </span>
        <span className="s2-mi-name">{shown.label}</span>
      </button>
      <AgentModelRows entry={shown} />
      {onSchedule ? <button type="button" role="menuitem" className="s2-mi s2-mi-model" data-testid="schedule-agent-switch-compact" onClick={onSchedule}><span className="s2-mi-name">Schedule switch to {shown.label}</span></button> : null}
    </div>
  );
}
