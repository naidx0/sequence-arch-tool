/* ══════════════════════════════════════════════════════════════════════════
   THE TIDY-UP SESSION: strokes in, offers out
   packages/web2/src/whiteboard/snapSession.ts

   The whiteboard hands this every finished freehand stroke. It waits for the
   pen to rest (a box is often four strokes), asks the shape recognizer
   (`@sequence/ink`, trained on real hand-drawn flowcharts) what the strokes
   stand for, and offers a clean rect, ellipse, diamond or connector for the
   ones it is sure of. Everything else, handwriting above all, is never
   mentioned: no offer is the quiet answer.

   LOADED ON THE FIRST STROKE, NOT AT BOOT. This module, the grouping code and
   the model's weights (~170 KB) are three dynamic imports away from the board's
   entry chunk (perf ratchet, bootJsBytes); a person who never draws never pays
   for any of them.

   No React, no DOM. Time and timers are injected so a test can run a stroke
   sequence in zero milliseconds.
   ══════════════════════════════════════════════════════════════════════════ */

import {
  GROUP_IDLE_MS,
  GROUP_MAX_PENDING,
  decideGroup,
  decidesAtOnce,
  joinsPending,
  medianDiag,
  type GroupStroke,
  type Recognizer,
} from '@sequence/ink/shape';

import type { Point } from './whiteboardModel';

export type SnapDecision = 'rect' | 'ellipse' | 'diamond' | 'connector';

export interface SnapOffer {
  /** The strokes the clean shape would replace, in draw order. */
  strokeIds: string[];
  decision: SnapDecision;
  confidence: number;
  /** A box's two corners, or a connector's tail and tip. */
  from: Point;
  to: Point;
}

export interface SnapStrokeEnd {
  id: string;
  points: readonly Point[];
  /** Pen-down and pen-up, milliseconds on any one clock. */
  t0: number;
  t1: number;
}

export interface SnapSessionOptions {
  /** Called for every offer; the owner decides whether to show it or apply it. */
  onOffer: (offers: SnapOffer[]) => void;
  /** Points of the strokes already on the board, OTHER than the pending ones (their median size is the yardstick for handwriting). */
  context: (pendingIds: ReadonlySet<string>) => readonly (readonly Point[])[];
  /** Is this stroke still on the board? A stroke erased or undone meanwhile is not offered. */
  present: (id: string) => boolean;
  /** Screen pixels per board unit: a tiny shape is not worth an offer. */
  zoom: () => number;
  recognizer: () => Promise<Recognizer>;
  idleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Offers below this many screen pixels across are dropped: a dot, not a diagram. */
export const SNAP_MIN_SCREEN_DIAG = 36;

export class SnapSession {
  private pending: GroupStroke[] = [];
  private timer: unknown = null;
  private recognize: Recognizer | null = null;
  private loading: Promise<Recognizer> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly idleMs: number;

  constructor(private readonly o: SnapSessionOptions) {
    this.idleMs = o.idleMs ?? GROUP_IDLE_MS;
  }

  private load(): Promise<Recognizer> {
    /* A chunk that failed to load (offline, or a deploy replaced it) is tried again
       on the next stroke; meanwhile strokes stay ink, the board's old behaviour. */
    this.loading ??= this.o.recognizer().then(
      (r) => (this.recognize = r),
      (e: unknown) => {
        this.loading = null;
        this.pending = [];
        throw e;
      },
    );
    return this.loading;
  }

  private cancelTimer(): void {
    if (this.timer !== null) (this.o.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = null;
  }

  /** The pen went down: whatever is pending is not rested yet. */
  strokeBegan(): void {
    this.cancelTimer();
  }

  /** A finished stroke. Serialised, so two quick strokes are judged in order. */
  strokeEnded(s: SnapStrokeEnd): Promise<void> {
    this.chain = this.chain.then(() => this.take(s)).catch(() => undefined);
    return this.chain;
  }

  private async take(s: SnapStrokeEnd): Promise<void> {
    if (this.disposed) return;
    const recognize = await this.load();
    const next: GroupStroke = { id: s.id, points: s.points, t0: s.t0, t1: s.t1 };
    if (this.pending.length > 0 && (!joinsPending(this.pending, next, this.idleMs) || this.pending.length >= GROUP_MAX_PENDING)) {
      this.decide(recognize);
    }
    this.pending.push(next);
    this.cancelTimer();
    if (decidesAtOnce(this.pending, { recognize, boardDiag: this.boardDiag() })) {
      this.decide(recognize);
      return;
    }
    this.timer = (this.o.setTimer ?? setTimeout)(() => {
      this.timer = null;
      if (this.recognize) this.decide(this.recognize);
    }, this.idleMs);
  }

  private boardDiag(): number | undefined {
    const ids = new Set(this.pending.map((p) => String(p.id)));
    const others = this.o.context(ids);
    return others.length > 0 ? medianDiag(others as never) : undefined;
  }

  private decide(recognize: Recognizer): void {
    const pending = this.pending;
    this.pending = [];
    this.cancelTimer();
    if (pending.length === 0 || this.disposed) return;
    const offers: SnapOffer[] = [];
    for (const v of decideGroup(pending, { recognize, boardDiag: this.diagWithout(pending) })) {
      if (v.decision === 'ink' || !v.from || !v.to) continue;
      const ids = v.ids.map(String);
      if (!ids.every((id) => this.o.present(id))) continue;
      const span = Math.hypot(v.to.x - v.from.x, v.to.y - v.from.y) * this.o.zoom();
      if (span < SNAP_MIN_SCREEN_DIAG) continue;
      offers.push({ strokeIds: ids, decision: v.decision, confidence: v.confidence, from: v.from, to: v.to });
    }
    if (offers.length > 0) this.o.onOffer(offers);
  }

  private diagWithout(pending: readonly GroupStroke[]): number | undefined {
    const others = this.o.context(new Set(pending.map((p) => String(p.id))));
    return others.length > 0 ? medianDiag(others as never) : undefined;
  }

  /** Decide whatever is pending now (a test, or leaving the board). */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => {
      if (this.recognize) this.decide(this.recognize);
    });
    return this.chain;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.pending = [];
  }
}
