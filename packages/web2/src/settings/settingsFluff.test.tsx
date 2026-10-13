import { render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { AgentMapSetting } from './AgentMapSetting';
import { AskLedgerSetting } from './AskLedgerSetting';
import { ComponentsSetting } from './ComponentsSetting';
import { WhiteboardSetting } from './WhiteboardSetting';

beforeEach(() => localStorage.clear());

/* Owner: "less fluff in people's faces". A row's hint is one short line; the rest lives in a title (tooltip). */
const LIMIT = 90;

describe('settings hints are one short line', () => {
  it('no static .sb-row-sub in settings/* is longer than a line (derived from the source, not hand-listed)', () => {
    const dir = __dirname;
    const long: string[] = [];
    let seen = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/className="sb-row-sub"[^>]*>([^<{]+)</g)) {
        seen += 1;
        const text = m[1]!.replace(/\s+/g, ' ').trim();
        if (text.length > LIMIT) long.push(`${f}: ${text.slice(0, 60)}… (${text.length})`);
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(long).toEqual([]);
  });

  it('rendered rows keep to the limit too, and the detail moved into a tooltip', () => {
    for (const C of [WhiteboardSetting, AskLedgerSetting, AgentMapSetting, ComponentsSetting]) {
      const { container, unmount } = render(<C />);
      const subs = [...container.querySelectorAll('.sb-row-sub')];
      expect(subs.length).toBeGreaterThan(0);
      for (const s of subs) expect((s.textContent ?? '').length).toBeLessThanOrEqual(LIMIT);
      unmount();
    }
    const { container } = render(<AskLedgerSetting />);
    expect(container.querySelector('.sb-row-sub')!.getAttribute('title')).toMatch(/several requests/);
  });
});

describe('one primary button per section', () => {
  it('with several agents ready to connect, only the first Connect is filled; the rest are the quiet secondary pill', async () => {
    const { AgentsPane } = await import('./AgentsPane');
    const { screen } = await import('@testing-library/react');
    const rows = [
      { id: 'codex', label: 'Codex', status: 'ready' },
      { id: 'claude', label: 'Claude Code', status: 'ready' },
      { id: 'gemini', label: 'Gemini CLI', status: 'ready' },
    ];
    render(<AgentsPane client={{ list: async () => ({ outcome: 'ok', body: rows }), connect: async () => ({ outcome: 'ok', body: rows[0] }), disconnect: async () => ({ outcome: 'ok', body: rows }) } as never} />);
    const buttons = await screen.findAllByTestId('settings-agent-connect');
    expect(buttons.map((b) => b.classList.contains('sb-pill-solid'))).toEqual([true, false, false]);
  });
});
