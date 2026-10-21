/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT SIDE OF A GENERATIVE UI SESSION
   packages/web2/src/genui/agent.ts

   One interface, three ways to fill it:
     MockAgent    a scripted stream (mockScript.ts): demos and tests, no key
     HttpAgent    the app's /api/genui routes: a real agent (Claude Code, Codex,
                  an API model) behind the analyzer, events over SSE
     (fence)      an agent that only writes text: a ```genui fence in a chat
                  message, rendered by GenUIFence.tsx with the same pipeline

   agent -> ui   ui.text (JSONL chunks), ui.ops (structured, from a tool call),
                 ui.end (this pass is finished: validate + repair), turn (busy)
   ui -> agent   sendAction (a click), repair (diagnostics -> ops or JSONL)
   ══════════════════════════════════════════════════════════════════════════ */
import type { UIAction, UIDiagnostics, UIOp } from '@sequence/genui';

export type AgentToUI =
  | { kind: 'ui.text'; surfaceId: string; chunk: string }
  | { kind: 'ui.ops'; surfaceId: string; ops: UIOp[] }
  | { kind: 'ui.end'; surfaceId: string }
  /** The server cannot replay this surface to a client that joined late: drop its partial state; the saved copy or a skeleton stands in until the next pass. */
  | { kind: 'ui.reset'; surfaceId: string; reason?: string }
  | { kind: 'turn'; busy: boolean; label?: string }
  | { kind: 'say'; text: string };

export interface GenUIAgent {
  subscribe(fn: (e: AgentToUI) => void): () => void;
  /** Begin the turn (the person's message). */
  start(prompt: string): void;
  /** A click on a generated control. The agent continues the turn from it. */
  sendAction(a: UIAction): void;
  /** Repair round: answer the diagnostics with ops or JSONL, or null to let the fallback run. */
  repair(d: UIDiagnostics): Promise<UIOp[] | string | null>;
  stop?(): void;
}

/** A small fan-out every implementation shares. */
export class Emitter {
  private fns = new Set<(e: AgentToUI) => void>();
  subscribe(fn: (e: AgentToUI) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(e: AgentToUI): void {
    for (const f of [...this.fns]) f(e);
  }
}

/**
 * A real agent behind the analyzer. The server side (not in this prototype's scope,
 * see docs/genui/README.md) relays the agent's `ui` MCP tool calls and ```genui
 * text as SSE frames of AgentToUI, and takes actions and repair requests by POST.
 */
/** The routes of genuiRoutes.ts, spelled out so the reachability scan sees the client ask for each. */
export const GENUI_ROUTE = { events: '/api/genui/events', turn: '/api/genui/turn', action: '/api/genui/action', repair: '/api/genui/repair' } as const;

export class HttpAgent extends Emitter implements GenUIAgent {
  private es: EventSource | null = null;
  constructor(private base = '/api/genui', private session = 'default') {
    super();
  }
  private url(name: keyof typeof GENUI_ROUTE): string {
    return GENUI_ROUTE[name].replace('/api/genui', this.base);
  }
  start(prompt: string): void {
    this.es?.close();
    this.es = new EventSource(`${this.url('events')}?session=${encodeURIComponent(this.session)}`);
    this.es.onmessage = (m) => {
      try {
        this.emit(JSON.parse(m.data) as AgentToUI);
      } catch {
        /* a malformed frame is dropped; the next stands on its own */
      }
    };
    void fetch(this.url('turn'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: this.session, prompt }) });
  }
  sendAction(a: UIAction): void {
    void fetch(this.url('action'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: this.session, action: a }) });
  }
  async repair(d: UIDiagnostics): Promise<UIOp[] | string | null> {
    try {
      const r = await fetch(this.url('repair'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: this.session, diagnostics: d }), signal: AbortSignal.timeout(30000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { ops?: UIOp[]; text?: string };
      return j.ops ?? j.text ?? null;
    } catch {
      return null;
    }
  }
  stop(): void {
    this.es?.close();
    this.es = null;
  }
}
