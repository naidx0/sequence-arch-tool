import { describe, expect, it } from 'vitest';

import { elideNameEnds, fitNeed } from './FileTree';
import type { FileRow } from './filesModel';
import { markSharedNames } from './serviceGroups';

/* Owner-seat review: "no two sibling rows read the same". 7 px a character, 120 px of room (17 characters). */
const measure = (s: string) => s.length * 7;
const text = (e: { head: string; tail: string }) => e.head + e.tail;

const row = (dir: string, label: string): FileRow =>
  ({ kind: 'file', path: dir === '' ? label : `${dir}/${label}`, label, dir, depth: 1, expanded: false, fileCount: 1, dirty: false }) as unknown as FileRow;

describe('elideNameEnds keeps the part where two look-alike names differ', () => {
  const peers = ['ask-history-review-fixes.test.ts', 'ask-review-fixes.test.ts'];
  it('reads differently for a pair that shares its start and its end', () => {
    const a = text(elideNameEnds(peers[0]!, 120, measure, peers));
    const b = text(elideNameEnds(peers[1]!, 120, measure, peers));
    expect(a).not.toBe(b);
    expect(a.length * 7).toBeLessThanOrEqual(120);
    expect(b.length * 7).toBeLessThanOrEqual(120);
  });
  it('reads differently for a family of names that part at different places', () => {
    const names = ['ask-history-server.test.ts', 'ask-index-server.test.ts', 'ask-history-server-2.test.ts', 'ask-stream-server.test.ts'];
    const shown = names.map((n) => text(elideNameEnds(n, 120, measure, names)));
    expect(new Set(shown).size).toBe(names.length);
  });
  it('a family that shares a long start and a long end and differs only in the middle still reads apart in 20 characters', () => {
    const names = [
      'agent-ab-bash-granite-map-r1-2026-10-05.jsonl',
      'agent-ab-bash-granite-map-r2-2026-10-05.jsonl',
      'agent-ab-bash-granite-sequence-r1-2026-10-05.jsonl',
      'agent-ab-bash-granite-sequence-r2-2026-10-05.jsonl',
      'agent-ab-bash-map-r1-2026-10-05.jsonl',
      'agent-ab-bash-sequence-r2-2026-10-05.jsonl',
      'agent-ab-full-bash-sequence-r2-2026-10-01.jsonl',
      'find-the-fix-codeforge-stopwords-2026-10-01.json',
      'find-the-fix-ml-harness-stopwords-2026-10-01.json',
    ];
    const shown = names.map((n) => text(elideNameEnds(n, 140, measure, names)));
    expect(new Set(shown).size, shown.join(' | ')).toBe(names.length);
    for (const s of shown) expect(s.length * 7).toBeLessThanOrEqual(140);
  });
  it('negative control: a name that fits is whole, and a lone long name is unchanged from before', () => {
    expect(text(elideNameEnds('index.ts', 120, measure, ['index.ts']))).toBe('index.ts');
    expect(elideNameEnds('live-browser-session-manager.test.ts', 120, measure, [])).toEqual({ head: 'live…', tail: 'ager.test.ts' });
  });
});

describe('fitNeed cuts the folders of a same-named set to a narrow row without making two rows alike', () => {
  const keys = ['.agents/…/loop/', '.cursor/…/loop/', '.agents/…/grill/', '.cursor/…/grill/'];
  it('keeps them apart at every room, and whole when the room is wide', () => {
    expect(fitNeed(keys, keys[0]!, 400, measure)).toBe(keys[0]);
    for (const room of [112, 98, 84, 70]) {
      const cut = keys.map((k) => fitNeed(keys, k, room, measure));
      expect(new Set(cut).size, `room ${room}: ${cut.join(' ')}`).toBe(keys.length);
      for (const c of cut) expect(c.length * 7).toBeLessThanOrEqual(room);
    }
  });
});

describe('markSharedNames asks for the folder that tells same-named files apart', () => {
  it('src/ against src/settings/ keeps the nearest folder', () => {
    const rows = [row('src', 'noMiddleDot.test.ts'), row('src/settings', 'noMiddleDot.test.ts')];
    markSharedNames(rows);
    expect(rows.map((r) => r.dirNeed)).toEqual(['src/', 'settings/']);
  });
  it('.agents/ against .cursor/ keeps the front when the nearest folders are alike', () => {
    const rows = [row('.agents/skills/loop', 'SKILL.md'), row('.cursor/skills/loop', 'SKILL.md')];
    markSharedNames(rows);
    expect(rows.map((r) => r.dirNeed)).toEqual(['.agents/…/', '.cursor/…/']);
  });
  it('when no single run of folders does it, the first folder and the nearest are kept together', () => {
    const rows = [
      row('.agents/skills/loop', 'SKILL.md'),
      row('.cursor/skills/loop', 'SKILL.md'),
      row('.agents/skills/grill', 'SKILL.md'),
      row('.cursor/skills/grill', 'SKILL.md'),
    ];
    markSharedNames(rows);
    expect(rows.map((r) => r.dirNeed)).toEqual(['.agents/…/loop/', '.cursor/…/loop/', '.agents/…/grill/', '.cursor/…/grill/']);
  });
  it('a middle folder that differs is kept alone', () => {
    const rows = [row('t/fixtures/shopfront/invoices/src', 'a.properties'), row('t/fixtures/shopfront-mutated/invoices/src', 'a.properties')];
    markSharedNames(rows);
    expect(rows.map((r) => r.dirNeed)).toEqual(['…/shopfront/…/', '…/shopfront-mutated/…/']);
  });
  it('negative control: a name that is alone in its group asks for nothing', () => {
    const rows = [row('src', 'a.ts'), row('src', 'b.ts')];
    markSharedNames(rows);
    expect(rows.map((r) => r.dirNeed)).toEqual([undefined, undefined]);
  });
});
