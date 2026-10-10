import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentsPane } from './AgentsPane';
import { InstructionsEditor } from './InstructionsEditor';
import { createInstructionsClient, instructionsPath, type InstructionsClient } from './instructionsClient';

/* Round 13 (O4): Settings > Agents says where AGENTS.md lives and edits it in place,
   through the file routes the server already has (GET and PUT /api/file). */

function server(opts: { attached?: boolean; file?: string | null; putStatus?: number } = {}) {
  const calls: string[] = [];
  let file = opts.file === undefined ? 'Run tests first.\n' : opts.file;
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === '/api/status') return json(opts.attached === false ? { attached: false } : { attached: true, root: '/home/dev/shop/' });
    if (url === '/api/workspace') return json({ root: '/home/dev/.sequence/workspace', exists: true, entries: [], omitted: 0 });
    if (url.startsWith('/api/file') && method === 'GET') {
      if (file !== null) return new Response(file);
      /* the real route: a question with `optional=1` gets 204, not a 404 the console would log */
      return url.includes('optional=1') ? new Response(null, { status: 204 }) : json({ error: 'file not found' }, 404);
    }
    if (url === '/api/file' && method === 'PUT') {
      if (opts.putStatus) return json({ error: 'a hook refused the write' }, opts.putStatus);
      file = JSON.parse(String(init!.body)).content;
      return json({ ok: true });
    }
    return json({}, 404);
  });
  return { f: f as unknown as typeof fetch, calls, get file() { return file; } };
}

describe('the AGENTS.md client uses existing routes only', () => {
  it('joins the project root and the file name once', () => {
    expect(instructionsPath('/home/dev/shop/')).toBe('/home/dev/shop/AGENTS.md');
    expect(instructionsPath('/home/dev/shop')).toBe('/home/dev/shop/AGENTS.md');
    expect(instructionsPath(null)).toBe('AGENTS.md');
  });

  it('reads the open project, else the home workspace; a 404 is "not created"', async () => {
    const a = await createInstructionsClient(server().f).read();
    expect(a).toEqual({ outcome: 'ok', body: { root: '/home/dev/shop/', project: true, exists: true, text: 'Run tests first.\n' } });
    const b = await createInstructionsClient(server({ attached: false, file: null }).f).read();
    expect(b).toEqual({ outcome: 'ok', body: { root: '/home/dev/.sequence/workspace', project: false, exists: false, text: '' } });
  });

  it('asks for AGENTS.md as optional, so a missing file is a 204 and never a 404 in the console', async () => {
    const s = server({ file: null });
    const r = await createInstructionsClient(s.f).read();
    expect(r).toEqual({ outcome: 'ok', body: { root: '/home/dev/shop/', project: true, exists: false, text: '' } });
    expect(s.calls.find((c) => c.includes('/api/file'))).toBe('GET /api/file?path=AGENTS.md&optional=1');
  });

  it('writes with PUT /api/file { path, content } and nothing else', async () => {
    const s = server();
    const a = await createInstructionsClient(s.f).write('x');
    expect(a.outcome).toBe('ok');
    expect(s.calls.at(-1)).toBe('PUT /api/file');
    expect(s.file).toBe('x');
  });
});

describe('<InstructionsEditor>', () => {
  it('shows where the file lives and its text, then edits and saves in place', async () => {
    const s = server();
    render(<InstructionsEditor client={createInstructionsClient(s.f)} />);
    expect((await screen.findByTestId('settings-instructions-path')).textContent).toBe('/home/dev/shop/AGENTS.md');
    expect(screen.getByTestId('settings-instructions-preview').textContent).toBe('Run tests first.\n');
    fireEvent.click(screen.getByTestId('settings-instructions-edit'));
    const box = screen.getByTestId('settings-instructions-text') as HTMLTextAreaElement;
    expect(box.value).toBe('Run tests first.\n');
    await waitFor(() => expect(document.activeElement).toBe(box));
    fireEvent.change(box, { target: { value: 'Run tests first.\nKeep diffs small.\n' } });
    fireEvent.click(screen.getByTestId('settings-instructions-save'));
    expect((await screen.findByTestId('settings-instructions-saved')).textContent).toContain('/home/dev/shop/AGENTS.md');
    expect(s.file).toBe('Run tests first.\nKeep diffs small.\n');
    expect(screen.getByTestId('settings-instructions-preview').textContent).toBe('Run tests first.\nKeep diffs small.\n');
    expect(screen.queryByTestId('settings-instructions-editor')).toBeNull();
  });

  it('no file yet: says where it will live and one button creates it from a starter', async () => {
    const s = server({ file: null });
    render(<InstructionsEditor client={createInstructionsClient(s.f)} />);
    const create = await screen.findByTestId('settings-instructions-edit');
    expect(create.textContent).toBe('Create AGENTS.md');
    expect(screen.queryByTestId('settings-instructions-preview')).toBeNull();
    fireEvent.click(create);
    fireEvent.click(screen.getByTestId('settings-instructions-save'));
    await screen.findByTestId('settings-instructions-saved');
    expect(s.file).toMatch(/^# Agent instructions/);
  });

  it('a refused save says why and keeps the draft open', async () => {
    const s = server({ putStatus: 403 });
    render(<InstructionsEditor client={createInstructionsClient(s.f)} />);
    fireEvent.click(await screen.findByTestId('settings-instructions-edit'));
    fireEvent.change(screen.getByTestId('settings-instructions-text'), { target: { value: 'new' } });
    fireEvent.click(screen.getByTestId('settings-instructions-save'));
    expect((await screen.findByTestId('settings-instructions-failure')).textContent).toBe('a hook refused the write');
    expect((screen.getByTestId('settings-instructions-text') as HTMLTextAreaElement).value).toBe('new');
    expect(s.file).toBe('Run tests first.\n');
  });

  it('Cancel drops the draft', async () => {
    const s = server();
    render(<InstructionsEditor client={createInstructionsClient(s.f)} />);
    fireEvent.click(await screen.findByTestId('settings-instructions-edit'));
    fireEvent.change(screen.getByTestId('settings-instructions-text'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByTestId('settings-instructions-cancel'));
    expect(screen.getByTestId('settings-instructions-preview').textContent).toBe('Run tests first.\n');
  });

  it('is part of the Agents pane', async () => {
    const api: InstructionsClient = { read: async () => ({ outcome: 'ok', body: { root: '/r', project: true, exists: true, text: 'a' } }), write: async () => ({ outcome: 'ok', body: { bytes: 1 } }) };
    render(
      <AgentsPane
        client={{ list: async () => ({ outcome: 'ok', body: [] }), connect: async (row) => ({ outcome: 'ok', body: row }) }}
        instructionsClient={api}
      />,
    );
    expect((await screen.findByTestId('settings-instructions-path')).textContent).toBe('/r/AGENTS.md');
  });
});

describe('round 13 (N5): AGENTS.md can be imported', () => {
  const file = (text: string, name = 'AGENTS.md') => new File([text], name, { type: 'text/markdown' });

  it('a chosen file opens in the editor and is not written until Save', async () => {
    const s = server();
    render(<InstructionsEditor client={createInstructionsClient(s.f)} />);
    const input = (await screen.findByTestId('settings-instructions-file')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file('Use pnpm.\n')] } });
    expect(((await screen.findByTestId('settings-instructions-text')) as HTMLTextAreaElement).value).toBe('Use pnpm.\n');
    expect(screen.getByTestId('settings-instructions-imported').textContent).toMatch(/Imported AGENTS\.md.*replacing the current text/);
    expect(s.file).toBe('Run tests first.\n');
    fireEvent.click(screen.getByTestId('settings-instructions-save'));
    await waitFor(() => expect(s.file).toBe('Use pnpm.\n'));
  });

  it('a dropped file does the same, and Cancel throws the import away', async () => {
    const s = server();
    render(<InstructionsEditor client={createInstructionsClient(s.f)} />);
    const box = await screen.findByTestId('settings-instructions');
    fireEvent.drop(box, { dataTransfer: { files: [file('Dropped.\n', 'notes.md')], types: ['Files'] } });
    expect(((await screen.findByTestId('settings-instructions-text')) as HTMLTextAreaElement).value).toBe('Dropped.\n');
    fireEvent.click(screen.getByTestId('settings-instructions-cancel'));
    expect(screen.queryByTestId('settings-instructions-text')).toBeNull();
    expect(s.file).toBe('Run tests first.\n');
  });

  it('refuses a file that is too big or not text, in words, and says how to copy from another project', async () => {
    const s = server();
    render(<InstructionsEditor client={createInstructionsClient(s.f)} />);
    const input = (await screen.findByTestId('settings-instructions-file')) as HTMLInputElement;
    expect(screen.getByTestId('settings-instructions-import-hint').textContent).toMatch(/copy from another project, choose its AGENTS\.md/);
    fireEvent.change(input, { target: { files: [file('x'.repeat(300 * 1024), 'big.md')] } });
    expect((await screen.findByTestId('settings-instructions-failure')).textContent).toMatch(/too large/);
    fireEvent.change(input, { target: { files: [file('a\u0000b', 'bin.md')] } });
    await waitFor(() => expect(screen.getByTestId('settings-instructions-failure').textContent).toMatch(/not a text file/));
    expect(screen.queryByTestId('settings-instructions-text')).toBeNull();
  });
});
