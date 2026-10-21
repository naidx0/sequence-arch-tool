// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProseMessage } from '../chat/ProseMessage';

/* ROUND 12 (G18): what an agent actually writes back, as one message: a numbered list with code ticks and a
   bold lead, a nested bullet list, a fenced block, a table, and a plain paragraph. Each must be an element
   and no marker may survive as text. */
const AGENT = [
  'I found the cause. Three steps:',
  '',
  '1. **Read** `gateway/src/rate.ts`',
  '2. Trust `x-forwarded-for` behind the proxy',
  '   - only from the first hop',
  '   - never from the client',
  '3. Re-run the tests',
  '',
  '```ts',
  'const ip = req.headers["x-forwarded-for"]?.split(",")[0] ?? req.ip;',
  '```',
  '',
  '| File | Change |',
  '|---|---|',
  '| `rate.ts` | key on the first hop |',
  '| `proxy.ts` | none |',
  '',
  'All **12** tests pass.',
].join('\n');

describe('agent output renders as formatted chat (G18)', () => {
  it('lists, code, a table and bold are elements, with no raw markers left', () => {
    render(<ProseMessage text={AGENT} />);
    expect(screen.getAllByTestId('chat-list').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('chat-code-block')).toHaveLength(1);
    expect(screen.getByTestId('chat-table').querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getAllByTestId('chat-tick').map((n) => n.textContent)).toEqual(expect.arrayContaining(['gateway/src/rate.ts', 'x-forwarded-for', 'rate.ts']));
    expect(screen.getAllByTestId('chat-strong').map((n) => n.textContent)).toEqual(expect.arrayContaining(['Read', '12']));
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\*\*|```|\|---|^\s*\d\. /m);
  });

  it('the nested bullets stay inside the numbered list (three top-level steps)', () => {
    const { container } = render(<ProseMessage text={AGENT} />);
    const first = container.querySelector('ol[data-testid="chat-list"]')!;
    expect(first.querySelectorAll(':scope > li')).toHaveLength(3);
    expect(first.querySelectorAll(':scope > li > ul[data-testid="chat-list"] > li')).toHaveLength(2);
    expect(first.textContent).toContain('only from the first hop');
  });

  it('an indented continuation line stays inside its item', () => {
    const { container } = render(<ProseMessage text={['1. First step', '   goes on here', '2. Second step'].join('\n')} />);
    const items = container.querySelectorAll('ol[data-testid="chat-list"] > li');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('First step goes on here');
    expect(document.body.textContent).not.toMatch(/^\s*\d\. /m);
  });

  it('a code fence inside a numbered list does not restart the numbering', () => {
    const { container } = render(<ProseMessage text={['1. Install', '2. Run this', '```sh', 'pnpm test', '```', '3. Done'].join('\n')} />);
    const lists = container.querySelectorAll('ol[data-testid="chat-list"]');
    expect(lists).toHaveLength(2);
    expect(lists[1]!.getAttribute('start')).toBe('3');
  });
});
