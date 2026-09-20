import { describe, expect, it } from 'vitest';

import { acpReadinessNote, type AcpReadiness } from './acpReadiness';

describe('acpReadinessNote', () => {
  it('is silent while the probe has not answered', () => {
    expect(acpReadinessNote({ kind: 'unknown' })).toBeNull();
  });

  it('quotes the engine reason when ACP is unavailable', () => {
    const r: AcpReadiness = { kind: 'unavailable', reason: 'ACP is not available' };
    expect(acpReadinessNote(r)).toBe('ACP is not available');
  });

  it('names how to register when available but empty', () => {
    const note = acpReadinessNote({ kind: 'no-agents' });
    expect(note).toMatch(/No local ACP agent is registered/i);
    expect(note).toMatch(/sequence agent add/);
  });

  it('does not invent a green ready strip when agents exist', () => {
    expect(acpReadinessNote({ kind: 'ready', count: 2 })).toBeNull();
  });
});
