/**
 * Board model: palette-named styling, path/frame shapes, groups, and the
 * hosted `svg` item with its strict sanitizer.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BoardError, SvgError, applyBoardOps, createBoard, readBoard, sanitizeSvg, validateItem } from '../index.js';

const B = String.fromCharCode(92);

const ANATOMY = `<svg viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Anatomy">
  <title>Heart</title>
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d33"/><stop offset="1" stop-color="var(--wont)"/></linearGradient>
    <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="currentColor"/></marker>
    <style>.lbl{font-family:var(--font-sans);fill:var(--ink-1)} .p{fill:url(#g1)}</style>
  </defs>
  <g id="organs" transform="translate(10 10)">
    <path class="p" d="M100 20 C60 0 20 40 100 120 C180 40 140 0 100 20z" stroke="currentColor" stroke-width="2" fill="url(#g1)"/>
    <ellipse cx="100" cy="200" rx="40" ry="20" fill="none" stroke="var(--ink-3)" stroke-dasharray="4 2"/>
    <line x1="100" y1="120" x2="100" y2="180" stroke="currentColor" marker-end="url(#arr)"/>
  </g>
  <text class="lbl" x="100" y="290" text-anchor="middle">Left ventricle</text>
</svg>`;

test('sanitizeSvg: keeps a valid anatomy-style SVG (paths, groups, gradients, markers, text); <style> elements are dropped', () => {
  const { svg, removed } = sanitizeSvg(ANATOMY);
  assert.deepEqual(removed, ['<style> element']);
  assert.ok(!svg.includes('<style') && !svg.includes('font-family:var(--font-sans)'), 'a stylesheet would restyle the whole app');
  for (const needle of ['<linearGradient id="g1"', '<stop offset="0"', '<g id="organs"', '<path class="p"', 'fill="url(#g1)"', '<ellipse', 'marker-end="url(#arr)"', '<text class="lbl"', 'Left ventricle', '<marker id="arr"', 'stroke="var(--ink-3)"']) {
    assert.ok(svg.includes(needle), `kept: ${needle}`);
  }
  assert.ok(svg.startsWith('<svg'));
});

test('sanitizeSvg: strips script, handlers, foreignObject, javascript: and external hrefs, external url() and @import', () => {
  const evil = `<svg viewBox="0 0 10 10" onload="alert(1)">
    <script>alert(2)</script>
    <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(3)></div></foreignObject>
    <a href="javascript:alert(4)"><rect width="5" height="5" onclick="alert(5)"/></a>
    <use href="https://evil.example/x.svg#a"/>
    <use xlink:href="java&#115;cript:alert(6)"/>
    <image href="https://evil.example/p.png" width="5" height="5"/>
    <image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" width="5" height="5"/>
    <image href="data:image/png;base64,iVBORw0KGgo=" width="5" height="5"/>
    <rect width="5" height="5" fill="url(https://evil.example/a.svg#x)" style="background:url(http://e/x)"/>
    <circle r="3" style="fill:red"/>
    <animate attributeName="x" to="1"/>
    <style>@import url(https://evil.example/a.css); .a{fill:red}</style>
    <path d="M0 0L5 5" onmouseover="x()" fill="red"/>
  </svg>`;
  const { svg, removed } = sanitizeSvg(evil);
  const low = svg.toLowerCase();
  for (const bad of ['script', 'alert', 'foreignobject', 'onload', 'onclick', 'onerror', 'onmouseover', 'javascript', 'evil.example', '@import', '<animate', 'svg+xml', '<a ', '<div']) {
    assert.ok(!low.includes(bad), `removed: ${bad} in ${svg}`);
  }
  assert.ok(svg.includes('data:image/png;base64,iVBORw0KGgo='), 'png data image kept');
  assert.ok(svg.includes('<circle r="3" style="fill:red"/>'), 'harmless style kept');
  assert.ok(svg.includes('<path d="M0 0L5 5" fill="red"/>'));
  assert.ok(removed.some((r) => /script/.test(r)) && removed.some((r) => /foreignobject/.test(r)) && removed.some((r) => /onload/.test(r)));
});

test('sanitizeSvg: rejects with a reason: too big, not svg, doctype, non-string', () => {
  assert.throws(() => sanitizeSvg('<svg>' + 'x'.repeat(260 * 1024) + '</svg>'), (e: unknown) => e instanceof SvgError && /256KB/.test((e as Error).message));
  assert.throws(() => sanitizeSvg('<div>hi</div>'), /root/);
  assert.throws(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>'), /DOCTYPE/);
  assert.throws(() => sanitizeSvg(42), /string/);
});

test('sanitizeSvg: nesting stays balanced when the agent leaves tags open', () => {
  const { svg } = sanitizeSvg('<svg><g><rect width="1" height="1"></svg>');
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="1" height="1"></rect></g></svg>');
});

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'board-style-'));
}

test('board store: stroke/fill/dash/arrow/width/points/group/fontSize round-trip through applyBoardOps', () => {
  const root = tmp();
  try {
    const wb = createBoard(root, { name: 'Styles' });
    applyBoardOps(root, wb.id, [
      { op: 'put', item: { kind: 'shape', id: 'r1', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, stroke: 'accent', fill: 'surface', strokeWidth: 3, dash: 'dashed', group: 'g1', fontSize: 'lg', labelPos: 'top', label: 'API' } },
      { op: 'put', item: { kind: 'shape', id: 'a1', shape: 'arrow', from: { x: 100, y: 25 }, to: { x: 200, y: 25 }, stroke: 'danger', dash: 'dotted', arrowStart: 'dot', arrowEnd: 'arrow' } },
      { op: 'put', item: { kind: 'shape', id: 'p1', shape: 'path', points: [{ x: 0, y: 100 }, { x: 40, y: 60 }, { x: 80, y: 120 }], stroke: 'chart3', strokeWidth: 8 } },
      { op: 'put', item: { kind: 'shape', id: 'f1', shape: 'frame', from: { x: -10, y: -30 }, to: { x: 220, y: 140 }, label: 'Checkout', fill: 'none' } },
      { op: 'put', item: { kind: 'text', id: 't1', at: { x: 5, y: 5 }, text: 'hi', color: 'muted', fontSize: 'sm' } },
    ]);
    const items = readBoard(root, wb.id)!.items;
    const by = Object.fromEntries(items.map((i) => [i.id, i])) as unknown as Record<string, Record<string, unknown>>;
    assert.deepEqual({ ...by.r1 }, { id: 'r1', kind: 'shape', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, stroke: 'accent', fill: 'surface', strokeWidth: 3, dash: 'dashed', group: 'g1', fontSize: 'lg', labelPos: 'top', label: 'API' });
    assert.equal(by.a1!.arrowStart, 'dot');
    assert.equal(by.a1!.arrowEnd, 'arrow');
    assert.equal(by.a1!.dash, 'dotted');
    assert.deepEqual(by.p1!.points, [{ x: 0, y: 100 }, { x: 40, y: 60 }, { x: 80, y: 120 }]);
    assert.deepEqual([by.p1!.from, by.p1!.to], [{ x: 0, y: 60 }, { x: 80, y: 120 }], 'path bounding box');
    assert.equal(by.p1!.strokeWidth, 8);
    assert.equal(by.f1!.shape, 'frame');
    assert.equal(by.t1!.color, 'muted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('board store: unknown colour names and raw hex are refused unless ownTheme', () => {
  const base = { kind: 'shape', id: 'x', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } };
  const bad = validateItem({ ...base, stroke: 'hotpink' });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : '', /unknown colour.*ink/s);
  const hex = validateItem({ ...base, fill: '#ff0000' });
  assert.equal(hex.ok, false);
  assert.match(!hex.ok ? hex.error : '', /ownTheme/);
  const own = validateItem({ ...base, fill: '#ff0000', stroke: '#112233', ownTheme: true });
  assert.ok(own.ok && (own.item as { fill?: string }).fill === '#ff0000');
  assert.equal(validateItem({ ...base, dash: 'wavy' }).ok, false);
  assert.equal(validateItem({ ...base, shape: 'path' }).ok, false, 'path needs points');
  assert.throws(() => applyBoardOps(tmp(), 'whiteboard', [{ op: 'put', item: { ...base, stroke: 'nope' } }]), BoardError);
});

test('board store: an svg item stores sanitized markup and refuses bad ones', () => {
  const root = tmp();
  try {
    applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'svg', id: 'heart', at: { x: 10, y: 20 }, w: 200, h: 300, svg: ANATOMY, label: 'Heart' } }]);
    const it = readBoard(root, 'whiteboard')!.items[0]! as { kind: string; svg: string; w: number; at: { x: number } };
    assert.equal(it.kind, 'svg');
    assert.ok(it.svg.includes('<linearGradient'));
    applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'svg', id: 'bad', at: { x: 0, y: 0 }, w: 50, h: 50, svg: '<svg onload="x()"><script>1</script><rect width="1" height="1"/></svg>' } }]);
    const bad = readBoard(root, 'whiteboard')!.items.find((i) => i.id === 'bad') as unknown as { svg: string };
    assert.ok(!/script|onload/.test(bad.svg));
    assert.throws(() => applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'svg', id: 'big', at: { x: 0, y: 0 }, w: 5, h: 5, svg: '<svg>' + 'x'.repeat(300_000) + '</svg>' } }]), /svg refused: svg is larger than 256KB/);
    assert.throws(() => applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'svg', id: 'tiny', at: { x: 0, y: 0 }, w: 1, h: 1, svg: '<svg/>' } }]), /between 8 and 20000/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sanitizeSvg: style attributes cannot smuggle a fetch: escapes, image-set(), src(), external url() are all dropped', () => {
  const bad = [
    'fill:u' + B + '72l(https://evil.example/x)',
    'background:image-set("https://evil.example/a.png" 1x)',
    'background:-webkit-image-set(url(#a) 1x)',
    'fill:src("https://evil.example/a")',
    'fill:url(https://evil.example/a.svg#x)',
    'fill:url(' + B + '68ttps://evil.example/a)',
  ];
  for (const css of bad) {
    const { svg, removed } = sanitizeSvg('<svg><rect width="1" height="1" style="' + css.replace(/"/g, "'") + '"/></svg>');
    assert.ok(!svg.includes('style='), css + ' -> ' + svg);
    assert.ok(removed.some((r) => /style|script or external/.test(r)), css);
  }
  const ok = sanitizeSvg('<svg><rect width="1" height="1" style="fill:var(--wont);stroke:url(#g)"/></svg>');
  assert.ok(ok.svg.includes('style="fill:var(--wont);stroke:url(#g)"'));
  /* attribute values too */
  const attr = sanitizeSvg('<svg><rect width="1" height="1" fill="url(' + B + '68ttp://x/y)"/></svg>');
  assert.ok(!attr.svg.includes('fill='));
});

test('sanitizeSvg: ids and their references get a per-item prefix, idempotently', () => {
  const src = '<svg><defs><linearGradient id="g1"><stop offset="0" stop-color="red"/></linearGradient><marker id="m"><path d="M0 0"/></marker></defs><rect id="r" width="1" height="1" fill="url(#g1)" style="stroke:url(#g1)" marker-end="url(#m)" aria-labelledby="r g1"/><use href="#r"/></svg>';
  const once = sanitizeSvg(src, { idPrefix: 'heart-' }).svg;
  for (const needle of ['id="heart-g1"', 'id="heart-m"', 'id="heart-r"', 'fill="url(#heart-g1)"', 'stroke:url(#heart-g1)', 'marker-end="url(#heart-m)"', 'aria-labelledby="heart-r heart-g1"', 'href="#heart-r"']) {
    assert.ok(once.includes(needle), needle + ' in ' + once);
  }
  assert.equal(sanitizeSvg(once, { idPrefix: 'heart-' }).svg, once, 'a second pass changes nothing');
  assert.ok(!sanitizeSvg(src).svg.includes('heart-'), 'no prefix without an item');
});

test('board store: a stored svg item is prefixed with its item id and stays stable across reads', () => {
  const root = tmp();
  try {
    applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { kind: 'svg', id: 'a1', at: { x: 0, y: 0 }, w: 50, h: 50, svg: '<svg><defs><linearGradient id="g"/></defs><rect width="1" height="1" fill="url(#g)"/></svg>' } }]);
    const first = (readBoard(root, 'whiteboard')!.items[0] as unknown as { svg: string }).svg;
    assert.ok(first.includes('id="a1~g"') && first.includes('url(#a1~g)'));
    applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { ...(readBoard(root, 'whiteboard')!.items[0] as object), w: 60 } }]);
    assert.equal((readBoard(root, 'whiteboard')!.items[0] as unknown as { svg: string }).svg, first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('board store: a path box is always derived from its points, whatever the caller sent', () => {
  const v = validateItem({ kind: 'shape', id: 'p', shape: 'path', points: [{ x: 10, y: 50 }, { x: 40, y: 5 }, { x: 25, y: 70 }], from: { x: 0, y: 0 }, to: { x: 0, y: 0 } });
  assert.ok(v.ok);
  if (v.ok && v.item.kind === 'shape') assert.deepEqual([v.item.from, v.item.to], [{ x: 10, y: 5 }, { x: 40, y: 70 }]);
});

test('svg id prefixes cannot collide across items whose ids contain dashes (s1-a / s1)', () => {
  const root = tmp();
  try {
    const mk = (id: string, svgId: string) => ({ op: 'put' as const, item: { kind: 'svg', id, at: { x: 0, y: 0 }, w: 50, h: 50, svg: '<svg><defs><linearGradient id="' + svgId + '"/></defs><rect width="1" height="1" fill="url(#' + svgId + ')"/></svg>' } });
    applyBoardOps(root, 'whiteboard', [mk('s1-a', 'x'), mk('s1', 'a-x')]);
    const items = readBoard(root, 'whiteboard')!.items as unknown as { id: string; svg: string }[];
    const ids = items.flatMap((i) => [...i.svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    assert.equal(new Set(ids).size, ids.length, 'ids are unique across items: ' + ids.join(', '));
    assert.deepEqual(ids.sort(), ['s1-a~x', 's1~a-x']);
    assert.ok(items.find((i) => i.id === 's1')!.svg.includes('url(#s1~a-x)'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pen strokes keep a palette stroke colour (hex only with ownTheme); text color and shape fill surface survive validation and a store round-trip', () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
  const ok = validateItem({ kind: 'stroke', id: 's', points: pts, width: 3, stroke: 'chart4' });
  assert.ok(ok.ok && (ok.item as { stroke?: string }).stroke === 'chart4');
  assert.equal(validateItem({ kind: 'stroke', id: 's', points: pts, stroke: 'puce' }).ok, false);
  assert.equal(validateItem({ kind: 'stroke', id: 's', points: pts, stroke: '#123456' }).ok, false);
  const own = validateItem({ kind: 'stroke', id: 's', points: pts, stroke: '#123456', ownTheme: true });
  assert.ok(own.ok && (own.item as { stroke?: string; ownTheme?: boolean }).stroke === '#123456');
  const plain = validateItem({ kind: 'stroke', id: 's', points: pts });
  assert.ok(plain.ok && !('stroke' in plain.item));
  const root = tmp();
  try {
    applyBoardOps(root, 'whiteboard', [
      { op: 'put', item: { kind: 'stroke', id: 'pen', points: pts, width: 2, stroke: 'danger' } },
      { op: 'put', item: { kind: 'text', id: 'tx', at: { x: 0, y: 0 }, text: 'hi', color: 'positive', fontSize: 'lg' } },
      { op: 'put', item: { kind: 'shape', id: 'box', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, fill: 'surface' } },
    ]);
    const items = Object.fromEntries(readBoard(root, 'whiteboard')!.items.map((i) => [i.id, i])) as unknown as Record<string, Record<string, unknown>>;
    assert.equal(items.pen!.stroke, 'danger');
    assert.equal(items.tx!.color, 'positive');
    assert.equal(items.box!.fill, 'surface');
    /* and again through a re-read + rewrite */
    applyBoardOps(root, 'whiteboard', [{ op: 'put', item: { ...(readBoard(root, 'whiteboard')!.items.find((i) => i.id === 'pen') as object) } }]);
    assert.equal((readBoard(root, 'whiteboard')!.items.find((i) => i.id === 'pen') as unknown as { stroke: string }).stroke, 'danger');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
