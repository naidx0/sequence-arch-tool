#!/usr/bin/env node
/*
 * Draw the report's charts from report/data.json. No dependencies: each chart
 * is a hand-built SVG with its own background, so it reads the same on GitHub's
 * light and dark themes.
 *
 *   node report/charts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const D = JSON.parse(fs.readFileSync(path.join(HERE, 'data.json'), 'utf8'));

const C = { bg: '#fbfbfa', ink: '#1d1d1f', muted: '#6b6b70', grid: '#e4e4e2', a: '#2f6fd6', b: '#d9822b', ok: '#2e8b57' };
const W = 720;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const txt = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 12}" fill="${o.fill ?? C.ink}" text-anchor="${o.anchor ?? 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;
const frame = (h, title, sub, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif">
<rect width="${W}" height="${h}" rx="10" fill="${C.bg}"/>
${txt(24, 32, title, { size: 16, weight: 600 })}
${txt(24, 52, sub, { fill: C.muted })}
${body}
</svg>
`;
const fmt = (n) => n.toLocaleString('en-US');
const out = (name, svg) => fs.writeFileSync(path.join(HERE, name), svg);

/* 1. Release bank: full answers (line) and turn time (bars) per snapshot. */
{
  const p = D.releaseBank.points;
  const x0 = 70, x1 = W - 70, y0 = 90, y1 = 300, h = 380;
  const step = (x1 - x0) / p.length;
  let body = '';
  for (const g of [0, 25, 50, 75, 100]) {
    const y = y1 - ((y1 - y0) * g) / 100;
    body += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="${C.grid}"/>` + txt(x0 - 8, y + 4, `${g}%`, { anchor: 'end', fill: C.a, size: 11 });
    body += txt(x1 + 8, y + 4, `${((16 * g) / 100).toFixed(0)} s`, { fill: C.b, size: 11 });
  }
  p.forEach((d, i) => {
    const cx = x0 + step * (i + 0.5);
    const bh = ((y1 - y0) * d.turnSeconds) / 16;
    body += `<rect x="${cx - 18}" y="${y1 - bh}" width="36" height="${bh}" fill="${C.b}" opacity="0.35"/>`;
    body += txt(cx, y1 - bh - 6, `${d.turnSeconds} s`, { anchor: 'middle', fill: C.b, size: 11 });
    const lines = d.label.split(' (');
    body += txt(cx, y1 + 18, lines[0], { anchor: 'middle', size: 11 });
    body += txt(cx, y1 + 32, lines[1] ? '(' + lines[1] : d.date, { anchor: 'middle', size: 10, fill: C.muted });
  });
  const pts = p.map((d, i) => [x0 + step * (i + 0.5), y1 - ((y1 - y0) * d.fullAnswer) / 100]);
  body += `<polyline points="${pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${C.a}" stroke-width="2.5"/>`;
  pts.forEach(([x, y], i) => {
    body += `<circle cx="${x}" cy="${y}" r="4" fill="${C.a}"/>` + txt(x, y - 10, `${p[i].fullAnswer}%`, { anchor: 'middle', fill: C.a, weight: 600 });
  });
  body += `<rect x="${x0}" y="${h - 30}" width="12" height="3" fill="${C.a}"/>` + txt(x0 + 18, h - 25, 'Full product answer (left axis)', { size: 11 });
  body += `<rect x="${x0 + 250}" y="${h - 34}" width="12" height="10" fill="${C.b}" opacity="0.35"/>` + txt(x0 + 268, h - 25, 'Mean turn time (right axis)', { size: 11 });
  out('release-bank.svg', frame(h, 'Answers got better and faster', 'Sealed release bank, 72 turns per snapshot, same questions and seeds', body));
}

/* 2. Tokens pulled vs context window. */
{
  const w = D.window;
  const x0 = 90, x1 = W - 40, y0 = 80, y1 = 280, h = 340, max = 200000;
  const X = (i) => x0 + ((x1 - x0) * i) / (w.buckets.length - 1);
  const Y = (v) => y1 - ((y1 - y0) * v) / max;
  let body = '';
  for (const g of [0, 50000, 100000, 150000, 200000]) {
    body += `<line x1="${x0}" x2="${x1}" y1="${Y(g)}" y2="${Y(g)}" stroke="${C.grid}"/>` + txt(x0 - 8, Y(g) + 4, `${g / 1000}k`, { anchor: 'end', size: 11, fill: C.muted });
  }
  w.buckets.forEach((b, i) => (body += txt(X(i), y1 + 18, `${b / 1000}k window`, { anchor: 'middle', size: 11 })));
  const line = (vals, color) =>
    `<polyline points="${vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>` +
    vals.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="${color}"/>`).join('');
  body += line(w.dumpTokens, C.b) + line(w.sequenceTokens, C.a);
  body += txt(X(2) - 12, Y(150000) - 12, 'Paste source until the window is full', { anchor: 'end', fill: C.b, weight: 600 });
  body += txt(X(3) - 8, Y(w.sequenceTokens[0]) - 10, `Sequence map + digest: ${fmt(w.sequenceTokens[0])} at every size`, { anchor: 'end', fill: C.a, weight: 600 });
  out('context-window.svg', frame(h, 'Sequence does not grow with the window', 'Tokens sent to answer one shopfront question (chars / 4)', body));
}

/* 3. Big repository: tokens to answer, log scale. */
{
  const rows = D.bigRepo.rows;
  const x0 = 250, x1 = W - 110, y0 = 80, rowH = 44, h = y0 + rows.length * rowH + 40;
  const lmax = Math.log10(5e6);
  let body = '';
  for (const g of [1e3, 1e4, 1e5, 1e6]) {
    const x = x0 + ((x1 - x0) * Math.log10(g)) / lmax;
    body += `<line x1="${x}" x2="${x}" y1="${y0 - 10}" y2="${y0 + rows.length * rowH}" stroke="${C.grid}"/>` + txt(x, y0 + rows.length * rowH + 16, g >= 1e6 ? '1M' : `${g / 1000}k`, { anchor: 'middle', size: 11, fill: C.muted });
  }
  rows.forEach((r, i) => {
    const y = y0 + i * rowH;
    const bw = ((x1 - x0) * Math.log10(r.tokens)) / lmax;
    const color = r.label.startsWith('Sequence') ? C.a : C.b;
    body += txt(x0 - 10, y + 20, r.label, { anchor: 'end' });
    body += `<rect x="${x0}" y="${y + 6}" width="${bw}" height="22" rx="3" fill="${color}"/>`;
    body += txt(x0 + bw + 8, y + 22, fmt(r.tokens), { weight: 600 });
  });
  out('big-repo.svg', frame(h, 'On a large checkout (10,000 files searched)', 'Tokens pulled to answer one question about the code (log scale)', body));
}

/* 4. Map build time by repository size. */
{
  const rows = D.scan.rows;
  const x0 = 200, x1 = W - 90, y0 = 80, rowH = 52, h = y0 + rows.length * rowH + 50, max = 8000;
  let body = '';
  for (const g of [0, 2000, 4000, 6000, 8000]) {
    const x = x0 + ((x1 - x0) * g) / max;
    body += `<line x1="${x}" x2="${x}" y1="${y0 - 10}" y2="${y0 + rows.length * rowH}" stroke="${C.grid}"/>` + txt(x, y0 + rows.length * rowH + 16, `${g / 1000} s`, { anchor: 'middle', size: 11, fill: C.muted });
  }
  rows.forEach((r, i) => {
    const y = y0 + i * rowH;
    body += txt(x0 - 10, y + 16, r.repo, { anchor: 'end' });
    body += txt(x0 - 10, y + 31, `${fmt(r.files)} files, ${fmt(r.nodes)} nodes`, { anchor: 'end', size: 10, fill: C.muted });
    const cw = ((x1 - x0) * r.coldMs) / max;
    body += `<rect x="${x0}" y="${y + 4}" width="${cw}" height="16" rx="3" fill="${C.b}"/>` + txt(x0 + cw + 6, y + 16, `${(r.coldMs / 1000).toFixed(2)} s first scan`, { size: 11 });
    if (r.cachedMs != null) {
      const ww = ((x1 - x0) * r.cachedMs) / max;
      body += `<rect x="${x0}" y="${y + 23}" width="${ww}" height="16" rx="3" fill="${C.a}"/>` + txt(x0 + ww + 6, y + 35, `${(r.cachedMs / 1000).toFixed(2)} s from cache`, { size: 11 });
    } else {
      body += txt(x0 + 4, y + 35, 'repeat scans missed the cache (cause not yet found)', { size: 11, fill: C.muted });
    }
  });
  out('scan-speed.svg', frame(h, 'Building the map', 'Median of 3 cold scans, and a repeat scan served from the graph cache', body));
}

/* 5. Find the fix: hit@5 per picker, per repository. */
{
  const R = D.findTheFix.repos;
  const P = [['A_grep', 'grep over contents', C.b], ['B_sequence', 'Sequence today', '#9a9aa0'], ['D_lexical', 'grep + path words', '#c9a27a'], ['C_topology', '+ one hop on the map', C.a]];
  const x0 = 70, y0 = 80, y1 = 290, h = 370, groupW = (W - x0 - 40) / R.length, barW = 34;
  let body = '';
  for (const g of [0, 25, 50, 75, 100]) {
    const y = y1 - ((y1 - y0) * g) / 100;
    body += `<line x1="${x0}" x2="${W - 40}" y1="${y}" y2="${y}" stroke="${C.grid}"/>` + txt(x0 - 8, y + 4, `${g}%`, { anchor: 'end', size: 11, fill: C.muted });
  }
  R.forEach((r, gi) => {
    const gx = x0 + gi * groupW + (groupW - P.length * (barW + 10)) / 2;
    P.forEach(([k, , color], i) => {
      const v = r[k], bh = ((y1 - y0) * v) / 100, x = gx + i * (barW + 10);
      body += `<rect x="${x}" y="${y1 - bh}" width="${barW}" height="${bh}" rx="3" fill="${color}"/>` + txt(x + barW / 2, y1 - bh - 6, `${v}%`, { anchor: 'middle', size: 11, weight: 600 });
    });
    body += txt(gx + (P.length * (barW + 10)) / 2 - 5, y1 + 20, `${r.repo}, ${r.commits} commits`, { anchor: 'middle' });
  });
  P.forEach(([, label, color], i) => {
    const lx = x0 + i * 160;
    body += `<rect x="${lx}" y="${h - 34}" width="12" height="10" fill="${color}"/>` + txt(lx + 18, h - 25, label, { size: 11 });
  });
  out('find-the-fix.svg', frame(h, 'Finding the files a real fix touched', 'Commit message as the question; share of commits with a changed file in the top 5', body));
}

/* 6. The same agent with and without Sequence. */
{
  const A = D.agentAB;
  const rows = [{ label: 'All 36 questions', plain: (A.runs.plainF1[0] + A.runs.plainF1[1]) / 2, sequence: (A.runs.sequenceF1[0] + A.runs.sequenceF1[1]) / 2 }, ...A.byType.map((t) => ({ label: t.type, ...t }))];
  const x0 = 170, x1 = W - 80, y0 = 80, rowH = 50, h = y0 + rows.length * rowH + 72, max = 0.4;
  let body = '';
  for (const g of [0, 0.1, 0.2, 0.3, 0.4]) {
    const x = x0 + ((x1 - x0) * g) / max;
    body += `<line x1="${x}" x2="${x}" y1="${y0 - 10}" y2="${y0 + rows.length * rowH}" stroke="${C.grid}"/>` + txt(x, y0 + rows.length * rowH + 16, g.toFixed(1), { anchor: 'middle', size: 11, fill: C.muted });
  }
  rows.forEach((r, i) => {
    const y = y0 + i * rowH;
    body += txt(x0 - 10, y + 24, r.label, { anchor: 'end', weight: i === 0 ? 600 : undefined });
    for (const [k, color, dy] of [['plain', C.b, 4], ['sequence', C.a, 23]]) {
      const w = ((x1 - x0) * r[k]) / max;
      body += `<rect x="${x0}" y="${y + dy}" width="${Math.max(w, 1)}" height="16" rx="3" fill="${color}"/>` + txt(x0 + w + 6, y + dy + 12, r[k].toFixed(2), { size: 11 });
    }
  });
  body += `<rect x="${x0}" y="${h - 30}" width="12" height="10" fill="${C.b}"/>` + txt(x0 + 18, h - 21, 'Same agent, no map', { size: 11 });
  body += `<rect x="${x0 + 170}" y="${h - 30}" width="12" height="10" fill="${C.a}"/>` + txt(x0 + 188, h - 21, 'Same agent + Sequence map', { size: 11 });
  out('agent-ab.svg', frame(h, 'The same agent, with and without Sequence', 'Answer accuracy (file-set F1) on 36 hand-labelled questions, local 4B model, mean of 2 runs per side', body));
}

console.log('wrote release-bank.svg, context-window.svg, big-repo.svg, scan-speed.svg, find-the-fix.svg, agent-ab.svg');
