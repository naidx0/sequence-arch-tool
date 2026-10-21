import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AUTO_COMPACT_FULL_AT } from '../agents/agentRuns';
import { AgentMapSetting, agentMapStatus, mapToAgentsStatus, mapTokensLabel } from './AgentMapSetting';


const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Architecture map setting', () => {
  it('says how big the map is, in the server’s own count', () => {
    expect(mapTokensLabel(3912)).toBe('map 3.9k tokens');
    expect(mapTokensLabel(850)).toBe('map 850 tokens');
    expect(agentMapStatus({ includeArchitectureMap: true, map: { tokens: 3912 } })).toBe("On: the map is about 3.9k tokens, sent with every question to Sequence's own model. Claude and Codex read it through the map tool when they need it.");
    expect(agentMapStatus({ includeArchitectureMap: true, map: null })).toMatch(/no map yet/);
    expect(agentMapStatus({ includeArchitectureMap: false, map: { tokens: 3912 } })).toMatch(/^Off/);
  });

  it('the line under the Claude and Codex switch states the switch, and never says Off while it is On', () => {
    /*
     * The line under a switch states that switch. This one used to be one
     * fixed sentence that ended "Off until we have measured that it helps"
     * whatever the switch was set to, so a reader who had turned it ON was
     * still being told it was off.
     */
    const on = mapToAgentsStatus({ includeArchitectureMap: true, mapToAgents: true, map: { tokens: 3912 } });
    expect(on).toMatch(/^On:/);
    expect(on).not.toMatch(/^Off:/);
    expect(on).toMatch(/3\.9k tokens/);
    const off = mapToAgentsStatus({ includeArchitectureMap: true, mapToAgents: false, map: { tokens: 3912 } });
    expect(off).toMatch(/^Off:/);
    expect(off).toMatch(/3\.9k tokens/);
    /* and the reason it is off by default is still there, in the row's title */
    expect(mapToAgentsStatus({ includeArchitectureMap: true, mapToAgents: false, map: { tokens: 3912 } })).toMatch(/not sent the map/i);
  });

  it('on by default; unticking PUTs false and shows the server’s answer', async () => {
    const calls: { method: string; body?: string }[] = [];
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined });
      if (init?.method === 'PUT') return json({ includeArchitectureMap: false, map: { tokens: 574 } });
      return json({ includeArchitectureMap: true, map: { tokens: 574 } });
    });
    render(<AgentMapSetting fetchImpl={f} />);
    const box = screen.getByTestId('settings-agent-map-toggle') as HTMLInputElement;
    await waitFor(() => expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/about 574 tokens/));
    expect(box.checked).toBe(true);
    await act(async () => fireEvent.click(box));
    await waitFor(() => expect(box.checked).toBe(false));
    expect(calls.at(-1)).toEqual({ method: 'PUT', body: '{"includeArchitectureMap":false}' });
    expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/^Off/);
  });

  it('a failed read says so instead of showing a stale switch', async () => {
    render(<AgentMapSetting fetchImpl={async () => json({ error: 'x' }, 500)} />);
    await waitFor(() => expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/Could not read/));
  });

  it('the Claude and Codex switch is off by default, PUTs mapToAgents, and leaves the main switch alone', async () => {
    const calls: { method: string; body?: string }[] = [];
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', ...(init?.body ? { body: String(init.body) } : {}) });
      return json({ includeArchitectureMap: true, mapToAgents: init?.method === 'PUT', map: { tokens: 3912 } });
    });
    render(<AgentMapSetting fetchImpl={f as unknown as typeof fetch} />);
    const box = (await screen.findByTestId('settings-map-to-agents-toggle')) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);
    /* OFF says off. */
    expect(screen.getByTestId('settings-map-to-agents-status').textContent).toMatch(/^Off:/);
    fireEvent.click(box);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body!)).toEqual({ mapToAgents: true });
    await waitFor(() => expect(box.checked).toBe(true));
    /* ON says on. The same sentence for both states was a control that lied. */
    await waitFor(() => expect(screen.getByTestId('settings-map-to-agents-status').textContent).toMatch(/^On:/));
  });
});

describe('Workspace copy a first-time reader can follow (F5/F6/I9)', () => {
  const json2 = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  it('names the map in plain words, defines a turn, and shows the server token count', async () => {
    render(<AgentMapSetting fetchImpl={(async () => json2({ includeArchitectureMap: true, allBoardTools: false, map: { tokens: 3912 } })) as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/the map is about 3\.9k tokens, sent with every question/));
    const explain = screen.getByTestId('settings-agent-map-explain').textContent ?? '';
    expect(explain).toMatch(/A turn is one message from you and the agent/);
    expect(document.body.textContent).not.toMatch(/Include the architecture map|All 16 tools|4\.1k/);
  });
  it('board tools: no tool count unless the server reports one, and the counts are the server’s', async () => {
    const { unmount } = render(<AgentMapSetting fetchImpl={(async () => json2({ includeArchitectureMap: true, map: null })) as unknown as typeof fetch} />);
    await waitFor(() => expect((screen.getByTestId('settings-board-tools-toggle') as HTMLInputElement).disabled).toBe(false));
    expect(screen.getByTestId('settings-board-tools-status').textContent).not.toMatch(/\d/);
    unmount();
    render(<AgentMapSetting fetchImpl={(async () => json2({ includeArchitectureMap: true, map: null, tools: { all: 23, core: ['map', 'who_calls', 'impact', 'architecture_changed', 'list_boards', 'create_board', 'draw', 'edit_workflow', 'drawings', 'visual', 'find_files'], allTokens: 5726, coreTokens: 2100 } })) as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId('settings-board-tools-status').textContent).toBe("23 tools, about 5.7k tokens added to each agent session's tool list."));
  });
  it('says plainly that compaction starts by itself at the line the store uses, and leaves a note (contract change)', async () => {
    render(<AgentMapSetting fetchImpl={(async () => json2({ includeArchitectureMap: true, map: null })) as unknown as typeof fetch} />);
    const percent = `${Math.round(AUTO_COMPACT_FULL_AT * 100)}%`;
    const sub = screen.getByTestId('settings-compaction-sub').textContent ?? '';
    expect(sub).toContain(percent);
    expect(sub).toMatch(/by itself/);
    expect(sub).toMatch(/note/);
    expect(sub).not.toMatch(/Not automatic/);
    const detail = screen.getByTestId('settings-compaction').getAttribute('title') ?? '';
    expect(detail).toContain(percent);
    expect(detail).not.toMatch(/does not compact a long chat by itself/);
  });
});

describe('review fixes (settings)', () => {
  const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  it('a map object with no token count never prints undefined', () => {
    expect(agentMapStatus({ includeArchitectureMap: true, map: {} as unknown as { tokens: number } })).not.toMatch(/undefined|NaN/);
  });
  it('Web search and fetch is on by default and PUTs web.enabled', async () => {
    const puts: unknown[] = [];
    const f = async (_u: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        return j({ includeArchitectureMap: true, map: null, web: { enabled: false } });
      }
      return j({ includeArchitectureMap: true, map: null });
    };
    render(<AgentMapSetting fetchImpl={f as unknown as typeof fetch} />);
    const box = (await screen.findByTestId('settings-web-toggle')) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(true);
    await act(async () => fireEvent.click(box));
    expect(puts).toEqual([{ web: { enabled: false } }]);
    await waitFor(() => expect(box.checked).toBe(false));
  });
});
