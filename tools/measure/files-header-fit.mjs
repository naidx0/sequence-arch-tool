/**
 * Files header fit probe: renders the Files header (real tokens + files.css) at
 * 180, 220, 260, 320 and 480 px in Chromium and measures what the owner saw on
 * 2026-09-22: "the header's file name squeezed out under Code/Diff".
 *
 *   node tools/measure/files-header-fit.mjs [--css packages/web2/src/files/files.css]
 *
 * Prints, per width, the file name's visible width, how many px of the name
 * and of the "unsaved" badge sit under the Code/Diff/Edit buttons, and how far
 * the buttons run past the pane's edge. Exits 1 when anything overlaps or runs
 * past the edge. Needs playwright-core (a dev dependency of packages/web2) and
 * a Chromium (PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH). Calls no model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB2 = path.join(ROOT, 'packages', 'web2');
const require = createRequire(path.join(WEB2, 'package.json'));
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const CSS = arg('--css', path.join(WEB2, 'src', 'files', 'files.css'));
const WIDTHS = [180, 220, 260, 320, 480];

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = path.join(root, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const css =
  fs.readFileSync(path.join(WEB2, 'src', 'tokens', 'graphite.css'), 'utf8') + '\n' + fs.readFileSync(CSS, 'utf8');
const icon = (s) => `<svg class="files-i" width="${s}" height="${s}" viewBox="0 0 16 16"><rect width="16" height="16" fill="currentColor"/></svg>`;
const header = (w) =>
  /* Inside the pane's own size container, as FilesPanel renders it: head's header rules ask
     `@container files-pane`, which a bare .files-scope never matches. */
  `<div class="files-container" style="width:${w}px;height:auto"><div class="files-scope" style="display:block"><div class="files-hd" data-w="${w}">` +
  `<div class="files-hd-id">${icon(14)}<span class="files-hd-name">ConnectedFilesPanel.tsx</span>` +
  `<span class="files-hd-path mono"><bdi>packages/web2/src/files/ConnectedFilesPanel.tsx</bdi></span>` +
  `<span class="files-hd-status">unsaved</span></div>` +
  `<div class="files-modes" role="group">` +
  ['Code', 'Diff', 'Edit'].map((l) => `<button class="files-mode" title="${l}">${icon(12)}<span>${l}</span></button>`).join('') +
  `</div></div></div></div>`;

const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.setContent(`<style>${css}</style>` + WIDTHS.map(header).join('<br>'));
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.files-hd')].map((hd) => {
    const r = (e) => e.getBoundingClientRect();
    const under = (a, b) =>
      a.bottom > b.top && a.top < b.bottom ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) : 0;
    const H = r(hd);
    const M = r(hd.querySelector('.files-modes'));
    const N = r(hd.querySelector('.files-hd-name'));
    const S = r(hd.querySelector('.files-hd-status'));
    return {
      width: Number(hd.dataset.w),
      nameVisible: Math.round(N.width),
      nameUnderButtons: Math.round(under(N, M)),
      badgeUnderButtons: Math.round(under(S, M)),
      buttonsPastEdge: Math.round(Math.max(0, M.right - H.right)),
      headerHeight: Math.round(H.height),
    };
  }),
);
await browser.close();
console.table(rows);
const bad = rows.filter((r) => r.nameVisible < 24 || r.nameUnderButtons || r.badgeUnderButtons || r.buttonsPastEdge);
console.log(bad.length ? `FAIL at ${bad.map((r) => `${r.width}px`).join(', ')}` : 'ok: nothing overlaps and nothing runs past the edge');
process.exit(bad.length ? 1 : 0);
