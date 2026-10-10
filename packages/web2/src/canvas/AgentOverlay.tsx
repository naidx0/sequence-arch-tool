/* ══════════════════════════════════════════════════════════════════════════
   AGENT OVERLAY — "agent is here", live on the board
   packages/web2/src/canvas/AgentOverlay.tsx

   Mounted once where the board renders. It draws nothing of its own: it marks
   the board's existing nodes and connectors with `data-agent-here` /
   `data-agent-edge` (live → fading → removed, see agents/overlayModel.ts),
   and agents/agents.css paints those in the accent.

   WHY ATTRIBUTES ON THE BOARD'S DOM AND NOT PROPS INTO IT. The board belongs
   to another lane, and a light that lasts ten seconds must not re-render a
   board of hundreds of cards. React leaves attributes it does not manage
   alone, and a card that remounts (a zoom rung change) is re-marked on the
   next tick.

   Marks are applied in the SAME task as the SSE message that caused them, so
   hook-to-highlight latency is the network and nothing else.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect } from 'react';

import '../agents/agents.css';
import { agentStore, type AgentStore } from '../agents/agentStream.js';
import type { AgentActivity } from '../agents/agentActivity.js';
/* Loaded when needed, not imported: a static import here would join this
   lazy chunk's preload list in the boot entry and cost boot bytes (perf
   ratchet). */
/* From the chat composer's chunk (it re-exports agentActivity), so the
   strip's data is not a chunk of its own named in the boot preload list. */
const loadActivity = () => import('../chat/agentComposer.js');
import { agentRuns, type AgentRunStore } from '../agents/agentRuns.js';
import { useAppState } from '../state/index.js';
import { LightBook, edgeKeyFromLabel, targetsOf } from '../agents/overlayModel.js';
import type { AgentNode } from '../agents/agentTypes.js';
import { CHIP_H, chipWidth, placeChips } from './agentChipLayout';
import type { ChipInput, ChipObstacle } from './agentChipLayout';

const VERB: Record<string, string> = {
  edit: 'editing',
  read: 'reading',
  search: 'searching',
  execute: 'running',
  delete: 'deleting',
  move: 'moving',
  fetch: 'fetching',
  think: 'thinking',
};

/**
 * The chip a lit card wears: who is there and what it is doing, e.g.
 * "Main agent: editing accessMode.ts". The agent is the nearest subagent
 * above the call ("Main agent" for the session itself); the action is the
 * call's kind as a verb and the touched file's name.
 */
export function chipFor(call: AgentNode, nodes: ReadonlyMap<string, AgentNode>, boardId: string, doing: string | null = null): string {
  let cur = call.parentId ? nodes.get(call.parentId) : undefined;
  const seen = new Set<string>();
  while (cur && cur.kind !== 'subagent' && cur.kind !== 'session' && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = cur.parentId ? nodes.get(cur.parentId) : undefined;
  }
  const who = cur?.kind === 'subagent' ? cur.title : 'Main agent';
  const hit = call.locations.find((l) => [l.fileNodeId, l.moduleId, l.serviceId].includes(boardId)) ?? call.locations[0];
  const file = hit ? (hit.path.split(/[\\/]/).pop() ?? hit.path) : '';
  /* The chat's agent strip says what the agent is doing now (agentActivity,
     S2b); when it does, the chip says the same words, so the board and the
     composer never disagree. Otherwise the call's own kind. */
  /* No "·" separators (Decision 49): the agent, a colon, what it does. */
  if (doing) return `${who}: ${doing}${file ? `, ${file}` : ''}`;
  const verb = (call.stepKind && VERB[call.stepKind]) ?? (call.toolKind ? call.toolKind.toLowerCase() : 'working');
  return `${who}: ${verb}${file ? ` ${file}` : ''}`;
}

/* THE BOARD CARRIES NO AGENT STATUS LINE (Decision 49, Jaden: no status in
   the board header). The shell's bottom status bar owns the agent's state;
   on the board an agent's activity is marked on the nodes it touches only. */

/**
 * The overlay as the board mounts it (preloadable.tsx loads `AgentOverlay`):
 * the chat on screen comes from the store here, inside the lazy chunk, so the
 * board's boot code is byte-for-byte what it was. `AgentLights` below is the
 * store-free part, which the tests mount directly.
 */
export function AgentOverlay(props: Omit<Parameters<typeof AgentLights>[0], 'sessionId'>): JSX.Element {
  const state = useAppState();
  return <AgentLights {...props} sessionId={state.session.activeId} />;
}

/** How long after the first board the stream opens (out of the boot window). */
export const STREAM_DELAY_MS = 1500;

const NODE_SEL = '[data-testid="board-node"][data-node-id]';
const EDGE_SEL = '.react-flow__edge';
const TICK_MS = 250;

export function AgentLights({
  store = agentStore,
  root,
  delayMs,
  sessionId = null,
  runs = agentRuns,
}: {
  store?: AgentStore;
  root?: () => ParentNode | null;
  /** The chat on screen: its agent's doing line and todos (agentActivity). */
  sessionId?: string | null;
  runs?: AgentRunStore;
  /** The stream opens this long after mount, so the first board's boot
   *  requests do not include it. Default: STREAM_DELAY_MS for the page's
   *  store, 0 for a store handed in (it opens no stream of its own). */
  delayMs?: number;
}): null {
  const wait = delayMs ?? (store === agentStore ? STREAM_DELAY_MS : 0);
  useEffect(() => {
    const delayMs = wait;
    const book = new LightBook();
    /* Per lit board node: its chip text and a pulse token that flips on every
       new touch, so the CSS pulse runs once per touch. */
    const chips = new Map<string, { text: string; pulse: 'a' | 'b'; at: number }>();
    let timer: ReturnType<typeof setInterval> | null = null;
    const scope = (): ParentNode => root?.() ?? document;

    /* Null until the module is in (one tick after mount); then the repaint below. */
    let gone = false;
    let derive: ((s: ReturnType<AgentRunStore['get']>, id: string | null) => AgentActivity | null) | null = null;
    const activity = (): AgentActivity | null => (derive ? derive(runs.get(), sessionId) : null);
    const paint = (): void => {
      const phases = book.phases(Date.now());
      const s = store.get();
      const focused = s.focusId ? s.nodes.get(s.focusId) : undefined;
      const held = focused ? targetsOf(focused.locations) : null;
      const doc = scope();
      const litChips: (ChipInput & { el: HTMLElement })[] = [];
      doc.querySelectorAll<HTMLElement>(NODE_SEL).forEach((el) => {
        const id = el.getAttribute('data-node-id') ?? '';
        const phase = held?.nodes.has(id) ? 'live' : phases.get(`n:${id}`);
        if (phase) {
          if (el.getAttribute('data-agent-here') !== phase) el.setAttribute('data-agent-here', phase);
          const chip = chips.get(id);
          if (chip) {
            if (el.getAttribute('data-agent-chip') !== chip.text) el.setAttribute('data-agent-chip', chip.text);
            if (el.getAttribute('data-agent-pulse') !== chip.pulse) el.setAttribute('data-agent-pulse', chip.pulse);
            /* A card in the pane's right half hangs its chip from its right
               edge, so the chip grows into the pane, not past it. */
            const pane = el.closest('.react-flow')?.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            const side = pane && pane.width > 0 && r.left + r.width / 2 > pane.left + pane.width / 2 ? 'end' : 'start';
            if (el.getAttribute('data-agent-chip-side') !== side) el.setAttribute('data-agent-chip-side', side);
            /* Round 9, ask 25: where this chip would sit on screen, so chips that
               would overlap (a zoomed-out board) can stack or yield below. */
            if (pane && pane.width > 0 && r.width > 0) {
              const w = chipWidth(chip.text);
              const x0 = side === 'end' ? r.right - w : r.left;
              litChips.push({ el, id, x0, x1: x0 + w, y0: r.top - 4 - CHIP_H, priority: chip.at });
            }
          }
        } else {
          if (el.hasAttribute('data-agent-here')) el.removeAttribute('data-agent-here');
          if (el.hasAttribute('data-agent-chip')) el.removeAttribute('data-agent-chip');
          if (el.hasAttribute('data-agent-pulse')) el.removeAttribute('data-agent-pulse');
          if (el.hasAttribute('data-agent-chip-side')) el.removeAttribute('data-agent-chip-side');
          if (el.hasAttribute('data-agent-chip-hidden')) el.removeAttribute('data-agent-chip-hidden');
          if (el.style.getPropertyValue('--agent-chip-lane')) el.style.removeProperty('--agent-chip-lane');
          chips.delete(id);
        }
      });
      /* The other cards on screen are obstacles, so a chip is not drawn across a
         neighbour's face either. Read only while some chip is lit. */
      const obstacles: ChipObstacle[] = [];
      if (litChips.length > 0) {
        doc.querySelectorAll<HTMLElement>(NODE_SEL).forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0) obstacles.push({ id: el.getAttribute('data-node-id') ?? '', x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
        });
      }
      for (const placement of placeChips(litChips, obstacles)) {
        const el = litChips.find((c) => c.id === placement.id)!.el;
        const lane = String(placement.lane);
        if (el.style.getPropertyValue('--agent-chip-lane') !== lane) el.style.setProperty('--agent-chip-lane', lane);
        if (placement.hidden) {
          if (el.getAttribute('data-agent-chip-hidden') !== 'true') el.setAttribute('data-agent-chip-hidden', 'true');
        } else if (el.hasAttribute('data-agent-chip-hidden')) el.removeAttribute('data-agent-chip-hidden');
      }
      doc.querySelectorAll<SVGGElement>(EDGE_SEL).forEach((el) => {
        const key = edgeKeyFromLabel(el.getAttribute('aria-label'));
        const phase = key ? (held?.edges.has(key) ? 'live' : phases.get(`e:${key}`)) : undefined;
        if (phase) {
          if (el.getAttribute('data-agent-edge') !== phase) el.setAttribute('data-agent-edge', phase);
        } else if (el.hasAttribute('data-agent-edge')) el.removeAttribute('data-agent-edge');
      });
      const busy = book.size() > 0 || !!held;
      if (busy && !timer) timer = setInterval(paint, TICK_MS);
      if (!busy && timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    let off: (() => void) | null = null;
    const start = (): void => {
      off = store.subscribe((s, changed) => {
        if (book.touch(changed, Date.now())) {
          for (const n of changed) {
            if (n.kind !== 'tool_call' || !n.locations.length || !book.holds(n.id)) continue;
            for (const id of targetsOf(n.locations).nodes) {
              const had = chips.get(id);
              chips.set(id, { text: chipFor(n, s.nodes, id, activity()?.doing ?? null), pulse: had?.pulse === 'a' ? 'b' : 'a', at: Date.now() });
            }
          }
        }
        paint();
      });
      paint();
    };
    /* The run store moves on every agent event of this chat: repaint, so the
       status line and the next chip follow the doing line. */
    /* ONE REPAINT PER FRAME, not one per event: a streaming run moves this store ~20 times a second
       per chat (and every chat's runs move it), and each paint reads layout for every card on the
       board. Measured with three chats streaming: 228 ms of paint in 6 s of the page
       (tools/measure/stream-bench.mjs). */
    let frame = 0;
    const paintNextFrame = (): void => {
      if (frame) return;
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
      frame = raf(() => {
        frame = 0;
        if (!gone) paint();
      });
    };
    const offRuns = runs.subscribe(paintNextFrame);
    void loadActivity().then((m) => {
      if (gone) return;
      derive = m.agentActivity;
      paint();
    });
    /* THE STREAM OPENS AFTER THE FIRST BOARD (boot calls 14 -> 13): the
       overlay still lights from a closed panel, it just starts listening
       STREAM_DELAY_MS later. A replay on connect catches up anything earlier. */
    const delay = delayMs > 0 ? setTimeout(start, delayMs) : null;
    if (delayMs <= 0) start();
    return () => {
      if (delay) clearTimeout(delay);
      gone = true;
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      off?.();
      offRuns();
      if (timer) clearInterval(timer);
      book.phases(Number.POSITIVE_INFINITY);
      paint();
    };
  }, [store, root, wait, sessionId, runs]);
  return null;
}
