import { describe, expect, it } from 'vitest';

import {
  INITIAL_WORKSPACE_VIEWS,
  MAX_SECONDARY,
  minimizeBoard,
  requestOpen,
  restoreBoard,
  secondaryCount,
  selectHumanSurface,
} from './workspaceViews';

describe('workspaceViews — chat + ≤2 secondaries, no replace', () => {
  it('starts chat-alone with zero secondaries', () => {
    expect(secondaryCount(INITIAL_WORKSPACE_VIEWS)).toBe(0);
    expect(INITIAL_WORKSPACE_VIEWS.boardOpen).toBe(false);
  });

  it('opens Architecture beside chat without replacing chat', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'architecture');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe('opened');
    expect(r.state.boardOpen).toBe(true);
    expect(r.state.boardKind).toBe('architecture');
    expect(secondaryCount(r.state)).toBe(1);
  });

  it('Architecture → Whiteboard switches the board slot, does not consume a second', () => {
    const opened = requestOpen(INITIAL_WORKSPACE_VIEWS, 'architecture');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const swapped = requestOpen(opened.state, 'whiteboard');
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.changed).toBe('switched');
    expect(swapped.state.boardKind).toBe('whiteboard');
    expect(secondaryCount(swapped.state)).toBe(1);
  });

  it('Files with board closed opens Architecture + files as two secondaries', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'files');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.boardOpen).toBe(true);
    expect(r.state.boardKind).toBe('architecture');
    expect(r.state.filesOpen).toBe(true);
    expect(secondaryCount(r.state)).toBe(MAX_SECONDARY);
  });

  it('Files with board already open adds the files slot without dropping board', () => {
    const board = requestOpen(INITIAL_WORKSPACE_VIEWS, 'whiteboard');
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    const files = requestOpen(board.state, 'files');
    expect(files.ok).toBe(true);
    if (!files.ok) return;
    expect(files.state.boardOpen).toBe(true);
    expect(files.state.boardKind).toBe('architecture'); /* files lives on Architecture */
    expect(files.state.filesOpen).toBe(true);
    expect(secondaryCount(files.state)).toBe(2);
  });

  it('chrome pills do not consume secondary slots when board + files are open', () => {
    let s = INITIAL_WORKSPACE_VIEWS;
    const a = requestOpen(s, 'architecture');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    s = a.state;
    const f = requestOpen(s, 'files');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    s = f.state;
    expect(secondaryCount(s)).toBe(2);

    const term = requestOpen(s, 'terminal');
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.state).toEqual(s);

    const browser = requestOpen(s, 'browser');
    expect(browser.ok).toBe(true);
    if (!browser.ok) return;
    expect(browser.state).toEqual(s);
    expect(s.boardOpen).toBe(true);
    expect(s.filesOpen).toBe(true);
  });

  it('terminal host open is shipped (C1.7) without consuming secondary slots', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'terminal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(secondaryCount(r.state)).toBe(0);
  });

  it('browser host open is shipped (C2.5) without consuming secondary slots', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'browser');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(secondaryCount(r.state)).toBe(0);
  });

  it('minimise / restore board keeps the board slot and files', () => {
    const opened = requestOpen(INITIAL_WORKSPACE_VIEWS, 'files');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const min = minimizeBoard(opened.state);
    expect(min.boardMinimized).toBe(true);
    expect(min.boardOpen).toBe(true);
    expect(min.filesOpen).toBe(true);
    const back = restoreBoard(min);
    expect(back.boardMinimized).toBe(false);
  });

  it('human Chat tab clears board and files', () => {
    const opened = requestOpen(INITIAL_WORKSPACE_VIEWS, 'files');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const chat = selectHumanSurface(opened.state, 'chat');
    expect(chat.boardOpen).toBe(false);
    expect(chat.filesOpen).toBe(false);
  });
});
