import { describe, expect, it } from 'vitest';

import { askSurfaceFromChrome, askSurfaceFromWorkspace } from './workspaceAskSurface';

describe('askSurfaceFromWorkspace', () => {
  it('sends nothing on chat-alone', () => {
    expect(askSurfaceFromWorkspace('chat')).toBeNull();
  });

  it('names Architecture with the architecture wire id', () => {
    expect(askSurfaceFromWorkspace('architecture')).toEqual({
      id: 'architecture',
      title: 'Architecture',
    });
  });

  it('names Whiteboard; wire id stays task-board (server copy is honest)', () => {
    expect(askSurfaceFromWorkspace('whiteboard')).toEqual({
      id: 'task-board',
      title: 'Whiteboard',
    });
  });

  it('names AI Canvas with the ai-canvas wire id', () => {
    expect(askSurfaceFromWorkspace('ai-canvas')).toEqual({
      id: 'ai-canvas',
      title: 'AI Canvas',
    });
  });
});

describe('askSurfaceFromChrome — overlays win (owner deictic bug)', () => {
  it('Activity overlay is agents wire id, not the repo', () => {
    expect(
      askSurfaceFromChrome({ workspace: 'architecture', overlayKind: 'activity' }),
    ).toEqual({ id: 'agents', title: 'Activity' });
  });

  it('Settings overlay is settings wire id', () => {
    expect(askSurfaceFromChrome({ workspace: 'chat', overlayKind: 'settings' })).toEqual({
      id: 'settings',
      title: 'Settings',
    });
  });

  it('falls through to workspace when overlay is review/help/null', () => {
    expect(askSurfaceFromChrome({ workspace: 'whiteboard', overlayKind: 'review' })).toEqual({
      id: 'task-board',
      title: 'Whiteboard',
    });
    expect(askSurfaceFromChrome({ workspace: 'chat', overlayKind: null })).toBeNull();
  });
});
