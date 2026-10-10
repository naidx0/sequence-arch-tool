import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';
import { SETTINGS_PANES } from './settingsPanes';
import type { SettingsFacts } from './settingsSections';

/*
 * ROUND 7, A9: "Some settings don't save."
 *
 * EVERY SETTING SURVIVES A RELOAD. The subject set is derived, not listed:
 * the panel is drawn tab by tab (the tabs are read from SETTINGS_PANES), and
 * every control in it that holds a state (a checkbox, a switch, a radio, a
 * pressed button, a select) is changed once, the panel is unmounted and drawn
 * again against the same server and the same browser storage, and the
 * control must come back changed. A control added later is in the set
 * without anyone remembering to add it.
 *
 * The server is a fake that keeps what it is sent: a PUT merges its body
 * into what the next GET of that route answers, as the real routes do.
 */

type Json = Record<string, unknown>;

const FACTS: SettingsFacts = {
  repoName: 'shopfront',
  recentCount: 2,
  sessionCount: 3,
  memoryAvailable: true,
  graphNodes: 40,
  graphEdges: 30,
  unreadFiles: 0,
  paneCount: 4,
  hookCount: 0,
  pluginCount: 0,
  pluginError: null,
  pluginAskWired: false,
  mcpServerCount: 0,
};

function server() {
  const PERM = '{\n  "version": 1,\n  "default": "allow",\n  "denyStreak": 3,\n  "deny": [],\n  "ask": [],\n  "allow": []\n}\n';
  const MCP = '{\n  "servers": {}\n}\n';
  const state: Record<string, Json> = {
    '/api/ai-config': { configured: false },
    '/api/hooks': { events: [], blocking: [], declared: {}, trusted: false },
    '/api/skills': { dir: '.sequence/skills', skills: [], warnings: [], trusted: false, instructions: null },
    '/api/permissions': { path: '.sequence/permissions.json', document: JSON.parse(PERM), text: PERM, warnings: [] },
    '/api/mcp': { path: '.sequence/mcp.json', document: JSON.parse(MCP), text: MCP, warnings: [] },
    '/api/auto-approve': { root: '/repo', trusted: true, on: false, refusal: 'auto-approve is off for this repository.' },
    '/api/repo-trust': { root: '/repo', trusted: true },
    '/api/agent-settings': { includeArchitectureMap: true, allBoardTools: false },
    '/api/worktree-settings': { cap: 4, setupCommand: null },
    '/api/onboarding/providers': { providers: [] },
    '/api/acp/agents': { agents: [] },
    '/api/local/setup': { ok: true, ollama: null, models: [] },
  };
  const writes: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split('?')[0]!;
    const method = init?.method ?? 'GET';
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (!(url in state)) return json(404, { error: `no ${url}` });
    if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
      writes.push(`${method} ${url}`);
      const body = init?.body ? (JSON.parse(String(init.body)) as Json) : {};
      state[url] = { ...state[url], ...body, ...(typeof body.text === 'string' ? { document: JSON.parse(body.text) } : {}) };
      if (url === '/api/auto-approve') state[url] = { ...state[url], refusal: state[url]!.on ? null : 'auto-approve is off for this repository.' };
    }
    return json(200, state[url]);
  });
  return { fetchImpl, writes, state };
}

/** A control that holds a state, and how to read and change it. */
interface Stateful {
  key: string;
  read: () => string;
  change: () => void;
}

function statefulControls(root: HTMLElement): Stateful[] {
  const out: Stateful[] = [];
  const seen = new Map<string, number>();
  const keyOf = (el: Element, kind: string) => {
    /* Identity from what does not change with the state: the test id, the name, the value and the
       data-* attributes other than the ones that carry the state. */
    const ids = [...el.attributes]
      .filter((a) => (a.name.startsWith('data-') && !/^data-(selected|state|on|checked)$/.test(a.name)) || a.name === 'name' || (a.name === 'value' && /^(checkbox|radio)$/.test(kind)))
      .map((a) => `${a.name}=${a.value}`)
      .join(',');
    const base = `${kind}:${ids || (el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '')}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  };
  for (const el of root.querySelectorAll('input, select, [role="switch"], [role="radio"], [aria-pressed]')) {
    if ((el as HTMLInputElement).disabled) continue;
    /* A form's starting point (which provider card fills the form) is not a setting until Save. */
    if (el.closest('[data-settings-draft]')) continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      const i = el;
      out.push({ key: keyOf(el, i.type), read: () => String(i.checked), change: () => fireEvent.click(i) });
    } else if (el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'text')) {
      /* A field that saves itself when you leave it. */
      const i = el;
      const next = i.type === 'number' ? String(Number(i.value || '0') + 1) : `${i.value}r7`;
      out.push({
        key: keyOf(el, i.type),
        read: () => i.value,
        change: () => {
          fireEvent.change(i, { target: { value: next } });
          fireEvent.blur(i);
        },
      });
    } else if (el instanceof HTMLSelectElement) {
      const s = el;
      const next = [...s.options].find((o) => o.value !== s.value)?.value;
      if (next !== undefined) out.push({ key: keyOf(el, 'select'), read: () => s.value, change: () => fireEvent.change(s, { target: { value: next } }) });
    } else if (el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'radio') {
      const attr = 'aria-checked';
      out.push({ key: keyOf(el, el.getAttribute('role')!), read: () => String(el.getAttribute(attr)), change: () => fireEvent.click(el) });
    } else if (el.hasAttribute('aria-pressed')) {
      out.push({ key: keyOf(el, 'pressed'), read: () => String(el.getAttribute('aria-pressed')), change: () => fireEvent.click(el) });
    }
  }
  return out;
}

const settle = () => act(async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 15));
});

async function drawTab(fetchImpl: typeof fetch, tab: string): Promise<HTMLElement> {
  render(<SettingsPanel client={createSettingsClient(fetchImpl)} facts={FACTS} pane={tab as never} />);
  await settle();
  const button = screen.getByTestId(`settings-nav-${tab}`);
  await act(async () => fireEvent.click(button));
  await settle();
  return screen.getByTestId('settings-body');
}

beforeEach(() => {
  localStorage.clear();
  /* The desktop app (Electron) grants notifications; jsdom has none. */
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'granted', requestPermission: async () => 'granted' }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('every setting survives a reload (derived from the panel itself)', () => {
  it('finds stateful controls on the tabs at all (positive control)', { timeout: 60_000 }, async () => {
    const s = server();
    vi.stubGlobal('fetch', s.fetchImpl);
    let total = 0;
    for (const tab of SETTINGS_PANES.map((p) => p.id)) {
      total += statefulControls(await drawTab(s.fetchImpl as unknown as typeof fetch, tab)).length;
      cleanup();
    }
    expect(total).toBeGreaterThanOrEqual(6);
  });

  for (const tab of SETTINGS_PANES.map((p) => p.id)) {
    it(`${tab}: each control, changed, is changed after a reload`, { timeout: 120_000 }, async () => {
      const s = server();
      vi.stubGlobal('fetch', s.fetchImpl);
      const first = statefulControls(await drawTab(s.fetchImpl as unknown as typeof fetch, tab));
      const lost: string[] = [];
      const checked: string[] = [];
      for (const c of first.map((x) => x.key)) {
        cleanup();
        const now = statefulControls(await drawTab(s.fetchImpl as unknown as typeof fetch, tab)).find((x) => x.key === c);
        if (!now) continue;
        const before = now.read();
        await act(async () => now.change());
        await settle();
        const after = now.read();
        if (after === before) continue; /* an action that asks first (a confirm) is not a setting change */
        checked.push(c);
        cleanup();
        const again = statefulControls(await drawTab(s.fetchImpl as unknown as typeof fetch, tab)).find((x) => x.key === c);
        if (!again || again.read() !== after) lost.push(`${c}: ${before} -> ${after}, after reload ${again ? again.read() : 'gone'}`);
      }
      console.log(`settings persist ${tab}: ${checked.length} controls changed and reloaded: ${checked.join(' | ')}`);
      expect(lost).toEqual([]);
    });
  }
});
