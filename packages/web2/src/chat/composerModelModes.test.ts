import { describe, expect, it } from 'vitest';

import { acpPermissionModeFor, askPermissionFor } from './accessMode';
import {
  COMPOSER_MODE_KEYS,
  acpModeOf,
  modeFromSaved,
  modeOf,
  nextComposerMode,
  savedNameOf,
  loadSavedMode,
  wireOf,
} from './composerModelModes';

describe('the three composer modes', () => {
  it('offers exactly Plan, Smart and Full auto', () => {
    expect(COMPOSER_MODE_KEYS).toEqual(['plan', 'smart', 'full']);
  });

  it('loads an old saved teach as Plan', () => {
    expect(modeFromSaved('teach')).toBe('plan');
    expect(modeFromSaved('plan')).toBe('plan');
  });

  it('loads build / edit as Smart and auto / skip / bypass as Full auto', () => {
    for (const m of ['build', 'edit', 'autoEdit', 'smart']) expect(modeFromSaved(m, 'autoEdit')).toBe('smart');
    for (const m of ['auto', 'skip', 'bypass', 'full']) expect(modeFromSaved(m)).toBe('full');
    expect(modeFromSaved('build', 'full')).toBe('full');
  });

  it('a saved Ask never widens: it loads as Plan, whichever of its shapes was saved', () => {
    expect(modeFromSaved('ask')).toBe('plan');
    expect(modeFromSaved('propose')).toBe('plan');
    expect(modeFromSaved('build', 'ask')).toBe('plan');
    expect(modeFromSaved('build', 'autoEdit')).toBe('smart');
  });

  it('never widens on an unknown value', () => {
    expect(modeFromSaved('???')).toBe('smart');
    expect(modeFromSaved(null)).toBe('smart');
  });

  it('round-trips every mode through its wire value', () => {
    for (const k of COMPOSER_MODE_KEYS) {
      const w = wireOf(k);
      expect(modeOf(w.intent, w.access ?? 'autoEdit')).toBe(k);
    }
  });

  it('reaches the agent right: Plan refuses edits, Smart auto-edits, Full auto skips permissions', () => {
    for (const k of COMPOSER_MODE_KEYS) {
      const w = wireOf(k);
      expect(acpPermissionModeFor(w.intent, w.access ?? 'autoEdit')).toBe(acpModeOf(k));
    }
    expect(acpModeOf('plan')).toBe('plan');
    expect(acpModeOf('smart')).toBe('autoEdit');
    expect(acpModeOf('full')).toBe('full');
    /* the built-in /api/ask route knows plan | build only */
    expect(askPermissionFor(wireOf('plan').intent, 'full')).toBe('plan');
    expect(askPermissionFor(wireOf('smart').intent, wireOf('smart').access!)).toBe('build');
    expect(askPermissionFor(wireOf('full').intent, wireOf('full').access!)).toBe('build');
  });

  it('cycles Plan -> Smart -> Full auto -> Plan, and saves under the names hydrate reads', () => {
    expect(nextComposerMode('plan')).toBe('smart');
    expect(nextComposerMode('smart')).toBe('full');
    expect(nextComposerMode('full')).toBe('plan');
    expect(savedNameOf('plan')).toBe('plan');
    expect(savedNameOf('smart')).toBe('build');
    expect(savedNameOf('full')).toBe('build');
  });
});

describe('what hydrate loads from the two saved values', () => {
  it('Build at Ask access is Plan, with one note owed, and the saved pair rewritten so it does not repeat', () => {
    const load = loadSavedMode('build', 'ask', true);
    expect(load).toMatchObject({ key: 'plan', intent: 'plan', access: 'autoEdit', note: true, rewrite: { mode: 'plan', access: 'autoEdit' } });
    /* the rewritten pair loads quietly the second time */
    const again = loadSavedMode('plan', 'autoEdit', true);
    expect(again.note).toBe(false);
    expect(again.rewrite).toBeNull();
  });

  it('a saved ask / propose name is the same carry-over, even where Build is not enabled', () => {
    for (const m of ['ask', 'propose']) {
      const load = loadSavedMode(m, null, false);
      expect(load).toMatchObject({ key: 'plan', intent: 'plan', note: true });
    }
  });

  it('a stray Ask access under Plan is quietly set to Auto-edit (no note: it was already Plan)', () => {
    expect(loadSavedMode('plan', 'ask', true)).toMatchObject({ key: 'plan', access: 'autoEdit', note: false, rewrite: { mode: 'plan', access: 'autoEdit' } });
  });

  it('Smart, Full auto and teach load as themselves; nothing saved changes nothing', () => {
    expect(loadSavedMode('build', 'autoEdit', true)).toMatchObject({ key: 'smart', intent: 'build', access: 'autoEdit', note: false, rewrite: null });
    expect(loadSavedMode('build', 'full', true)).toMatchObject({ key: 'full', intent: 'build', access: 'full', note: false });
    expect(loadSavedMode('teach', null, true)).toMatchObject({ key: 'plan', intent: 'plan', note: false });
    expect(loadSavedMode(null, null, true)).toMatchObject({ intent: null, access: null, note: false, rewrite: null });
  });

  it('Build stays off until the project opted in', () => {
    expect(loadSavedMode('build', 'autoEdit', false).intent).toBeNull();
  });
});
