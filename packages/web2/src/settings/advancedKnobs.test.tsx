/* ══════════════════════════════════════════════════════════════════════════
   APP-01: THE ADVANCED KNOBS TAKE ANY TEXT, AND TYPING DOES NOT RE-RENDER THE PANEL
   packages/web2/src/settings/advancedKnobs.test.tsx

   A renderer died while someone typed into Timeout / Retries (main.log
   2026-10-17, `crashed exitCode=7`). The cause is native and not reproduced;
   what this file locks is the part that is ours: every keystroke used to
   re-render the 2,800-line panel, and the fields now keep the RAW STRING and
   let go of the panel until the reader leaves the box.
   ══════════════════════════════════════════════════════════════════════════ */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GetAiConfigResponse } from '@sequence/api-types';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';
import { KNOBS } from './knobs';

/* Counts SbIcon renders: the nav draws one per tab, so a panel re-render shows up here and a knob-row-only render does not. */
const renders = vi.hoisted(() => ({ icons: 0 }));
vi.mock('./sbParts', async (orig) => {
  const real = await orig<typeof import('./sbParts')>();
  return {
    ...real,
    SbIcon: (props: Parameters<typeof real.SbIcon>[0]) => {
      renders.icons++;
      return real.SbIcon(props);
    },
  };
});

afterEach(cleanup);

const CONFIGURED = {
  configured: true,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: '••••9f3a',
  defaultProfileId: 'claude',
  profiles: [
    { id: 'claude', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '••••9f3a' },
  ],
} as unknown as GetAiConfigResponse;

function makeClient() {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = url.includes('/api/ai-config')
      ? CONFIGURED
      : url.includes('/api/hooks')
        ? { events: [], blocking: [], declared: {}, trusted: false }
        : { path: '', exists: false, text: '', warnings: [], document: {} };
    void init;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSettingsClient(fetchImpl);
}

async function openAdvanced() {
  render(<SettingsPanel pane="models" client={makeClient()} />);
  fireEvent.click((await screen.findAllByTestId('settings-profile-edit'))[0]!);
  fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
  await screen.findByTestId('settings-advanced');
}

/** mulberry32: a seeded generator, so a failure replays exactly. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const POOL = ['0', '1', '2', '3', '4', '5', '7', '9', '.', '-', '+', 'e', 'E', ' ', ',', 'x', 'a', 'N', '∞', '٣', '💥', '\t', '/', '|', '<', '%'];
const SPECIALS = ['Infinity', '-Infinity', 'NaN', '1e999', '0x10', '9'.repeat(20), '-0', '.', '', '   '];

function randomText(next: () => number): string {
  if (next() < 0.15) return SPECIALS[Math.floor(next() * SPECIALS.length)]!;
  const len = Math.floor(next() * 21); // 0..20
  let s = '';
  for (let i = 0; i < len; i++) s += POOL[Math.floor(next() * POOL.length)];
  return s;
}

describe('Advanced knobs (APP-01)', () => {
  it('fuzz: any 0-20 character text in any numeric field never throws, never unmounts the panel, and is kept as typed', async () => {
    await openAdvanced();
    const next = prng(0x5eed01);
    let typed = 0;
    for (const k of KNOBS) {
      const box = screen.getByTestId(`settings-knob-${k.key}`) as HTMLInputElement;
      for (let i = 0; i < 60; i++) {
        const text = randomText(next);
        expect(() => fireEvent.change(box, { target: { value: text } })).not.toThrow();
        expect(box.value).toBe(text);
        if (i % 3 === 0) expect(() => fireEvent.blur(box)).not.toThrow();
        expect(screen.getByTestId('settings-panel')).toBeTruthy();
        expect(screen.queryByTestId('panel-error')).toBeNull();
        typed++;
      }
    }
    expect(typed).toBe(KNOBS.length * 60);
  });

  it('typing into a knob does not re-render the panel (the row is memoised and keeps its own text)', async () => {
    await openAdvanced();
    const box = screen.getByTestId('settings-knob-timeoutMs') as HTMLInputElement;
    const before = renders.icons;
    for (const text of ['1', '12', '120', '1200', '12000', '120000']) {
      fireEvent.change(box, { target: { value: text } });
      expect(box.value).toBe(text);
    }
    expect(renders.icons - before).toBe(0);
  });

  it('what was typed (without leaving the box) is what Save sends', async () => {
    const calls: unknown[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT') calls.push(JSON.parse(String(init.body)));
      const body = url.includes('/api/ai-config') ? CONFIGURED : { events: [], blocking: [], declared: {}, trusted: false, path: '', exists: false, text: '', warnings: [], document: {} };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    render(<SettingsPanel pane="models" client={createSettingsClient(fetchImpl)} />);
    fireEvent.click((await screen.findAllByTestId('settings-profile-edit'))[0]!);
    fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
    fireEvent.change(screen.getByTestId('settings-knob-timeoutMs'), { target: { value: '120000' } });
    fireEvent.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(calls.length).toBe(1));
    const sent = calls[0] as { profiles: { params?: Record<string, number> }[] };
    expect(sent.profiles[0]!.params).toEqual({ timeoutMs: 120000 });
  });
});
