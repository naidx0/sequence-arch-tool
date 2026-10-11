import { describe, expect, it } from 'vitest';

import { WORKSPACE_PILLS } from './chromeTabModel';
import { INITIAL_WORKSPACE_VIEWS, requestOpen } from './workspaceViews';

/**
 * D4 — Settings/CTA honesty for Browser vs Terminal (mega-plan Phase D).
 *
 * Terminal ships as a workspace pill + composer control. Browser is hidden
 * (2026-10-05, not in SHIPPED_SURFACES): no pill, and a host open is refused
 * with a reason rather than accepted and drawn nowhere.
 */
describe('D4 workspace CTA honesty', () => {
  it('Terminal is a workspace pill; Browser is not while it is hidden', () => {
    expect(WORKSPACE_PILLS).toContain('terminal');
    expect(WORKSPACE_PILLS).not.toContain('browser');
  });

  it('requestOpen refuses browser while it is hidden, and says what to open instead', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'browser');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.state).toBe(INITIAL_WORKSPACE_VIEWS);
    expect(r.reason).toBe('browser is not shipped yet. Open Files, Architecture, Whiteboard, Terminal or Agents instead.');
  });

  it('requestOpen allows terminal (chrome pill path)', () => {
    const r = requestOpen(INITIAL_WORKSPACE_VIEWS, 'terminal');
    expect(r.ok).toBe(true);
  });
});
