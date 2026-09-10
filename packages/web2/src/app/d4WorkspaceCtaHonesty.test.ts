import { describe, expect, it } from 'vitest';

import { WORKSPACE_PILLS } from './chromeTabModel';
import { INITIAL_WORKSPACE_VIEWS, requestOpen } from './workspaceViews';

/**
 * D4 — Settings/CTA honesty for Browser vs Terminal (mega-plan Phase D).
 *
 * Browser ships as a workspace pill once C2.5 lands (tool+panel, not fake Chrome).
 * Terminal remains shipped as a workspace pill + composer control.
 */
describe('D4 workspace CTA honesty', () => {
  it('Terminal and Browser are workspace pills', () => {
    expect(WORKSPACE_PILLS).toContain('terminal');
    expect(WORKSPACE_PILLS).toContain('browser');
  });

  it('requestOpen allows browser (chrome pill path)', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'browser');
    expect(r.ok).toBe(true);
  });

  it('requestOpen allows terminal (chrome pill path)', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'terminal');
    expect(r.ok).toBe(true);
  });
});
