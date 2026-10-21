#!/usr/bin/env node
/*
 * BOARD LEGIBILITY — what the architecture board shows on its first screen.
 *
 * Starts the built CLI (`sequence app --repo <dir>`) on a free port, opens a fresh Chromium at
 * each viewport, waits for the board to settle (node positions unchanged for 800 ms), then counts
 * on the rendered page:
 *   visible      board boxes (.react-flow__node) that intersect the board pane
 *   cutOff       boxes not wholly inside the pane (1 px tolerance), including boxes wholly
 *                outside it
 *   labelOverlaps pairs of visible labels (node titles, edge labels) whose boxes intersect
 *   boxOverlaps  pairs of visible boxes whose boxes intersect (a box inside its group is not one)
 *   crossings    intersections between the rendered edge paths of two different edges, sampled
 *                from the SVG paths in screen space; points within 8 px of an endpoint are not
 *                counted (edges that share a port meet there by construction)
 *   edges        rendered edges
 *
 *   node tools/measure/board-legibility.mjs --repo <dir> [--viewports 1440x900,1024x700]
 *        [--expand-all [--max-cutoff 0]] [--max-title-spread 0.5] [--max-under-controls 0] [--expand <id,id>] [--click <testid,testid>] [--export <dir>] [--shots <dir> --tag <name>] [--out file.json] [--settle-ms 1500] [--attach]
 *        [--theme dark|light] [--max-title-past-box 0] [--max-edge-label-overlaps 0] [--keep-sequence]
 *
 * --theme light sets data-theme="light" on the root before the app boots (the app ships no switch);
 * dark is the default room. --max-title-past-box <n> fails a run when more than n card titles paint
 * ink outside their own card's border box (S4 review, item 1). --keep-sequence copies the repo's
 * .sequence/ too, so a fixture's explained names (shopfront's "Notifications service") are the
 * board's labels; without it the board shows the scanned ids.
 *
 * --attach starts the app with NO repo and attaches it the way a person does on first run:
 * Open project, paste the path, Open. The board pane appears after the page has laid out, which
 * is the case where the first fit used to run against a pane that was still changing width.
 *
 * Calls no model. Needs playwright-core (a web2 dev dependency) and a Chromium.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { exitCode, removeDirPatiently } from './lib/teardown.mjs';
import { isolatedEnv } from './lib/isolatedEnv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const REPO = path.resolve(arg('--repo', path.join(ROOT, 'packages/analyzer/test/fixtures/shopfront')));
const VIEWPORTS = arg('--viewports', '1440x900,1024x700')
  .split(',')
  .map((v) => v.split('x').map(Number));
const SHOTS = arg('--shots');
const TAG = arg('--tag', path.basename(REPO));
const OUT = arg('--out');
const SETTLE_MS = Number(arg('--settle-ms', '1500'));
const ATTACH = process.argv.includes('--attach');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(root, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitStatus(port, capMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server never answered /api/status');
}

/* Runs in the page. Pure geometry over what was painted. */
async function measureInPage() {
  const flow = document.querySelector('.react-flow');
  if (!flow) return { error: 'no .react-flow on the page' };
  const fr = flow.getBoundingClientRect();
  const pane = {
    left: Math.max(fr.left, 0),
    top: Math.max(fr.top, 0),
    right: Math.min(fr.right, window.innerWidth),
    bottom: Math.min(fr.bottom, window.innerHeight),
  };
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const inside = (a, b, tol = 1) => a.left >= b.left - tol && a.right <= b.right + tol && a.top >= b.top - tol && a.bottom <= b.bottom + tol;
  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  const nodes = [...document.querySelectorAll('.react-flow__node')]
    .map((el) => ({ el, id: el.getAttribute('data-id'), r: el.getBoundingClientRect() }))
    .filter((n) => n.r.width > 0 && n.r.height > 0);
  const visible = nodes.filter((n) => intersects(n.r, pane));
  /* Cut off = any box the reader cannot see whole: partly outside the pane, or
     wholly outside it (a box that never reached the first screen is cut too). */
  const cut = nodes.filter((n) => !inside(n.r, pane));

  let boxOverlaps = 0;
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (inside(a.r, b.r, 0) || inside(b.r, a.r, 0)) continue; /* a member inside its group */
      if (area(a.r, b.r) > 1) boxOverlaps++;
    }

  const labels = [...document.querySelectorAll('[data-testid="board-node-title"], [data-testid="board-edge-label"], [data-testid="board-group-title"]')]
    /* A label painted fully transparent (a far label that yields to a busier
       neighbour) is not on screen, so it cannot overlap anything. */
    .filter((el) => getComputedStyle(el).opacity !== '0' && getComputedStyle(el).visibility !== 'hidden')
    /* The INK, not the element: a block-level title is as wide as its card,
       and a counter-scaled far title's box is wider than its glyphs. A Range
       over the text measures what is painted. */
    .map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    })
    .filter((r) => r.width > 0 && r.height > 0 && intersects(r, pane));
  /* A card title whose ink leaves its own card's border box (S4 review, item
     1): the counter-scaled far title included. Ink by Range, as above; a
     title painted transparent (it yields) is not on screen. Ink touching the
     border reads as spilling (the S4 shots), so the ink must clear the
     border box by a screen pixel. */
  const pastBox = [];
  for (const el of document.querySelectorAll('[data-testid="board-node-title"]')) {
    if (getComputedStyle(el).opacity === '0' || getComputedStyle(el).visibility === 'hidden') continue;
    const card = el.closest('.node');
    if (!card) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const ink = range.getBoundingClientRect();
    if (ink.width === 0 || ink.height === 0 || !intersects(ink, pane)) continue;
    const cr = card.getBoundingClientRect();
    const clear = { left: cr.left + 1, right: cr.right - 1, top: cr.top + 1, bottom: cr.bottom - 1 };
    if (!inside(ink, clear, 0)) pastBox.push(el.closest('.react-flow__node')?.getAttribute('data-id') ?? el.textContent);
  }

  let labelOverlaps = 0;
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) if (area(labels[i], labels[j]) > 1) labelOverlaps++;

  /* Edge paths, sampled to polylines in screen space. */
  const edgeEls = [...document.querySelectorAll('.react-flow__edge')];
  const lines = [];
  for (const g of edgeEls) {
    const paths = [...g.querySelectorAll('path')].filter((p) => {
      const cs = getComputedStyle(p);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.strokeOpacity || 1) > 0 && cs.stroke !== 'none' && !p.classList.contains('react-flow__edge-interaction');
    });
    const p = paths[0];
    if (!p) continue;
    const len = p.getTotalLength();
    if (!(len > 0)) continue;
    const m = p.getScreenCTM();
    const pts = [];
    const steps = Math.max(2, Math.ceil(len / 6));
    for (let k = 0; k <= steps; k++) {
      const q = p.getPointAtLength((len * k) / steps);
      pts.push({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
    }
    lines.push(pts);
  }
  const segX = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  };
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.y - b.y) < r;
  let crossings = 0;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i], B = lines[j];
      const ends = [A[0], A[A.length - 1], B[0], B[B.length - 1]];
      const found = [];
      for (let a = 0; a < A.length - 1; a++)
        for (let b = 0; b < B.length - 1; b++) {
          const x = segX(A[a], A[a + 1], B[b], B[b + 1]);
          if (!x) continue;
          if (ends.some((e) => near(e, x, 8))) continue;
          if (found.some((f) => near(f, x, 4))) continue;
          found.push(x);
        }
      crossings += found.length;
    }

  /* EDGE-LABEL OVERLAPS (round 7): every painted connector tag against every
     other tag, every card (not a group frame) and every OTHER connector's
     path, sampled every 3px. A tag sits on its own line by design. Counted as
     one per colliding pair. */
  let edgeLabelOverlaps = 0;
  const edgeLabelOverlapIds = [];
  {
    const tagEls = [...document.querySelectorAll('.react-flow__edge [data-testid="board-edge-label"]')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.opacity !== '0' && cs.visibility !== 'hidden' && cs.display !== 'none';
    });
    const tagged = tagEls
      .map((el) => ({ edge: el.closest('.react-flow__edge'), r: el.getBoundingClientRect(), text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('') }))
      .filter((t) => t.r.width > 0 && intersects(t.r, pane));
    const cards = [...document.querySelectorAll('.react-flow__node .node')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
    const samples = [...document.querySelectorAll('.react-flow__edge')].map((g) => {
      const p = [...g.querySelectorAll('path')].find((q) => q.getAttribute('data-testid') === 'board-edge');
      if (!p) return { g, pts: [] };
      const len = p.getTotalLength();
      const m = p.getScreenCTM();
      const pts = [];
      for (let k = 0; k <= Math.ceil(len / 3); k++) {
        const q = p.getPointAtLength(Math.min(len, k * 3));
        pts.push({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
      }
      return { g, pts };
    });
    const inR = (pt, r) => pt.x > r.left && pt.x < r.right && pt.y > r.top && pt.y < r.bottom;
    for (let i = 0; i < tagged.length; i++) {
      const t = tagged[i];
      for (let j = i + 1; j < tagged.length; j++)
        if (area(t.r, tagged[j].r) > 1) { edgeLabelOverlaps++; edgeLabelOverlapIds.push(`${t.text} x ${tagged[j].text}`); }
      for (const c of cards)
        if (area(t.r, c) > 1) { edgeLabelOverlaps++; edgeLabelOverlapIds.push(`${t.text} x card`); }
      for (const s of samples)
        if (s.g !== t.edge && s.pts.some((pt) => inR(pt, t.r))) { edgeLabelOverlaps++; edgeLabelOverlapIds.push(`${t.text} x line`); }
    }
  }

  /* UNDER CONTROLS: visible boxes that the floating controls panel (at rest)
     intersects. The panel paints over the board, so a box under it is hidden. */
  const ctl = document.querySelector('[data-testid="board-controls"]');
  const ctlR = ctl ? ctl.getBoundingClientRect() : null;
  const under = ctlR && ctlR.width > 0 ? visible.filter((n) => area(n.r, ctlR) > 1) : [];

  /* LABELS WIDER THAN THEIR BOX: a node title whose painted ink is wider than
     the card it names (it spills over the border), plus titles the browser
     truncates (scrollWidth past clientWidth: an ellipsis is showing). */
  let labelsWider = 0;
  let labelsTruncated = 0;
  const widerIds = [];
  const truncatedIds = [];
  for (const el of document.querySelectorAll('[data-testid="board-node-title"], [data-testid="board-group-title"]')) {
    const cs = getComputedStyle(el);
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const host = el.closest('.react-flow__node');
    if (!host) continue;
    const hr = host.getBoundingClientRect();
    if (!intersects(hr, pane)) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const raw = range.getBoundingClientRect();
    if (raw.width <= 0) continue;
    /* What is PAINTED: a label that clips its own overflow (an ellipsis)
       paints only inside its own box. */
    const own = el.getBoundingClientRect();
    const clips = cs.overflowX === 'hidden' || cs.overflow === 'hidden';
    const ink = clips ? { left: Math.max(raw.left, own.left), right: Math.min(raw.right, own.right) } : raw;
    if (ink.left < hr.left - 1 || ink.right > hr.right + 1) {
      labelsWider++;
      widerIds.push(host.getAttribute('data-id'));
    }
    const text = (el.textContent || '').trim();
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || /\.\.\.|…/.test(text)) {
      /* Any ellipsis, end or middle: a shortened name is a truncated name. */
      labelsTruncated++;
      truncatedIds.push(host.getAttribute('data-id'));
    }
  }

  /* TITLE SIZE PER KIND: the painted size of each card's title (its computed
     font-size times every scale above it: the camera and the far-zoom
     counter-scale), grouped by the card's kind. One kind, one size at a given
     zoom; titleSpread is max - min over every title on the board, whatever its
     kind (coordinator ruling: one size for every kind at a given zoom), and
     titleSpreadInKind the largest within one kind. */
  const titlePx = {};
  for (const el of document.querySelectorAll('[data-testid="board-node-title"]')) {
    const cs = getComputedStyle(el);
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const card = el.closest('[data-testid="board-node"]');
    if (!card || el.offsetHeight <= 0) continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || !intersects(r, pane)) continue;
    const px = parseFloat(cs.fontSize) * (r.height / el.offsetHeight);
    const kind = card.getAttribute('data-kind') || '?';
    const k = (titlePx[kind] ??= { min: px, max: px, n: 0 });
    k.min = Math.min(k.min, px);
    k.max = Math.max(k.max, px);
    k.n++;
  }
  for (const k of Object.values(titlePx)) {
    k.min = Math.round(k.min * 10) / 10;
    k.max = Math.round(k.max * 10) / 10;
  }
  const all = Object.values(titlePx);
  const titleSpread = all.length ? Math.round((Math.max(...all.map((k) => k.max)) - Math.min(...all.map((k) => k.min))) * 10) / 10 : 0;
  const titleSpreadInKind = Math.round(Math.max(0, ...all.map((k) => k.max - k.min)) * 10) / 10;

  /* GROUP HEADERS: the smallest painted group title (px of ink height), so a
     header that shrank to an unreadable smudge at far zoom shows up as a number. */
  let minGroupTitlePx = null;
  for (const el of document.querySelectorAll('[data-testid="board-group-title"]')) {
    const cs = getComputedStyle(el);
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (r.height <= 0 || !intersects(r, pane)) continue;
    minGroupTitlePx = minGroupTitlePx === null ? r.height : Math.min(minGroupTitlePx, r.height);
  }

  /* EDGES SHOWN / EDGES IN THE GRAPH AT THIS LEVEL. Every scanned edge
     (imports included) is lifted to the deepest box the board draws; the
     distinct directed pairs of different, non-nested boxes are what the graph
     has to say at this level. Shown = distinct pairs the board draws (from
     data-pair when the build carries it, else the rendered edge count). So
     dropping lines can never read as a cleaner board. */
  let edgesAtLevel = null;
  let levelPairs = null;
  try {
    const res = await fetch('/archgraph.json');
    const body = res.ok ? await res.json() : null;
    const g = body && (body.graph ?? body);
    if (g && Array.isArray(g.nodes) && Array.isArray(g.edges)) {
      const drawnIds = new Set(nodes.map((n) => n.id));
      const parent = new Map(g.nodes.map((n) => [n.id, n.parentId]));
      const liftId = (id) => {
        const seen = new Set();
        let cur = id;
        while (cur && !seen.has(cur)) {
          if (drawnIds.has(cur)) return cur;
          seen.add(cur);
          cur = parent.get(cur);
        }
        return undefined;
      };
      const contains = (a, b) => {
        let cur = parent.get(b);
        const seen = new Set();
        while (cur && !seen.has(cur)) {
          if (cur === a) return true;
          seen.add(cur);
          cur = parent.get(cur);
        }
        return false;
      };
      const pairs = new Set();
      for (const e of g.edges) {
        const a = liftId(e.srcId);
        const b = liftId(e.dstId);
        if (!a || !b || a === b || contains(a, b) || contains(b, a)) continue;
        pairs.add(a + '\u0000' + b);
      }
      edgesAtLevel = pairs.size;
      levelPairs = new Set([...pairs].map((k) => k.replace('\u0000', '->')));
    }
  } catch {}
  const pairEls = [...document.querySelectorAll('.react-flow__edge [data-pair]')];
  const shownPairs = new Set(pairEls.map((el) => el.getAttribute('data-pair')));
  const edgesShown = pairEls.length > 0 ? shownPairs.size : lines.length;
  /* Of the graph's pairs at this level, how many the board draws (needs data-pair). */
  const edgesCovered = pairEls.length > 0 && levelPairs ? [...levelPairs].filter((k) => shownPairs.has(k)).length : null;

  return {
    pane: { w: Math.round(pane.right - pane.left), h: Math.round(pane.bottom - pane.top) },
    total: nodes.length,
    titlesPastBox: pastBox.length,
    titlesPastBoxIds: pastBox.slice(0, 20),
    underControls: under.length,
    underControlsIds: under.map((n) => n.id),
    labelsWider,
    widerIds: widerIds.slice(0, 20),
    labelsTruncated,
    truncatedIds: truncatedIds.slice(0, 20),
    minGroupTitlePx: minGroupTitlePx === null ? null : Math.round(minGroupTitlePx * 10) / 10,
    titlePx,
    titleSpread,
    titleSpreadInKind,
    edgesShown,
    edgesAtLevel,
    edgesCovered,
    edgesShownBy: pairEls.length > 0 ? 'data-pair' : 'rendered edges',
    visible: visible.length,
    cutOff: cut.length,
    cutOffIds: cut.map((n) => n.id).slice(0, 20),
    labelOverlaps,
    edgeLabelOverlaps,
    edgeLabelOverlapIds: edgeLabelOverlapIds.slice(0, 20),
    boxOverlaps,
    crossings,
    edges: lines.length,
  };
}

async function settle(page) {
  await page.waitForSelector('.react-flow__node', { state: 'visible', timeout: 90000 });
  let last = '';
  let stableSince = Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const sig = await page.evaluate(() => {
      const vp = document.querySelector('.react-flow__viewport');
      const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => n.style.transform).join('|');
      /* A layout still running in the worker is not a settled board. */
      const busy = document.querySelector('[data-layout="laying-out"]') ? 'busy' : '';
      return busy + (vp ? vp.style.transform : '') + '#' + nodes;
    });
    if (sig !== last || sig.startsWith('busy')) {
      last = sig;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= SETTLE_MS) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const exe = findChromium();
if (!exe) {
  console.log('board-legibility: no Chromium found; set CHROMIUM_PATH. Skipping.');
  process.exit(0);
}
const port = await freePort();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-legibility-home-'));
/* The scan writes .sequence/ into the repo it reads, so it reads a temp COPY:
   a measurement never writes into a checked-in fixture or the worktree. */
const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-legibility-repo-'));
const scanned = path.join(scanRoot, path.basename(REPO));
const SKIP = process.argv.includes('--keep-sequence')
  ? /[\\/](node_modules|\.git|\.claude|dist)([\\/]|$)/
  : /[\\/](node_modules|\.git|\.sequence|\.claude|dist)([\\/]|$)/;
fs.cpSync(REPO, scanned, { recursive: true, filter: (p) => !SKIP.test(p.slice(REPO.length)) });
const cliArgs = [CLI, 'app', '--no-open', '--port', String(port), ...(ATTACH ? [] : ['--repo', scanned])];
const child = spawn(process.execPath, cliArgs, {
  /* The user store (last-place.json, recent repos) is SEQUENCE_USER_DIR; a run
     with SEQUENCE_HOME alone wrote the real ~/.sequence (2026-10-05). */
  env: isolatedEnv(process.env, { userDir: home }),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const rows = [];
let failed = false;
try {
  await waitStatus(port);
  for (const [w, h] of VIEWPORTS) {
    const THEME = arg('--theme', 'dark');
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: THEME === 'light' ? 'light' : 'dark' });
    const page = await ctx.newPage();
    if (THEME === 'light') await page.addInitScript(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.goto(`http://127.0.0.1:${port}/${arg('--query', '')}`, { waitUntil: 'domcontentloaded' });
    if (ATTACH) {
      await page.getByText('Open project', { exact: true }).first().click();
      await page.fill('[data-testid="attach-path"]', scanned);
      await page.click('[data-testid="attach-path-open"]');
    }
    /* --expand a,b: expand these groups in place (double-click), in order. */
    for (const id of (arg('--expand', '') || '').split(',').filter(Boolean)) {
      await settle(page);
      await page.dblclick(`.react-flow__node[data-id="${id}"] [data-testid="board-node"]`);
    }
    /* --click <testid,testid>: press these controls first (e.g. collapse the sidebar). */
    for (const id of (arg('--click', '') || '').split(',').filter(Boolean)) {
      await settle(page);
      await page.click(`[data-testid="${id}"]`);
    }
    /* --expand-all: press the board's own Expand all (More panel) and wait
       for it to finish: it opens groups in rank order while the board stays
       readable (canvas/autoExpand.ts). Records the most boxes ever drawn
       (§3.2 budget: 50) and the groups it left behind "+N groups". */
    const EXPAND_ALL = process.argv.includes('--expand-all');
    let maxBoxes = 0;
    let moreGroups = null;
    if (EXPAND_ALL) {
      await settle(page);
      await page.click('[data-testid="board-controls-toggle"]');
      await page.click('[data-testid="board-expand-all"]');
      await page.click('[data-testid="board-controls-toggle"]');
      const t0 = Date.now();
      while (Date.now() - t0 < 120000) {
        maxBoxes = Math.max(maxBoxes, await page.locator('.react-flow__node').count());
        const running = await page.$('[data-auto-expand="running"]');
        if (!running) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await settle(page);
      moreGroups = await page.$eval('[data-testid="board-more-groups"]', (el) => el.textContent).catch(() => null);
    }
    /* An attach can reload the page once; measure the page that stays. */
    let m;
    for (let attempt = 0; ; attempt++) {
      try {
        await settle(page);
        m = await page.evaluate(measureInPage);
        break;
      } catch (e) {
        if (attempt >= 2 || !/context was destroyed|navigation/i.test(String(e?.message))) throw e;
        await page.waitForLoadState('domcontentloaded');
      }
    }
    const row = { repo: TAG, viewport: `${w}x${h}`, theme: arg('--theme', 'dark'), ...m };
    if (EXPAND_ALL) {
      row.maxBoxesDuringExpands = Math.max(maxBoxes, m.total);
      row.moreGroups = moreGroups;
    }
    /* --export <dir>: press Save as PNG and check what the reader gets. */
    const EXPORT = arg('--export');
    if (EXPORT) {
      fs.mkdirSync(EXPORT, { recursive: true });
      await page.click('[data-testid="board-controls-toggle"]');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click('[data-testid="board-export-png"]'),
      ]);
      const file = path.join(EXPORT, `${TAG}-${w}x${h}-export.png`);
      await download.saveAs(file);
      const buf = fs.readFileSync(file);
      const isPng = buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      row.export = { file, bytes: buf.length, png: isPng, width: isPng ? buf.readUInt32BE(16) : 0, height: isPng ? buf.readUInt32BE(20) : 0 };
      await page.click('[data-testid="board-controls-toggle"]');
    }
    rows.push(row);
    console.log(JSON.stringify(row));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${TAG}-${w}x${h}.png`) });
    }
    await ctx.close();
  }
} catch (e) {
  failed = true;
  console.error('board-legibility failed:', e?.message ?? e);
  console.error(log.slice(-2000));
} finally {
  await browser.close().catch(() => {});
  /* The app must be gone before its directories are: a live child (or the browser's last handles) is what makes the
     removal fail on Windows. Teardown is housekeeping and never fails the run (lib/teardown.mjs). */
  if (child.exitCode === null && child.signalCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
  }
  await removeDirPatiently(home);
  await removeDirPatiently(scanRoot);
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
/* --max-cutoff <n>: fail the run when any viewport cuts off more than n boxes
   (the expand-all lock: `--expand-all --max-cutoff 0` on codeforge). */
const MAX_CUT = arg('--max-cutoff');
if (!failed && MAX_CUT !== undefined) {
  const over = rows.filter((r) => r.cutOff > Number(MAX_CUT));
  for (const r of over) console.error(`board-legibility: ${r.repo} ${r.viewport} cuts off ${r.cutOff} boxes (max ${MAX_CUT}): ${r.cutOffIds.join(', ')}`);
  if (over.length > 0) failed = true;
}
/* --max-title-spread <px>: fail when one kind's titles differ in painted size
   by more than this at one viewport, across every kind (one size for every title at a
   given zoom). */
const MAX_SPREAD = arg('--max-title-spread');
if (!failed && MAX_SPREAD !== undefined) {
  const over = rows.filter((r) => r.titleSpread > Number(MAX_SPREAD));
  for (const r of over) console.error(`board-legibility: ${r.repo} ${r.viewport} title sizes on the board differ by ${r.titleSpread}px (max ${MAX_SPREAD}): ${JSON.stringify(r.titlePx)}`);
  if (over.length > 0) failed = true;
}
/* --max-under-controls <n>: fail when a box sits under the board toolbar. */
const MAX_UNDER = arg('--max-under-controls');
if (!failed && MAX_UNDER !== undefined) {
  const over = rows.filter((r) => r.underControls > Number(MAX_UNDER));
  for (const r of over) console.error(`board-legibility: ${r.repo} ${r.viewport} has ${r.underControls} boxes under the controls: ${r.underControlsIds.join(', ')}`);
  if (over.length > 0) failed = true;
}
/* --max-edge-label-overlaps <n>: fail when connector tags overprint each
   other, a card or another connector (round 7). */
const MAX_TAG = arg('--max-edge-label-overlaps');
if (!failed && MAX_TAG !== undefined) {
  const over = rows.filter((r) => r.edgeLabelOverlaps > Number(MAX_TAG));
  for (const r of over) console.error(`board-legibility: ${r.repo} ${r.viewport} ${r.theme} has ${r.edgeLabelOverlaps} edge-label overlaps: ${r.edgeLabelOverlapIds.join('; ')}`);
  if (over.length > 0) failed = true;
}
/* --max-title-past-box <n>: fail when a card title paints outside its box. */
const MAX_PAST = arg('--max-title-past-box');
if (!failed && MAX_PAST !== undefined) {
  const over = rows.filter((r) => r.titlesPastBox > Number(MAX_PAST));
  for (const r of over) console.error(`board-legibility: ${r.repo} ${r.viewport} ${r.theme} has ${r.titlesPastBox} titles past their box: ${r.titlesPastBoxIds.join(', ')}`);
  if (over.length > 0) failed = true;
}
process.exit(exitCode({ failed }));
