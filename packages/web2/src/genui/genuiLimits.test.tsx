// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { Emitter, type GenUIAgent, type AgentToUI } from './agent';
import { GenUISession } from './session';

/* Caps: 8 surfaces a turn, 200 elements a surface. The extras are dropped with a diagnostic; what already drew stays. */

class Quiet extends Emitter implements GenUIAgent {
  start(): void {}
  sendAction(): void {}
  async repair(): Promise<null> {
    return null;
  }
}
const textOp = (id: string, parent?: string): string => JSON.stringify({ op: 'el', id, type: 'Text', props: { text: id }, ...(parent ? { parent } : {}) }) + '\n';
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('surface cap', () => {
  it('the ninth surface of a turn is dropped with one diagnostic; the first eight keep drawing', async () => {
    const agent = new Quiet();
    const session = new GenUISession(agent);
    for (let i = 0; i < 10; i++) agent.emit({ kind: 'ui.text', surfaceId: `s${i}`, chunk: textOp(`t${i}`) });
    agent.emit({ kind: 'ui.text', surfaceId: 's9', chunk: textOp('again') });
    agent.emit({ kind: 'ui.ops', surfaceId: 's8', ops: [{ op: 'status', status: 'done' }] });
    agent.emit({ kind: 'ui.end', surfaceId: 's9' });
    await wait(60);
    const v = session.get();
    expect(v.surfaces.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
    const notes = v.log.filter((l) => /LIMIT_EXCEEDED \/surfaces\//.test(l.text));
    expect(notes.map((l) => l.text.match(/surfaces\/(s\d)/)![1])).toEqual(['s8', 's9'], 'one line per dropped surface, not per op');
    /* the eight still take updates */
    agent.emit({ kind: 'ui.text', surfaceId: 's3', chunk: textOp('more', 't3') });
    await wait(40);
    expect(session.get().surfaces[3]!.spec.elements.more).toBeTruthy();
  });

  it('a surface that exists keeps working when the turn is at its quota (the cap counts surfaces, not events)', async () => {
    const agent = new Quiet();
    const session = new GenUISession(agent);
    for (let i = 0; i < 8; i++) agent.emit({ kind: 'ui.text', surfaceId: `s${i}`, chunk: textOp(`a${i}`) });
    agent.emit({ kind: 'ui.end', surfaceId: 's0' });
    await wait(60);
    expect(session.get().surfaces).toHaveLength(8);
    expect(session.get().surfaces[0]!.phase).toBe('settled');
  });
});

describe('element cap', () => {
  const flood = (n: number): string => textOp('root') + Array.from({ length: n }, (_, i) => textOp(`n${i}`, 'root')).join('');

  it('text path: past 200 elements ops are dropped and counted, and the same at every chunk size', async () => {
    const text = flood(260);
    const results: string[] = [];
    for (const size of [1, 13, 4096]) {
      const agent = new Quiet();
      const session = new GenUISession(agent);
      for (let i = 0; i < text.length; i += size) agent.emit({ kind: 'ui.text', surfaceId: 's', chunk: text.slice(i, i + size) });
      await wait(80);
      const s = session.get().surfaces[0]!;
      expect(Object.keys(s.spec.elements)).toHaveLength(200);
      expect(s.dropped).toBe(61);
      results.push(JSON.stringify(s.spec));
    }
    expect(new Set(results).size, 'chunk size never changes the result').toBe(1);
  });

  it('ops path (a tool call): capped, and the diagnostic is in the log', async () => {
    const agent = new Quiet();
    const session = new GenUISession(agent);
    const ops: AgentToUI = { kind: 'ui.ops', surfaceId: 's', ops: [{ op: 'el', id: 'root', type: 'Stack', props: {} }, ...Array.from({ length: 220 }, (_, i) => ({ op: 'el' as const, id: `n${i}`, type: 'Text', props: { text: 'x' }, parent: 'root' }))] };
    agent.emit(ops);
    await wait(60);
    expect(Object.keys(session.get().surfaces[0]!.spec.elements)).toHaveLength(200);
    expect(session.get().log.some((l) => /LIMIT_EXCEEDED \/elements: 21 ops dropped/.test(l.text))).toBe(true);
  });
});
