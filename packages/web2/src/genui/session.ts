/* ══════════════════════════════════════════════════════════════════════════
   THE GENERATIVE UI SESSION: agent events in, rendered surfaces out
   packages/web2/src/genui/session.ts

   Per surface, the pipeline every frame runs:

     ui.text chunks ─► SpecStream (commit whole lines, preview the open one)
                    ─► autoFix lossless   (aliases, synonyms, coercions: free)
                    ─► validate streaming (what is missing is a placeholder)
                    ─► view               (React renders only renderable nodes)

   and when the agent ends a pass (ui.end):

     validate final ─► repairSpec: lossless, then ask the agent with diagnostics
                       (the nodes being repaired show "Fixing"), then lossy fallback
                    ─► settled view; the stream keeps going from the repaired spec

   Updates are coalesced to one per animation frame (Cursor's partial tool call
   coalescer flushes at a 16 ms minimum the same way): a fast stream re-renders at
   display rate, not at token rate.
   ══════════════════════════════════════════════════════════════════════════ */
import { GENUI_LIMITS, SpecStream, autoFix, buildAction, repairSpec, validateSpec, type Fix, type Issue, type UISpec } from '@sequence/genui';

import type { AgentToUI, GenUIAgent } from './agent';

export interface TimedFix extends Fix {
  at: number;
}

export type SurfacePhase = 'streaming' | 'repairing' | 'settled';

export interface SurfaceView {
  id: string;
  spec: UISpec;
  renderable: ReadonlySet<string>;
  issues: Issue[];
  fixes: TimedFix[];
  phase: SurfacePhase;
  /** Elements the agent is repairing right now. */
  repairing: ReadonlySet<string>;
  rounds: number;
  /** The button the person clicked, until the agent's turn picks it up. */
  pendingAction: string | null;
  refused: { elementId: string; reason: string; at: number } | null;
  /** Loaded from a saved turn: drawn once with no motion, and its controls are off (the turn is over). */
  restored?: boolean;
  /** Ops the element cap dropped from this surface (GENUI_LIMITS.elementsPerSurface). */
  dropped?: number;
}

/** A saved, settled spec as a view: what a reload draws. Nothing is animated and nothing can be clicked. */
export function restoredView(id: string, spec: UISpec): SurfaceView {
  const v = validateSpec(spec, 'final');
  return { id, spec, renderable: v.renderable, issues: v.issues, fixes: [], phase: 'settled', repairing: new Set(), rounds: 0, pendingAction: null, refused: null, restored: true };
}

export interface LogLine {
  at: number;
  dir: 'agent' | 'ui' | 'fix' | 'repair';
  text: string;
}

export interface SessionView {
  surfaces: SurfaceView[];
  busy: boolean;
  label: string | null;
  narration: string;
  log: LogLine[];
}

interface Internal {
  stream: SpecStream;
  view: SurfaceView;
  seen: Set<string>;
  dirty: boolean;
  /** True while a pass is being repaired; agent events wait in queue until it settles. */
  settling: boolean;
  queue: AgentToUI[];
}

const schedule = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
};

export class GenUISession {
  private surfaces = new Map<string, Internal>();
  private order: string[] = [];
  private listeners = new Set<(v: SessionView) => void>();
  private view: SessionView = { surfaces: [], busy: false, label: null, narration: '', log: [] };
  private frame = false;
  private unsub: (() => void) | null = null;
  private now: () => number;

  private onSettled: ((surfaceId: string, spec: UISpec) => void) | undefined;

  /**
   * `onSettled` is called with the final spec each time a surface finishes a pass and passes the strict check (the
   * app saves it with the turn, see surfaceStore.ts `persistSettled`). It never sees a half-drawn or invalid spec.
   */
  constructor(private agent: GenUIAgent, opts: { now?: () => number; connect?: boolean; onSettled?: (surfaceId: string, spec: UISpec) => void } = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.onSettled = opts.onSettled;
    if (opts.connect !== false) this.connect();
  }

  /** Listen to the agent. Returns the disconnect (React effects connect and disconnect). */
  connect(): () => void {
    this.unsub?.();
    const off = this.agent.subscribe((e) => this.onEvent(e));
    this.unsub = off;
    return () => {
      off();
      if (this.unsub === off) this.unsub = null;
    };
  }

  get(): SessionView {
    return this.view;
  }

  subscribe(fn: (v: SessionView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(prompt: string): void {
    this.log('ui', `turn: ${prompt}`);
    this.agent.start(prompt);
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.agent.stop?.();
  }

  /** A click on a generated Button. */
  click(surfaceId: string, elementId: string): void {
    const s = this.surfaces.get(surfaceId);
    if (!s) return;
    const v = buildAction(s.stream.spec, surfaceId, elementId, this.view.busy, this.now());
    if (!v.ok) {
      s.view = { ...s.view, refused: { elementId, reason: v.reason, at: this.now() } };
      this.log('ui', `refused ${elementId}: ${v.reason}`);
      this.publish();
      return;
    }
    s.view = { ...s.view, pendingAction: elementId, refused: null };
    this.log('ui', `ui.action ${v.action.name} ${JSON.stringify(v.action.params)}`);
    this.publish();
    this.agent.sendAction(v.action);
  }

  /** The surfaces this turn has refused (past GENUI_LIMITS.surfacesPerTurn); each is reported once. */
  private refusedSurfaces = new Set<string>();

  /** The surface for an event, or null when this turn already holds its quota of cards: its ops are dropped with a diagnostic. */
  private admit(id: string): Internal | null {
    if (!this.surfaces.has(id) && this.order.length >= GENUI_LIMITS.surfacesPerTurn) {
      if (!this.refusedSurfaces.has(id)) {
        this.refusedSurfaces.add(id);
        this.log('fix', `LIMIT_EXCEEDED /surfaces/${id}: a turn draws at most ${GENUI_LIMITS.surfacesPerTurn} surfaces; "${id}" was dropped`);
        this.publish();
      }
      return null;
    }
    return this.surface(id);
  }

  /** Count and log what the element cap dropped. */
  private noteDropped(s: Internal, issues: Issue[]): void {
    const cap = issues.filter((i) => i.code === 'LIMIT_EXCEEDED');
    if (!cap.length) return;
    const n = cap.reduce((sum, i) => sum + Number(/^(\d+) ops/.exec(i.message)?.[1] ?? 1), 0);
    s.view = { ...s.view, dropped: (s.view.dropped ?? 0) + n };
  }

  private surface(id: string): Internal {
    let s = this.surfaces.get(id);
    if (!s) {
      const stream = new SpecStream();
      s = {
        stream,
        seen: new Set(),
        dirty: false,
        settling: false,
        queue: [],
        view: { id, spec: stream.spec, renderable: new Set(), issues: [], fixes: [], phase: 'streaming', repairing: new Set(), rounds: 0, pendingAction: null, refused: null },
      };
      this.surfaces.set(id, s);
      this.order.push(id);
    }
    return s;
  }

  private onEvent(e: AgentToUI): void {
    if ((e.kind === 'ui.text' || e.kind === 'ui.ops' || e.kind === 'ui.end') && this.surfaces.get(e.surfaceId)?.settling) {
      this.surfaces.get(e.surfaceId)!.queue.push(e);
      return;
    }
    switch (e.kind) {
      case 'ui.text': {
        const s = this.admit(e.surfaceId);
        if (!s) return;
        const r = s.stream.push(e.chunk);
        this.noteDropped(s, r.issues);
        this.noteFixes(s, r.fixes);
        if (r.applied.length) this.commitFixes(s);
        for (const i of r.issues) this.log('fix', `${i.code} ${i.path}: ${i.message}`);
        if (s.view.phase === 'settled') s.view = { ...s.view, phase: 'streaming' };
        this.markDirty(s);
        return;
      }
      case 'ui.ops': {
        const s = this.admit(e.surfaceId);
        if (!s) return;
        const dropped = s.stream.applyOps(e.ops);
        this.noteDropped(s, dropped);
        for (const i of dropped) this.log('fix', `${i.code} ${i.path}: ${i.message}`);
        this.commitFixes(s);
        if (s.view.phase === 'settled') s.view = { ...s.view, phase: 'streaming' };
        this.markDirty(s);
        return;
      }
      case 'ui.reset': {
        /* A surface mid-settle belongs to a pass this client followed from the start; only a late join has nothing to keep. */
        const s = this.surfaces.get(e.surfaceId);
        if (!s || s.settling) return;
        this.surfaces.delete(e.surfaceId);
        this.order = this.order.filter((id) => id !== e.surfaceId);
        this.publish();
        return;
      }
      case 'ui.end':
        if (this.admit(e.surfaceId)) void this.settle(e.surfaceId);
        return;
      case 'turn': {
        const wasBusy = this.view.busy;
        this.view = { ...this.view, busy: e.busy, label: e.label ?? (e.busy ? this.view.label : null) };
        /* The clicked button spins until the turn it started is over. */
        if (!e.busy && wasBusy) for (const s of this.surfaces.values()) s.view = { ...s.view, pendingAction: null };
        this.publish();
        return;
      }
      case 'say':
        this.view = { ...this.view, narration: this.view.narration + e.text };
        this.publish();
        return;
    }
  }

  private markDirty(s: Internal): void {
    s.dirty = true;
    if (this.frame) return;
    this.frame = true;
    schedule(() => {
      this.frame = false;
      for (const x of this.surfaces.values()) if (x.dirty) this.recompute(x);
      this.publish();
    });
  }

  /* Lossless fixes are written back into the committed spec, so the agent's next update
     to an element merges into the fixed element (an "el" for a TimelineItem must not
     land on a "step" and lose its title). */
  private commitFixes(s: Internal): void {
    const f = autoFix(s.stream.spec, { phase: 'streaming' });
    if (!f.fixes.length) return;
    s.stream.spec = f.spec;
    this.noteFixes(s, f.fixes);
  }

  private recompute(s: Internal): void {
    s.dirty = false;
    /* The committed spec is already fixed (commitFixes). The in-flight element is drawn as
       it streams when it validates; while it does not (a half-typed enum, a partial type
       name), the committed version stays on screen, and a new one is a skeleton. Fixes are
       never guessed from partial text: "Stat" is the start of StatusLine, not a Metric. */
    const committed = s.stream.spec;
    const { spec: preview, id } = s.stream.previewInfo();
    let spec = preview;
    let v = validateSpec(spec, 'streaming');
    if (id && !v.renderable.has(id) && committed.elements[id]) {
      spec = { ...preview, elements: { ...preview.elements, [id]: committed.elements[id]! } };
      v = validateSpec(spec, 'streaming');
    }
    s.view = { ...s.view, spec, renderable: v.renderable, issues: v.issues };
  }

  private noteFixes(s: Internal, fixes: Fix[]): void {
    const fresh: TimedFix[] = [];
    for (const f of fixes) {
      const k = `${f.by}|${f.elementId ?? ''}|${f.message}`;
      if (s.seen.has(k)) continue;
      s.seen.add(k);
      fresh.push({ ...f, at: this.now() });
      this.log(f.by === 'agent' ? 'repair' : 'fix', `${f.lossy ? 'lossy ' : ''}${f.message}`);
    }
    if (fresh.length) s.view = { ...s.view, fixes: [...s.view.fixes, ...fresh] };
  }

  private async settle(id: string): Promise<void> {
    const s = this.surface(id);
    s.settling = true;
    s.stream.end();
    this.recompute(s);
    this.publish();
    const out = await repairSpec(s.stream.spec, {
      surfaceId: id,
      agent: async (d) => {
        const ids = new Set(d.issues.map((i) => i.elementId).filter((x): x is string => !!x));
        s.view = { ...s.view, phase: 'repairing', repairing: ids, rounds: d.round };
        this.log('repair', `ui.diagnostics round ${d.round}: ${d.issues.map((i) => i.code).join(', ')}`);
        this.publish();
        return this.agent.repair(d);
      },
      onEvent: (ev) => {
        if (ev.type === 'fixed' || ev.type === 'fallback') this.noteFixes(s, ev.fixes);
        if (ev.type === 'agent-patched') {
          this.noteFixes(s, ev.fixes);
          this.log('agent', `repair ops: ${ev.ops.length}`);
        }
        if (ev.type === 'agent-silent') this.log('repair', 'agent passed; fallback');
      },
    });
    s.stream = new SpecStream(out.spec);
    const v = validateSpec(out.spec, 'final');
    s.view = { ...s.view, spec: out.spec, renderable: v.renderable, issues: v.issues, phase: 'settled', repairing: new Set(), rounds: out.rounds };
    s.settling = false;
    this.publish();
    if (out.spec.root && v.ok) {
      try {
        this.onSettled?.(id, out.spec);
      } catch {
        /* saving is a convenience; a failure must not stop the queued events */
      }
    }
    const queued = s.queue.splice(0);
    for (const q of queued) this.onEvent(q);
  }

  private log(dir: LogLine['dir'], text: string): void {
    this.view = { ...this.view, log: [...this.view.log.slice(-199), { at: this.now(), dir, text }] };
  }

  private publish(): void {
    this.view = { ...this.view, surfaces: this.order.map((id) => this.surfaces.get(id)!.view) };
    for (const l of [...this.listeners]) l(this.view);
  }
}
