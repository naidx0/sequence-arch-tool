#!/usr/bin/env node
/**
 * R10 chat shots, dark and light at 1440x900: the step timeline (collapsed,
 * expanded), a subagent subthread, the rail with subagent sub-rows, a stopped
 * turn, a usage-limit turn, a signed-out turn, the no-response watchdog line,
 * and a mermaid diagram and an svg block in an answer.
 * Live turns are faked at /api/acp/run-node (no agent runs). Shots go to
 * $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/r10/chat).
 */
import fs from 'node:fs';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r10/chat';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};
const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output });
let clock = 1;
/* Steps follow one another, so a run reads as a timeline with realistic durations. */
const tool = (id, title, toolKind, status, ms) => {
  const startedAt = clock;
  clock += ms;
  return { id, title, toolKind, status, startedAt, endedAt: startedAt + ms };
};
const CAPS = { models: [{ id: 'claude-sonnet-5', name: 'Sonnet 5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true }, { id: 'claude-opus-5', name: 'Opus 5', efforts: ['medium', 'high'] }], efforts: ['low', 'medium', 'high'], commands: [], skills: [] };
const PLAN = [
  '## Plan: move the limiter behind the proxy',
  '',
  'The request path after the change:',
  '',
  '```mermaid',
  'flowchart LR',
  '  Client --> Proxy',
  '  Proxy -->|x-forwarded-for| Limiter',
  '  Limiter -->|under limit| Handler',
  '  Limiter -->|over limit| Reject[429]',
  '```',
  '',
  'And the bucket, drawn:',
  '',
  '```svg',
  '<svg viewBox="0 0 320 90" xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
  '  <script>alert(1)</script>',
  '  <rect x="10" y="20" width="300" height="50" rx="8" fill="none" stroke="currentColor"/>',
  '  <rect x="10" y="20" width="190" height="50" rx="8" fill="currentColor" opacity=".25"/>',
  '  <text x="160" y="50" text-anchor="middle" fill="currentColor" font-size="14">63 / 100 requests this minute</text>',
  '</svg>',
  '```',
].join('\n');
const RUNS = {
  runs: [
    { id: 't1', agentRef: 'claude', prompt: 'Why does the rate limiter return 200 under load?', text: 'The window is keyed on `req.ip`, which is the proxy for every request. Reading `x-forwarded-for` first fixes it, and the gateway tests pass (14).', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9, model: 'claude-sonnet-5', nodeId: null,
      tools: [tool('a', 'Read gateway/src/rate.ts', 'read', 'done', 1200), tool('a2', 'Read gateway/src/proxy.ts', 'read', 'done', 800), tool('b', 'Grep x-forwarded-for', 'search', 'done', 1500), tool('c', 'Edit gateway/src/rate.ts', 'edit', 'done', 2100), tool('d', 'pnpm --filter @sequence/gateway test', 'execute', 'done', 26000)],
      usage: usage(18400, 2100, 61200) },
    { id: 't2', agentRef: 'claude', prompt: 'Now add a test for the proxy case', text: '', status: 'stopped', error: null, stopReason: 'cancelled', startedAt: 10, endedAt: 19, model: 'claude-sonnet-5', nodeId: null, tools: [tool('e', 'Read gateway/test/rate.test.ts', 'read', 'done', 1200)], usage: usage(9300, 640, 28800) },
  ],
};
const PLAN_RUNS = { runs: [{ id: 'p1', agentRef: 'claude', prompt: 'Plan the limiter change', text: PLAN, status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(4200, 900, 1000) }] };

const XSS = [
  '<svg><!--><img src=x onerror=alert(1)>--></svg>',
  '<svg><?x ><img src=x onerror=alert(1)>?></svg>',
  '<svg><desc><![CDATA[ x><img src=x onerror=alert(1)> ]]></desc></svg>',
  '<svg><p/><form><button formaction="java&#9;script:alert(1)">Click</button></form></svg>',
  '<svg><img src="https://evil/pixel"/></svg>',
  '<svg><rect width="4" height="4" style="fill:u\\72l(https://evil/x)"/></svg>',
  `<svg><rect width="4" height="4" style="cursor:image-set('https://evil/i' 1x)"/></svg>`,
];
const xssRuns = (payload) => ({ runs: [{ id: 'x1', agentRef: 'claude', prompt: 'draw', text: '```svg\n' + payload + '\n```', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(1, 1, 0) }] });

/* Mermaid sources that try to make the browser fetch something: every one must cause zero non-local requests. */
const FLOW = 'flowchart LR\n  Client --> Proxy --> Limiter';
const MERMAID_ATTACKS = [
  ['themeCSS', `%%{init: {"themeCSS": "g{background-image:url(https://evil.example/x)} text{cursor:url(https://evil.example/c),auto}"}}%%\n${FLOW}`],
  ['fontFamily', `%%{init: {"fontFamily": "x; background-image: url(https://evil.example/ff)"}}%%\n${FLOW}`],
  ['flowchart img label', 'flowchart LR\n  A["<img src=\'https://evil.example/i\'>x"] --> B'],
  ['block-beta img label', 'block-beta\n  a["<img src=https://evil.example/b>"]'],
  ['svg/image/feImage label', 'flowchart LR\n  A["<svg><image href=\'https://evil.example/s\'></image><feImage href=\'https://evil.example/f\'></feImage></svg>"] --> B'],
  ['node img', 'flowchart LR\n  A@{ img: "https://evil.example/n.png", label: "x" } --> B'],
  ['node icon', 'flowchart LR\n  A@{ icon: "https://evil.example/n.svg", label: "x" } --> B'],
  ['classDef background-image', 'flowchart LR\n  A --> B\n  classDef c background-image:url(https://evil.example/cd),fill:#fff\n  class A c'],
];
const WIDE = 'flowchart LR\n  Client --> Gateway --> Proxy --> Limiter --> Handler --> Cache --> Store --> Queue --> Worker --> Notifier';
const WIDE_LABELLED = 'flowchart LR\n  Client -->|request| Gateway -->|forward| Proxy -->|check limit| Limiter -->|allow| Handler -->|lookup| Cache -->|miss| Store -->|enqueue| Queue -->|dispatch| Worker -->|notify| Notifier';
const LABEL_IMG = 'flowchart LR\n  A@{ shape: rect, label: "img: preview pane" } --> B[Next]';
const LABEL_ICON = 'flowchart LR\n  A@{ shape: rect, label: "icon: settings" } --> B[Next]';
const SEQ = 'sequenceDiagram\n  participant U as User\n  participant A as API\n  U->>A: request\n  A-->>U: 200';
const mermaidRuns = (src) => ({ runs: [{ id: 'm1', agentRef: 'claude', prompt: 'draw', text: '```mermaid\n' + src + '\n```', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 9, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: usage(1, 1, 0) }] });

const upd = (update) => ({ type: 'acp:update', update: { sessionId: 's', update } });
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const SUBAGENT = sse([
  upd({ sessionUpdate: 'tool_call', toolCallId: 'task-1', title: 'Task', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'Explore', description: 'find where the limiter reads the client address' } }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'r-1', title: 'Read gateway/src/rate.ts', kind: 'read', status: 'completed', _meta: { claudeCode: { parentToolUseId: 'task-1' } } }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'g-1', title: 'Grep req.ip', kind: 'search', status: 'completed', _meta: { claudeCode: { parentToolUseId: 'task-1' } } }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'r-2', title: 'Read gateway/src/proxy.ts', kind: 'read', status: 'completed', _meta: { claudeCode: { parentToolUseId: 'task-1' } } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'task-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'The limiter keys on `req.ip` in `rate.ts` line 41; the proxy never forwards the client address.' } }] }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'task-2', title: 'Task', kind: 'other', status: 'in_progress', rawInput: { subagent_type: 'general-purpose', description: 'draft the failing proxy test' } }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'w-1', title: 'Write gateway/test/proxy.test.ts', kind: 'edit', status: 'in_progress', _meta: { claudeCode: { parentToolUseId: 'task-2' } } }),
  upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Two subagents looked at it in parallel. ' } }),
  { type: 'acp:result', stopReason: 'end_turn', text: 'Two subagents looked at it in parallel. ' },
]);
const failure = (error, recovery) => sse([{ type: 'acp:error', error, recovery }]);
const LIMIT = failure('You have hit your usage limit. Try again at Oct 12th, 2026 4:36 PM.', { kind: 'wait', provider: 'claude', resetsAt: new Date(2026, 9, 12, 16, 36).getTime(), cause: 'usageLimit' });
const SIGNED_OUT = failure('Please log in again', { kind: 'signIn', provider: 'claude', cause: 'signedOut' });

let capsFails = false;
async function fresh(page, base, theme, runs) {
  await page.unroute('**/api/acp/runs*').catch(() => {});
  await page.unroute('**/api/acp/capabilities*').catch(() => {});
  await page.route('**/api/acp/capabilities*', (r) =>
    capsFails ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'claude is signed out' }) }) : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS) }),
  );
  await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runs) }));
  await page.goto(base);
  await page.evaluate((t) => {
    try {
      localStorage.setItem('seq.theme', t);
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForSelector(sel('shell'));
  await page.locator('section.s2-chat [data-testid="agent-run"], section.s2-chat .s2-run, section.s2-chat [data-testid="v3-prose"]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
}

async function send(page, text) {
  const box = page.locator('section.s2-chat textarea').first();
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

await suite(
  'r10-chat-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + (window.__skew || 0);
    });
    const shot = (name, theme) => page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    const live = async (body) => {
      await page.unroute('**/api/acp/run-node*').catch(() => {});
      await page.route('**/api/acp/run-node*', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body }));
    };
    for (const theme of ['dark', 'light']) {
      /* The step timeline, collapsed then expanded; and the stopped turn. */
      await fresh(page, base, theme, RUNS);
      await check(`${theme}: finished steps fold into one summary line`, async () => {
        const fold = page.locator(sel('agent-tool-fold')).first();
        await fold.waitFor({ timeout: 8000 });
        const t = await fold.locator(sel('agent-tool-fold-summary')).innerText();
        if (!/Read 2 files/.test(t)) throw new Error(`summary is "${t}"`);
      });
      await check(`${theme}: a stopped turn is one quiet row`, async () => {
        const row = page.locator(sel('agent-recovery')).first();
        await row.waitFor({ timeout: 8000 });
        if ((await row.getAttribute('data-stopped')) !== 'true') throw new Error('not marked stopped');
        const h = (await row.boundingBox())?.height ?? 999;
        if (h > 48) throw new Error(`the row is ${h}px tall`);
      });
      await shot('timeline-collapsed', theme);
      await page.locator(sel('agent-tool-fold-toggle')).first().click();
      await page.waitForTimeout(250);
      await shot('timeline-expanded', theme);
      await page.locator('section.s2-chat').last().screenshot({ path: `${OUT}/stopped-${theme}.png` });

      /* A subagent subthread, and the rail's sub-rows. */
      await fresh(page, base, theme, RUNS);
      await live(SUBAGENT);
      await send(page, 'Find where the limiter reads the client address and draft a test');
      await check(`${theme}: subagents are nested cards`, async () => {
        await page.locator(sel('agent-subagent')).first().waitFor({ timeout: 10000 });
        if ((await page.locator(sel('agent-subagent')).count()) !== 2) throw new Error('want two subthreads');
      });
      await page.locator(sel('agent-subagent-toggle')).first().click();
      await page.waitForTimeout(300);
      await shot('subagent', theme);
      await check(`${theme}: the rail lists subagents and a click opens that subthread`, async () => {
        const toggle = page.locator(sel('rail-subagents-toggle')).first();
        await toggle.waitFor({ timeout: 8000 });
        await toggle.click();
        const rows = page.locator(sel('rail-subagent'));
        if ((await rows.count()) !== 2) throw new Error('want two sub-rows');
        await page.waitForTimeout(250);
        await shot('rail-subagents', theme);
        await page.locator(sel('agent-subagent-toggle')).first().click(); // fold it
        await rows.nth(0).click();
        await page.waitForTimeout(400);
        if ((await page.locator(sel('agent-subagent')).first().getAttribute('data-open')) !== 'true') throw new Error('not expanded');
      });

      /* Usage limit and signed out. */
      for (const [name, body, pattern] of [['usage-limit', LIMIT, /Usage limit, resets/], ['signed-out', SIGNED_OUT, /Claude is signed out/]]) {
        await fresh(page, base, theme, RUNS);
        await live(body);
        await send(page, 'Run the gateway tests again');
        await check(`${theme}: ${name} is one sentence`, async () => {
          const row = page.locator(sel('agent-recovery-why')).filter({ hasText: pattern }).last();
          await row.waitFor({ timeout: 10000 });
        });
        await page.waitForTimeout(200);
        await shot(name, theme);
      }

      /* The one shot where the models line is meant to appear: the capabilities endpoint fails. */
      capsFails = true;
      await fresh(page, base, theme, RUNS);
      await live(sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'Done.' }]));
      await send(page, 'Say hi');
      await check(`${theme}: a failed capabilities load says so once, in one line`, async () => {
        await page.getByText(/Couldn't load this agent's models/).first().waitFor({ timeout: 10000 });
      });
      await shot('caps-error', theme);
      capsFails = false;

      /* No response for 45 s: the request never answers; the page clock moves on. */
      await fresh(page, base, theme, RUNS);
      await page.unroute('**/api/acp/run-node*').catch(() => {});
      await page.route('**/api/acp/run-node*', () => {});
      await send(page, 'Run the gateway tests again');
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        window.__skew = 47_000;
      });
      await check(`${theme}: a quiet turn says so and offers Keep waiting / Stop`, async () => {
        const w = page.locator(sel('agent-run-watchdog'));
        await w.waitFor({ timeout: 8000 });
        const t = await w.innerText();
        if (!/(?:No response from Claude|Claude is still starting), 4\ds/.test(t) || !/Keep waiting/.test(t) || !/Stop/.test(t)) throw new Error(`says "${t}"`);
      });
      await shot('watchdog', theme);

      /* A plan with a diagram and a drawing. */
      await fresh(page, base, theme, PLAN_RUNS);
      await check(`${theme}: mermaid and svg are drawn, the svg's script is gone`, async () => {
        await page.locator(`${sel('chat-diagram')}[data-kind="svg"] ${sel('chat-diagram-art')} svg`).waitFor({ timeout: 10000 });
        await page.locator(`${sel('chat-diagram')}[data-kind="mermaid"] ${sel('chat-diagram-art')} svg`).waitFor({ timeout: 20000 });
        const html = await page.locator(`${sel('chat-diagram')}[data-kind="svg"]`).innerHTML();
        if (/script|onload|alert/.test(html)) throw new Error('unsafe markup survived');
      });
      await shot('diagrams', theme);

      /* Hostile svg payloads: no dialog, and no html img / form in the transcript. */
      let dialogs = 0;
      const onDialog = (d) => {
        dialogs += 1;
        d.dismiss().catch(() => {});
      };
      page.on('dialog', onDialog);
      for (const payload of XSS) {
        await fresh(page, base, theme, xssRuns(payload));
        await page.waitForTimeout(500);
        await check(`${theme}: svg payload is inert: ${payload.slice(0, 48)}`, async () => {
          if (dialogs) throw new Error('a dialog fired');
          const n = await page.locator(`section.s2-chat img, section.s2-chat form, ${sel('chat-diagram-art')} button`).count();
          if (n) throw new Error(`${n} html img/form/button elements in the transcript`);
        });
      }
      page.off('dialog', onDialog);

      /* Mermaid sources that reach for a URL: zero requests to a non-local host, and no dialog. */
      const remote = [];
      const onRequest = (r) => {
        const u = new URL(r.url());
        if (!['localhost', '127.0.0.1', '[::1]', ''].includes(u.hostname) && !/^(data|blob|about):/.test(r.url())) remote.push(r.url());
      };
      page.on('request', onRequest);
      page.on('dialog', onDialog);
      dialogs = 0;
      for (const [name, src] of MERMAID_ATTACKS) {
        remote.length = 0;
        await fresh(page, base, theme, mermaidRuns(src));
        await page.locator(sel('chat-diagram')).first().waitFor({ timeout: 20000 });
        await page.waitForFunction(() => document.querySelector('[data-testid="chat-diagram"]')?.getAttribute('data-state') !== 'pending', null, { timeout: 20000 });
        await page.waitForTimeout(800);
        await check(`${theme}: mermaid ${name}: 0 non-local requests, no dialog (${remote.length})`, async () => {
          if (remote.length) throw new Error(`requests: ${remote.join(', ')}`);
          if (dialogs) throw new Error('a dialog fired');
        });
      }
      page.off('request', onRequest);
      page.off('dialog', onDialog);

      /* Normal diagrams still draw with their labels as text; a wide one fits, then scrolls with a hint. */
      for (const [name, src] of [['flowchart', FLOW], ['sequence', SEQ], ['wide', WIDE], ['widelabels', WIDE_LABELLED], ['labelimg', LABEL_IMG], ['labelicon', LABEL_ICON]]) {
        await fresh(page, base, theme, mermaidRuns(src));
        const art = page.locator(`${sel('chat-diagram')}[data-kind="mermaid"] ${sel('chat-diagram-art')}`);
        await art.locator('svg').waitFor({ timeout: 20000 });
        await page.waitForTimeout(300);
        await check(`${theme}: ${name} mermaid keeps its labels as text`, async () => {
          const t = await art.innerText();
          const want = name === 'sequence' ? /(?=[\s\S]*User)(?=[\s\S]*API)/ : name === 'labelimg' ? /img: preview pane[\s\S]*Next/ : name === 'labelicon' ? /icon: settings[\s\S]*Next/ : /Client[\s\S]*Proxy/;
          if (!want.test(t)) throw new Error(`text is "${t}"`);
          if ((await art.locator('foreignObject, image, img').count()) !== 0) throw new Error('html/image elements in the drawing');
        });
        if (name === 'wide') {
          await check(`${theme}: a wide diagram scales to a floor and then scrolls, with a hint`, async () => {
            const m = await art.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, scale: el.querySelector('svg').getAttribute('data-fit-scale') }));
            if (!(m.sw > m.cw)) throw new Error(`does not overflow: ${JSON.stringify(m)}`);
            if (Number(m.scale) < 0.69 || Number(m.scale) > 0.71) throw new Error(`scale ${m.scale}`);
            if ((await page.locator(sel('chat-diagram-hint')).count()) !== 1) throw new Error('no scroll hint');
          });
        }
        if (name === 'labelimg' || name === 'labelicon') {
          await check(`${theme}: ${name}: a label that says img:/icon: draws, no failure note`, async () => {
            if ((await page.locator(sel('chat-diagram-note')).count()) !== 0) throw new Error("Diagram didn't parse");
          });
        }
        if (name === 'sequence') {
          await check(`${theme}: a sequence diagram keeps padding on every side and has no scroll hint`, async () => {
            if ((await page.locator(sel('chat-diagram-hint')).count()) !== 0) throw new Error('hint on a narrow diagram');
            const m = await art.evaluate((el) => {
              const svg = el.querySelector('svg');
              const r = svg.getBoundingClientRect();
              let top = Infinity;
              let left = Infinity;
              let bottom = -Infinity;
              let right = -Infinity;
              for (const t of svg.querySelectorAll('line, rect, text, path')) {
                const q = t.getBoundingClientRect();
                if (q.width === 0 && q.height === 0) continue;
                top = Math.min(top, q.top); left = Math.min(left, q.left); bottom = Math.max(bottom, q.bottom); right = Math.max(right, q.right);
              }
              return { top: top - r.top, left: left - r.left, bottom: r.bottom - bottom, right: r.right - right };
            });
            if (m.top < 4 || m.left < 4) throw new Error(`top/left pad ${JSON.stringify(m)}`);
            if (m.bottom < 4 || m.right < 4) throw new Error(`bottom/right pad ${JSON.stringify(m)}`);
          });
        }
        if (name === 'widelabels') {
          await check(`${theme}: a wide diagram's edge labels are not clipped vertically and no space is left under it`, async () => {
            const m = await art.evaluate((el) => {
              const svg = el.querySelector('svg');
              const r = svg.getBoundingClientRect();
              let top = Infinity;
              let bottom = -Infinity;
              for (const t of svg.querySelectorAll('text, .edgeLabel rect, rect')) {
                const q = t.getBoundingClientRect();
                if (q.height > 0) { top = Math.min(top, q.top); bottom = Math.max(bottom, q.bottom); }
              }
              return { clipTop: r.top - top, clipBottom: bottom - r.bottom, under: el.getBoundingClientRect().bottom - r.bottom, sh: el.scrollHeight, ch: el.clientHeight, scale: svg.getAttribute('data-fit-scale') };
            });
            if (m.clipTop > 0.5 || m.clipBottom > 0.5) throw new Error(`clipped: ${JSON.stringify(m)}`);
            if (m.under > 24) throw new Error(`${m.under}px under the drawing: ${JSON.stringify(m)}`);
          });
        }
        if (name === 'flowchart') {
          await check(`${theme}: a short diagram has no scroll hint and little empty space`, async () => {
            if ((await page.locator(sel('chat-diagram-hint')).count()) !== 0) throw new Error('hint on a fitting diagram');
            const m = await art.evaluate((el) => ({ h: el.clientHeight, sh: el.querySelector('svg').getBoundingClientRect().height }));
            if (m.h - m.sh > 24) throw new Error(`${m.h - m.sh}px of padding around the drawing`);
          });
        }
        await page.locator(sel('chat-diagram')).first().screenshot({ path: `${OUT}/diagram-${name}-${theme}.png` });
      }
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/acp/runs': RUNS } },
);
