import { describe, expect, it } from 'vitest';

import railPopCssRaw from '../rail/railPopover.css?raw';
import previewSrc from '../activity/WorkflowPreview.tsx?raw';
import shellSrc from '../shell2/Shell2.tsx?raw';
import shell2Css from '../shell2/shell2.css?raw';
import v3ChatSrc from '../v3/V3Chat.tsx?raw';
import overviewSrc from './ChatOverview.tsx?raw';
import overviewCssRaw from './overview.css?raw';

/*
 * 0.1.8.4 (owner, Jaden: "overview artifact and file buttons should also just be floating there without big boxes around
 * them ... the same for the button floating at the chat header, just have them float with minimal transparent backdrops,
 * if anything capsule like the + in the chatbox ... no need to really package them like they are now with heavy shadows").
 *
 * The overview's Quick open buttons and the chat header's icon buttons wear the composer + button's capsule classes
 * (.s2-ibtn .s2-round, no .s2-g plate). The Files and Artifacts rows and the section heads carry no border and no shadow.
 * The panel keeps a light glass edge and loses its shadow.
 */
const norm = (s: string): string => s.replace(/\r\n/g, '\n');
const overviewCss = norm(overviewCssRaw);
const shellCss = norm(shell2Css);

/** The declaration bodies of every rule whose selector list is exactly `selector` (whitespace-normalised). */
function bodies(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    if (sel === selector) out.push(m[2]!);
  }
  return out;
}
const shadowsOf = (body: string): string[] => [...body.matchAll(/(?:^|[\s;])box-shadow:\s*([^;]+);/g)].map((m) => m[1]!.trim());
const bordersOf = (body: string): string[] => [...body.matchAll(/(?:^|[\s;])border(?:-color)?:\s*([^;]+);/g)].map((m) => m[1]!.trim());

/** The class tokens of the <button> that carries `testId` (a literal or the start of a template). */
function classesOf(src: string, testId: string): string[] {
  const at = norm(src).indexOf(testId);
  expect(at, `${testId} is in the source`).toBeGreaterThan(-1);
  const s = norm(src);
  const open = s.lastIndexOf('<button', at);
  const head = s.slice(open, s.indexOf('>', at));
  const c = /className="([^"]*)"/.exec(head);
  expect(c, `${testId} has a literal className`).not.toBeNull();
  return c![1]!.split(/\s+/).filter(Boolean);
}

const PLUS = classesOf(v3ChatSrc, 'data-testid="v3-tools-trigger"');
const CAPSULE = ['s2-ibtn', 's2-round'];

describe('the composer + is the capsule the floating buttons copy', () => {
  it('the + is .s2-ibtn .s2-round, and .s2-round is the full radius', () => {
    for (const c of CAPSULE) expect(PLUS).toContain(c);
    const chat2 = norm(readChat2());
    expect(bodies(chat2, '.s2-ibtn.s2-round').join('')).toMatch(/border-radius:\s*var\(--r-full\);/);
  });
});

describe('the overview floats: no boxes on its buttons, rows or panel', () => {
  it('the Quick open buttons are the + capsule, with no .s2-g plate', () => {
    const cls = classesOf(overviewSrc, 'data-testid={`ov-open-${q.id}`}');
    for (const c of CAPSULE) expect(cls).toContain(c);
    expect(cls).not.toContain('s2-g');
  });

  it('CONTRACT CHANGE (0184 finish): there is no collapse button to dress, the chat-only overview is never minimised by hand', () => {
    expect(overviewSrc).not.toContain('ov-collapse');
    expect(overviewSrc).not.toContain('Collapse overview');
  });

  it.each(['.ov .ov-row', '.ov .ov-sec-h', '.ov .ov-pillbtn'])('%s has no shadow and no border (or only transparent)', (sel) => {
    const rules = bodies(overviewCss, sel);
    expect(rules.length).toBeGreaterThan(0);
    const all = rules.join('\n');
    if (sel !== '.ov .ov-pillbtn') expect(bordersOf(all).every((b) => b === '0' || b === 'none' || /transparent/.test(b))).toBe(true);
    expect(shadowsOf(all)).toContain('none');
    expect(shadowsOf(all).every((s) => s === 'none')).toBe(true);
  });

  it.each(['.ov .ov-row:hover', '.ov .ov-sec-h:hover, .ov .ov-row:hover', '.ov .ov-row.is-static:hover'])('%s adds a backdrop but never a shadow', (sel) => {
    const rules = bodies(overviewCss, sel);
    expect(rules.length).toBeGreaterThan(0);
    expect(shadowsOf(rules.join('\n')).every((s) => s === 'none')).toBe(true);
  });

  it('the panel and popover drop the heavy shadow and keep only a light glass edge', () => {
    const all = bodies(overviewCss, '.ov-panel, .ov-pop').join('\n');
    expect(shadowsOf(all)).toEqual(['none']);
    expect(all).not.toMatch(/--b-shadow|--b-lift/);
    expect(bordersOf(all)).toEqual(['var(--w-hair) solid var(--b-glassedge)']);
  });

  it('no overview rule re-adds a shadow other than none', () => {
    for (const m of overviewCss.matchAll(/box-shadow:\s*([^;]+);/g)) expect(m[1]!.trim()).toBe('none');
  });
});

describe('the chat header buttons float as the same capsule', () => {
  const IDS = ['s2-chat-quick-${q.id}', 's2-overview-toggle', 's2-chat-more', 's2-sidebar-open'];
  it.each(IDS)('%s is .s2-ibtn .s2-round, with no .s2-g plate', (id) => {
    const cls = classesOf(shellSrc, `data-testid="${id}"`.replace('"s2-chat-quick-${q.id}"', '{`s2-chat-quick-${q.id}`}'));
    for (const c of CAPSULE) expect(cls).toContain(c);
    expect(cls).not.toContain('s2-g');
  });

  it('the .s2-ibtn base they stand on is transparent, borderless and shadowless; the header adds no rule that boxes them', () => {
    const base = bodies(shellCss, '.s2-ibtn').join('\n');
    expect(base).toMatch(/background:\s*transparent;/);
    expect(bordersOf(base)).toEqual(['1px solid transparent']);
    expect(shadowsOf(base)).toEqual([]);
    for (const m of shellCss.matchAll(/([^{}]*\.s2-ch[^{}]*\.s2-ibtn[^{}]*|[^{}]*\.s2-chat-quick[^{}]*)\{([^{}]*)\}/g)) {
      expect(shadowsOf(m[2]!).every((s) => s === 'none')).toBe(true);
    }
  });
});

import chat2Raw from '../shell2/chat2.css?raw';
function readChat2(): string {
  return chat2Raw;
}

describe('every hover card wears the old grey and white buttons, and a light lift', () => {
  const rail = norm(railPopCssRaw);
  it('the Review loop preview has no blue button: Open and Launch are plain .s2-btn', () => {
    for (const id of ['wfp-open', 'wfp-launch']) {
      const cls = classesOf(previewSrc, `data-testid="${id}"`);
      expect(cls).toContain('s2-btn');
      expect(cls).not.toContain('s2-blue');
    }
  });
  it.each(['.rail-pop .s2-btn, .rail-pop .s2-btn.s2-blue', '.rail-pop .s2-btn:hover, .rail-pop .s2-btn.s2-blue:hover'])('%s is grey and white with no shadow', (sel) => {
    const body = bodies(rail, sel).join('\n');
    expect(body.length).toBeGreaterThan(0);
    expect(shadowsOf(body)).toEqual(['none']);
    expect(body).toMatch(/background:\s*var\(--surface-1\);/);
    expect(body).toMatch(/border(?:-color)?:[^;]*var\(--edge(?:-strong)?\)/);
    expect(body).not.toMatch(/--accent|--b-acc|--b-accs/);
  });
  it('the popover card keeps a light edge and a soft shadow, not --b-lift', () => {
    const body = bodies(rail, '.s2-menu.rail-pop').join('\n');
    expect(body).toMatch(/border-color:\s*var\(--edge\);/);
    const sh = shadowsOf(body);
    expect(sh).toHaveLength(1);
    expect(sh[0]).not.toMatch(/--b-lift|--b-shadow/);
    expect(sh[0]).toMatch(/rgba\(0, 0, 0, 0\.\d+\)/);
  });
});
