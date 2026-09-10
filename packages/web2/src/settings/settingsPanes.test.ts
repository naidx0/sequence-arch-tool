import { describe, expect, it } from 'vitest';

import { SETTINGS_PANES, isCurrent, resolvePane } from './settingsPanes';

describe('which pane the panel shows', () => {
  it('honours the one the caller asked for', () => {
    /* `ShellOverlay` has carried `{ kind: 'settings'; pane }` from the start
       and every caller passes one. The panel never read it. */
    expect(resolvePane('workspace')).toBe('workspace');
    expect(resolvePane('hooks')).toBe('hooks');
  });

  it('falls back to the provider pane, not to nothing', () => {
    /* An unknown pane showing an empty frame would be worse than ignoring the
       request. And provider is the honest default: with no model configured
       the assistant cannot answer at all. */
    expect(resolvePane('appearance')).toBe('provider');
    expect(resolvePane(undefined)).toBe('provider');
    expect(resolvePane(null)).toBe('provider');
    expect(resolvePane(42)).toBe('provider');
  });

  it('names only panes the panel actually draws', () => {
    /* The old union was 'provider' | 'permissions' | 'appearance'. There is no
       permissions pane and no appearance pane, and light is deferred by
       Graphite decision so there may never be one. A contract naming surfaces
       that do not exist cannot be honoured. */
    expect(SETTINGS_PANES.map((p) => p.id)).toEqual([
      'provider',
      'notifications',
      'hooks',
      'workspace',
    ]);
  });

  it('puts the blocking one first', () => {
    /* Provider blocks everything else, and the failure strip routes here for
       exactly that reason. */
    expect(SETTINGS_PANES[0]!.id).toBe('provider');
  });

  it('every tab carries a title saying what a reader would come for', () => {
    for (const pane of SETTINGS_PANES) {
      expect(pane.label.length).toBeGreaterThan(0);
      expect(pane.title.length).toBeGreaterThan(10);
    }
  });

  it('exactly one tab is current at a time', () => {
    const current = SETTINGS_PANES.filter((p) => isCurrent(p.id, 'hooks'));
    expect(current).toHaveLength(1);
    expect(current[0]!.id).toBe('hooks');
  });
});
