import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import './settings.css';
import { SharedMemorySection, targetWord, type MemoryTargetState } from './SharedMemorySection';

const T = (over: Partial<MemoryTargetState>): MemoryTargetState => ({ id: 'claude', agent: 'Claude Code', path: '~/.claude/CLAUDE.md', present: true, exists: true, bytes: 40, shared: false, current: false, ...over });

const TARGETS = [T({}), T({ id: 'codex', agent: 'Codex', path: '~/.codex/AGENTS.md', shared: true }), T({ id: 'qwen', agent: 'Qwen Code', path: '~/.qwen/QWEN.md', present: false, exists: false })];

function server(over: { gather?: unknown; text?: string } = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let text = over.text ?? '';
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const view = () => ({ text, targets: TARGETS.map((t) => ({ ...t, ...(t.id === 'claude' && text ? { shared: true, current: true } : {}) })) });
    if (url === '/api/memory/shared' && method === 'GET') return new Response(JSON.stringify(view()));
    if (url === '/api/memory/shared' && method === 'PUT') {
      text = (body as { text: string }).text;
      return new Response(JSON.stringify(view()));
    }
    if (url.endsWith('/gather')) return new Response(JSON.stringify(over.gather ?? { text: 'Use pnpm, not npm.', sources: ['~/.claude/CLAUDE.md'] }));
    if (url.endsWith('/sync')) return new Response(JSON.stringify({ results: (body as { ids: string[] }).ids.map((id) => ({ id, ok: true, note: 'shared' })), ...view() }));
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('Settings › Agents: one memory for all your agents', () => {
  it('each agent says in words where it stands; one not set up here is not offered', async () => {
    expect([targetWord(T({})), targetWord(T({ shared: true })), targetWord(T({ shared: true, current: true })), targetWord(T({ present: false })), targetWord(T({ refused: 'it is saved as UTF-16' })), targetWord(T({ lost: true }))]).toEqual(['Not shared', 'Older text', 'Up to date', 'Not set up here', "Can't change", 'Removed elsewhere']);
    const { f } = server();
    render(<SharedMemorySection fetchImpl={f} />);
    const rows = await screen.findAllByTestId('shared-memory-target');
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual(['claude', 'codex']);
    expect(rows.map((r) => within(r).getByTestId('shared-memory-state').textContent)).toEqual(['Not shared', 'Older text']);
  });

  it('gather fills the box, save keeps it, share sends it to the ticked agents only', async () => {
    const { f, calls } = server();
    render(<SharedMemorySection fetchImpl={f} />);
    fireEvent.click(await screen.findByTestId('shared-memory-gather'));
    await waitFor(() => expect((screen.getByTestId('shared-memory-text') as HTMLTextAreaElement).value).toBe('Use pnpm, not npm.'));
    expect(screen.getByTestId('shared-memory-note').textContent).toMatch(/Gathered from ~\/\.claude\/CLAUDE\.md/);
    expect((screen.getByTestId('shared-memory-share') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('shared-memory-save'));
    await waitFor(() => expect((screen.getByTestId('shared-memory-share') as HTMLButtonElement).disabled).toBe(false));
    const picks = screen.getAllByTestId('shared-memory-pick') as HTMLInputElement[];
    fireEvent.click(picks[0]!);
    fireEvent.click(screen.getByTestId('shared-memory-share'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/sync'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/sync'))!.body).toEqual({ ids: ['codex'], remove: false });
    expect((await screen.findByTestId('shared-memory-note')).textContent).toMatch(/Shared\./);
  });

  it('a Save never re-ticks an agent the person unticked', async () => {
    const { f, calls } = server();
    render(<SharedMemorySection fetchImpl={f} />);
    const picks = (await screen.findAllByTestId('shared-memory-pick')) as HTMLInputElement[];
    fireEvent.click(picks[0]!);
    fireEvent.change(screen.getByTestId('shared-memory-text'), { target: { value: 'New text.' } });
    fireEvent.click(screen.getByTestId('shared-memory-save'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    await waitFor(() => expect((screen.getByTestId('shared-memory-share') as HTMLButtonElement).disabled).toBe(false));
    expect(((screen.getAllByTestId('shared-memory-pick') as HTMLInputElement[])[0]!).checked).toBe(false);
    fireEvent.click(screen.getByTestId('shared-memory-share'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/sync'))?.body).toEqual({ ids: ['codex'], remove: false }));
  });

  it('Share reads Shared and is off while every ticked agent has the current text', async () => {
    const { f } = server({ text: 'Kept.' });
    render(<SharedMemorySection fetchImpl={f} />);
    const picks = (await screen.findAllByTestId('shared-memory-pick')) as HTMLInputElement[];
    fireEvent.click(picks[1]!);
    const share = screen.getByTestId('shared-memory-share') as HTMLButtonElement;
    expect(share.textContent).toBe('Shared');
    expect(share.disabled).toBe(true);
    fireEvent.click(picks[1]!);
    expect(share.textContent).toBe('Share with 2 agents');
    expect(share.disabled).toBe(false);
  });

  it('is not offered until an agent that reads such a file is set up here', async () => {
    const none = (async () => new Response(JSON.stringify({ text: '', targets: [{ ...TARGETS[2]! }] }))) as typeof fetch;
    render(<SharedMemorySection fetchImpl={none} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('shared-memory')).toBeNull();
  });

  it('nothing to gather says so instead of emptying the box', async () => {
    const { f } = server({ gather: { text: '', sources: [] }, text: 'Kept.' });
    render(<SharedMemorySection fetchImpl={f} />);
    fireEvent.click(await screen.findByTestId('shared-memory-gather'));
    expect((await screen.findByTestId('shared-memory-note')).textContent).toMatch(/None of your agents has its own instructions yet/);
    expect((screen.getByTestId('shared-memory-text') as HTMLTextAreaElement).value).toBe('Kept.');
  });

  it('no route (older server, hosted mode): nothing is drawn', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    const { container } = render(<SharedMemorySection fetchImpl={f} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
