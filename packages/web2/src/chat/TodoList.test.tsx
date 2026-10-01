import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TodoList } from './TodoList';
import type { TodoItem } from '../state/types';

/*
 * THE WORK LIST, SEEN.
 *
 * The server half (`todoList.ts`, `todo-work-list.test.ts`) can be perfectly
 * correct and the feature still not exist — that is the hole `sendPayload.test`
 * was written about, in the other direction. These assert what a reader
 * actually sees.
 */

const LIST: TodoItem[] = [
  { id: 's1', title: 'Read the parser', status: 'done' },
  { id: 's2', title: 'Add the guard', status: 'active' },
  { id: 's3', title: 'Lock it with a test', status: 'pending' },
  { id: 's4', title: 'Ship it', status: 'blocked', note: 'needs a release key' },
];

describe('the work list a reader sees', () => {
  it('shows every step, in order, with its own status', () => {
    render(<TodoList items={LIST} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-status'))).toEqual([
      'done',
      'active',
      'pending',
      'blocked',
    ]);
    expect(rows[1]!.textContent).toContain('Add the guard');
    expect(screen.getByTestId('todo-list-track')).toBeTruthy();
  });

  it('counts done out of total, and names blocked SEPARATELY', () => {
    // A blocked step is neither done nor waiting its turn. Counting it into
    // either half makes a fraction the reader can disprove by looking at the
    // rows underneath it — sheet 11.5's rule about the rail's match count.
    render(<TodoList items={LIST} />);
    expect(screen.getByText('1 of 4 done · 1 blocked')).toBeTruthy();
  });

  it('omits the blocked clause entirely when nothing is blocked', () => {
    render(<TodoList items={LIST.filter((i) => i.status !== 'blocked')} />);
    expect(screen.getByText('1 of 3 done')).toBeTruthy();
  });

  it('a blocked step carries its reason ON the row it explains', () => {
    render(<TodoList items={LIST} />);
    const blocked = screen.getAllByRole('listitem')[3]!;
    expect(blocked.textContent).toContain('needs a release key');
  });

  it('renders NOTHING for an empty list — most turns declare none', () => {
    const { container } = render(<TodoList items={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
