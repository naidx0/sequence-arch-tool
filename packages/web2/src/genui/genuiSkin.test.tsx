import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { S2Icon } from '../shell2/icons';
import { Emitter, type GenUIAgent } from './agent';
import { GenUISurface } from './GenUISurface';
import { GenUISession } from './session';

/* A GENERATED CARD READS AS ONE OF THE CHAT'S OWN CARDS: glass, rows rather than boxes, the app's glyphs, the app's type.
   Locked from the sheet and the source (jsdom has no layout, so the sheet is read as text) plus one real render. */

const here = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { selector: string; decls: Map<string, string> }

export function rulesOf(css: string): Rule[] {
  const flat = strip(css).replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, '$1');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => {
    const decls = new Map<string, string>();
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    return m[1]!.split(',').map((s) => ({ selector: s.trim().replace(/\s+/g, ' '), decls }));
  });
}

/* A rule draws a border when a border-* colour/width/line property is set to something that is not none, 0 or transparent. */
export function bordered(rules: Rule[]): string[] {
  return [
    ...new Set(
      rules
        .filter((r) => [...r.decls].some(([k, v]) => /^border(-(top|right|bottom|left))?(-color|-width|-style)?$/.test(k) && !/^(none|0|transparent)$/.test(v)))
        .map((r) => r.selector),
    ),
  ].sort();
}

const css = here('genui.css');
const rules = rulesOf(css);
const decl = (selector: string, prop: string): string | undefined => rules.find((r) => r.selector === selector && r.decls.has(prop))?.decls.get(prop);

/* The only things inside a generated card that may draw a line: the card's frame, the hairline under its head, the hairline between
   rows (card rows, timeline rows, file rows), the app's read-only chip, and the floating tooltip (a menu, not a box in the card). */
const ALLOWED_BORDER = [
  '.gu-card',
  '.gu-card-body > .gu-node + .gu-node',
  '.gu-card-head',
  '.gu-check',
  '.gu-check[data-status=\'fail\']',
  '.gu-check[data-status=\'pass\']',
  '.gu-check[data-status=\'running\']',
  '.gu-file + .gu-file',
  '.gu-tip',
  '.gu-timeline > .gu-node + .gu-node',
].sort();

describe('the card is the chat card in glass', () => {
  it('the checkers find a planted box and pass the allowed list (positive and negative controls)', () => {
    expect(bordered(rulesOf('.gu-metric { border: 1px solid red; } .a { border-top: 0; } .b { border-radius: 8px; } .c { border-color: transparent; }'))).toEqual(['.gu-metric']);
    expect(bordered(rulesOf('.x { color: red; } @media (a) { .y { border-bottom: var(--w-hair) solid var(--edge); } }'))).toEqual(['.y']);
    expect(bordered(rules).length).toBeGreaterThan(5);
  });

  it('no element inside a card draws its own border except the allowed frame and row separators', () => {
    expect(bordered(rules)).toEqual(ALLOWED_BORDER);
  });

  it('the card is the glass pane (translucent fill and the edge light), not a flat surface, and it does not blur the transcript', () => {
    expect(decl('.gu-card', 'background')).toBe('var(--glass-pane-fill)');
    expect(decl('.gu-card', 'box-shadow')).toBe('var(--glass-inset)');
    expect(decl('.gu-card', 'border')).toContain('var(--edge)');
    expect(decl('.gu-card', 'border-radius')).toBe('16px');
    expect(rules.some((r) => r.decls.has('backdrop-filter'))).toBe(false);
  });

  it('only the floating tip and the Fixing chip paint a surface-N fill; inner parts are rows on the card, not plates', () => {
    const plates = rules.filter((r) => /var\(--surface-\d\)/.test(r.decls.get('background') ?? '') || /var\(--surface-\d\)/.test(r.decls.get('background-color') ?? '')).map((r) => r.selector);
    expect(plates.sort()).toEqual(['.gu-fixing', '.gu-tip']);
  });

  it('uses the app type only: the UI or mono family, the --t-* scale, the --fw-* weights', () => {
    const fams = new Set(rules.map((r) => r.decls.get('font-family')).filter(Boolean));
    expect([...fams].sort()).toEqual(['var(--font-mono)', 'var(--font-ui)']);
    for (const r of rules) {
      const size = r.decls.get('font-size');
      if (size) expect(size, r.selector).toMatch(/^var\(--t-[0-9-]+\)$/);
      const w = r.decls.get('font-weight');
      if (w) expect(w, r.selector).toMatch(/^var\(--fw-[a-z]+\)$/);
    }
  });

  it('status, durations, counts and diffs are mono with tabular figures, as the tool rows are', () => {
    for (const sel of ['.gu-step-meta', '.gu-progress-count', '.gu-metric-value', '.gu-file', '.gu-diff-body']) {
      expect(decl(sel, 'font-family'), sel).toBe('var(--font-mono)');
      expect(decl(sel, 'font-variant-numeric'), sel).toBe('tabular-nums');
    }
  });

  it('colour stays in the tone roles: the default bar and badge are neutral, and the card has no accent', () => {
    expect(decl('.gu-progress-fill', 'background')).toBe('var(--ink-3)');
    expect(decl('.gu-badge[data-tone=\'neutral\']', 'color')).toBe('var(--ink-3)');
    const card = rules.filter((r) => /^\.gu-card\b/.test(r.selector) && !r.selector.includes('[')).flatMap((r) => [...r.decls.values()]);
    expect(card.some((v) => /--accent/.test(v))).toBe(false);
  });

  it('writes no middle dot', () => {
    for (const f of ['genui.css', 'GenUISurface.tsx']) expect(here(f), f).not.toContain('·');
  });
});

describe('every status mark is the app\'s own', () => {
  const src = here('GenUISurface.tsx');
  const icons = here('../shell2/icons.tsx');

  it('draws no svg of its own: marks come from S2Icon, the AsciiSpinner or the plan rows\' .s2-ring', () => {
    expect(src).not.toMatch(/<svg/);
    expect(src).not.toMatch(/<path/);
    expect(src).toContain("import { S2Icon } from '../shell2/icons'");
  });

  it('names only icons the set has (a warning is `bell`: the set has no alert glyph)', () => {
    const named = [...src.matchAll(/GLYPH_ICON = \{([^}]*)\}/g)][0]![1]!.match(/'([a-z0-9]+)'/g)!.map((s) => s.replace(/'/g, ''));
    expect(named.sort()).toEqual(['bell', 'check', 'minus', 'x']);
    for (const n of named) expect(icons, n).toMatch(new RegExp(`\\n  ${n}: `));
  });

  class Quiet extends Emitter implements GenUIAgent {
    start(): void {}
    sendAction(): void {}
    async repair(): Promise<null> {
      return null;
    }
  }

  it('a rendered card with every status holds only S2Icon marks, rings and the spinner', async () => {
    const agent = new Quiet();
    const session = new GenUISession(agent);
    const el = (id: string, type: string, props: Record<string, unknown>, children?: string[]): string => JSON.stringify({ op: 'el', id, type, props, ...(children ? { children } : {}) }) + '\n';
    const steps = ['done', 'error', 'warning', 'pending', 'skipped', 'running'];
    const ops =
      el('card', 'Card', { title: 'T', badge: 'Needs attention', tone: 'warning' }, ['tl', 'chk', 'b']) +
      el('tl', 'Timeline', {}, steps.map((s) => `s-${s}`)) +
      steps.map((s) => el(`s-${s}`, 'TimelineItem', { title: s, status: s, meta: '2s' })).join('') +
      el('chk', 'Checks', {}, ['c1', 'c2', 'c3']) +
      el('c1', 'Check', { label: 'a', status: 'pass' }) +
      el('c2', 'Check', { label: 'b', status: 'fail' }) +
      el('c3', 'Check', { label: 'c', status: 'pending' }) +
      el('b', 'Badge', { label: 'Done', tone: 'success' });
    agent.emit({ kind: 'ui.text', surfaceId: 's', chunk: ops });
    agent.emit({ kind: 'ui.end', surfaceId: 's' });
    await new Promise((r) => setTimeout(r, 40));
    const { container } = render(<GenUISurface view={session.get().surfaces[0]!} busy={false} onClick={() => {}} />);
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs.length).toBeGreaterThan(6);
    for (const s of svgs) expect(s.getAttribute('data-icon'), 'every svg is an S2Icon').toBeTruthy();
    expect(svgs.filter((s) => s.getAttribute('data-icon')).map((s) => s.getAttribute('data-icon')).sort()).toEqual(
      expect.arrayContaining(['bell', 'check', 'minus', 'x']),
    );
    expect(container.querySelectorAll('.s2-ring').length).toBe(2);
    expect(container.querySelector('.gu-dot')).toBeNull();
    /* the nodes carry their kind, which the row rules key on */
    expect(container.querySelector('.gu-card-body > .gu-node[data-kind="Timeline"]')).not.toBeNull();
    const probe = render(<S2Icon name="bell" small />);
    expect(probe.container.querySelector('svg')!.getAttribute('data-icon')).toBe('bell');
  });
});
