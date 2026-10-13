import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ALL_WORKSPACE_PILLS, CHROME_TAB_DEFS } from '../app/chromeTabModel';
import { BoardTabs } from '../canvas/boards/BoardTabs';
import { ARCH_BOARD_ID, type BoardsIndex } from '../canvas/boards/boardsModel';
import { SHELL_COMMANDS, filterCommands } from '../shell/shellModel';

afterEach(cleanup);

const noop = () => undefined;
const arch = { id: ARCH_BOARD_ID, name: 'Architecture', kind: 'architecture', rev: 1, createdAt: '', updatedAt: '' };
const wb = { id: 'wb1', name: 'Sketch', kind: 'whiteboard', rev: 1, createdAt: '', updatedAt: '' };

/* B9: the reader's word for the surface is "Spaces"; the internal id and route stay `whiteboard`. */
describe('B9: Whiteboard is called Spaces where the reader sees it', () => {
  it('the pill is Spaces and the id is unchanged', () => {
    expect(CHROME_TAB_DEFS.whiteboard.id).toBe('whiteboard');
    expect(CHROME_TAB_DEFS.whiteboard.label).toBe('Spaces');
  });
  it('no pill label and no palette command label says Whiteboard (derived from the sets)', () => {
    for (const id of ALL_WORKSPACE_PILLS) expect(CHROME_TAB_DEFS[id].label).not.toMatch(/whiteboard/i);
    for (const c of SHELL_COMMANDS) expect(c.label).not.toMatch(/whiteboard/i);
  });
  it('the old word still finds the command (search term) and the id is kept', () => {
    const open = SHELL_COMMANDS.find((c) => c.id === 'canvas.whiteboard');
    expect(open?.label).toBe('Open Spaces');
    expect(open?.searchTerms).toContain('whiteboard');
    expect(filterCommands('spaces')[0]?.id).toBe('canvas.whiteboard');
    expect(filterCommands('whiteboard').map((c) => c.id)).toContain('canvas.whiteboard');
  });
  it('the tag strip says space, not whiteboard, on the + button, tooltip and menu', () => {
    render(<BoardTabs index={{ version: 1, boards: [arch, wb] } as unknown as BoardsIndex} current="wb1" onOpen={noop} onCreate={noop} onRename={noop} onDelete={noop} />);
    const plus = screen.getByTestId('board-tab-new');
    expect(plus.getAttribute('aria-label')).toBe('New space');
    expect(plus.getAttribute('title')).toBe('New space');
    expect(screen.getByTestId('board-tab-wb1').getAttribute('title')).toMatch(/a space/);
    fireEvent.click(plus);
    expect(document.body.textContent ?? '').not.toMatch(/whiteboard/i);
  });
});
