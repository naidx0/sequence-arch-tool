import fs from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachDialog } from './AttachDialog';
import type { BootTransport } from './bootSequence';

/*
 * Owner-seat review, "no two sibling rows read the same": with repo2, repo3 and repo4 recent, every Recent row read
 * "r…  C:\Users\<user>\...\claude\..." because the long path took the room and the short project NAME was clipped. The name
 * is short and is the point of the row: it is never clipped. The path is what gives way, from the FRONT, so the
 * distinguishing tail ("...\owner3\home\repo3") stays.
 */

const HOME = 'C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\C--Users-dev-Projects\\9b7e6376-1f19-424b-835a-eba9e234d2cb\\scratchpad';
const RECENT = ['repo2', 'repo3', 'repo4'].map((name, i) => ({
  name,
  path: `${HOME}\\owner${i + 2}\\home\\${name}`,
}));

const sheet = fs.readFileSync(path.join(__dirname, 'boot.css'), 'utf8');

/** The declarations of every top-level rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const out: string[] = [];
  for (const m of sheet.matchAll(/(^|\n)([^{}\n@][^{}]*)\{([^}]*)\}/g)) {
    if ((m[2] ?? '').trim() === selector) out.push(m[3] ?? '');
  }
  return out.join('\n');
}

afterEach(cleanup);

function transport(): BootTransport {
  return {
    status: vi.fn(),
    archGraph: vi.fn(),
    recent: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { recent: RECENT } })),
    browse: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { root: 'C:/Users/u', path: 'C:/Users/u', parent: null, entries: [] } })),
    attach: vi.fn(),
    detach: vi.fn(),
  } as unknown as BootTransport;
}

async function rows(): Promise<HTMLElement[]> {
  render(<AttachDialog transport={transport()} onAttached={() => {}} onClose={() => {}} />);
  await waitFor(() => expect(screen.getAllByTestId('attach-recent')).toHaveLength(3));
  return screen.getAllByTestId('attach-recent');
}

describe('Recent rows', () => {
  it('each row carries the whole project name and the whole path, in separate elements', async () => {
    (await rows()).forEach((row, i) => {
      expect(row.querySelector('.attach-name')?.textContent).toBe(RECENT[i]!.name);
      expect(row.querySelector('.attach-path')?.textContent).toBe(RECENT[i]!.path);
    });
  });

  it('the path is isolated (bdi, ltr) so a right-to-left ellipsis cannot reorder its punctuation', async () => {
    for (const row of await rows()) {
      const bdi = row.querySelector('.attach-path > bdi');
      expect(bdi).not.toBeNull();
      expect(bdi!.getAttribute('dir')).toBe('ltr');
    }
  });

  it('no two rows read the same: the name plus the path tail differs', async () => {
    const labels = (await rows()).map((r) => `${r.querySelector('.attach-name')?.textContent}|${(r.querySelector('.attach-path')?.textContent ?? '').slice(-24)}`);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('CSS: the name never shrinks or clips; the path gives way from the front', () => {
    const name = rule('.attach-open-recent .attach-name');
    expect(name).toMatch(/flex:\s*none|flex:\s*0\s+0\s+auto/);
    expect(name).not.toMatch(/text-overflow/);
    const p = rule('.attach-open-recent .attach-path');
    expect(p).toMatch(/direction:\s*rtl/);
    expect(p).toMatch(/text-overflow:\s*ellipsis/);
    expect(p).toMatch(/overflow:\s*hidden/);
  });

  it('CSS: when narrow, the path drops under the name and takes the full row width', () => {
    const m = sheet.match(/@media\s*\(max-width:\s*\d+px\)\s*\{([\s\S]*?\.attach-open-recent[\s\S]*?)\n\}/);
    expect(m, 'a narrow rule for the recent row').not.toBeNull();
    expect(m![1]).toMatch(/\.attach-open-recent \.attach-text\s*\{[^}]*flex-direction:\s*column/);
  });
});
