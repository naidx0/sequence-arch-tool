#!/usr/bin/env node
/*
 * BOARD VIEWS A/B — Grid and Flow against the Map, scored on a fixed task.
 *
 * Registered before the run in lab/log.md (2026-10-05, "board views (Grid,
 * Flow) against the Map"). For each repo it starts the built app on a temp
 * copy, and at two levels (L0 first screen; L1 every group with members
 * expanded, file-level Imports on, both set by the URL hash) it:
 *   1. reads the Map's DOM: the boxes drawn, and the edges a reader can read
 *      (both ends wholly in the pane and not under the controls; both names
 *      painted and not cut; the route not bundled: no 24 px stretch within
 *      3 px of another route);
 *   2. builds the truth from /archgraph.json lifted to those boxes (imports
 *      included) and generates the questions (Q1 depends-on, Q2 depended-on-by,
 *      Q3 mutual, Q4 shortest path / none);
 *   3. reads the Grid's DOM (cells with a count; labels painted and not cut;
 *      cell text >= 9 px; +1 interaction per axis scrolled) and the Flow's
 *      (pick start and end, count the messages or read "no path"; 2 picks);
 *   4. scores every answer against the truth and compares each view with the
 *      Map: correct counts, exact two-sided McNemar on the paired outcomes,
 *      mean interactions.
 *
 *   node tools/measure/board-views-ab.mjs --repo <dir> [--tag name] [--out file.json]
 *        [--levels L0,L1] [--settle-ms 1500]
 *
 * Calls no model. Needs playwright-core (a web2 dev dependency) and a Chromium.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './lib/isolatedEnv.mjs';
import { diffTruth, heatTruth, historyAnswer, historyQuestions, lineCountSeen, rankSeen, truthSeen } from './lib/historyAb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const REPO = path.resolve(arg('--repo', path.join(ROOT, 'packages/analyzer/test/fixtures/shopfront')));
const TAG = arg('--tag', path.basename(REPO));
const OUT = arg('--out');
const LEVELS = arg('--levels', 'L0,L1').split(',');
const SETTLE_MS = Number(arg('--settle-ms', '1500'));
const SHOTS = arg('--shots');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
const W = 1440;
const H = 900;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean);
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

/* The app's own hash id encoding (canvas/viewState.ts encodeId). */
const encodeId = (id) => encodeURIComponent(id).replace(/\./g, '%2E').replace(/\+/g, '%2B').replace(/%3A/gi, '_');

/* ── the truth and the questions (pure) ─────────────────────────────────── */

export function liftedPairs(graph, drawnIds) {
  const drawn = new Set(drawnIds);
  const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  const lift = (id) => {
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      if (drawn.has(cur)) return cur;
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
  for (const e of graph.edges) {
    const a = lift(e.srcId);
    const b = lift(e.dstId);
    if (!a || !b || a === b || contains(a, b) || contains(b, a)) continue;
    pairs.add(`${a}->${b}`);
  }
  return pairs;
}

const split = (k) => k.split('->');

export function hops(pairs, from, to) {
  if (from === to) return 0;
  const out = new Map();
  for (const k of pairs) {
    const [a, b] = split(k);
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
  }
  const dist = new Map([[from, 0]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift();
    for (const n of out.get(cur) ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, dist.get(cur) + 1);
      if (n === to) return dist.get(n);
      q.push(n);
    }
  }
  return null;
}

export function questions(boxes, truth) {
  const ids = [...boxes].sort();
  const outs = (x, pairs) => [...pairs].filter((k) => split(k)[0] === x).map((k) => split(k)[1]).sort();
  const ins = (x, pairs) => [...pairs].filter((k) => split(k)[1] === x).map((k) => split(k)[0]).sort();
  const qs = [];
  for (const x of ids) if (outs(x, truth).length) qs.push({ q: 'Q1', x });
  for (const x of ids) if (ins(x, truth).length) qs.push({ q: 'Q2', x });
  const seenPair = new Set();
  for (const k of [...truth].sort()) {
    const [a, b] = split(k);
    const u = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenPair.has(u)) continue;
    seenPair.add(u);
    const [p, r] = u.split('|');
    qs.push({ q: 'Q3', a: p, b: r });
  }
  const far = [];
  const none = [];
  for (const a of ids)
    for (const b of ids) {
      if (a === b) continue;
      const d = hops(truth, a, b);
      if (d === null) none.push({ q: 'Q4', a, b });
      else if (d >= 2) far.push({ q: 'Q4', a, b });
    }
  qs.push(...far.slice(0, 10), ...none.slice(0, 5));
  return qs;
}

export function answer(q, pairs) {
  const outs = (x) => [...pairs].filter((k) => split(k)[0] === x).map((k) => split(k)[1]).sort().join(',');
  const ins = (x) => [...pairs].filter((k) => split(k)[1] === x).map((k) => split(k)[0]).sort().join(',');
  if (q.q === 'Q1') return outs(q.x);
  if (q.q === 'Q2') return ins(q.x);
  if (q.q === 'Q3') return pairs.has(`${q.a}->${q.b}`) && pairs.has(`${q.b}->${q.a}`) ? 'yes' : 'no';
  const d = hops(pairs, q.a, q.b);
  return d === null ? 'none' : String(d);
}

/** Exact two-sided McNemar: b = view right / Map wrong, c = the reverse. */
export function mcnemar(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let p = 0;
  let comb = 1;
  for (let i = 0; i <= k; i++) {
    if (i > 0) comb = (comb * (n - i + 1)) / i;
    p += comb;
  }
  return Math.min(1, (2 * p) / 2 ** n);
}

/* ── the readers (run in the page) ──────────────────────────────────────── */

function readMap() {
  const flow = document.querySelector('.react-flow');
  const fr = flow.getBoundingClientRect();
  const pane = { left: Math.max(fr.left, 0), top: Math.max(fr.top, 0), right: Math.min(fr.right, innerWidth), bottom: Math.min(fr.bottom, innerHeight) };
  const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const ctl = document.querySelector('[data-testid="board-controls"]');
  const ctlR = ctl ? ctl.getBoundingClientRect() : null;
  const boxes = {};
  for (const el of document.querySelectorAll('.react-flow__node')) {
    const id = el.getAttribute('data-id');
    const r = el.getBoundingClientRect();
    if (!id || r.width <= 0) continue;
    const t = el.querySelector('[data-testid="board-node-title"], [data-testid="board-group-title"]');
    let named = false;
    if (t) {
      const cs = getComputedStyle(t);
      const painted = cs.opacity !== '0' && cs.visibility !== 'hidden' && cs.display !== 'none';
      const text = (t.textContent || '').trim();
      const cut = t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1 || /(\.\.\.|…)$/.test(text);
      named = painted && !cut && text.length > 0;
    }
    const placed = inside(r, pane) && !(ctlR && ctlR.width > 0 && hit(r, ctlR));
    boxes[id] = { named, placed };
  }
  const routes = [];
  for (const g of document.querySelectorAll('.react-flow__edge')) {
    const m = /^Edge from (.+) to (.+)$/.exec(g.getAttribute('aria-label') || '');
    if (!m) continue;
    /* The drawn route itself: not the arrowhead marker's path inside the
       edge's <defs>, not the wide interaction or hover strokes. */
    const p = g.querySelector('path.react-flow__edge-path');
    if (!p) continue;
    const len = p.getTotalLength();
    const ctm = p.getScreenCTM();
    const pts = [];
    const steps = Math.max(2, Math.ceil(len / 2));
    for (let k = 0; k <= steps; k++) {
      const q = p.getPointAtLength((len * k) / steps);
      pts.push({ x: ctm.a * q.x + ctm.c * q.y + ctm.e, y: ctm.b * q.x + ctm.d * q.y + ctm.f });
    }
    routes.push({ a: m[1], b: m[2], pts });
  }
  const segDist = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  const bundled = (R) => {
    for (const S of routes) {
      if (S === R) continue;
      let run = 0;
      for (let i = 1; i < R.pts.length; i++) {
        const p = R.pts[i];
        let near = false;
        for (let j = 1; j < S.pts.length && !near; j++) if (segDist(p, S.pts[j - 1], S.pts[j]) <= 3) near = true;
        const step = Math.hypot(p.x - R.pts[i - 1].x, p.y - R.pts[i - 1].y);
        run = near ? run + step : 0;
        if (run >= 24) return true;
      }
    }
    return false;
  };
  const read = [];
  const unread = [];
  /* Why each unread edge is unread, first failing rule, for the report. */
  const why = { missingBox: 0, notPlaced: 0, unnamed: 0, bundled: 0 };
  for (const R of routes) {
    const A = boxes[R.a];
    const B = boxes[R.b];
    let reason = null;
    if (!A || !B) reason = 'missingBox';
    else if (!A.placed || !B.placed) reason = 'notPlaced';
    else if (!A.named || !B.named) reason = 'unnamed';
    else if (bundled(R)) reason = 'bundled';
    if (reason) why[reason]++;
    (reason ? unread : read).push(`${R.a}->${R.b}`);
  }
  const unnamedBoxes = Object.entries(boxes).filter(([, b]) => !b.named).map(([id]) => id);
  return { boxes: Object.keys(boxes), read, unread, drawn: routes.length, why, unnamedBoxes };
}

function readGrid() {
  const view = document.querySelector('[data-testid="grid-view"]');
  if (!view) return null;
  const vr = view.getBoundingClientRect();
  const labelOk = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    const text = (el.textContent || '').trim();
    const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 || /(\.\.\.|…)$/.test(text);
    return cs.opacity !== '0' && cs.visibility !== 'hidden' && text.length > 0 && !cut;
  };
  const rows = {};
  for (const th of view.querySelectorAll('th[data-row]')) {
    const r = th.getBoundingClientRect();
    rows[th.getAttribute('data-row')] = { ok: labelOk(th.querySelector('.gv-row-t')), inY: r.top >= vr.top - 1 && r.bottom <= vr.bottom + 1 };
  }
  const cols = {};
  for (const th of view.querySelectorAll('th[data-col]')) {
    const r = th.getBoundingClientRect();
    cols[th.getAttribute('data-col')] = { ok: labelOk(th.querySelector('.gv-col-t')), inX: r.left >= vr.left - 1 && r.right <= vr.right + 1 };
  }
  const read = [];
  for (const td of view.querySelectorAll('td[data-src][data-dst]')) {
    const text = (td.textContent || '').trim();
    if (!/^\d+$/.test(text)) continue;
    const s = td.getAttribute('data-src');
    const d = td.getAttribute('data-dst');
    const px = parseFloat(getComputedStyle(td).fontSize);
    if (rows[s]?.ok && cols[d]?.ok && px >= 9) read.push(`${s}->${d}`);
  }
  return { rows, cols, read };
}

/* ── the run ────────────────────────────────────────────────────────────── */

async function settle(page) {
  await page.waitForSelector('.react-flow__node', { state: 'visible', timeout: 90000 });
  let last = '';
  let since = Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const sig = await page.evaluate(() => {
      const vp = document.querySelector('.react-flow__viewport');
      const busy = document.querySelector('[data-layout="laying-out"]') ? 'busy' : '';
      return busy + (vp ? vp.style.transform : '') + '#' + [...document.querySelectorAll('.react-flow__node')].map((n) => n.style.transform).join('|');
    });
    if (sig !== last || sig.startsWith('busy')) {
      last = sig;
      since = Date.now();
    } else if (Date.now() - since >= SETTLE_MS) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function open(browser, base, hash) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  return { ctx, page };
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-${name}.png`) });
}

async function main() {
  const exe = findChromium();
  if (!exe) {
    console.log('board-views-ab: no Chromium found; set CHROMIUM_PATH. Skipping.');
    return 0;
  }
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-views-home-'));
  const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-views-repo-'));
  const scanned = path.join(scanRoot, path.basename(REPO));
  fs.cpSync(REPO, scanned, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence|\.claude|dist)([\\/]|$)/.test(p.slice(REPO.length)) });
  const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port), '--repo', scanned], {
    env: isolatedEnv(process.env, { userDir: home }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const result = { repo: TAG, levels: {} };
  let code = 0;
  try {
    const t0 = Date.now();
    for (;;) {
      try {
        if ((await fetch(`${base}/api/status`)).ok) break;
      } catch {}
      if (Date.now() - t0 > 180000) throw new Error('server never answered');
      await new Promise((r) => setTimeout(r, 100));
    }
    const g0 = await (await fetch(`${base}/archgraph.json`)).json();
    const graph = g0.graph ?? g0;
    const hasKids = new Set(graph.nodes.filter((n) => n.parentId).map((n) => n.parentId));
    /* L0's boxes decide L1's expansion list: every drawn top-level box with members. */
    const first = await open(browser, base, '#map');
    const l0 = await first.page.evaluate(readMap);
    await first.ctx.close();
    for (const level of LEVELS) {
      const tokens = level === 'L1' ? [`x-${l0.boxes.filter((id) => hasKids.has(id)).sort().map(encodeId).join('+')}`, 'i'] : [];
      const suffix = tokens.length ? `.${tokens.join('.')}` : '';
      const m = await open(browser, base, `#map${suffix}`);
      const map = await m.page.evaluate(readMap);
      await shot(m.page, `${level}-map`);
      await m.ctx.close();
      const truth = liftedPairs(graph, map.boxes);
      const qs = questions(map.boxes, truth);
      const gv = await open(browser, base, `#grid${suffix}`);
      await gv.page.waitForSelector('[data-testid="grid-view"]', { timeout: 30000 });
      const grid = await gv.page.evaluate(readGrid);
      await shot(gv.page, `${level}-grid`);
      await gv.ctx.close();
      const fv = await open(browser, base, `#flow${suffix}`);
      await fv.page.waitForSelector('[data-testid="flow-view"]', { timeout: 30000 });
      const flowAnswers = {};
      for (const q of qs.filter((x) => x.q === 'Q4')) {
        await fv.page.selectOption('[data-testid="flow-start"]', q.a);
        await fv.page.selectOption('[data-testid="flow-end"]', q.b);
        const a = await fv.page.evaluate(() => {
          if (document.querySelector('[data-testid="flow-nopath"]')) return 'none';
          const n = document.querySelectorAll('[data-testid="flow-message"]').length;
          return n > 0 ? String(n) : '?';
        });
        flowAnswers[`${q.a}->${q.b}`] = a;
      }
      const firstPath = qs.find((x) => x.q === 'Q4' && answer(x, truth) !== 'none');
      if (firstPath) {
        await fv.page.selectOption('[data-testid="flow-start"]', firstPath.a);
        await fv.page.selectOption('[data-testid="flow-end"]', firstPath.b);
        await shot(fv.page, `${level}-flow`);
      }
      await fv.ctx.close();

      const mapRead = new Set(map.read);
      const gridRead = new Set(grid.read);
      const gridCost = (q) => {
        const need = q.q === 'Q1' ? [q.x] : q.q === 'Q2' ? [q.x] : [q.a, q.b];
        const rowsY = need.some((id) => grid.rows[id] && !grid.rows[id].inY);
        const colsX = need.some((id) => grid.cols[id] && !grid.cols[id].inX);
        return (rowsY ? 1 : 0) + (colsX ? 1 : 0);
      };
      const rows = qs.map((q) => {
        const t = answer(q, truth);
        const mapA = answer(q, mapRead);
        const gridA = answer(q, gridRead);
        const row = { ...q, truth: t, map: mapA, mapOk: mapA === t, grid: gridA, gridOk: gridA === t, gridCost: gridCost(q) };
        if (q.q === 'Q4') {
          row.flow = flowAnswers[`${q.a}->${q.b}`];
          row.flowOk = row.flow === t;
        }
        return row;
      });
      result.levels[level] = { boxes: map.boxes.length, truthPairs: truth.size, mapDrawn: map.drawn, mapRead: map.read.length, mapUnreadWhy: map.why, mapUnnamedBoxes: map.unnamedBoxes, gridRead: grid.read.length, questions: rows };
      console.log(`${TAG} ${level}: boxes ${map.boxes.length}, truth pairs ${truth.size}, map drawn ${map.drawn} read ${map.read.length} (unread: ${JSON.stringify(map.why)}), grid read ${grid.read.length}, questions ${rows.length}`);
    }
    /* Pool both levels; compare each view with the Map. */
    const all = Object.values(result.levels).flatMap((l) => l.questions);
    const cmp = (rows, ok, cost) => {
      const b = rows.filter((r) => r[ok] && !r.mapOk).length;
      const c = rows.filter((r) => !r[ok] && r.mapOk).length;
      const view = rows.filter((r) => r[ok]).length;
      const map = rows.filter((r) => r.mapOk).length;
      const meanCost = rows.length ? rows.reduce((s, r) => s + cost(r), 0) / rows.length : 0;
      return { n: rows.length, view, map, b, c, p: mcnemar(b, c), meanInteractions: meanCost, mapMeanInteractions: 0 };
    };
    const grid = cmp(all, 'gridOk', (r) => r.gridCost);
    grid.win = grid.view > grid.map && grid.p < 0.05 && grid.meanInteractions <= 1;
    const q4 = all.filter((r) => r.q === 'Q4');
    const flow = cmp(q4, 'flowOk', () => 2);
    flow.win = flow.view > flow.map && flow.p < 0.05 && flow.meanInteractions <= 2;
    result.grid = grid;
    result.flow = flow;
    console.log(JSON.stringify({ repo: TAG, grid, flow }));
  } catch (e) {
    code = 1;
    console.error('board-views-ab failed:', e?.message ?? e);
    console.error(log.slice(-2000));
  } finally {
    await browser.close();
    child.kill();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(scanRoot, { recursive: true, force: true });
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  return code;
}


/* ══ DIFF AND HOTSPOTS (--views diff,hotspots) ══════════════════════════════
   Registered in lab/log.md (2026-10-05, "Diff and Hotspots views against the
   Map"). The repo is a temp CLONE with its history (codeforge, ml-harness:
   --clone --head <sha> --base <ref>) or a temp repo with the scripted
   shopfront history (--synthetic-history). A local branch "main" is set to
   the base, so the views' default base is the registered one. */

function gitIn(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The scripted shopfront history: base, then 12 dated commits on a branch. */
export const SYNTHETIC_PLAN = [
  ['orders', 5],
  ['payments', 4],
  ['gateway', 2],
  ['inventory', 1],
];

function sourceFilesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|py|go|java)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function syntheticHistory(src, dst) {
  fs.cpSync(src, dst, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence|dist)([\\/]|$)/.test(p.slice(src.length)) });
  gitIn(dst, ['init', '-q', '-b', 'main']);
  gitIn(dst, ['config', 'user.email', 'ab@example.com']);
  gitIn(dst, ['config', 'user.name', 'A/B']);
  gitIn(dst, ['config', 'commit.gpgsign', 'false']);
  gitIn(dst, ['add', '-A']);
  const at = (n) => new Date(Date.UTC(2026, 8, 1 + n, 12)).toISOString();
  gitIn(dst, ['commit', '-q', '-m', 'base'], { GIT_AUTHOR_DATE: at(0), GIT_COMMITTER_DATE: at(0) });
  gitIn(dst, ['checkout', '-q', '-b', 'feature']);
  let n = 0;
  for (const [svc, times] of SYNTHETIC_PLAN) {
    const file = sourceFilesUnder(path.join(dst, svc))[0];
    if (!file) throw new Error(`synthetic history: no source file under ${svc}`);
    for (let k = 0; k < times; k++) {
      n += 1;
      fs.appendFileSync(file, `\n// change ${n}\n`);
      if (svc === 'orders' && k === 0) fs.writeFileSync(path.join(path.dirname(file), `added_by_branch${path.extname(file)}`), '// new on the branch\n');
      gitIn(dst, ['add', '-A']);
      gitIn(dst, ['commit', '-q', '-m', `change ${n} in ${svc}`], { GIT_AUTHOR_DATE: at(n), GIT_COMMITTER_DATE: at(n) });
    }
  }
}

function clonedHistory(src, dst, head, base) {
  gitIn(path.dirname(dst), ['clone', '-q', '--no-hardlinks', '--no-checkout', src, dst]);
  const headSha = gitIn(src, ['rev-parse', head]).trim();
  /* A base relative to HEAD (HEAD~30) is relative to the pinned head. */
  const baseSha = gitIn(src, ['rev-parse', base.replace(/^HEAD/, headSha)]).trim();
  gitIn(dst, ['checkout', '-q', '-B', 'feature', headSha]);
  gitIn(dst, ['branch', '-f', 'main', baseSha]);
  return { headSha, baseSha };
}

/* Readers (in the page). */
function readDiff() {
  const ok = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    const t = (el.textContent || '').trim();
    return cs.opacity !== '0' && cs.visibility !== 'hidden' && t.length > 0 && el.scrollWidth <= el.clientWidth + 1 && !/(\.\.\.|…)/.test(t);
  };
  const view = document.querySelector('[data-testid="diff-view"]');
  const vr = view?.getBoundingClientRect();
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return vr && r.top >= vr.top - 1 && r.bottom <= vr.bottom + 1;
  };
  const changed = [];
  const changedOut = [];
  for (const row of document.querySelectorAll('[data-testid="diff-box"]')) {
    const status = row.querySelector('.dv-status');
    if (!ok(row.querySelector('[data-testid="diff-box-name"]')) || !status || !/added|changed|removed/.test(status.textContent || '')) continue;
    changed.push(row.getAttribute('data-id'));
    if (!inView(row)) changedOut.push(row.getAttribute('data-id'));
  }
  const touched = [];
  const touchedOut = [];
  for (const row of document.querySelectorAll('[data-testid="diff-line"]')) {
    if (!ok(row.querySelector('[data-testid="diff-line-from"]')) || !ok(row.querySelector('[data-testid="diff-line-to"]'))) continue;
    touched.push(row.getAttribute('data-pair'));
    if (!inView(row)) touchedOut.push(row.getAttribute('data-pair'));
  }
  return { error: document.querySelector('[data-testid="diff-error"]')?.textContent ?? null, changed, changedOut, touched, touchedOut };
}

function readHot() {
  const view = document.querySelector('[data-testid="hotspots-view"]');
  const vr = view?.getBoundingClientRect();
  const rank = {};
  const out = [];
  for (const row of document.querySelectorAll('[data-testid="hot-box"]')) {
    const name = row.querySelector('[data-testid="hot-name"]');
    const r = row.querySelector('[data-testid="hot-rank"]');
    const t = (name?.textContent || '').trim();
    if (!name || !r || !t || name.scrollWidth > name.clientWidth + 1 || /(\.\.\.|…)/.test(t)) continue;
    const n = Number((r.textContent || '').trim());
    if (!Number.isFinite(n)) continue;
    rank[row.getAttribute('data-id')] = n;
    const rr = row.getBoundingClientRect();
    if (vr && (rr.top < vr.top - 1 || rr.bottom > vr.bottom + 1)) out.push(row.getAttribute('data-id'));
  }
  return { error: document.querySelector('[data-testid="hotspots-error"]')?.textContent ?? null, rank, out };
}

async function waitFor(page, sel) {
  await page.waitForFunction((s) => !!document.querySelector(s), sel, { timeout: 30000 });
}

export async function mainHistory() {
  const exe = findChromium();
  if (!exe) {
    console.log('board-views-ab: no Chromium found; set CHROMIUM_PATH. Skipping.');
    return 0;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-views-hist-'));
  const repo = path.join(work, TAG);
  let setup;
  if (process.argv.includes('--synthetic-history')) {
    syntheticHistory(REPO, repo);
    setup = { synthetic: true, plan: SYNTHETIC_PLAN };
  } else {
    setup = clonedHistory(REPO, repo, arg('--head', 'HEAD'), arg('--base', 'HEAD~30'));
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-views-home-'));
  const port = await freePort();
  const child = spawn(process.execPath, [CLI, 'app', '--no-open', '--port', String(port), '--repo', repo], {
    env: isolatedEnv(process.env, { userDir: home }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const result = { repo: TAG, setup, levels: {} };
  let code = 0;
  try {
    const t0 = Date.now();
    for (;;) {
      try {
        if ((await fetch(`${base}/api/status`)).ok) break;
      } catch {}
      if (Date.now() - t0 > 240000) throw new Error('server never answered');
      await new Promise((r) => setTimeout(r, 100));
    }
    const g0 = await (await fetch(`${base}/archgraph.json`)).json();
    const graph = g0.graph ?? g0;
    const label = (id) => graph.nodes.find((n) => n.id === id)?.label ?? id;
    const bf = await (await fetch(`${base}/api/git/branch-files?base=main`)).json();
    const ch = await (await fetch(`${base}/api/git/churn?days=90`)).json();
    if (!Array.isArray(bf.files) || !ch.files) throw new Error(`history routes: ${JSON.stringify({ bf, ch }).slice(0, 300)}`);
    result.branchFiles = bf.files.length;
    result.churnCommits = ch.commits;
    const hasKids = new Set(graph.nodes.filter((n) => n.parentId).map((n) => n.parentId));
    const first = await open(browser, base, '#map');
    const l0 = await first.page.evaluate(readMap);
    await first.ctx.close();
    for (const level of LEVELS) {
      const tokens = level === 'L1' ? [`x-${l0.boxes.filter((id) => hasKids.has(id)).sort().map(encodeId).join('+')}`, 'i'] : [];
      const suffix = tokens.length ? `.${tokens.join('.')}` : '';
      const m = await open(browser, base, `#map${suffix}`);
      const map = await m.page.evaluate(readMap);
      await m.ctx.close();
      const drawnPairs = [...map.read, ...map.unread];
      const diff = diffTruth(graph, map.boxes, drawnPairs, bf.files);
      const heat = heatTruth(graph, map.boxes, ch.files);
      const qs = historyQuestions(map.boxes, diff, heat, label);
      const truth = truthSeen(diff, heat, label);
      const nameable = map.boxes.filter((id) => !map.unnamedBoxes.includes(id));
      const mapSeen = { changed: new Set(), touched: new Set(), ...lineCountSeen(nameable, drawnPairs, label) };

      const dv = await open(browser, base, `#diff${suffix}`);
      await waitFor(dv.page, '[data-testid="diff-summary"], [data-testid="diff-error"]');
      const dr = await dv.page.evaluate(readDiff);
      await shot(dv.page, `${level}-diff`);
      await dv.ctx.close();
      const hv = await open(browser, base, `#hotspots${suffix}`);
      await waitFor(hv.page, '[data-testid="hot-box"], [data-testid="hotspots-none"], [data-testid="hotspots-error"]');
      const hr = await hv.page.evaluate(readHot);
      await shot(hv.page, `${level}-hotspots`);
      await hv.ctx.close();
      const diffSeen = { changed: new Set(dr.changed), touched: new Set(dr.touched) };
      const hotSeen = rankSeen(new Map(Object.entries(hr.rank)));
      const diffCost = (q) => (q.q === 'D2' ? (dr.changedOut.length ? 1 : 0) : q.q === 'D1' ? (dr.changedOut.includes(q.x) ? 1 : 0) : q.q === 'D3' ? (dr.touchedOut.some((k) => k.split('->').includes(q.x)) ? 1 : 0) : 0);
      const hotCost = (q) => (q.q === 'H3' ? ([q.a, q.b].some((id) => hr.out.includes(id)) ? 1 : 0) : q.q === 'H2' ? (hotSeen.order.slice(0, 3).some((id) => hr.out.includes(id)) ? 1 : 0) : 0);
      const rows = qs.map((q) => {
        const t = historyAnswer(q, truth);
        const mapA = historyAnswer(q, mapSeen);
        const isD = q.q.startsWith('D');
        const viewA = historyAnswer(q, isD ? diffSeen : hotSeen);
        return { ...q, view: isD ? 'diff' : 'hotspots', truth: t, map: mapA, mapOk: mapA === t, ans: viewA, ok: viewA === t, cost: isD ? diffCost(q) : hotCost(q) };
      });
      result.levels[level] = {
        boxes: map.boxes.length,
        changedBoxes: diff.changedBoxes.size,
        touchedLines: diff.touched.size,
        hotBoxes: heat.size,
        diffError: dr.error,
        hotError: hr.error,
        questions: rows,
      };
      console.log(`${TAG} ${level}: boxes ${map.boxes.length}, changed ${diff.changedBoxes.size}, touched ${diff.touched.size}, hot ${heat.size}, questions ${rows.length}${dr.error ? ` diff error: ${dr.error}` : ''}${hr.error ? ` hot error: ${hr.error}` : ''}`);
    }
    const all = Object.values(result.levels).flatMap((l) => l.questions);
    const cmp = (rows) => {
      const b = rows.filter((r) => r.ok && !r.mapOk).length;
      const c = rows.filter((r) => !r.ok && r.mapOk).length;
      const view = rows.filter((r) => r.ok).length;
      const mapN = rows.filter((r) => r.mapOk).length;
      const meanInteractions = rows.length ? rows.reduce((s, r) => s + r.cost, 0) / rows.length : 0;
      const out = { n: rows.length, view, map: mapN, b, c, p: mcnemar(b, c), meanInteractions, mapMeanInteractions: 0 };
      out.win = out.view > out.map && out.p < 0.05 && out.meanInteractions <= 1;
      return out;
    };
    result.diff = cmp(all.filter((r) => r.view === 'diff'));
    result.hotspots = cmp(all.filter((r) => r.view === 'hotspots'));
    console.log(JSON.stringify({ repo: TAG, diff: result.diff, hotspots: result.hotspots }));
  } catch (e) {
    code = 1;
    console.error('board-views-ab (history) failed:', e?.message ?? e);
    console.error(log.slice(-2000));
  } finally {
    await browser.close();
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const views = arg('--views', 'grid,flow');
  process.exit(await (/diff|hotspots/.test(views) ? mainHistory() : main()));
}
