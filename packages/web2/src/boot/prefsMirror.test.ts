import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { promptQueue, QUEUE_STORAGE_PREFIX } from '../composer/promptQueue';
import { agentRuns } from '../agents/agentRuns';
import { PREF_KEYS, PREF_PREFIXES, prefStorage } from './prefStorage';
import { applyRestored, startPrefsMirror } from './prefsMirror';

/* A new origin (a changed port) starts with empty localStorage; the server copy brings the preferences back. */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeServer(prefs: Record<string, string>) {
  const calls: { method: string; body?: { prefs: Record<string, string | null> } }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('/api/ui-prefs');
    const method = init?.method ?? 'GET';
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { prefs: Record<string, string | null> };
      calls.push({ method, body });
      for (const [k, v] of Object.entries(body.prefs)) (v === null ? delete prefs[k] : (prefs[k] = v));
      return json({ prefs });
    }
    calls.push({ method });
    return json({ prefs });
  }) as typeof fetch;
  return { impl, calls, prefs };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => localStorage.clear());

describe('prefsMirror', () => {
  it('empty localStorage plus server prefs: the theme is applied, the queue is held, the picks are back', async () => {
    const server = fakeServer({
      'seq.theme': 'light',
      'sequence.chatAgentPicks.v1': JSON.stringify({ c9: { agent: 'claude', model: 'opus' } }),
      [`${QUEUE_STORAGE_PREFIX}home::c9`]: JSON.stringify({ at: Date.now(), items: [{ id: 'q1', text: 'ship it', w: 'another-window' }] }),
    });
    const m = startPrefsMirror({ fetchImpl: server.impl, debounceMs: 5 });
    const restored = await m.done;
    expect(restored.sort()).toEqual(['seq.theme', 'sequence.chatAgentPicks.v1', `${QUEUE_STORAGE_PREFIX}home::c9`].sort());
    expect(localStorage.getItem('seq.theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(promptQueue.held('home::c9')).toBe(true);
    expect(promptQueue.items('home::c9').map((i) => i.text)).toEqual(['ship it']);
    expect(agentRuns.get().chatConfig?.c9?.model).toBe('opus');
    expect(server.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
    m.stop();
  });

  it('migration: a key only localStorage has is sent up once, and later writes are mirrored in one batch', async () => {
    localStorage.setItem('seq.font', 'geist');
    localStorage.setItem('unrelated.key', 'x');
    const server = fakeServer({});
    const m = startPrefsMirror({ fetchImpl: server.impl, debounceMs: 5, apply: () => undefined });
    await m.done;
    await new Promise((r) => setTimeout(r, 40));
    expect(server.prefs).toEqual({ 'seq.font': 'geist' });
    prefStorage.setItem('seq.theme', 'dark');
    prefStorage.setItem('s2.split', '0.4');
    prefStorage.setItem('not.mirrored', 'no');
    await new Promise((r) => setTimeout(r, 40));
    expect(server.prefs).toEqual({ 'seq.font': 'geist', 'seq.theme': 'dark', 's2.split': '0.4' });
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
    prefStorage.removeItem('seq.font');
    await new Promise((r) => setTimeout(r, 40));
    expect(server.prefs['seq.font']).toBeUndefined();
    m.stop();
  });

  it('a key written before the server answered is not overwritten by the restore', async () => {
    const server = fakeServer({ 'seq.theme': 'light' });
    const m = startPrefsMirror({ fetchImpl: server.impl, debounceMs: 5, apply: () => undefined });
    prefStorage.setItem('seq.theme', 'dark');
    localStorage.removeItem('seq.theme');
    const restored = await m.done;
    expect(restored).toEqual([]);
    m.stop();
  });

  it('a server that cannot be reached changes nothing and throws nothing', async () => {
    localStorage.setItem('seq.theme', 'light');
    const m = startPrefsMirror({ fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch, debounceMs: 5 });
    expect(await m.done).toEqual([]);
    expect(localStorage.getItem('seq.theme')).toBe('light');
    m.stop();
  });

  it('a key outside the allowlist from the server is not restored (negative control)', async () => {
    const server = fakeServer({ 'github.token': 'x', 'seq.theme': 'light' });
    const m = startPrefsMirror({ fetchImpl: server.impl, debounceMs: 5, apply: () => undefined });
    expect(await m.done).toEqual(['seq.theme']);
    expect(localStorage.getItem('github.token')).toBeNull();
    m.stop();
  });

  it('applyRestored with nothing to restore does nothing', () => {
    expect(() => applyRestored([])).not.toThrow();
  });

  it('a migration bigger than the server body cap goes up in chunks, and later writes still land', async () => {
    for (let i = 0; i < 17; i++) localStorage.setItem(`sequence:pq:v2:home::c${i}`, JSON.stringify({ items: [{ text: 'y'.repeat(60 * 1024) }] }));
    const puts: { size: number; keys: string[]; ok: boolean }[] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return json({ prefs: {} });
      const body = String(init?.body);
      const keys = Object.keys((JSON.parse(body) as { prefs: Record<string, unknown> }).prefs);
      if (body.length > 1_000_000) {
        puts.push({ size: body.length, keys, ok: false });
        throw new TypeError('fetch failed');
      }
      puts.push({ size: body.length, keys, ok: true });
      return json({ prefs: {} });
    }) as typeof fetch;
    const m = startPrefsMirror({ fetchImpl: impl, debounceMs: 5, apply: () => undefined });
    await m.done;
    await new Promise((r) => setTimeout(r, 60));
    prefStorage.setItem('seq.theme', 'light');
    await new Promise((r) => setTimeout(r, 60));
    m.stop();
    expect(puts.every((p) => p.ok)).toBe(true);
    expect(new Set(puts.flatMap((p) => p.keys)).size).toBe(18);
    expect(puts.some((p) => p.keys.includes('seq.theme'))).toBe(true);
  });

  it('a key the server refuses is dropped and reported, never resent, and the others still land', async () => {
    const seen: string[][] = [];
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return json({ prefs: {} });
      const keys = Object.keys((JSON.parse(String(init?.body)) as { prefs: Record<string, unknown> }).prefs);
      seen.push(keys);
      return keys.includes('seq.font') ? json({ error: 'nope' }, 400) : json({ prefs: {} });
    }) as typeof fetch;
    const warn = console.warn;
    console.warn = () => undefined;
    const m = startPrefsMirror({ fetchImpl: impl, debounceMs: 5, apply: () => undefined });
    await m.done;
    prefStorage.setItem('seq.font', 'geist');
    prefStorage.setItem('seq.theme', 'light');
    await new Promise((r) => setTimeout(r, 80));
    prefStorage.setItem('s2.split', '0.4');
    await new Promise((r) => setTimeout(r, 60));
    console.warn = warn;
    m.stop();
    expect([...m.refused]).toEqual(['seq.font']);
    expect(seen.flat().filter((k) => k === 'seq.font').length).toBeLessThanOrEqual(2);
    expect(seen.flat()).toContain('seq.theme');
    expect(seen.flat()).toContain('s2.split');
    expect(seen[seen.length - 1]).toEqual(['s2.split']);
  });

  it('the client allowlist is the server allowlist', () => {
    const server = readFileSync(resolve(process.cwd(), '../analyzer/src/server/uiPrefs.ts'), 'utf8');
    for (const k of PREF_KEYS) expect(server, k).toContain(`'${k}'`);
    for (const p of PREF_PREFIXES) expect(server, p).toContain(`'${p}'`);
  });
});
