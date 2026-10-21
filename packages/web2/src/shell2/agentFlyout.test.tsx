import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { createRef, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { AIM_MS, ModelMenu, aimingAtFlyout, flyoutPlacement } from './ModelMenu';

/*
 * Owner, 2026-10-10, on the model picker: "there's no agent connected, that's
 * very key: connect an agent. Make sure it's easy to connect everything just
 * from this section. Easy to choose models. You sign in when you have to. You
 * can click on Codex and then it opens up to the right all the models you can
 * choose. Another expandable; I think that's the best format."
 *
 * The built state is the one he described: the picker with no agent connected
 * (every agent listed with its state, Connect or Sign in on the row), and the
 * picker with a connected Codex whose row opens its models to the right. The
 * server is a fake (no live Codex or Claude): the routes the real one has, with
 * canned answers, the same shape connectedCodexPicker.test.tsx uses.
 */

const SID = 'chat-1';
const READY_CODEX = { id: 'codex', label: 'Codex', installed: true, version: '0.153.4', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: 'npm i -g @openai/codex' };
const SIGNED_OUT_CLAUDE = { id: 'claude', label: 'Claude Code', installed: true, version: '2.1.0', state: 'signIn', signInCommand: 'claude auth login', installHint: 'npm i -g @anthropic-ai/claude-code' };
const MISSING_GEMINI = { id: 'gemini', label: 'Gemini CLI', installed: false, version: null, state: 'install', signInCommand: 'gemini', installHint: 'npm i -g @google/gemini-cli' };
const MODELS = {
  codex: [
    { id: 'gpt-6-astra', name: 'GPT-6-Astra', efforts: ['low', 'medium', 'high'], isDefault: true },
    { id: 'gpt-6-lite', name: 'GPT-6-Lite', efforts: ['low'] },
  ],
  claude: [{ id: 'claude-opus-5', name: 'Claude Opus 5', efforts: ['medium'], isDefault: true }],
};

function stubServer(opts: { registered: string[]; providers: Record<string, unknown>[] }) {
  const registered = [...opts.registered];
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      const json = (status: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } }));
      if (url === '/api/acp/agents' && method === 'GET') return json(200, { agents: registered.map((id) => ({ id, label: id })) });
      if (url === '/api/acp/agents/connect') {
        const id = JSON.parse(String(init?.body)).provider as string;
        registered.push(id);
        return json(200, { agent: { id } });
      }
      if (url.startsWith('/api/onboarding/providers')) return json(200, { providers: opts.providers.filter((p) => !registered.includes(String(p.id)) || true) });
      if (url.startsWith('/api/acp/capabilities')) {
        const ref = new URL(url, 'http://x').searchParams.get('agentRef') ?? '';
        return json(200, { agentRef: ref, models: (MODELS as Record<string, unknown[]>)[ref] ?? [], efforts: [], commands: [], skills: [] });
      }
      return json(404, {});
    }),
  );
  return calls;
}

function Host({ onClose, onPick }: { onClose?: () => void; onPick?: () => void }) {
  const [open, setOpen] = useState(true);
  const [run, setRun] = useState<string | undefined>(agentRuns.get().agents?.[SID] || undefined);
  agentRuns.subscribe(() => setRun(agentRuns.get().agents?.[SID] || undefined));
  return (
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open={open}
        onTrigger={() => setOpen((v) => !v)}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        sessionId={SID}
        agentRun={run}
        profiles={[]}
        pickModel={() => onPick?.()}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Connect agent"
        modelChipShort="Connect agent"
        modelChipTitle="Connect agent"
        effortLabel="Medium"
        modes={[{ key: 'plan', label: 'Plan', desc: 'Plans and teaches, no edits', icon: 'map' }]}
        currentMode="plan"
        onMode={() => {}}
      />
    </StoreProvider>
  );
}

const row = (ref: string) => document.querySelector<HTMLElement>(`[data-testid="s2-agent-row"][data-agent="${ref}"]`);
const agentRowFor = (ref: string) => waitFor(() => {
  const el = row(ref);
  if (!el) throw new Error(`no row for ${ref}`);
  return el;
}, { timeout: 4000 });

/* The menu pulls ConnectAgents and agentRunner in with dynamic import(), which Vite transforms on first use. Under load that
   first transform outlasts any findBy/waitFor window, so the picker's rows "never appear". Load them before the first test
   instead of racing them: the tests then wait only on the fake server's answers. */
beforeAll(async () => {
  await Promise.all([import('./ConnectAgents'), import('../agents/agentRunner')]);
}, 120_000);

beforeEach(() => {
  resetSignInState();
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {}, registered: undefined }));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

describe('the picker with no agent connected: Connect an agent, in place', () => {
  it('names registration honestly when a registered agent needs sign-in', async () => {
    stubServer({ registered: ['claude'], providers: [SIGNED_OUT_CLAUDE] });
    render(<Host />);
    const registered = await agentRowFor('claude');
    expect(within(registered).getByTestId('s2-agent-note').textContent).toBe('Registered');
    expect(await screen.findByTestId('s2-signin-claude')).toBeTruthy();
  });
  it('lists every known agent with its state, and offers Connect or Sign in only where that is the next step', async () => {
    stubServer({ registered: [], providers: [READY_CODEX, SIGNED_OUT_CLAUDE, MISSING_GEMINI] });
    render(<Host />);
    const section = await screen.findByTestId('s2-connect');
    await within(section).findByTestId('s2-connect-gemini');
    expect(section.querySelector('.s2-menu-gh')!.textContent).toBe('Connect an agent');
    expect(within(section).getByTestId('s2-connect-note-codex').textContent).toBe('Ready, ChatGPT');
    expect(within(section).getByTestId('s2-connect-note-claude').textContent).toBe('Needs sign-in');
    expect(within(section).getByTestId('s2-connect-note-gemini').textContent).toBe('Not installed');
    /* Nothing connected: no agent row, so no flyout to open. */
    expect(within(section).queryByTestId('s2-agent-row')).toBeNull();
    expect(within(section).getByTestId('s2-connect-go-codex')).toBeTruthy();
    expect(within(section).getByTestId('s2-signin-claude')).toBeTruthy();
    expect(within(section).queryByTestId('s2-signin-codex')).toBeNull();
    expect(within(section).queryByTestId('s2-signin-gemini')).toBeNull();
  });

  it('Connect registers the agent through the Agents pane route, then opens its models to choose from', async () => {
    const calls = stubServer({ registered: [], providers: [READY_CODEX] });
    render(<Host />);
    fireEvent.click(await screen.findByTestId('s2-connect-go-codex'));
    const flyout = await screen.findByTestId('s2-agent-flyout', {}, { timeout: 4000 });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/acp/agents/connect']);
    expect(flyout.getAttribute('data-agent')).toBe('codex');
    expect(within(flyout).getAllByTestId('agent-model').map((r) => r.getAttribute('data-model'))).toEqual(['gpt-6-astra', 'gpt-6-lite']);
    /* It is this chat's agent already, and the menu is still open for the choice. */
    expect(agentRuns.get().agents?.[SID]).toBe('codex');
    expect(screen.getByTestId('s2-model-menu')).toBeTruthy();
    /* Connected: it is a row now, not under Connect. */
    expect(row('codex')).toBeTruthy();
    expect(screen.queryByTestId('s2-connect-codex')).toBeNull();
  });
});

describe('a connected agent is an expandable that opens its models to the right', () => {
  async function connectedCodex(onClose?: () => void) {
    stubServer({ registered: ['codex'], providers: [READY_CODEX] });
    render(<Host onClose={onClose} />);
    return agentRowFor('codex');
  }

  it('shows the agent as one row with a chevron; its models appear only when it is opened', async () => {
    const r = await connectedCodex();
    expect(r.getAttribute('aria-haspopup')).toBe('menu');
    expect(r.getAttribute('aria-expanded')).toBe('false');
    expect(r.querySelector('svg[data-icon="chevr"]')).toBeTruthy();
    expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(r);
    const flyout = await screen.findByTestId('s2-agent-flyout');
    expect(r.getAttribute('aria-expanded')).toBe('true');
    expect(flyout.getAttribute('role')).toBe('menu');
    expect(flyout.getAttribute('aria-label')).toBe('Codex models');
    /* Placed beside the menu (the placement ran for this render's row, not a stale one): a side and a position are set. */
    expect(flyout.getAttribute('data-side')).toBe('right');
    expect(flyout.style.left).not.toBe('');
    expect(flyout.style.top).not.toBe('');
    expect(within(flyout).getAllByRole('menuitemradio').map((m) => m.querySelector('.s2-mi-name')!.textContent)).toEqual(['GPT-6 Astra', 'GPT-6 Lite']);
    /* The same menu surface and the same rows as the menu it hangs off. */
    expect(flyout.classList.contains('s2-menu')).toBe(true);
    for (const m of within(flyout).getAllByRole('menuitemradio')) expect(m.classList.contains('s2-mi')).toBe(true);
  });

  it('hover opens it and leaving closes it; pointing at another row of the menu lets go of it', async () => {
    const r = await connectedCodex();
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.pointerEnter(r);
    expect(await screen.findByTestId('s2-agent-flyout')).toBeTruthy();
    fireEvent.pointerOver(screen.getByTestId('s2-add-model'));
    await waitFor(() => expect(screen.queryByTestId('s2-agent-flyout')).toBeNull());
    fireEvent.pointerEnter(r);
    expect(await screen.findByTestId('s2-agent-flyout')).toBeTruthy();
    fireEvent.pointerLeave(r);
    await waitFor(() => expect(screen.queryByTestId('s2-agent-flyout')).toBeNull(), { timeout: 1000 });
  });

  it('a click pins it: the pointer leaving does not close it; a second click does', async () => {
    const r = await connectedCodex();
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(r);
    await screen.findByTestId('s2-agent-flyout');
    fireEvent.pointerLeave(r);
    await act(async () => {
      await new Promise((res) => setTimeout(res, 300));
    });
    expect(screen.getByTestId('s2-agent-flyout')).toBeTruthy();
    fireEvent.click(r);
    expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
  });

  it('ArrowRight opens it with focus on the model in force; ArrowLeft closes it and hands focus back to the row', async () => {
    const onClose = vi.fn();
    const r = await connectedCodex(onClose);
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    r.focus();
    fireEvent.keyDown(r, { key: 'ArrowRight' });
    const flyout = await screen.findByTestId('s2-agent-flyout');
    expect(document.activeElement).toBe(within(flyout).getAllByTestId('agent-model')[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(flyout).getAllByTestId('agent-model')[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
    expect(document.activeElement).toBe(r);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('s2-model-menu')).toBeTruthy();
  });

  it('Escape in the flyout closes the flyout only, not the menu, and the page\'s own Escape listener never sees it', async () => {
    const onClose = vi.fn();
    const r = await connectedCodex(onClose);
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    const page = vi.fn();
    document.addEventListener('keydown', page);
    try {
      fireEvent.keyDown(r, { key: 'ArrowRight' });
      const flyout = await screen.findByTestId('s2-agent-flyout');
      page.mockClear();
      fireEvent.keyDown(within(flyout).getAllByTestId('agent-model')[0]!, { key: 'Escape' });
      expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
      expect(document.activeElement).toBe(r);
      expect(onClose).not.toHaveBeenCalled();
      expect(page).not.toHaveBeenCalled();
      /* A second Escape, with no flyout, closes the menu as before. */
      fireEvent.keyDown(r, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', page);
    }
  });

  it('picking a model selects that agent and model for this chat, and the menu stays open for the effort', async () => {
    const onClose = vi.fn();
    const r = await connectedCodex(onClose);
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(r);
    const flyout = await screen.findByTestId('s2-agent-flyout');
    fireEvent.click(within(flyout).getAllByTestId('agent-model')[1]!);
    expect(agentRuns.get().agents?.[SID]).toBe('codex');
    expect(agentRuns.get().config?.codex?.model).toBe('gpt-6-lite');
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(within(screen.getByTestId('s2-agent-flyout')).getAllByTestId('agent-model')[1]!.getAttribute('aria-checked')).toBe('true'));
    expect(row('codex')!.querySelector('[data-testid="s2-agent-note"]')!.textContent).toBe('GPT-6 Lite');
    /* The effort in the foot is now the picked model's. */
    expect(screen.getAllByTestId('agent-effort').map((b) => b.getAttribute('data-effort'))).toEqual(['low']);
  });

  it('closing the menu closes its flyout', async () => {
    const r = await connectedCodex();
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    fireEvent.click(r);
    await screen.findByTestId('s2-agent-flyout');
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    expect(screen.queryByTestId('s2-agent-flyout')).toBeNull();
    expect(screen.queryByTestId('s2-model-menu')).toBeNull();
  });
});

describe('where the flyout goes', () => {
  const view = { w: 1440, h: 900 };
  const size = { w: 320, h: 160 };
  it('opens to the right of the menu, top-aligned with its row', () => {
    expect(flyoutPlacement({ top: 500 }, { left: 280, right: 652 }, size, view)).toEqual({ left: 658, top: 494, side: 'right' });
  });
  it('flips to the left of the menu when there is no room on the right', () => {
    const at = flyoutPlacement({ top: 500 }, { left: 1000, right: 1400 }, size, view);
    expect(at.side).toBe('left');
    expect(at.left).toBe(1000 - 6 - 320);
  });
  it('stays inside the window above and below, and takes the roomier side when neither fits', () => {
    expect(flyoutPlacement({ top: 880 }, { left: 280, right: 652 }, size, view).top).toBe(900 - 8 - 160);
    expect(flyoutPlacement({ top: -40 }, { left: 280, right: 652 }, size, view).top).toBe(8);
    const narrow = flyoutPlacement({ top: 100 }, { left: 100, right: 500 }, { w: 320, h: 100 }, { w: 640, h: 900 });
    expect(narrow.side).toBe('right');
    expect(narrow.left + 320).toBeLessThanOrEqual(640 - 8);
  });
});

describe('the flyout keeps the picker\'s motion and the kit', () => {
  const css = fs.readFileSync(path.join(__dirname, 'modelMenu.css'), 'utf8');
  it('animates with the surface switch tokens, in and out, and turns it off under reduced motion', () => {
    expect(css).toMatch(/\.s2-menu\.s2-menu-fly \{[^}]*animation: s2-fly-in var\(--s2-switch-dur\) var\(--s2-switch-ease\);/);
    expect(css).toMatch(/\.s2-menu\.s2-menu-fly\[data-state='closing'\] \{\s*animation: s2-fly-out var\(--s2-switch-dur\) var\(--s2-switch-ease\) forwards;/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.s2-menu.s2-menu-fly');
  });
  it('draws no new button type: the connect actions are the kit\'s s2-btn, the rows s2-mi', async () => {
    stubServer({ registered: [], providers: [READY_CODEX, SIGNED_OUT_CLAUDE] });
    render(<Host />);
    const section = await screen.findByTestId('s2-connect');
    await within(section).findByTestId('s2-signin-claude');
    for (const b of section.querySelectorAll('button')) expect(b.className).toMatch(/\bs2-(mi|btn)\b/);
  });
});

describe('review fixes: its own layer, motion fenced, menu aim, the mode hint', () => {
  it('the flyout is a layer on the page, not inside the composer, and its row names it (aria-controls)', async () => {
    stubServer({ registered: ['codex'], providers: [READY_CODEX] });
    render(<Host />);
    const r = await agentRowFor('codex');
    await waitFor(() => expect(agentRuns.get().caps?.codex).toBeTruthy());
    expect(r.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(r);
    const flyout = await screen.findByTestId('s2-agent-flyout');
    expect(flyout.closest('.s2-anchor')).toBeNull();
    expect(flyout.closest('.s2-fly-layer')!.parentElement).toBe(document.body);
    expect(r.getAttribute('aria-controls')).toBe(flyout.id);
    expect(document.getElementById(flyout.id)).toBe(flyout);
  });

  it('under reduced motion nothing animates: every flyout animation sits inside no-preference, none outside it', () => {
    const css = fs.readFileSync(path.join(__dirname, 'modelMenu.css'), 'utf8');
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf('@keyframes s2-fly-in {', start);
    const outside = css.slice(0, start) + css.slice(end);
    /* An `animation` declaration on a flyout selector outside the fence would win over the reduce block above it. */
    const rules = [...outside.matchAll(/([^{}]*s2-menu-fly[^{}]*)\{([^}]*)\}/g)].filter((m) => /animation(-name)?:/.test(m[2]!) && !/animation:\s*none|s2-check-in/.test(m[2]!));
    expect(rules.map((m) => m[1]!.trim())).toEqual([]);
  });

  it('aimingAtFlyout: inside the triangle from the last point to the flyout\'s near corners, not outside it', () => {
    const fly = { left: 658, right: 978, top: 400, bottom: 600 };
    const from = { x: 500, y: 450 };
    expect(aimingAtFlyout({ x: 560, y: 500 }, from, fly, 'right')).toBe(true);
    expect(aimingAtFlyout({ x: 560, y: 700 }, from, fly, 'right')).toBe(false);
    expect(aimingAtFlyout({ x: 400, y: 450 }, from, fly, 'right')).toBe(false);
  });

  /* The reviewer's diagonal: from the first agent's row down and to the right toward the flyout's lower part, across the
     second agent's row. Rects are stubbed (jsdom has no layout). */
  async function twoAgents() {
    stubServer({ registered: ['claude', 'codex'], providers: [READY_CODEX] });
    render(<Host />);
    const a = await agentRowFor('claude');
    const b = await agentRowFor('codex');
    await waitFor(() => expect(agentRuns.get().caps?.codex && agentRuns.get().caps?.claude).toBeTruthy());
    const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} }) as DOMRect;
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const id = this.getAttribute('data-testid');
      if (id === 's2-agent-flyout') return rect(658, 380, 320, 240);
      if (id === 's2-model-menu') return rect(332, 400, 320, 330);
      if (this === a) return rect(340, 420, 300, 30);
      if (this === b) return rect(340, 452, 300, 30);
      return real.call(this);
    });
    return { a, b };
  }
  const ptr = (el: Element, type: string, x: number, y: number) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })));

  it('a diagonal toward the flyout across another agent\'s row keeps the open flyout on the first agent', async () => {
    const { a, b } = await twoAgents();
    const menu = screen.getByTestId('s2-model-menu');
    ptr(a, 'pointerover', 600, 435);
    await screen.findByTestId('s2-agent-flyout');
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('claude');
    /* The aim logic reads the clock (setTimeout and performance.now): it is the test's, so a loaded machine cannot stretch
       the "60ms" the pointer is on the second row past the aim delay. */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    for (let i = 0; i < 6; i++) ptr(menu, 'pointermove', 600 + i * 6, 435 + i * 2);
    /* Across the second row, still on the way: inside the triangle to the flyout's near corners. */
    ptr(b, 'pointerover', 640, 470);
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('claude');
    /* Into the flyout: it is still there. */
    ptr(screen.getByTestId('s2-agent-flyout'), 'pointerover', 700, 480);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('claude');
  });

  it('a pointer still crossing the other row toward the flyout, slowly, stays on the first agent; once it stops it switches', async () => {
    const { a, b } = await twoAgents();
    const menu = screen.getByTestId('s2-model-menu');
    ptr(a, 'pointerover', 600, 435);
    await screen.findByTestId('s2-agent-flyout');
    for (let i = 0; i < 4; i++) ptr(menu, 'pointermove', 600 + i * 3, 436 + i);
    /* The aim logic reads the clock (setTimeout and performance.now), so the clock is the test's: a real 30ms sleep takes
       longer under load and the pointer would then be "still" by wall time. Well over the delay on the row, never still long. */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    ptr(b, 'pointerover', 620, 460);
    for (let i = 0; i < 14; i++) {
      await act(async () => {
        vi.advanceTimersByTime(30);
      });
      ptr(menu, 'pointermove', 622 + i * 2, 461 + i);
    }
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('claude');
    /* It stops: the next ask finds the pointer still for the delay, and switches. */
    await act(async () => {
      vi.advanceTimersByTime(AIM_MS * 3);
    });
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('codex');
  });

  it('a pointer that rests on the other agent\'s row does switch to it, after the delay', async () => {
    const { a, b } = await twoAgents();
    const menu = screen.getByTestId('s2-model-menu');
    ptr(a, 'pointerover', 600, 435);
    await screen.findByTestId('s2-agent-flyout');
    /* The delay is the test's clock, not a window the machine's load can outrun. */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    for (let i = 0; i < 4; i++) ptr(menu, 'pointermove', 620 + i, 440 + i);
    ptr(b, 'pointerover', 640, 470);
    await act(async () => {
      vi.advanceTimersByTime(AIM_MS * 3);
    });
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('codex');
  });

  it('a click opens its flyout and a row that slides under the still pointer (the menu grew) does not take it; moving does', async () => {
    const { a, b } = await twoAgents();
    const menu = screen.getByTestId('s2-model-menu');
    fireEvent.click(a, { clientX: 400, clientY: 435, detail: 1 });
    await screen.findByTestId('s2-agent-flyout');
    ptr(b, 'pointerover', 400, 435);
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('claude');
    for (let i = 0; i < 4; i++) ptr(menu, 'pointermove', 400 - i, 440);
    ptr(b, 'pointerover', 380, 470);
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('codex');
  });

  it('moving away from the flyout (not aiming) switches at once', async () => {
    const { a, b } = await twoAgents();
    const menu = screen.getByTestId('s2-model-menu');
    ptr(a, 'pointerover', 400, 435);
    await screen.findByTestId('s2-agent-flyout');
    for (let i = 0; i < 4; i++) ptr(menu, 'pointermove', 400 - i, 440);
    ptr(b, 'pointerover', 380, 470);
    expect(screen.getByTestId('s2-agent-flyout').getAttribute('data-agent')).toBe('codex');
  });

  it('the mode icon\'s menu carries the Shift+Tab hint (Cycle modes) the popup\'s Mode section used to', () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    const head = screen.getByTestId('s2-quickmode-head');
    expect(head.textContent).toContain('Cycle modes');
    expect(head.querySelector('.s2-kbd')!.textContent).toBe('⇧ Tab');
  });
});
