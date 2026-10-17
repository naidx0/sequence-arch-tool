/* ══════════════════════════════════════════════════════════════════════════
   WHERE THE AGENT IS — the pure half of the board overlay
   packages/web2/src/agents/overlayModel.ts

   A tool call that touches a file lights three things on the board: the file's
   own node (visible when a service is opened), its module and service, and the
   board edges whose evidence sits in that file. Each light lasts LIVE_MS, then fades for
   FADE_MS, then is gone — unless a view has FOCUSED a step, which holds that
   step's locations lit until the focus moves.

   Accent only for live state (Graphite): nothing here paints a claim about
   the code, only "an agent is here now".
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentNode, BoardHit } from './agentTypes.js';

export const LIVE_MS = 8000;
export const FADE_MS = 2000;

export interface LitTargets {
  nodes: Set<string>;
  /** `${from}>${to}` board edge keys. */
  edges: Set<string>;
}

/** The file, its module and service, and the board edges its evidence sits on. */
export function targetsOf(locations: readonly BoardHit[]): LitTargets {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const l of locations) {
    for (const id of [l.fileNodeId, l.moduleId, l.serviceId]) if (id) nodes.add(id);
    for (const k of l.liftedEdges) edges.add(k);
  }
  return { nodes, edges };
}

/**
 * Light expiry, kept PER CALL: call id → when it lights from, and its target
 * keys. A target's light is its latest call's. Per call, not per target, so a
 * call's end can take back the light its start gave: a replay on page load
 * folds an old call's start (running, so lit "now") before its end, and the
 * end's old time must put that light out (round 8 integration: every load lit
 * work that had finished long before).
 */
export class LightBook {
  private calls = new Map<string, { at: number; keys: string[] }>();

  touch(changed: readonly AgentNode[], now: number): boolean {
    let any = false;
    for (const n of changed) {
      if (n.kind !== 'tool_call' || !n.locations.length) continue;
      /* A finished call lights from when it FINISHED (server clock, same
         machine), so a snapshot on reconnect does not relight old work. */
      const at = n.status === 'running' ? now : Math.min(now, n.endedAt ?? now);
      if (now - at >= LIVE_MS + FADE_MS) {
        if (this.calls.delete(n.id)) any = true;
        continue;
      }
      const t = targetsOf(n.locations);
      this.calls.set(n.id, { at, keys: [...[...t.nodes].map((id) => `n:${id}`), ...[...t.edges].map((k) => `e:${k}`)] });
      any = true;
    }
    return any;
  }

  /** The phase of every live target at `now`; expired calls are dropped. */
  phases(now: number): Map<string, 'live' | 'fading'> {
    const latest = new Map<string, number>();
    for (const [id, c] of this.calls) {
      if (now - c.at >= LIVE_MS + FADE_MS) {
        this.calls.delete(id);
        continue;
      }
      for (const k of c.keys) latest.set(k, Math.max(c.at, latest.get(k) ?? 0));
    }
    const out = new Map<string, 'live' | 'fading'>();
    for (const [k, t] of latest) out.set(k, now - t < LIVE_MS ? 'live' : 'fading');
    return out;
  }

  size(): number {
    return this.calls.size;
  }

  /** Whether this call is lighting anything (a chip is only that call's). */
  holds(callId: string): boolean {
    return this.calls.has(callId);
  }
}

/** Parse @xyflow's default edge label, "Edge from A to B", into `A>B`. */
export function edgeKeyFromLabel(label: string | null): string | null {
  const m = label ? /^Edge from (.+) to (.+)$/.exec(label) : null;
  return m ? `${m[1]}>${m[2]}` : null;
}
