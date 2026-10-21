/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT'S LIVE CARDS IN THE CHAT, AND THE SAVED ONES BACK AFTER A RELOAD
   packages/web2/src/genui/chatSurfacesImpl.tsx (the lazy half; chatSurfaces.tsx is the part the chat imports)

   The MCP `ui` tool posts ops to /api/genui/ingest?session=<chat id>; the server streams them on
   GET /api/genui/events?session=<chat id> (agent.ts HttpAgent speaks the same frames). One `ChatGenUI`
   belongs to one open chat:

     while an agent turn runs   one EventSource on that chat's events; each frame goes to the session of the
                                turn that is running (a GenUISession per turn, onSettled = persistSettled)
     on load                    listChatSurfaces(chatId) puts each saved surface back at its turn
     chat switch, unmount       the stream is closed

   `<TurnSurfaces turnId />` draws a turn's cards where the transcript draws that turn (an agent run's foot, an
   assistant message): live ones with GenUISurface, saved ones with GenUISavedSurface (still, buttons off). A
   surface that is live and saved shows once, live. The turn key is the agent run's id or the assistant turn's id.
   ══════════════════════════════════════════════════════════════════════════ */
import { actionToPrompt, type UIAction } from '@sequence/genui';

import { HttpAgent, type AgentToUI } from './agent';
import { GENUI_ACTION_EVENT, GENUI_TURN_EVENT, type GenUIActionDetail } from './chatActions';
import { GenUISavedSurface } from './GenUISavedSurface';
import { GenUISurface } from './GenUISurface';
import { GenUISession, type SessionView } from './session';
import { writeSurfaceMark } from './surfaceMarks';
import { listChatSurfaces, persistSettled, type SavedSurface } from './surfaceStore';

export interface EventSourceLike {
  onmessage: ((m: { data: string }) => void) | null;
  close(): void;
}

export interface ChatGenUIOptions {
  open?: (url: string) => EventSourceLike;
  list?: (chatId: string) => Promise<SavedSurface[]>;
}

/** A click goes to the chat (chatActions.ts), which sends it as a turn or steers it; there is no second path. */
class StreamAgent extends HttpAgent {
  lookup: (a: UIAction) => { label?: string; whileBusy?: boolean } = () => ({});
  constructor(chatId: string) {
    super('/api/genui', chatId);
  }
  start(): void {}
  sendAction(a: UIAction): void {
    const { label, whileBusy } = this.lookup(a);
    const detail: GenUIActionDetail = { action: a, prompt: actionToPrompt(a, label), whileBusy: whileBusy === true };
    window.dispatchEvent(new CustomEvent(GENUI_ACTION_EVENT, { detail }));
  }
}

interface TurnSession {
  agent: StreamAgent;
  session: GenUISession;
  off: () => void;
}

export type TurnCard =
  | { kind: 'live'; key: string; view: SessionView['surfaces'][number]; busy: boolean }
  | { kind: 'saved'; key: string; saved: SavedSurface }
  | { kind: 'drawing'; key: string };

export class ChatGenUI {
  private turns = new Map<string, TurnSession>();
  private saved: SavedSurface[] = [];
  private es: EventSourceLike | null = null;
  private turn: string | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private disposed = false;
  private offTurnEvent: (() => void) | null = null;
  /** Surfaces the server reset for this late client (surface id to the turn it belongs to), until a live frame or the pass end. */
  private drawing = new Map<string, string>();

  constructor(readonly chatId: string, private opts: ChatGenUIOptions = {}) {}

  /** Read the chat's saved surfaces. */
  load(): void {
    void (this.opts.list ?? listChatSurfaces)(this.chatId).then((rows) => {
      if (this.disposed) return;
      this.saved = rows;
      writeSurfaceMark(this.chatId, rows.length > 0);
      this.bump();
    });
  }

  /** The turn that live cards attach to (the running agent run, or the assistant turn in flight). */
  setTurn(turnId: string | null): void {
    this.turn = turnId;
  }

  /** Open this chat's events stream (once). */
  connect(): void {
    if (this.es || this.disposed) return;
    /* A page without EventSource (a test DOM, an old webview) simply has no live cards; saved ones still draw. */
    if (!this.opts.open && typeof EventSource === 'undefined') return;
    const url = `/api/genui/events?session=${encodeURIComponent(this.chatId)}`;
    const es = (this.opts.open ?? ((u) => new EventSource(u) as unknown as EventSourceLike))(url);
    es.onmessage = (m) => {
      let e: AgentToUI;
      try {
        e = JSON.parse(m.data) as AgentToUI;
      } catch {
        return;
      }
      this.route(e);
    };
    this.es = es;
    /* The chat says when its turn starts and ends: the sessions read it as `turn` (a clicked button's spinner clears). */
    const on = (ev: Event): void => {
      const busy = (ev as CustomEvent<{ busy?: boolean }>).detail?.busy === true;
      for (const t of this.turns.values()) t.agent.emit({ kind: 'turn', busy });
    };
    window.addEventListener(GENUI_TURN_EVENT, on);
    this.offTurnEvent = () => window.removeEventListener(GENUI_TURN_EVENT, on);
  }

  get open(): boolean {
    return this.es !== null;
  }

  /** Close the stream. The cards already drawn stay. */
  disconnect(): void {
    this.es?.close();
    this.es = null;
    this.offTurnEvent?.();
    this.offTurnEvent = null;
  }

  dispose(): void {
    this.disconnect();
    this.disposed = true;
    for (const t of this.turns.values()) {
      t.off();
      t.session.dispose();
    }
    this.turns.clear();
    this.listeners.clear();
  }

  private sessionFor(turnId: string): TurnSession {
    let t = this.turns.get(turnId);
    if (!t) {
      const agent = new StreamAgent(this.chatId);
      const save = persistSettled(this.chatId, turnId);
      const session = new GenUISession(agent, {
        onSettled: (surfaceId, spec) => {
          writeSurfaceMark(this.chatId, true);
          save(surfaceId, spec);
        },
      });
      const off = session.subscribe(() => this.bump());
      agent.lookup = (a) => {
        const spec = session.get().surfaces.find((s) => s.id === a.surfaceId)?.spec;
        return { label: String(spec?.elements[a.elementId]?.props.label ?? '') || undefined, whileBusy: spec?.actions[a.name]?.whileBusy };
      };
      t = { agent, session, off };
      this.turns.set(turnId, t);
    }
    return t;
  }

  private route(e: AgentToUI): void {
    const turnId = this.turn ?? [...this.turns.keys()].pop() ?? 'turn';
    if (e.kind === 'ui.reset') {
      this.drawing.set(e.surfaceId, turnId);
      this.load();
    } else if ('surfaceId' in e && this.drawing.delete(e.surfaceId)) {
      /* A live frame draws the card itself; the end of the pass may have saved it meanwhile. */
      if (e.kind === 'ui.end') this.load();
      this.bump();
    }
    this.sessionFor(turnId).agent.emit(e);
  }

  click(turnId: string, surfaceId: string, elementId: string): void {
    this.turns.get(turnId)?.session.click(surfaceId, elementId);
  }

  /** The cards of one turn, in the order they were drawn; a saved row the live session also holds is not repeated. */
  cardsFor(turnId: string): TurnCard[] {
    const t = this.turns.get(turnId);
    const view = t?.session.get();
    const live: TurnCard[] = (view?.surfaces ?? []).map((s) => ({ kind: 'live', key: `live:${s.id}`, view: s, busy: view!.busy }));
    const have = new Set((view?.surfaces ?? []).map((s) => s.id));
    const kept: TurnCard[] = this.saved.filter((s) => s.turn === turnId && !have.has(s.surface)).map((s) => ({ kind: 'saved', key: `saved:${s.surface}`, saved: s }));
    const saved = new Set(this.saved.map((s) => s.surface));
    const drawing: TurnCard[] = [...this.drawing]
      .filter(([id, turn]) => turn === turnId && !have.has(id) && !saved.has(id))
      .map(([id]) => ({ kind: 'drawing', key: `drawing:${id}` }));
    return [...kept, ...live, ...drawing];
  }

  /** A turn's cards drawn where the transcript draws that turn (TurnSurfaces in chatSurfaces.tsx calls this once the chunk is in). */
  renderCards(turnId: string): JSX.Element | null {
    const cards = this.cardsFor(turnId);
    if (cards.length === 0) return null;
    return (
      <>
        {cards.map((c) => (
          <div key={c.key} className="gu-turn-surface" data-testid="genui-turn-surface" data-turn={turnId}>
            {c.kind === 'live' ? (
              <GenUISurface view={c.view} busy={c.busy} onClick={(sid, eid) => this.click(turnId, sid, eid)} />
            ) : c.kind === 'saved' ? (
              <GenUISavedSurface saved={c.saved} />
            ) : (
              <div className="gu-skel" aria-busy="true">
                <span className="gu-skel-label">This card is still being drawn</span>
              </div>
            )}
          </div>
        ))}
      </>
    );
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = (): number => this.version;
  private bump(): void {
    this.version++;
    for (const f of [...this.listeners]) f();
  }
}
