import { describe, expect, it } from 'vitest';

import { SETTINGS_PANES, isCurrent, resolvePane, tabOf } from './settingsPanes';

/* Round 7 (A9): six panes became three, Agents, Models, App, connect first.
   The old pane names are sections now, and still open the tab that holds them. */
describe('which tab the panel shows', () => {
  it('six short stops, the connect flow first, Skills among them (round 13)', () => {
    expect(SETTINGS_PANES.map((p) => p.id)).toEqual(['agents', 'models', 'skills', 'app', 'safety', 'workspace']);
    expect(SETTINGS_PANES.map((p) => p.label)).toEqual(['Agents', 'Models', 'Skills', 'General', 'Safety', 'Workspace']);
  });

  it('every section lives on exactly one tab', () => {
    expect(tabOf('autonomy')).toBe('safety');
    expect(tabOf('permissions')).toBe('safety');
    expect(tabOf('hooks')).toBe('safety');
    expect(tabOf('skills')).toBe('skills');
    expect(resolvePane('skills')).toBe('skills');
    expect(tabOf('mcp')).toBe('workspace');
    expect(tabOf('notifications')).toBe('app');
  });

  it('honours a tab, and an old pane name opens the tab that holds it', () => {
    expect(resolvePane('agents')).toBe('agents');
    expect(resolvePane('models')).toBe('models');
    expect(resolvePane('app')).toBe('app');
    /* The failure strip and the model menu still ask for 'provider'. */
    expect(resolvePane('provider')).toBe('models');
    expect(resolvePane('notifications')).toBe('app');
    expect(resolvePane('hooks')).toBe('safety');
    expect(resolvePane('workspace')).toBe('workspace');
    expect(resolvePane('safety')).toBe('safety');
    /* A prototype key is not a pane. */
    expect(resolvePane('constructor')).toBe('agents');
    expect(tabOf('agents')).toBe('agents');
  });

  it('an unknown ask lands on Agents, never on nothing', () => {
    for (const ask of ['appearance', undefined, null, 42]) expect(resolvePane(ask)).toBe('agents');
  });

  it('every tab carries a title saying what a reader would come for', () => {
    for (const pane of SETTINGS_PANES) {
      expect(pane.label.length).toBeGreaterThan(0);
      expect(pane.title.length).toBeGreaterThan(10);
    }
  });

  it('exactly one tab is current at a time', () => {
    for (const current of SETTINGS_PANES) {
      expect(SETTINGS_PANES.filter((p) => isCurrent(p.id, current.id))).toHaveLength(1);
    }
  });
});
