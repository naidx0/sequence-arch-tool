import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { COMPONENTS, renderVisual } from '@sequence/schema/dist/visual/index.js';

import { ProseMessage } from './ProseMessage';
import { referenceChars, expandDrawingRefs, refTokens } from './drawingRefs';
import { sanitizeSvg } from './svgSanitize';
import { withVisualHint } from './visualHint';
import { CARD_CAP_FALLBACK } from './cardState';
import { createAgentRunStore } from '../agents/agentRuns';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const fence = (info: string, body: string, closed = true): string => '```' + info + '\n' + body + (closed ? '\n```' : '');
const ORIGIN = { chat: 'c1', turn: 't1', repoRoot: '/work', at: 5, prompt: 'show the load' };
const LINE = JSON.stringify({ component: 'line', spec: { title: 'Requests', x: ['Mon', 'Tue', 'Wed', 'Thu'], series: [{ name: 'rps', values: [10, 14, 19, 25] }], forecast: { periods: 2 } } });

describe('every kit component survives the chat sanitiser unchanged', () => {
  for (const c of COMPONENTS) {
    it(c.id, () => {
      const svg = renderVisual(c.id, c.example).svg;
      const r = sanitizeSvg(svg);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
      const live = svg.replace(/<!--[^]*?-->/g, '');
      expect(count(r.svg, /<[a-zA-Z]/g)).toBe(count(live, /<[a-zA-Z]/g));
      /* every attribute is kept (the rebuilt tree is serialised with its own namespace declaration) */
      expect(count(r.svg, /\s[a-zA-Z:-]+="/g)).toBe(count(live, /\s[a-zA-Z:-]+="/g));
      expect(r.svg).toContain('var(--seq-');
    });
  }
});

describe('the visual fence', () => {
  it('draws a kit component from its JSON, saves it as a drawing with an id, and View source shows the JSON', async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { body?: string }) => {
      posts.push(JSON.parse(init!.body!));
      return { ok: true, json: async () => ({ drawing: { id: 'd1' }, name: '1-requests.svg', version: 1 }) };
    }));
    render(<ProseMessage text={fence('visual', LINE)} drawing={ORIGIN} />);
    const art = await screen.findByTestId('chat-diagram-art');
    expect(art.querySelector('svg polyline')).toBeTruthy();
    expect(art.querySelector('svg title')?.textContent).toBe('Requests');
    expect(art.innerHTML).not.toContain('<!--');
    expect(screen.queryByText('Visual')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('chat-card-title').getAttribute('title')).toMatch(/\nd1/));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ chat: 'c1', kind: 'svg', turn: 't1' });
    expect(String(posts[0]!.source)).toContain('<!--visual {"component":"line"');
    fireEvent.click(screen.getByTestId('chat-diagram-toggle'));
    expect(screen.getByTestId('chat-code').textContent).toContain('"component":"line"');
  });

  it('a spec the kit refuses shows the problem and the JSON, and saves nothing', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const bad = JSON.stringify({ component: 'line', spec: { x: ['a', 'b'], series: [{ name: 's', values: [1, 'n/a'] }] } });
    render(<ProseMessage text={fence('visual', bad)} drawing={ORIGIN} />);
    const note = await screen.findByTestId('chat-visual-error');
    expect(note.textContent).toContain('spec.series[0].values[1]: expected a number, got "n/a"');
    expect(screen.getByTestId('chat-code').textContent).toContain('"values":[1,"n/a"]');
    expect(f).not.toHaveBeenCalled();
    cleanup();
    render(<ProseMessage text={fence('visual', '{nope')} />);
    expect((await screen.findByTestId('chat-visual-error')).textContent).toContain('not valid JSON');
  });

  it('streaming: an open fence says Drawing and parses nothing; closing it draws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ drawing: { id: 'd2' }, name: '2-x.svg', version: 1 }) })));
    const { rerender } = render(<ProseMessage text={fence('visual', LINE.slice(0, 40), false)} streaming drawing={ORIGIN} />);
    expect(screen.getByTestId('chat-visual-pending')).toBeTruthy();
    expect(screen.queryByTestId('chat-visual-error')).toBeNull();
    rerender(<ProseMessage text={fence('visual', LINE)} streaming drawing={ORIGIN} />);
    expect(await screen.findByTestId('chat-diagram-art')).toBeTruthy();
  });

  it('{"id":"d5"} shows the drawing the tool saved, with its handle, and saves no copy', async () => {
    const kit = renderVisual('kpi', { tiles: [{ label: 'Users', value: 1000 }] });
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: { method?: string }) => {
      calls.push({ url: u, method: init?.method ?? 'GET' });
      return { ok: true, json: async () => ({ id: 'd5', name: '5-kpi.svg', version: 2, kind: 'svg', source: kit.svg }) };
    }));
    render(<ProseMessage text={fence('visual', '{"id":"d5"}')} drawing={ORIGIN} />);
    await screen.findByTestId('chat-diagram-art');
    expect(screen.getByTestId('chat-card-title').getAttribute('title')).toMatch(/\nd5 v2/);
    expect(calls).toEqual([{ url: '/api/drawings/d5', method: 'GET' }]);
    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<ProseMessage text={fence('visual', '{"id":"d99"}')} drawing={ORIGIN} />);
    expect((await screen.findByTestId('chat-visual-error')).textContent).toContain('no drawing "d99"');
  });

  it('visual id=d3 with a spec saves a new version of d3', async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { body?: string }) => {
      posts.push(JSON.parse(init!.body!));
      return { ok: true, json: async () => ({ drawing: { id: 'd3' }, name: '3-requests-v2.svg', version: 2 }) };
    }));
    render(<ProseMessage text={fence('visual id=d3', LINE)} drawing={{ ...ORIGIN, prompt: 'change @drawing:d3' }} />);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ id: 'd3', referenced: true });
  });
});

describe('a spec that looks like a tool dump is still a drawing', () => {
  it('a flow spec (nodes and edges) draws, not a tool card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ drawing: { id: 'd1' }, name: '1-flow.svg', version: 1 }) })));
    const spec = JSON.stringify({ component: 'flow', spec: { nodes: [{ id: 'a', kind: 'service' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] } });
    render(<ProseMessage text={fence('visual', spec)} drawing={ORIGIN} />);
    expect(await screen.findByTestId('chat-diagram-art')).toBeTruthy();
    expect(screen.queryByText(/Drawing architecture board/)).toBeNull();
  });
});

describe('referencing a kit drawing sends its spec, not its picture', () => {
  it('@drawing:d5 expands to the spec JSON and the way to change it; a hand-drawn svg still sends its source', async () => {
    const kit = renderVisual('line', JSON.parse(LINE).spec, { title: 'Requests' });
    const hand = '<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>';
    const f = vi.fn(async (u: string) => ({ ok: true, json: async () => (u.endsWith('d5') ? { id: 'd5', title: 'Requests', kind: 'svg', version: 2, source: kit.svg } : { id: 'd6', title: 'Box', kind: 'svg', version: 1, source: hand }) }));
    const out = await expandDrawingRefs('widen @drawing:d5 and @drawing:d6', f as unknown as typeof fetch);
    expect(out).toContain('a visual kit drawing: line, version 2');
    expect(out).toContain('call the visual tool with id=d5');
    expect(out).toContain('"component":"line"');
    expect(out).not.toContain('<polyline');
    expect(out).toContain(hand);
    expect(out.length).toBeLessThan(kit.svg.length / 2 + hand.length + 900);
    expect(referenceChars(kit.svg)).toBeLessThan(kit.svg.length / 3);
    expect(refTokens(referenceChars(kit.svg))).toBeLessThan(refTokens(kit.svg.length));
    expect(referenceChars(hand)).toBe(hand.length);
  });
});

describe('the private hint', () => {
  it('is added to the agent copy only when the router fires, and is judged on what the person typed, not on attachments', async () => {
    const typed = 'forecast our API traffic for the next quarter';
    expect(await withVisualHint(typed)).toBe(`${typed}\n\n[For this request, prefer visual components: line (with forecast). Call visual({help:"line"}) for the spec, or write a visual fence.]`);
    expect(await withVisualHint('rename the foo function')).toBe('rename the foo function');
    const attached = 'tidy this @drawing:d1\n\n[Attached drawing d1 ... a bar chart and a forecast dashboard ...]';
    expect(await withVisualHint('tidy this @drawing:d1', attached)).toBe(attached);
    expect((await withVisualHint(typed, `${typed} + attachment`)).startsWith(`${typed} + attachment\n\n[For this request`)).toBe(true);
  });
});

describe('a kit picture fits the card without being clipped', () => {
  /* The card caps a body at CARD_CAP_FALLBACK (420, --col-min). The chat draws the kit at the column's width (280-760, steps of 20). */
  for (const w of [340, 360, 440, 560]) {
    for (const c of COMPONENTS) {
      it(`${c.id} at ${w} is at most ${CARD_CAP_FALLBACK} px tall`, () => {
        expect(renderVisual(c.id, c.example, { width: w }).height).toBeLessThanOrEqual(CARD_CAP_FALLBACK);
      });
    }
  }
});

describe('the hint reaches the agent and never the transcript', () => {
  const sseOk = (): Response => new Response('data: {"type":"acp:result","stopReason":"end_turn","text":"ok"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  async function sent(question: string): Promise<{ prompt: string; shown: string; display?: string }> {
    const f = vi.fn(async (url: string) => (url === '/api/acp/agents' ? new Response(JSON.stringify({ agents: [{ id: 'claude' }] })) : sseOk()));
    const store = createAgentRunStore({ fetch: f });
    const run = await store.start({ question, agentRef: 'claude' });
    const call = f.mock.calls.find((c) => String(c[0]).includes('run-node')) as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body)) as { prompt: string; display?: string };
    return { prompt: body.prompt, shown: run.prompt, display: body.display };
  }
  it('a chart request carries the line, a code request does not, and the run keeps what was typed', async () => {
    const a = await sent('chart our weekly signups and forecast the next quarter');
    expect(a.prompt).toMatch(/\n\n\[For this request, prefer visual components: line \(with forecast\)/);
    expect(a.shown).toBe('chart our weekly signups and forecast the next quarter');
    const b = await sent('rename getUser to fetchUser everywhere');
    expect(b.prompt).toBe('rename getUser to fetchUser everywhere');
    expect(b.display).toBeUndefined();
  });
  it('the server is told what was typed, so only that is saved (the reload shows it, Edit from here and the rewind seed carry it)', async () => {
    const a = await sent('chart our weekly signups and forecast the next quarter');
    expect(a.display).toBe('chart our weekly signups and forecast the next quarter');
  });
});

describe('the show-it block in every form an agent might write', () => {
  const kit = renderVisual('kpi', { tiles: [{ label: 'Users', value: 1000 }] });
  const stub = (): void => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'd5', name: '5-kpi.svg', version: 1, kind: 'svg', source: kit.svg }) })));
  };
  const forms: Record<string, string> = {
    'three lines': 'Here it is.\n\n```visual\n{"id":"d5"}\n```\n\nThe rest of the answer.',
    'one line': 'Here it is.\n\n```visual {"id":"d5"}```\n\nThe rest of the answer.',
    'two lines (closing fence on the next line)': 'Here it is.\n\n```visual {"id":"d5"}\n```\n\nThe rest of the answer.',
    'opened and never closed, then prose': 'Here it is.\n\n```visual {"id":"d5"}\n\nThe rest of the answer.',
  };
  for (const [name, text] of Object.entries(forms)) {
    it(name, async () => {
      stub();
      render(<ProseMessage text={text} drawing={ORIGIN} />);
      await screen.findByTestId('chat-diagram-art');
      expect(screen.getByTestId('chat-card-title').getAttribute('title')).toMatch(/\nd5/);
      expect(screen.getByText('The rest of the answer.')).toBeTruthy();
      expect(document.body.textContent).not.toContain('```');
    });
  }
  it('a malformed one-line block shows the problem and still lets the answer continue', async () => {
    render(<ProseMessage text={'Look:\n\n```visual {"id":\n```\n\nAfter.'} />);
    expect((await screen.findByTestId('chat-visual-error')).textContent).toContain('not valid JSON');
    expect(screen.getByText('After.')).toBeTruthy();
  });
  it('while streaming, a half-typed one-line block waits instead of flashing an error', () => {
    render(<ProseMessage text={'Look:\n\n```visual {"comp'} streaming />);
    expect(screen.queryByTestId('chat-visual-error')).toBeNull();
  });
});

describe('the kit draws at the column width', () => {
  it('a 398px column gets a 380px drawing (text stays at its size, nothing is scaled down); an explicit width in the spec wins', async () => {
    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 398 });
    try {
      render(<ProseMessage text={fence('visual', LINE)} />);
      const art = await screen.findByTestId('chat-diagram-art');
      await waitFor(() => expect(art.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2]).toBe('380'));
      cleanup();
      const wide = JSON.stringify({ ...JSON.parse(LINE), width: 600 });
      render(<ProseMessage text={fence('visual', wide)} />);
      const art2 = await screen.findByTestId('chat-diagram-art');
      await waitFor(() => expect(art2.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2]).toBe('600'));
    } finally {
      if (orig) Object.defineProperty(HTMLElement.prototype, 'clientWidth', orig);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });
});
