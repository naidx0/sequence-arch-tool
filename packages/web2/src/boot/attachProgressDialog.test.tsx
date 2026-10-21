import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetSwitchProgressForTest } from '../sessions/attachProgress';
import { AttachDialog } from './AttachDialog';
import type { BootTransport } from './bootSequence';

/*
 * 019-rescan-ui. Opening a project from the Open project dialog showed nothing for the 10 to 40 s the engine reads a
 * big repo. The attach now runs under withAttachProgress, and the dialog prints the engine's own "Reading N of M
 * files" (GET /api/status `attaching`) with the bar.
 */

afterEach(() => {
  cleanup();
  resetSwitchProgressForTest();
});

describe('Open project shows the read as it happens', () => {
  it('polls `attaching` while the attach is pending and prints Reading N of M files with a bar', async () => {
    let finish: (v: unknown) => void = () => {};
    const attach = vi.fn(() => new Promise((r) => (finish = r)));
    const status = vi.fn(async () => ({
      outcome: 'ok' as const,
      status: 200,
      body: { attaching: { path: 'C:/Users/user/code/big', phase: 'scanning', done: 40, total: 120, startedAt: 1 } },
    }));
    const transport = {
      status,
      archGraph: vi.fn(async () => ({ outcome: 'error' as const, status: 500, body: { error: 'stop here' } })),
      recent: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { recent: [{ path: 'C:/Users/user/code/big', name: 'big', lastOpened: 1 }] } })),
      browse: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { root: 'C:/Users/user', path: 'C:/Users/user/code', parent: 'C:/Users/user', entries: [] } })),
      attach,
      detach: vi.fn(),
    } as unknown as BootTransport;
    render(<AttachDialog transport={transport} onAttached={() => {}} />);
    expect(screen.queryByTestId('attach-progress')).toBeNull();
    fireEvent.click(await screen.findByTestId('attach-recent').then((li) => li.querySelector('button')!));
    await waitFor(() => expect(screen.getByTestId('attach-progress-line').textContent).toBe('Reading 40 of 120 files…'), { timeout: 3000 });
    const bar = screen.getByTestId('attach-progress-bar') as HTMLProgressElement;
    expect(bar.value).toBeCloseTo(40 / 120);
    expect(status).toHaveBeenCalled();
    finish({ outcome: 'error', status: 500, body: { error: 'stop' } });
    await waitFor(() => expect(screen.queryByTestId('attach-progress')).toBeNull());
  });
});

describe('the switch progress bar paints in Chrome and Firefox', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const css = fs.readFileSync(path.join(here, 'boot.css'), 'utf8').replace(/\r\n/g, '\n');
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };
  it('styles the track and the fill by their own pseudo-elements (a bare 4px <progress> is a flat grey line in Chrome)', () => {
    expect(rule('.switch-progress-bar')).toMatch(/appearance:\s*none/);
    expect(rule('.switch-progress-bar::-webkit-progress-bar')).toMatch(/background:/);
    expect(rule('.switch-progress-bar::-webkit-progress-value')).toMatch(/background:\s*var\(--accent\)/);
    expect(rule('.switch-progress-bar::-moz-progress-bar')).toMatch(/background:\s*var\(--accent\)/);
  });
});
