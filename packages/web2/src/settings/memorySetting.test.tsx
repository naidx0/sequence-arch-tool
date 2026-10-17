import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemorySetting } from './MemorySetting';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Memory setting', () => {
  it('asks /api/memory/summary and says the live counts', async () => {
    const asked: string[] = [];
    render(
      <MemorySetting
        fetchImpl={(async (url: string) => {
          asked.push(url);
          return json({ notes: 1, notesPath: '.sequence/memory/NOTES.md', findFilesLabels: 0, findFilesModel: 'frozen', agentThreads: 0 });
        }) as typeof fetch}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('settings-memory-detail').textContent).toContain('1 repo note in .sequence/memory/NOTES.md'));
    expect(asked).toEqual(['/api/memory/summary']);
  });

  it('says it could not read it when the server fails', async () => {
    render(<MemorySetting fetchImpl={(async () => json({}, 500)) as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId('settings-memory-error')).toBeTruthy());
  });
});
