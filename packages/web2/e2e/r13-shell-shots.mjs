#!/usr/bin/env node
/**
 * Round 13, lane S (shell): composer, status bar, spinner, surface bar, window controls.
 * Dark and light, 1440 and 1024. Shots go to $SHOTS (default
 * /mnt/project-files/sequence/cloud-pass/shots/r13/shell). Live turns are faked at /api/acp/run-node.
 */
import fs from 'node:fs';
import http from 'node:http';
import { sel, suite } from './lib/harness.mjs';

const AI_CONFIG = { configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '••••9f3a', contextWindow: 1_000_000 };
const EMPTY_TREE = { path: '', name: 'workspace', type: 'dir', children: [] };

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r13/shell';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = { index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] }, scope: 'workspace', repos: [] };
const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output });
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
const RUNS = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Why does the rate limiter return 200 under load?', text: 'The window is keyed on `req.ip`, which is the proxy for every request.\n\n- one\n- two\n\n```ts\nconst key = req.ip;\n```', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 40_000, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(18400, 2100, 61200) },
  ],
};
const LONG = 'pnpm --filter @sequence/gateway test -- --run --reporter=verbose --coverage --coverage.reporter=lcov --coverage.reporter=text-summary --testTimeout=120000 --bail=1 src/rate/limiter.proxy.integration.test.ts';
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');


let runsNow = RUNS;
let sessionsNow = SESSIONS;
async function fresh(page, base, theme, w = 1440, { agent = true, sessions = SESSIONS } = {}) {
  sessionsNow = sessions;
  runsNow = agent ? RUNS : { runs: [] };
  await page.setViewportSize({ width: w, height: 900 });
  for (const pat of ['**/api/sessions', '**/api/acp/runs*', '**/api/acp/capabilities*', '**/api/ai-config', '**/api/tree', '**/api/acp/full-access']) await page.unroute(pat).catch(() => {});
  await page.route('**/api/sessions', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessionsNow) }));
  await page.route('**/api/acp/capabilities*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }));
  await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runsNow) }));
  await page.route('**/api/acp/full-access', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ confirmed: true, prompt: 'Agents can run any command without asking' }) }));
  await page.route('**/api/ai-config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AI_CONFIG) }));
  await page.route('**/api/tree', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_TREE) }));
  await page.goto(base);
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await page.reload();
  await page.evaluate((t) => {
    try {
      localStorage.setItem('seq.theme', t);
      localStorage.setItem('theme', t);
      localStorage.setItem('v3.railCollapsed', '0');
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForSelector(sel('shell'));
  if (agent) await page.locator('section.s2-chat [data-testid="agent-run"], section.s2-chat .s2-run').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
}

async function send(page, text) {
  const box = page.locator('section.s2-chat textarea').first();
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

/** A stream that stays open on one running command. */
async function hangOnCommand(page) {
  const hang = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
    res.write(sse([{ type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 'x1', title: LONG, kind: 'execute', status: 'in_progress', rawInput: { command: LONG } } } }]));
  });
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  const port = hang.address().port;
  await page.unroute('**/api/acp/run-node*').catch(() => {});
  await page.route('**/api/acp/run-node*', (route) => route.continue({ url: `http://127.0.0.1:${port}/` }));
  return () => {
    hang.closeAllConnections();
    hang.close();
  };
}

const ASK_RESULT = {
  type: 'result',
  text: 'The limiter keys on the proxy address, so every client shares one bucket.',
  usage: { inputTokens: 274_000, outputTokens: 900, estimated: false },
  contextBreakdown: {
    sections: [
      { id: 'instructions', label: 'Tool & plan instructions', tokens: 21_400, estimated: true },
      { id: 'tools', label: 'Tool results this turn', tokens: 63_800, estimated: true },
      { id: 'grounding', label: 'Architecture digest + question', tokens: 92_300, estimated: true },
    ],
    totalApprox: 177_500,
    totalMeasured: 274_000,
  },
};

/** Ink centroid of an element's pixels against its own box: how far off-centre it paints, in px. */
async function inkOffset(page, locator, inside = 0) {
  const b = await locator.boundingBox();
  const x0 = Math.floor(b.x) - 3;
  const y0 = Math.floor(b.y) - 3;
  const w = Math.ceil(b.x + b.width) + 3 - x0;
  const h = Math.ceil(b.y + b.height) + 3 - y0;
  const png = await page.screenshot({ clip: { x: x0, y: y0, width: w, height: h } });
  const boxCx = b.x + b.width / 2 - x0;
  const boxCy = b.y + b.height / 2 - y0;
  return page.evaluate(
    async ({ b64, boxCx, boxCy, inside }) => {
      const img = await new Promise((res) => {
        const i = new Image();
        i.onload = () => res(i);
        i.src = `data:image/png;base64,${b64}`;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const k0 = inside ? (Math.round(boxCy) * c.width + Math.round(boxCx - inside + 3)) * 4 : 0;
      const bg = [d[k0], d[k0 + 1], d[k0 + 2]];
      let sx = 0, sy = 0, n = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (inside && Math.hypot(x + 0.5 - boxCx, y + 0.5 - boxCy) > inside - 4) continue;
          const k = (y * c.width + x) * 4;
          const diff = Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]);
          if (diff > 90) {
            sx += (x + 0.5) * diff;
            sy += (y + 0.5) * diff;
            n += diff;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
      if (!n) return null;
      return { dx: sx / n - boxCx, dy: sy / n - boxCy, bx: (minX + maxX + 1) / 2 - boxCx, by: (minY + maxY + 1) / 2 - boxCy, w: maxX - minX + 1, h: maxY - minY + 1 };
    },
    { b64: png.toString('base64'), boxCx, boxCy, inside },
  );
}

await suite(
  'r13-shell-shots',
  async ({ page, base, check }) => {
    await page.addInitScript(() => {
      /* A 2x device ratio would make the ink centroid finer; keep 1 and read sub-pixel means. */
    });
    const shot = (name, theme, w) => page.screenshot({ path: `${OUT}/${name}-${w}-${theme}.png` });
    const clip = async (name, theme, w, locators, pad = 12) => {
      const boxes = [];
      for (const l of locators) boxes.push(await l.boundingBox());
      const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
      const y0 = Math.min(...boxes.map((b) => b.y)) - pad;
      const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
      const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
      await page.screenshot({ path: `${OUT}/${name}-${w}-${theme}.png`, clip: { x: Math.max(0, x0), y: Math.max(0, y0), width: x1 - x0, height: y1 - y0 } });
    };
    for (const theme of ['dark', 'light']) {
      for (const w of [1440, 1024]) {
        const T = `${theme} ${w}`;

        /* ── an idle agent chat: surface bar has no dot, the selected pill is an outline ── */
        await fresh(page, base, theme, w);
        await shot('idle', theme, w);
        await check(`${T}: no surface shows a working dot while nothing works`, async () => {
          const n = await page.locator('.s2-sp-dot').count();
          if (n !== 0) throw new Error(`${n} dots while idle`);
        });
        await check(`${T}: the selected pill is a deeper outline only (no fill, no shadow)`, async () => {
          const m = await page.locator(sel('s2-sp-ind')).evaluate((n) => {
            const cs = getComputedStyle(n);
            return { bg: cs.backgroundColor, shadow: cs.boxShadow, border: cs.borderTopColor, bw: cs.borderTopWidth };
          });
          if (m.bg !== 'rgba(0, 0, 0, 0)') throw new Error(`fill ${m.bg}`);
          if (m.shadow !== 'none') throw new Error(`shadow ${m.shadow}`);
          if (m.bw !== '1px') throw new Error(`border ${m.bw}`);
        });
        await check(`${T}: S1 every surface keeps its name at the top, the bar scrolls under a drag, the dot never touches the X`, async () => {
          const bar = page.locator(sel('s2-surfaces'));
          const labels = await bar.locator('.s2-seg-l').evaluateAll((els) => els.map((e) => [getComputedStyle(e).display, e.textContent.trim()]));
          const hidden = labels.filter(([d, t]) => d === 'none' || !t);
          if (hidden.length || labels.length < 5) throw new Error(`labels: ${JSON.stringify(labels)}`);
          const m = await bar.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }));
          if (w === 1024 && m.sw <= m.cw) throw new Error('expected the bar to overflow at 1024');
          if (m.sw > m.cw) {
            const b = await bar.boundingBox();
            await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2);
            await page.mouse.down();
            await page.mouse.move(b.x + b.width * 0.15, b.y + b.height / 2, { steps: 8 });
            await page.mouse.up();
            const after = await bar.evaluate((n) => n.scrollLeft);
            if (after <= 0) throw new Error('did not scroll');
            await bar.evaluate((n) => { n.scrollLeft = 0; });
          }
        });
        await check(`${T}: the top bar leaves the Windows controls strip free at the right`, async () => {
          const m = await page.evaluate(() => {
            const bar = document.querySelector('[data-testid="s2-topbar"]');
            const kids = [...bar.children].filter((k) => !k.matches('.shell-winctl'));
            const right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
            return { right, controls: !!bar.querySelector('.shell-winctl'), pad: parseFloat(getComputedStyle(bar).paddingRight), w: window.innerWidth, plat: document.querySelector('[data-testid="shell"]').getAttribute('data-platform') };
          });
          if (m.plat !== 'win') return;
          /* No desktop bridge in this run: no controls render, so nothing is reserved. */
          if (!m.controls && m.pad > 20) throw new Error(`reserved ${m.pad}px with no controls`);
          if (m.controls && m.right > m.w - 138 + 1) throw new Error(`content reaches ${m.right} of ${m.w}`);
        });

        /* ── a long running command: the status bar stays inside the chat box ── */
        const stop = await hangOnCommand(page);
        await send(page, 'Run the gateway tests');
        await page.locator(sel('s2-status-state')).filter({ hasText: /command|Working|Starting/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1200);
        /* The state text is long on purpose, as a long command in it would be. */
        await page.evaluate((txt) => {
          const el = document.querySelector('[data-testid="s2-status-state"]');
          if (el) el.textContent = txt;
          const ws = document.querySelector('[data-testid="s2-status-workspace"]');
          if (ws) ws.textContent = 'a-very-long-workspace-or-worktree-name-that-keeps-going';
        }, `Running ${LONG}`);
        await shot('long-command', theme, w);
        await check(`${T}: a very long running command truncates inside the chat box`, async () => {
          const m = await page.evaluate(() => {
            const bar = document.querySelector('[data-testid="s2-status"]').getBoundingClientRect();
            const chat = document.querySelector('[data-testid="s2-chat"]').getBoundingClientRect();
            const items = [...document.querySelectorAll('[data-testid="s2-status"] > *')].map((e) => e.getBoundingClientRect());
            const st = document.querySelector('[data-testid="s2-status-state"]');
            return {
              barL: bar.left, barR: bar.right, chatL: chat.left, chatR: chat.right,
              minL: Math.min(...items.map((r) => r.left)), maxR: Math.max(...items.map((r) => r.right)),
              clipped: st.scrollWidth > st.clientWidth, ell: getComputedStyle(st).textOverflow,
            };
          });
          if (m.barL < m.chatL - 1 || m.barR > m.chatR + 1) throw new Error(`bar ${m.barL}-${m.barR} outside chat ${m.chatL}-${m.chatR}`);
          if (m.minL < m.chatL - 1 || m.maxR > m.chatR + 1) throw new Error(`items ${m.minL}-${m.maxR} outside chat ${m.chatL}-${m.chatR}`);
          if (!m.clipped || m.ell !== 'ellipsis') throw new Error(`not truncated: ${JSON.stringify(m)}`);
        });
        await check(`${T}: S7 the working spinner is the Claude Code star cycle in neutral ink, with a shimmering live label`, async () => {
          const sp = page.locator(sel('s2-ascii-spinner')).first();
          await sp.waitFor({ timeout: 8000 });
          const t = await sp.textContent();
          if (!/^[\u2722\u2733\u2736\u273B\u273D]\uFE0E$/u.test(t)) throw new Error(`glyph ${t}`);
          const seen = new Set();
          for (let i = 0; i < 12; i++) {
            seen.add(await sp.textContent());
            await page.waitForTimeout(70);
          }
          if (seen.size < 3) throw new Error(`only ${seen.size} frames seen`);
          /* The shimmer never blanks the label (review blocker): the status label keeps ink at its left end in every sample. */
          const lab = page.locator(sel('s2-status-state'));
          for (let i = 0; i < 8; i++) {
            const b = await lab.boundingBox();
            const png = await page.screenshot({ clip: { x: b.x, y: b.y, width: Math.min(b.width, 24), height: b.height } });
            const ink = await page.evaluate(async (b64) => {
              const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
              const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
              const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
              for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - d[0]) + Math.abs(d[k + 1] - d[1]) + Math.abs(d[k + 2] - d[2]) > 60) n++;
              return n;
            }, png.toString('base64'));
            if (ink < 8) throw new Error(`label blank at its left end (sample ${i}, ink px ${ink})`);
            await page.waitForTimeout(290);
          }
          const shim = await page.locator('.shimmer-text').count();
          if (shim < 1) throw new Error('no shimmering label');
          const box = await sp.boundingBox();
          if (box.width < 12 || box.width > 16) throw new Error(`spinner cell ${box.width}`);
        });
        await check(`${T}: S7 the status bar and the top bar carry the same spinner (not a dot) while it works`, async () => {
          const inBar = await page.locator('[data-testid="s2-status"] [data-testid="s2-ascii-spinner"]').count();
          if (inBar < 1) throw new Error('no spinner in the status bar');
          const sw = await page.locator('[data-testid="s2-status"] [data-testid="s2-ascii-spinner"]').first().evaluate((n) => n.getBoundingClientRect().width);
          if (sw < 12) throw new Error(`spinner squeezed to ${sw}px`);
          const lab = await page.locator('[data-testid="s2-status-state"]').getAttribute('class');
          if (!/shimmer-text/.test(lab)) throw new Error(`status label class ${lab}`);
        });
        await check(`${T}: the Agents pill shows a working dot while an agent runs`, async () => {
          const dots = await page.locator('.s2-sp-dot').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
          if (!dots.includes('s2-sp-dot-agents')) throw new Error(`dots: ${JSON.stringify(dots)}`);
        });
        await check(`${T}: S1 an open working surface keeps its dot clear of its close X`, async () => {
          const tab = page.locator(sel('s2-tab-agents'));
          if ((await page.locator(sel('v3-tab-close-agents')).count()) === 0) await tab.click();
          await page.waitForTimeout(300);
          await page.locator(sel('v3-tab-close-agents')).waitFor({ timeout: 4000 });
          await shot('working-open', theme, w);
          const r = await page.evaluate(() => {
            const pill = document.querySelector('[data-pill="agents"]');
            const rect = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
            const dot = pill.querySelector('.s2-sp-dot');
            const x = pill.querySelector('.s2-sp-x');
            const lab = pill.querySelector('.s2-seg-l');
            return { dot: dot && rect(dot), x: rect(x), lab: rect(lab), pos: dot && getComputedStyle(dot).position };
          });
          if (!r.dot) throw new Error('no dot');
          const overlap = r.dot.l < r.x.r && r.dot.r > r.x.l && r.dot.t < r.x.b && r.dot.b > r.x.t;
          if (overlap) throw new Error(`dot overlaps the X ${JSON.stringify(r)}`);
          if (r.pos === 'absolute') throw new Error('dot is positioned over the pill again');
          if (r.dot.l < r.lab.r - 0.5) throw new Error('dot is not after the name');
        });
        await check(`${T}: S6 the stop square is centred in its button`, async () => {
          const btn = page.locator(sel('composer-stop'));
          await btn.waitFor({ timeout: 5000 });
          const off = await inkOffset(page, btn, 15);
          if (!off || Math.abs(off.dx) > 0.3 || Math.abs(off.dy) > 0.3) throw new Error(`ink off by ${JSON.stringify(off)}`);
          await clip('stop-running', theme, w, [btn], 10);
        });
        await check(`${T}: S9 the background is undimmed a little (more than round 12, still a quiet ground)`, async () => {
          const o = await page.evaluate(() => {
            const el = document.querySelector('.s2-backdrop');
            return el ? { op: +getComputedStyle(el).opacity, mode: el.getAttribute('data-mode'), drawn: el.getAttribute('data-drawn'), sat: getComputedStyle(el.firstElementChild).filter } : null;
          });
          if (!o) throw new Error('no backdrop');
          const was = theme === 'dark' ? 0.05 : 0.07;
          if (o.drawn === 'true' && (o.op <= was + 0.01 || o.op > 0.3)) throw new Error(`opacity ${o.op} (mode ${o.mode})`);
          console.log(`   backdrop ${o.mode} opacity ${o.op} ${o.sat}`);
        });
        await check(`${T}: S10 the Workspace and Open project folders draw 16 px on whole pixels`, async () => {
          if (await page.locator(sel('v3-tab-close-agents')).count()) await page.locator(sel('v3-tab-close-agents')).click();
          await page.waitForTimeout(400);
          await shot('sidebar-folders', theme, w);
          const m = await page.evaluate(() => {
            const pick = (q) => [...document.querySelectorAll(q)].map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
            return { proj: pick('.s2-proj-row .s2-rail-ic > svg'), open: pick('.s2-it-foot svg').slice(1, 2) };
          });
          for (const r of [...m.proj, ...m.open]) {
            if (r.w !== 16 || r.h !== 16 || r.x % 1 !== 0 || r.y % 1 !== 0) throw new Error(`folder box ${JSON.stringify(r)}`);
          }
          if (!m.proj.length) throw new Error('no project row');
        });
        await check(`${T}: A5 a subagent row's definition stays on one line with an ellipsis`, async () => {
          const m = await page.evaluate(() => {
            const host = document.querySelector('section.s2-chat .agentrun, section.s2-chat') ;
            const sec = document.createElement('section');
            sec.className = 'agsub';
            sec.innerHTML = '<button class="agsub-hd"><span class="agsub-name">Explore</span><span class="agsub-desc" title="x">find where the limiter reads the client address and which header the proxy overwrites before it reaches the handler</span><span class="agsub-meta">3 steps, running, 12s</span></button>';
            host.appendChild(sec);
            const d = sec.querySelector('.agsub-desc');
            const r = { h: sec.getBoundingClientRect().height, clipped: d.scrollWidth > d.clientWidth, ell: getComputedStyle(d).textOverflow };
            sec.remove();
            return r;
          });
          if (m.h > 40 || !m.clipped || m.ell !== 'ellipsis') throw new Error(JSON.stringify(m));
        });
        stop();
        await page.waitForTimeout(300);
      }

      /* ── the popovers, the ring and the three modes (no agent: a configured model) ── */
      for (const w of [1440, 1024]) {
        const T = `${theme} ${w}`;
        await fresh(page, base, theme, w, { agent: false });
        await page.unroute('**/api/ask/stream').catch(() => {});
        await page.route('**/api/ask/stream', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: sse([ASK_RESULT]) }));
        await send(page, 'Why does the rate limiter return 200 under load?');
        await page.waitForTimeout(1500);
        const ring = page.locator(sel('s2-status-context')).locator(sel('composer-context'));
        await ring.waitFor({ timeout: 8000 });
        await check(`${T}: the context ring is small (14 px) and only in the status bar`, async () => {
          const r = await ring.locator('svg').boundingBox();
          if (r.width > 15) throw new Error(`ring is ${r.width}px`);
          const n = await page.locator(sel('composer-context')).count();
          if (n !== 1) throw new Error(`${n} rings on screen`);
        });
        await ring.hover();
        await page.waitForTimeout(700);
        await check(`${T}: the ring's popover reads used of total, percent and System/Tools/History/Files`, async () => {
          const p = page.locator(sel('composer-context-breakdown'));
          await p.waitFor({ timeout: 4000 });
          const t = await p.innerText();
          for (const w of ['Context window', '274k / 1M', '27%', 'Instructions', 'Tool results', 'Other (history', 'Files and question', 'Input 274k']) if (!t.includes(w)) throw new Error(`missing ${w} in ${JSON.stringify(t)}`);
          const b = await p.boundingBox();
          if (b.x < 0 || b.x + b.width > page.viewportSize().width) throw new Error('popover leaves the window');
        });
        await check(`${T}: S8 the hover has room inside its border, no footnote, and sits above the board toolbar`, async () => {
          const r = await page.evaluate(() => {
            const p = document.querySelector('[data-testid="composer-context-breakdown"]');
            const b = p.getBoundingClientRect();
            const first = [...p.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim()).map((e) => e.getBoundingClientRect());
            const l = Math.min(...first.map((x) => x.left)) - b.left;
            const rr = b.right - Math.max(...first.map((x) => x.right));
            const t = Math.min(...first.map((x) => x.top)) - b.top;
            const bt = b.bottom - Math.max(...first.map((x) => x.bottom));
            let covered = 0, total = 0;
            for (let x = b.left + 4; x < b.right - 4; x += 8) for (let y = b.top + 4; y < b.bottom - 4; y += 8) { total++; if (!p.contains(document.elementFromPoint(x, y))) covered++; }
            return { l, rr, t, bt, covered, total, text: p.innerText, z: getComputedStyle(p).zIndex };
          });
          for (const k of ['l', 'rr', 't', 'bt']) if (r[k] < 14) throw new Error(`inner padding ${k} = ${r[k]}`);
          if (/estimate|remains of the measured/i.test(r.text)) throw new Error('footnote still there');
          if (r.covered) throw new Error(`${r.covered} of ${r.total} points of the panel are covered by something else`);
        });
        await shot('context-hover', theme, w);
        await clip('context-hover-zoom', theme, w, [page.locator(sel('composer-context-breakdown')), ring], 16);
        await page.mouse.move(2, 2);
        await page.waitForTimeout(300);

        /* Modes: the three icons, one box as the agent icon, centred. */
        const trig = page.locator(sel('s2-mode-trigger'));
        const inks = {};
        for (const key of ['plan', 'smart', 'full']) {
          await trig.click();
          await page.locator(sel(`s2-quickmode-${key}`)).click();
          if (key === 'full') await page.locator(sel('v3-full-access-allow')).click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(500);
          await check(`${T}: mode ${key}: icon only (no word), same box as the provider icon, centred in it`, async () => {
            const m = await page.evaluate(() => {
              const pill = document.querySelector('[data-testid="s2-pillbar"]');
              const mode = pill.querySelector('.s2-mode-ico').getBoundingClientRect();
              const brand = pill.querySelector('.s2-brand').getBoundingClientRect();
              const vis = [...pill.querySelectorAll('.s2-pb-mode *')].filter((e) => !e.closest('.s2-sr') && !e.classList.contains('s2-sr') && e.textContent.trim() && e.children.length === 0 && getComputedStyle(e).display !== 'none').map((e) => e.textContent.trim());
              return { mw: mode.width, mh: mode.height, bw: brand.width, bh: brand.height, my: mode.top + mode.height / 2, by: brand.top + brand.height / 2, vis };
            });
            if (m.mw !== m.bw || m.mh !== m.bh) throw new Error(`boxes differ: mode ${m.mw}x${m.mh}, provider ${m.bw}x${m.bh}`);
            if (Math.abs(m.my - m.by) > 0.6) throw new Error(`centres differ by ${(m.my - m.by).toFixed(2)}`);
            if (m.vis.length) throw new Error(`visible text in the mode button: ${m.vis}`);
            const off = await inkOffset(page, page.locator('.s2-pb-mode .s2-mode-ico'));
            if (!off || Math.abs(off.dx) > 0.5 || Math.abs(off.dy) > 0.5) throw new Error(`ink off-centre by ${JSON.stringify(off)}`);
            const brandInk = await inkOffset(page, page.locator('.s2-pb-model .s2-brand'));
            console.log(`   ${key}: mode ink ${off.w.toFixed(1)}x${off.h.toFixed(1)} off ${off.dx.toFixed(2)},${off.dy.toFixed(2)}; agent ink ${brandInk.w.toFixed(1)}x${brandInk.h.toFixed(1)}`);
            if (Math.max(off.w, off.h) < Math.max(brandInk.w, brandInk.h) - 2.5) throw new Error(`mode glyph ${off.w}x${off.h} reads smaller than the agent mark ${brandInk.w}x${brandInk.h}`);
          });
          inks[key] = await inkOffset(page, page.locator('.s2-pb-mode .s2-mode-ico'));
          await clip(`mode-${key}`, theme, w, [page.locator(sel('s2-pillbar'))], 10);
        }
        await trig.click();
        await page.waitForTimeout(300);
        await clip('mode-menu', theme, w, [page.locator(sel('s2-quickmode-menu')), page.locator(sel('s2-pillbar'))], 10);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        await check(`${T}: S4 the plan icon has the Smart shield's weight and footprint`, async () => {
          const p = inks.plan, m = inks.smart;
          if (Math.abs(p.w - m.w) > 2.5 || Math.abs(p.h - m.h) > 2.5) throw new Error(`plan ink ${p.w}x${p.h} vs smart ${m.w}x${m.h}`);
          const stroke = await page.evaluate(() => getComputedStyle(document.querySelector('.s2-pb-mode .s2-mode-ico svg')).strokeWidth);
          console.log(`   plan ink ${p.w}x${p.h}, smart ${m.w}x${m.h}, stroke ${stroke}`);
        });
        await check(`${T}: S5 agent icon and mode icon: same box, same room to the pill's top and bottom, same room to the button edge, glyph centred in the button`, async () => {
          const m = await page.evaluate(() => {
            const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
            const pill = document.querySelector('.s2-pillbar');
            const mb = pill.querySelector('.s2-pb-mode'), ob = pill.querySelector('.s2-pb-model');
            const mi = pill.querySelector('.s2-mode-ico'), br = pill.querySelector('.s2-brand');
            return { pill: r(pill), mb: r(mb), ob: r(ob), mi: r(mi), br: r(br) };
          });
          const near = (a, b, what) => { if (Math.abs(a - b) > 0.6) throw new Error(`${what}: ${a} vs ${b}`); };
          near(m.mi.w, m.br.w, 'icon width'); near(m.mi.h, m.br.h, 'icon height');
          near(m.mi.t - m.pill.t, m.br.t - m.pill.t, 'room to the pill top');
          near(m.pill.b - m.mi.b, m.pill.b - m.br.b, 'room to the pill bottom');
          near(m.mi.l - m.mb.l, m.mb.r - m.mi.r, 'mode glyph centred in its button (x)');
          near(m.mi.t - m.mb.t, m.mb.b - m.mi.b, 'mode glyph centred in its button (y)');
          near(m.mb.w, m.mb.h, 'mode button is square (a circle on hover)');
          near(m.br.l - m.ob.l, m.mi.l - m.mb.l, 'agent mark room to its button edge equals the mode glyph room');
        });
        await page.locator('.s2-pb-mode').hover();
        await page.waitForTimeout(250);
        await clip('mode-hover-circle', theme, w, [page.locator(sel('s2-pillbar'))], 10);
        await page.mouse.move(2, 2);

        /* S6: send and stop glyphs sit on their button's centre. */
        const box = page.locator('section.s2-chat textarea').first();
        await box.click();
        await box.fill('hello');
        await check(`${T}: S6 the send arrow is centred in its button`, async () => {
          const btn = page.locator(sel('composer-send'));
          const off = await inkOffset(page, btn, 15);
          /* An arrow's centroid sits toward its head; it is centred by its bounding box, as every icon is. */
          if (!off || Math.abs(off.bx) > 0.6 || Math.abs(off.by) > 0.6) throw new Error(`ink box off by ${JSON.stringify(off)}`);
        });
        await clip('send-ready', theme, w, [page.locator(sel('composer-send'))], 10);
        await box.fill('');

        /* S3: a project opened at a chat worktree wears the small branch badge, centred in its disc. */
        const wtAt = new Date(Date.UTC(2026, 9, 8, 5)).toISOString();
        const wt = { id: 'w1', path: '/home/dev/shopfront-wt', branch: 'sequence/rate-limit-1a2b', baseBranch: 'main', baseCommit: 'abc1234', createdAt: wtAt };
        const chatOf = (id, title, extra = {}) => ({ id, title, titleEdited: true, createdAt: wtAt, updatedAt: wtAt, ...extra });
        await fresh(page, base, theme, w, {
          agent: false,
          sessions: {
            ...SESSIONS,
            repos: [
              { path: '/home/dev/shopfront', name: 'shopfront', index: { version: 1, activeId: 'r1', sessions: [chatOf('r1', 'Rate limiting', { worktree: wt })] } },
              { path: wt.path, name: 'shopfront-wt', index: { version: 1, activeId: 'w1', sessions: [chatOf('w2', 'Rate limiting')] } },
            ],
          },
        });
        await page.evaluate(() => localStorage.setItem('s2.projectsOpen', JSON.stringify({ '/home/dev/shopfront-wt': true })));
        await page.reload();
        await page.waitForSelector(sel('s2-project'), { timeout: 15000 });
        await page.waitForTimeout(800);
        await check(`${T}: S3 the worktree badge is small and centred in its disc`, async () => {
          const badge = page.locator('.s2-proj-row[data-worktree="true"] .s2-rail-badge').first();
          if (!(await badge.count())) throw new Error('no worktree badge rendered');
          const m = await badge.evaluate((n) => {
            const b = n.getBoundingClientRect(); const g = n.querySelector('svg').getBoundingClientRect();
            return { w: b.width, h: b.height, dx: g.left + g.width / 2 - (b.left + b.width / 2), dy: g.top + g.height / 2 - (b.top + b.height / 2), gw: g.width };
          });
          if (m.w > 10.5 || m.gw > 7.5 || Math.abs(m.dx) > 0.5 || Math.abs(m.dy) > 0.5) throw new Error(JSON.stringify(m));
          const row = page.locator('.s2-proj-row[data-worktree="true"]').first();
          await clip('sidebar-worktree', theme, w, [row], 24);
          await page.screenshot({ path: `${OUT}/sidebar-worktree-full-${w}-${theme}.png` });
        });
      }
    }
  },
  {},
);
