import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { resetSnapshotsForTest } from '../v3/sessionSnapshots';
import { SessionPanel } from './SessionPanel';

/* SPEED LANE wiring: the sidebar warms a chat only after the pointer rests; the shell and the
   sidebar take the run store through the narrow hooks (agents/railRuns.ts). */

const chat = (id: string, title: string): SessionIndexEntry => ({ id, title, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }) as SessionIndexEntry;
const INDEX = [chat('c1', 'One'), chat('c2', 'Two'), chat('c3', 'Three')];

function mount() {
  const reads: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /^\/api\/sessions\/([^/?]+)$/.exec(url);
    if (m && (init?.method ?? 'GET') === 'GET') {
      reads.push(m[1]!);
      return new Response(JSON.stringify({ chat: { version: 2, sessionId: m[1], turns: [] }, meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions') {
      return new Response(JSON.stringify({ index: { version: 1, activeId: 'c1', sessions: INDEX }, scope: 'workspace', repos: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <StoreProvider store={createStore({})}>
      <SessionPanel client={createSessionsClient(fetchImpl)} />
    </StoreProvider>,
  );
  return reads;
}

describe('hover warm', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSnapshotsForTest();
  });

  it('reads a chat only after the pointer rests on its row; sweeping past reads nothing', async () => {
    const reads = mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-session').length).toBeGreaterThan(1));
    const hit = (title: string) => screen.getAllByTestId('s2-session').map((r) => r.querySelector('.s2-it-hit') as HTMLElement).find((b) => b.textContent?.includes(title))!;
    reads.length = 0;
    const two = hit('Two');
    fireEvent.pointerEnter(two);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    fireEvent.pointerLeave(two);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(reads).not.toContain('c2');
    fireEvent.pointerEnter(hit('Three'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(reads).toContain('c3');
  });
});

describe('the run store is taken through the narrow hooks', () => {
  const src = (f: string) => fs.readFileSync(path.resolve(__dirname, f), 'utf8');
  it('Shell2 asks "is anything running" and SessionPanel takes the rail view; neither subscribes to the whole store', () => {
    const shell = src('Shell2.tsx');
    const rail = src('SessionPanel.tsx');
    expect(shell).toMatch(/useAgentsRunning\(\)/);
    expect(shell).not.toMatch(/useSyncExternalStore\(\s*agentRuns\.subscribe/);
    expect(rail).toMatch(/useRailRuns\(\)/);
    expect(rail).not.toMatch(/useSyncExternalStore\(\s*agentRuns\.subscribe/);
  });
});
