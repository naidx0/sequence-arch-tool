// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UISpec } from '@sequence/genui';

import { Emitter, type GenUIAgent } from './agent';
import { GenUISavedSurface } from './GenUISavedSurface';
import { GenUISurface } from './GenUISurface';
import { GenUISession } from './session';
import { listChatSurfaces, persistSettled, saveChatSurface } from './surfaceStore';

/* Persisted surfaces: the final spec is saved when a surface settles, and a reload draws it once, identically,
   with no motion and with its buttons off. */

class Quiet extends Emitter implements GenUIAgent {
  start(): void {}
  sendAction(): void {}
  async repair(): Promise<null> {
    return null;
  }
}

const OPS =
  '{"op":"add","path":"/actions/go","value":{"description":"Go"}}\n' +
  '{"op":"el","id":"card","type":"Card","props":{"title":"Upgrade auth","badge":"Running"},"children":["tl","acts"]}\n' +
  '{"op":"el","id":"tl","type":"Timeline","children":["a","b"]}\n' +
  '{"op":"el","id":"a","type":"TimelineItem","props":{"title":"Plan the change","status":"done"}}\n' +
  '{"op":"el","id":"b","type":"TimelineItem","props":{"title":"Run tests","status":"running"}}\n' +
  '{"op":"el","id":"acts","type":"Actions","children":["go"]}\n' +
  '{"op":"el","id":"go","type":"Button","props":{"label":"Open PR","action":{"name":"go"},"variant":"primary"}}\n';

function settledSpecFixture(): UISpec {
  return {
    root: 'card',
    state: {},
    actions: { go: { description: 'Go' } },
    meta: {},
    elements: {
      card: { type: 'Card', props: { title: 'Upgrade auth' }, children: ['tl', 'acts'] },
      tl: { type: 'Timeline', props: {}, children: ['a', 'b'] },
      a: { type: 'TimelineItem', props: { title: 'Plan the change', status: 'done' } },
      b: { type: 'TimelineItem', props: { title: 'Run tests', status: 'done' } },
      acts: { type: 'Actions', props: {}, children: ['go'] },
      go: { type: 'Button', props: { label: 'Open PR', action: { name: 'go' }, variant: 'primary' } },
    },
  };
}

async function settle(onSettled?: (id: string, spec: UISpec) => void): Promise<{ session: GenUISession; spec: UISpec }> {
  const agent = new Quiet();
  const session = new GenUISession(agent, { onSettled });
  agent.emit({ kind: 'ui.text', surfaceId: 's', chunk: OPS });
  agent.emit({ kind: 'ui.end', surfaceId: 's' });
  await new Promise((r) => setTimeout(r, 60));
  return { session, spec: session.get().surfaces[0]!.spec };
}

describe('the session hands the final spec to onSettled', () => {
  it('once per pass, the settled spec, and not while the pass is still open', async () => {
    const seen: [string, UISpec][] = [];
    const agent = new Quiet();
    const session = new GenUISession(agent, { onSettled: (id, spec) => void seen.push([id, spec]) });
    agent.emit({ kind: 'ui.text', surfaceId: 's', chunk: OPS });
    await new Promise((r) => setTimeout(r, 40));
    expect(seen, 'nothing is saved mid-stream').toEqual([]);
    agent.emit({ kind: 'ui.end', surfaceId: 's' });
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe('s');
    expect(seen[0]![1]).toEqual(session.get().surfaces[0]!.spec);
    expect(Object.keys(seen[0]![1].elements).sort()).toEqual(['a', 'acts', 'b', 'card', 'go', 'tl']);
  });

  it('a throwing saver does not stop the session', async () => {
    const { session } = await settle(() => {
      throw new Error('disk full');
    });
    expect(session.get().surfaces[0]!.phase).toBe('settled');
  });
});

describe('a saved surface reloads identical, still, and inert', () => {
  let animate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    animate = vi.fn(() => ({ cancel() {}, onfinish: null }));
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  });
  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  const strip = (html: string): string =>
    html
      .replace(/ data-restored="true"/g, '')
      .replace(/ disabled=""/g, '')
      .replace(/ title="[^"]*"/g, '')
      .replace(/ data-phase="[^"]*"/g, '')
      /* the busy mark is the app's ticking spinner: its frame glyph differs from one read to the next */
      .replace(/<span class="act-ink">[^<]*(<[^>]*>[^<]*)*?<\/span>/g, '<span class="act-ink"></span>');

  it('draws the same card as the live one, with no animation (a live one animates: the control)', async () => {
    const { session, spec } = await settle();
    const live = render(<GenUISurface view={session.get().surfaces[0]!} busy={false} onClick={() => {}} />);
    const liveHtml = live.container.querySelector('.gu-surface')!.outerHTML;
    expect(animate.mock.calls.length, 'positive control: a live surface does animate').toBeGreaterThan(0);
    live.unmount();
    animate.mockClear();

    const saved = render(<GenUISavedSurface saved={{ surface: 's', spec: JSON.parse(JSON.stringify(spec)) }} />);
    await new Promise((r) => setTimeout(r, 400));
    expect(animate, 'nothing replays').not.toHaveBeenCalled();
    expect(saved.container.querySelector('.gu-surface')!.getAttribute('data-restored')).toBe('true');
    expect(strip(saved.container.querySelector('.gu-surface')!.outerHTML)).toBe(strip(liveHtml));
  });

  it('its buttons are disabled and say why', () => {
    const { container } = render(<GenUISavedSurface saved={{ surface: 's', spec: settledSpecFixture() }} />);
    const btn = screen.getByText('Open PR').closest('button')!;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('This turn has finished');
    expect(container.querySelector('.gu-repair')).toBeNull();
  });

  it('a spec edited on disk draws skeletons for the bad nodes, never the junk', () => {
    const spec = settledSpecFixture();
    spec.elements.b = { type: 'Marquee', props: { text: 'evil' } };
    const { container } = render(<GenUISavedSurface saved={{ surface: 's', spec }} />);
    expect(container.textContent).not.toContain('evil');
    expect(container.querySelector('.gu-skel')).not.toBeNull();
  });
});

describe('surfaceStore', () => {
  it('lists a chat, saves with the keys the server wants, and swallows failures', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ surfaces: [{ chat: 'c1', turn: 't1', surface: 's', saved: 1, title: 'Upgrade auth', spec: settledSpecFixture() }] }));
    };
    const rows = await listChatSurfaces('c1', f);
    expect(rows.map((r) => [r.turn, r.surface, r.title])).toEqual([['t1', 's', 'Upgrade auth']]);
    expect(calls[0]!.url).toBe('/api/genui/surfaces?chat=c1');

    expect(await saveChatSurface('c1', 't1', 's', settledSpecFixture(), f)).toBe(true);
    expect(JSON.parse(String(calls[1]!.init!.body))).toMatchObject({ chat: 'c1', turn: 't1', surface: 's' });

    persistSettled('c1', 't2', f)('s2', settledSpecFixture());
    await Promise.resolve();
    expect(JSON.parse(String(calls[2]!.init!.body))).toMatchObject({ turn: 't2', surface: 's2' });

    const down = async (): Promise<Response> => {
      throw new Error('offline');
    };
    expect(await listChatSurfaces('c1', down)).toEqual([]);
    expect(await saveChatSurface('c1', 't', 's', settledSpecFixture(), down)).toBe(false);
    expect(await listChatSurfaces('c1', async () => new Response('no', { status: 500 }))).toEqual([]);
  });

  it('a chat id the server cannot hold is never asked about', async () => {
    const f = vi.fn();
    expect(await listChatSurfaces('Not A Chat', f)).toEqual([]);
    expect(await saveChatSurface('x/y', 't', 's', settledSpecFixture(), f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
