import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetTokenUsageResponse } from '@sequence/api-types';

import { TokenUsageSetting } from './TokenUsageSetting';
import type { TokenUsageClient } from './tokenUsageClient';

afterEach(cleanup);

function client(answer: GetTokenUsageResponse | null): TokenUsageClient {
  return { tokens: vi.fn().mockResolvedValue(answer) };
}

const REPORT: GetTokenUsageResponse = {
  total: 1_500_000,
  input: 1_200_000,
  output: 300_000,
  turns: 42,
  days: [
    { date: '2026-10-14', total: 1_000_000, input: 800_000, output: 200_000, turns: 12 },
    { date: '2026-10-15', total: 500_000, input: 400_000, output: 100_000, turns: 30 },
  ],
  since: '2026-10-14',
};

describe('the Agent usage card (Settings > General)', () => {
  it('shows the reported total, the halves, and a cell per reported day', async () => {
    render(<TokenUsageSetting client={client(REPORT)} />);
    await waitFor(() => expect(screen.getByTestId('token-total').textContent).toContain('1.5m'));
    expect(screen.getByTestId('token-total').textContent).toContain('tokens');
    expect(screen.getByTestId('token-in-out').textContent).toBe('1.2m / 300k');
    expect(screen.getByTestId('token-busiest').textContent).toContain('1m');
    const cells = screen.getAllByTestId('token-day');
    expect(cells).toHaveLength(53 * 7);
    expect(cells.filter((c) => c.getAttribute('data-level') === '4')).toHaveLength(1);
    expect(cells.find((c) => c.title.includes('Oct 14, 2026'))?.getAttribute('data-level')).toBe('4');
  });

  it('says the count is a floor and names the turns and the first day', async () => {
    render(<TokenUsageSetting client={client(REPORT)} />);
    const note = await screen.findByTestId('token-usage-note');
    expect(note.textContent).toContain('42 turns since Oct 14, 2026');
    expect(note.textContent).toContain('Only turns where the agent reported usage are counted.');
  });

  it('shows an honest empty state when nothing has been reported', async () => {
    render(<TokenUsageSetting client={client({ total: 0, input: 0, output: 0, turns: 0, days: [], since: null })} />);
    expect(await screen.findByTestId('token-usage-empty')).toBeTruthy();
    expect(screen.getByTestId('token-total').textContent).toContain('0');
    expect(screen.queryByTestId('token-map')).toBeNull();
  });

  it('shows a quiet line, never a thrown error, when the server cannot be read', async () => {
    render(<TokenUsageSetting client={client(null)} />);
    expect(await screen.findByTestId('token-usage-failed')).toBeTruthy();
    expect(screen.queryByTestId('token-map')).toBeNull();
  });

  it('asks the server once, from the card itself', async () => {
    const c = client(REPORT);
    render(<TokenUsageSetting client={c} />);
    await waitFor(() => expect(screen.getByTestId('token-total').textContent).toContain('1.5m'));
    expect(c.tokens).toHaveBeenCalledTimes(1);
  });
});
