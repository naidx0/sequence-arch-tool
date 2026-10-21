import { afterEach, describe, expect, it } from 'vitest';

import {
  FAILOVER_KEY,
  RETRY_PRIMARY_MS,
  decideOnLimit,
  decideOnTick,
  failoverLine,
  loadFailover,
  readFailover,
  saveFailover,
  writeFormat,
} from './agentFailover';

const NOW = Date.parse('2026-10-21T04:00:00Z');
const fmt = { primary: 'claude', backup: 'codex' };
const ready = ['claude', 'codex'];

afterEach(() => localStorage.clear());

describe('the failover format', () => {
  it('an empty or garbage store is no primary and no backup', () => {
    expect(readFailover(null)).toEqual({ format: { primary: '', backup: null }, off: null });
    expect(readFailover({ format: { primary: '../x', backup: 'codex' } }).format).toEqual({ primary: '', backup: 'codex' });
  });

  it('round-trips through the browser store', () => {
    saveFailover(localStorage, { format: fmt, off: null });
    expect(localStorage.getItem(FAILOVER_KEY)).toContain('"claude"');
    expect(loadFailover(localStorage).format).toEqual(fmt);
  });

  it('a backup that is the primary is no backup', () => {
    expect(readFailover({ primary: 'claude', backup: 'claude' }).format.backup).toBeNull();
  });
});

describe('a spent primary', () => {
  it('with a ready backup switches now and names the five-hour retry', () => {
    const { decision, state } = decideOnLimit({
      limitedAgent: 'claude',
      readyAgents: ready,
      state: { format: fmt, off: null },
      now: NOW,
      chatId: 's1',
    });
    expect(decision).toEqual({ action: 'use-backup', agent: 'codex', retryPrimaryAt: NOW + RETRY_PRIMARY_MS });
    expect(RETRY_PRIMARY_MS).toBe(5 * 60 * 60 * 1000);
    expect(state.off).toEqual({ from: 'claude', at: NOW, chats: ['s1'] });
  });

  it('without a backup, or with a backup that is not ready, waits', () => {
    const none = { format: { primary: 'claude', backup: null }, off: null };
    expect(decideOnLimit({ limitedAgent: 'claude', readyAgents: ready, state: none, now: NOW }).decision.action).toBe('wait');
    expect(decideOnLimit({ limitedAgent: 'claude', readyAgents: ['claude'], state: { format: fmt, off: null }, now: NOW }).decision.action).toBe('wait');
  });

  it('a spent backup does not bounce back to the primary', () => {
    const off = { from: 'claude' as const, at: NOW, chats: ['s1'] };
    expect(decideOnLimit({ limitedAgent: 'codex', readyAgents: ready, state: { format: fmt, off }, now: NOW }).decision.action).toBe('wait');
  });

  it('keeps the original switch-off time when another chat fails over', () => {
    const off = { from: 'claude' as const, at: NOW, chats: ['s1'] };
    const { state } = decideOnLimit({
      limitedAgent: 'claude',
      readyAgents: ready,
      state: { format: fmt, off },
      now: NOW + 60_000,
      chatId: 's2',
    });
    expect(state.off).toEqual({ from: 'claude', at: NOW, chats: ['s1', 's2'] });
  });
});

describe('five hours after switching off', () => {
  const offState = { format: fmt, off: { from: 'claude', at: NOW, chats: ['s1'] } };

  it('before five hours, stays on the backup', () => {
    expect(decideOnTick({ primaryReady: true, state: offState, now: NOW + RETRY_PRIMARY_MS - 1 }).decision.action).toBe('wait');
  });

  it('at five hours, a ready primary is tried again and the switch-off clears', () => {
    const { decision, state } = decideOnTick({ primaryReady: true, state: offState, now: NOW + RETRY_PRIMARY_MS });
    expect(decision).toEqual({ action: 'retry-primary', agent: 'claude' });
    expect(state.off).toBeNull();
  });

  it('at five hours, a still-spent primary stays on the backup and waits another five hours', () => {
    const { decision, state } = decideOnTick({ primaryReady: false, state: offState, now: NOW + RETRY_PRIMARY_MS });
    expect(decision.action).toBe('wait');
    expect(state.off?.at).toBe(NOW + RETRY_PRIMARY_MS);
  });
});

describe('the words', () => {
  it('name the backup in use and the five-hour retry, not a status-bar percent', () => {
    expect(failoverLine('Claude', 'Codex')).toBe('Using Codex. Claude is tried again every 5 hours.');
  });

  it('changing the format drops a switch-off that named a different primary', () => {
    const next = writeFormat({ format: fmt, off: { from: 'claude', at: NOW, chats: ['s1'] } }, { primary: 'codex', backup: 'claude' });
    expect(next.off).toBeNull();
    expect(next.format).toEqual({ primary: 'codex', backup: 'claude' });
  });
});
