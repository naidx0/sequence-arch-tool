import { describe, expect, it } from 'vitest';

import { isPristineChat, reusableEmptyChat } from './emptyChat';

const made = (over: Record<string, unknown> = {}) => ({ id: 'a', title: 'New chat', createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', mode: 'code' as const, ...over }) as never;

describe('an empty chat is read from the index', () => {
  it('made and never written to is empty; anything the person did to it is not', () => {
    expect(isPristineChat(made())).toBe(true);
    expect(isPristineChat(made({ updatedAt: '2026-10-15T10:00:03.000Z' }))).toBe(false);
    expect(isPristineChat(made({ title: 'Why is the build red' }))).toBe(false);
    expect(isPristineChat(made({ titleEdited: true }))).toBe(false);
    expect(isPristineChat(made({ pinned: true }))).toBe(false);
    expect(isPristineChat(made({ goal: 'ship it' }))).toBe(false);
    expect(isPristineChat(made({ worktree: { path: 'x', branch: 'y' } }))).toBe(false);
    expect(isPristineChat(made({ agentThreads: { codex: { id: 't' } } }))).toBe(false);
    expect(isPristineChat(made({ clonedFromId: 'z' }))).toBe(false);
  });

  it('the one to go to is the newest empty chat of the same kind', () => {
    const list = [made({ id: 'old', createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z' }), made({ id: 'new' }), made({ id: 'used', title: 'Real chat' }), made({ id: 'work', mode: 'work' })];
    expect(reusableEmptyChat(list, 'code')?.id).toBe('new');
    expect(reusableEmptyChat(list, 'work')?.id).toBe('work');
    expect(reusableEmptyChat([made({ id: 'used', title: 'Real chat' })], 'code')).toBeNull();
    expect(reusableEmptyChat([], 'code')).toBeNull();
  });
});
