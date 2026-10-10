#!/usr/bin/env node
/**
 * THE BOARD, DRAWN ON (round 9, asks 25 and 26) in a real browser, on the real
 * scan of this repository.
 *
 *   - ask 26: with a sticky note on the board and the Select tool, a drag moves
 *     it (the stored item changes by the drag, once).
 *   - ask 25: with several cards lit by an agent and the board zoomed out, no
 *     two agent chips overlap (they stack into lanes or yield).
 *
 * The boards store and the agent event stream are answered in-page
 * (page.route), so what is exercised is the real client, real layout, real CSS.
 * Shots: /mnt/project-files/sequence/cloud-pass/shots/cloud/ (SHOTS_DIR).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BOARD } from './lib/anchors.mjs';
import { atLeast, is, sel, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const REPO = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');
const SHOTS = process.env.SHOTS_DIR ?? '/mnt/project-files/sequence/cloud-pass/shots/cloud';

function scanRealRepo() {
  if (!fs.existsSync(ANALYZER_CLI)) {
    console.error('[board-draw] ERROR: the analyzer is not built, nothing to scan');
    process.exit(2);
  }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web2-board-draw-')), 'archgraph.json');
  execFileSync(process.execPath, [ANALYZER_CLI, 'scan', REPO, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'], cwd: REPO });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/** The harness's settle, less the loops: an infinite animation (a chip's glyph) cannot be finished, only waited past. */
async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const end = a.effect?.getComputedTiming?.().endTime;
      if (Number.isFinite(end)) a.finish();
    }
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const graph = scanRealRepo();
const REFUSED = ['/api/status', '/api/recent', '/api/browse', '/api/attach'];

const shot = async (page, name, theme) => {
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `files-boards-${name}-${theme}.png`) });
  } catch (error) {
    console.log('[board-draw] no shot:', error.message);
  }
};

await suite(
  'board-draw',
  async ({ page, base, check, log }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    /* An in-memory boards store. */
    const board = { version: 1, id: 'architecture', rev: 1, items: [] };
    const puts = [];
    await page.route('**/api/boards**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/boards/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      if (url.pathname === '/api/boards' && req.method() === 'GET') {
        return json({ version: 1, boards: [{ id: 'architecture', name: 'Architecture', kind: 'architecture', rev: board.rev, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }] });
      }
      if (url.pathname === '/api/boards/architecture' && req.method() === 'GET') return json(board);
      if (url.pathname === '/api/boards/architecture/ops' && req.method() === 'POST') {
        const { ops } = JSON.parse(req.postData() ?? '{}');
        for (const op of ops) {
          if (op.op === 'put') {
            puts.push(op.item);
            const i = board.items.findIndex((x) => x.id === op.item.id);
            if (i >= 0) board.items[i] = op.item;
            else board.items.push(op.item);
          } else board.items = board.items.filter((x) => x.id !== op.id);
        }
        board.rev += 1;
        return json(board);
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no"}' });
    });

    /* The agent stream: one edit per service, so several cards light at once. */
    const services = graph.nodes.filter((n) => n.kind === 'service').slice(0, 8);
    await page.route('**/api/agent-events', async (route) => {
      const now = Date.now();
      const frames = services.map((svc, i) => {
        const file = `${svc.path ?? svc.label}/src/file${i}.ts`.replace(/\\/g, '/');
        return `data: ${JSON.stringify({
          id: `ev-${i}`,
          at: now + i,
          source: 'claude-hook',
          sessionId: 's',
          kind: 'tool_end',
          tool: 'Edit',
          toolKind: 'edit',
          paths: [file],
          status: 'done',
          toolUseId: `t-${i}`,
          title: `Edit ${file}`,
          board: [{ path: file, fileNodeId: `file:${file}`, moduleId: null, serviceId: svc.id, serviceLabel: svc.label ?? svc.id, touchedEdgeIds: [], liftedEdges: [] }],
        })}\n\n`;
      });
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `retry: 600000\n\n${frames.join('')}` });
    });

    for (const theme of ['dark', 'light']) {
      board.items = [];
      board.rev = 1;
      puts.length = 0;
      await page.goto(base, { waitUntil: 'load' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForSelector(sel(BOARD.node), { timeout: 20000 });
      await settle(page);

      await check(`${theme}: agent chips do not overlap when the board is zoomed out`, async () => {
        /* Zoom all the way out so lit cards are as close as they get. */
        for (let i = 0; i < 6; i += 1) await page.keyboard.press('-').catch(() => {});
        const zoomOut = page.getByLabel('Zoom out');
        for (let i = 0; i < 4; i += 1) if (await zoomOut.count()) await zoomOut.first().click().catch(() => {});
        await page.waitForTimeout(2600);
        await settle(page);
        const chips = await page.evaluate(() => {
          const out = [];
          const cards = [...document.querySelectorAll('[data-testid="board-node"][data-node-id]')].map((el) => {
            const r = el.getBoundingClientRect();
            return { id: el.getAttribute('data-node-id'), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          });
          for (const el of document.querySelectorAll('[data-testid="board-node"][data-agent-chip]')) {
            const cs = getComputedStyle(el, '::after');
            if (cs.display === 'none') continue;
            const r = el.getBoundingClientRect();
            const side = el.getAttribute('data-agent-chip-side');
            const lane = Number(el.style.getPropertyValue('--agent-chip-lane') || 0);
            const w = Math.round(((el.getAttribute('data-agent-chip') || '').length + 2) * 5 + 14);
            const left = side === 'end' ? r.right - w : r.left;
            const top = r.top - 4 - 18 - lane * 20;
            out.push({ id: el.getAttribute('data-node-id'), left, right: left + w, top, bottom: top + 18, lane, cards });
          }
          return out;
        });
        log('visible chips:', chips.length, 'lanes:', JSON.stringify(chips.map((c) => c.lane)));
        atLeast(chips.length, 2, 'at least two lit chips to compare');
        const bad = [];
        for (let i = 0; i < chips.length; i += 1) {
          for (let j = i + 1; j < chips.length; j += 1) {
            const a = chips[i];
            const b = chips[j];
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bad.push(`${a.id} x ${b.id}`);
          }
        }
        /* ...and none lands on a card that is not its own. */
        for (const c of chips) {
          for (const k of c.cards) {
            if (k.id !== c.id && c.left < k.right && k.left < c.right && c.top < k.bottom && k.top < c.bottom) bad.push(`${c.id} on card ${k.id}`);
          }
        }
        is(bad.join(' | '), '', 'chips that overlap each other or another card');
        /* The scene is a crowded one: the layout had to move chips off their home lane. */
        atLeast(chips.filter((c) => c.lane > 0).length, 1, 'chips moved to a higher lane');
        /* A lit card draws above its neighbours, so no card covers a chip's words. */
        const z = await page.evaluate(() => {
          const lit = document.querySelector('.react-flow__node:has(> .node[data-agent-chip])');
          return lit ? Number(getComputedStyle(lit).zIndex) : -1;
        });
        atLeast(z, 900, 'a lit card draws above the others');
        await shot(page, 'agent-chips-zoomed-out', theme);
      });

      await check(`${theme}: a sticky note can be selected and dragged, and the move is stored once`, async () => {
        board.items = [{ kind: 'text', sticky: true, id: 'note-e2e', by: 'person', at: { x: 420, y: 300 }, text: 'Move me', w: 160, h: 80 }];
        board.rev += 1;
        await page.reload({ waitUntil: 'load' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.waitForSelector(sel(BOARD.node), { timeout: 20000 });
        await page.getByTestId('board-draw-toggle').click();
        await page.getByTestId('annot-tool-select').click();
        await settle(page);
        const note = page.locator('[data-annot-id="note-e2e"]');
        await note.waitFor({ state: 'visible', timeout: 5000 });
        /* The camera fits the board on load; drag only once the note has stopped moving. */
        let before = await note.boundingBox();
        for (let i = 0; i < 20; i += 1) {
          await page.waitForTimeout(250);
          const next = await note.boundingBox();
          const still = Math.abs(next.x - before.x) < 0.5 && Math.abs(next.y - before.y) < 0.5 && Math.abs(next.width - before.width) < 0.5;
          before = next;
          if (still) break;
        }

        await page.mouse.move(before.x + 20, before.y + 20);
        await page.mouse.down();
        await page.mouse.move(before.x + 120, before.y + 120, { steps: 6 });
        await page.mouse.up();
        await settle(page);
        await page.waitForTimeout(300);
        log('puts:', puts.length);
        is(puts.length, 1, 'one write for one drag');
        const after = await note.boundingBox();
        log('before', JSON.stringify(before), 'after', JSON.stringify(after), 'put', JSON.stringify(puts[0]?.at));
        atLeast(Math.abs(after.x - before.x), 20, 'the note moved on screen');
        await shot(page, 'drag-drawing', theme);
      });

      await check(`${theme}: the draw palette offers Select`, async () => {
        is(await page.getByTestId('annot-tool-select').count(), 1, 'select tool');
      });
    }
  },
  {
    routes: {
      '/archgraph.json': graph,
      ...Object.fromEntries(REFUSED.map((route) => [route, null])),
    },
  },
);
