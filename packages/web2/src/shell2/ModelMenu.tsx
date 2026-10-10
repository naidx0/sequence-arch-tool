/* ══════════════════════════════════════════════════════════════════════════
   THE MODEL PILL AND ITS MENU (Decision 49)
   packages/web2/src/shell2/ModelMenu.tsx

   Moved out of v3/V3Chat.tsx whole (round 7), so the agents lane owns it and
   the shell lane owns the composer around it. The pill names the model; its
   menu lists Sequence's models, then each agent's, then the reasoning slider.
   Open/close state stays with the composer, which also closes the other menus.
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

import { activeAgentModel, defaultModelLabel } from '../agents/activeModel';
import { defaultNickname } from '../chat/modelNames';
import { displayModelName, tidyModelName } from '../chat/modelNickname';
import { agentRuns } from '../agents/agentRuns';
import { CONNECT_AGENT_LABEL } from '../chat/composerModel';
import { ReasoningTrack } from './ReasoningTrack';
import type { ModelPickerProfile, ReasoningEffort } from '../chat/modelPicker';
import { useStore } from '../state';
import { ProviderIcon, modelGroupOf, providerLabel, providerOf, type ModelIdentity, type ProviderKey } from './brandIcons';
import { S2Icon, type S2IconName } from './icons';

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
 * `[data-state='closing']`, --dur-2), then goes. Where nothing animates
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

/** A saved model's name: the one the person gave it, else the auto nickname. */
export function profileName(pr: { nickname: string; model: string; provider: string }): string {
  return displayModelName(pr.model, pr.nickname === defaultNickname(pr.model, pr.provider) ? null : pr.nickname);
}

/** A stop's label: Off for none/minimal, Auto for the default, X-High and Max kept apart, else the word capitalised. */
export function effortLabelOf(e: string): string {
  if (e === 'none' || e === 'minimal') return 'Off';
  if (e === 'default' || e === 'auto') return 'Auto';
  if (e === 'xhigh') return 'X-High';
  if (e === 'max') return 'Max';
  return e.charAt(0).toUpperCase() + e.slice(1);
}

export function ModelMenu({
  wrapRef,
  open,
  onTrigger,
  onClose,
  sessionId,
  agentRun,
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
      onClose();
      triggerEl()?.focus();
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
  const menuShown = useExitPresence(open, menuRef);
  const modeMenuShown = useExitPresence(modeOpen, modeMenuRef);
  const runsState = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const chipName = agentRun || modelChipShort;
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
  const agentConfig = runsState.config ?? {};
  type Row = { id: string; kind: 'profile' | 'agent' | 'agentDefault'; agent?: string; name: string; note: string; provider: ProviderKey; active: boolean; title: string; pick: () => void };
  type Group = { key: string; label: string; provider: ProviderKey; rows: Row[]; failed: { ref: string; error: string }[] };
  const byKey = new Map<string, Group>();
  const groupFor = (key: string, label: string, provider: ProviderKey): Group => {
    let g = byKey.get(key);
    if (!g) {
      g = { key, label, provider, rows: [], failed: [] };
      byKey.set(key, g);
    }
    return g;
  };
  /* Local, Claude and OpenAI hold both the saved models and the agents of that
     provider; any other agent gets a group named after itself. */
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
     decides (a disconnected agent leaves at once); until then, what the page has asked about. */
  const agentRefs = [...new Set([...(runsState.registered ?? [...Object.keys(allCaps), ...Object.keys(runsState.capsError ?? {})]), ...(agentRun ? [agentRun] : [])])].sort();
  for (const ref of agentRefs) {
    const caps = allCaps[ref];
    const prov = providerOf(ref);
    const key = prov === 'claude' ? 'claude' : prov === 'codex' || prov === 'openai' ? 'openai' : ref;
    const g = groupFor(key, key === ref ? ref.charAt(0).toUpperCase() + ref.slice(1) : providerLabel(prov), prov);
    if (!caps || caps.models.length === 0) {
      /* No list to choose from: the agent itself, on the model it picks by default. One click attaches it. */
      const failedWhy = runsState.capsError?.[ref];
      if (failedWhy) g.failed.push({ ref, error: failedWhy });
      const agentName = ref.charAt(0).toUpperCase() + ref.slice(1);
      /* In a provider's group the row names the agent (OpenAI: Codex); in the agent's own group the header already
         does, so the row names the model (Hang: Hang default), never the agent's name twice. */
      const ownGroup = g.key === ref;
      g.rows.push({
        id: `${ref}:`,
        kind: 'agentDefault',
        agent: ref,
        name: ownGroup ? defaultModelLabel(ref) : agentName,
        note: caps ? 'Its default model' : failedWhy ? 'Its default model (list unreadable)' : 'Reading its models…',
        provider: prov === 'codex' ? 'openai' : prov,
        active: agentRun === ref,
        title: `${agentName}, on the model it uses by default`,
        pick: () => {
          const sid = sessionId;
          agentRuns.patch((st) => ({ ...st, agents: { ...st.agents, [sid]: ref } }));
          onClose();
        },
      });
      continue;
    }
    const chosen = activeAgentModel(runsState, ref, sessionId || null).id ?? caps.models[0]?.id;
    for (const m of caps.models) {
      g.rows.push({
        id: `${ref}:${m.id}`,
        kind: 'agent',
        name: tidyModelName(m.name || m.id),
        note: m.description ?? '',
        provider: prov === 'codex' ? 'openai' : prov,
        active: agentRun === ref && chosen === m.id,
        title: m.id,
        pick: () => {
          const sid = sessionId;
          agentRuns.patch((st) => ({
            ...st,
            agents: { ...st.agents, [sid]: ref },
            config: { ...st.config, [ref]: { ...st.config?.[ref], model: m.id } },
          }));
          /* The menu stays open: the effort below is the model's, chosen next. */
        },
      });
    }
  }
  const modelGroups = [...byKey.values()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.key);
    const ib = GROUP_ORDER.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const agentEfforts = (() => {
    if (!agentRun) return [] as string[];
    const caps = allCaps[agentRun];
    const chosen = agentConfig[agentRun]?.model ?? caps?.models.find((m) => m.isDefault)?.id;
    const m = caps?.models.find((x) => x.id === chosen);
    return m?.efforts.length ? m.efforts : (caps?.efforts ?? []);
  })();
  /* The effort in force: the one chosen, else the chosen model's default, else
     Medium where offered, else the first. Always one pill is the filled one. */
  const agentEffort = (() => {
    if (!agentRun) return undefined;
    const caps = allCaps[agentRun];
    const chosenModel = agentConfig[agentRun]?.model ?? caps?.models.find((m) => m.isDefault)?.id ?? caps?.models[0]?.id;
    const set = agentConfig[agentRun]?.effort;
    if (set && agentEfforts.includes(set)) return set;
    const def = caps?.models.find((m) => m.id === chosenModel)?.defaultEffort;
    if (def && agentEfforts.includes(def)) return def;
    return agentEfforts.includes('medium') ? 'medium' : agentEfforts[0];
  })();
  /* The level the model recommends: the agent model's stated default, else Medium where offered. */
  const recommendedEffort = (() => {
    if (!agentRun) return 'medium';
    const caps = allCaps[agentRun];
    const chosenModel = agentConfig[agentRun]?.model ?? caps?.models.find((m) => m.isDefault)?.id ?? caps?.models[0]?.id;
    const def = caps?.models.find((m) => m.id === chosenModel)?.defaultEffort;
    if (def && agentEfforts.includes(def)) return def;
    return agentEfforts.includes('medium') ? 'medium' : undefined;
  })();
  const effortChoices: { key: string; label: string; title: string; on: boolean; pick: () => void }[] = agentRun
    ? agentEfforts.map((e) => ({
        key: e,
        /* "Off" where the agent reports none or minimal reasoning. */
        label: effortLabelOf(e),
        title: `${effortLabelOf(e)} reasoning`,
        on: e === agentEffort,
        pick: () => agentRuns.patch((st) => ({ ...st, config: { ...st.config, [agentRun]: { ...st.config?.[agentRun], effort: e } } })),
      }))
    : EFFORT_ROWS.map((row) => ({
        key: row.key,
        label: row.key === 'medium' ? 'Medium' : row.label,
        title: row.description,
        on: effort === row.key,
        pick: () => pickEffort(row.key),
      }));

  /* THE COMPOSER PILL: one plain pill, two buttons: [mode icon] [provider icon] [model nickname].
     The mode is its icon only (its word is the accessible name); the model part ellipsises, its full name in the title.
     Everything else is in the popup. */
  const activeProfile = profiles.find((p) => p.active);
  const chipProvider: ProviderKey = agentRun ? (providerOf(agentRun) === 'codex' ? 'openai' : providerOf(agentRun)) : chipIdentity ? modelGroupOf(chipIdentity).icon : activeProfile ? modelGroupOf(activeProfile).icon : 'sequence';
  const noModel = !agentRun && modelChipShort === CONNECT_AGENT_LABEL;
  /* Nickname first: a saved model's is already one (profileName); an agent's label is tidied the same way. */
  const chipText = agentModel ? tidyModelName(agentModel.label) : modelChipShort === CONNECT_AGENT_LABEL ? modelChipShort : modelChip;
  const mode = modes.find((m) => m.key === currentMode) ?? modes[0];
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
          title={`${fullTitle}, ${effortLabel} reasoning`}
          aria-label={`${agentRun ? `Agent: ${chipName}, model: ${agentModel?.label}` : `Model: ${modelChip}`}, reasoning ${effortLabel}`}
          onClick={() => {
            setModeOpen(false);
            onTrigger();
          }}
          onKeyDown={onChipKey}
        >
          <ProviderIcon provider={chipProvider} />
          <span className="s2-pill-l" data-testid="v3-model-label">{chipText}</span>
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
          aria-label="Mode, model and reasoning"
          aria-hidden={open ? undefined : true}
          data-state={open ? 'open' : 'closing'}
          data-testid={open ? 's2-model-menu' : 's2-model-menu-closing'}
          onKeyDown={onMenuKey}
        >
          <div className="s2-menu-body" ref={bodyRef} onScroll={syncMore} data-testid="s2-menu-body">
          {modes.length > 0 ? (
            <div className="s2-menu-sec s2-modes" role="presentation" data-testid="s2-mode-menu">
              <p className="s2-gh s2-menu-gh" role="presentation">
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
                  data-testid={`s2-mode-${m.key}`}
                  data-mode={m.key}
                  title={`${m.label}: ${m.desc}`}
                  onPointerEnter={() => onModeIntent?.(m.key)}
                  onFocus={() => onModeIntent?.(m.key)}
                  onClick={() => onMode(m.key)}
                >
                  <ModeGlyph mode={m.key} icon={m.icon} />
                  <span className="s2-mi-name">{m.label}</span>
                  <span className="s2-mi-note">{m.desc}</span>
                  {currentMode === m.key ? <S2Icon name="check" small /> : null}
                </button>
              ))}
            </div>
          ) : null}
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
              {/* Round 7 (A1), 0.1.5 G1: an agent that could not list its models says so in its own group, once,
                  with one Retry, whether or not the chat is on it yet; the row above still attaches it. */}
              {g.failed.map((f) => (
                <div key={f.ref} className="s2-caps-err" role="presentation" data-testid="s2-model-caps-error" data-agent={f.ref}>
                  <FailureNote className="failure-note s2-failnote s2-caps-err-text" message="This agent's models could not be loaded." detail={f.error} />
                  <button
                    type="button"
                    role="menuitem"
                    className="s2-btn s2-btn-sm"
                    data-testid="s2-model-caps-retry"
                    onClick={() => void import('../agents/agentRunner').then((m) => m.loadCapabilities(agentRuns, f.ref, (input, init) => fetch(input, init), true))}
                  >
                    Retry
                  </button>
                </div>
              ))}
            </div>
          ))}
          {modelGroups.length === 0 && !capsError && modelErr ? (
            <FailureNote testid="s2-model-empty" className="failure-note s2-empty s2-failnote" message="The model list could not be loaded." detail={modelErr} />
          ) : null}
          {/* The agents first run found and this machine has not registered: one click connects. */}
          <Suspense fallback={null}>
            <ConnectAgents sessionId={sessionId} onConnected={onClose} />
          </Suspense>
          </div>
          {/* The pinned foot: reasoning (only with a model chosen) and the add row stay in view whatever scrolls above. */}
          <div className="s2-menu-foot" data-testid="s2-menu-foot">
          {effortChoices.length > 0 && !noModel ? (
            <div className="s2-menu-sec s2-effort" data-testid="s2-effort">
              <p className="s2-gh s2-menu-gh s2-effort-gh" role="presentation">
                <span className="s2-effort-word">Effort</span>
                <span className="s2-effort-now" data-testid="v3-effort-read">{effortChoices.find((e) => e.on)?.label ?? ''}</span>
                <span className="s2-grow" />
                <span
                  className="s2-effort-help"
                  data-testid="s2-effort-help"
                  title="How long the model thinks before it answers. Faster answers sooner; Smarter thinks longer and costs more."
                  aria-label="About effort"
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
          ) : null}
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
        </div>
      ) : null}
    </div>
  );
}
