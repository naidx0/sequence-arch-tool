import { describe, expect, it } from 'vitest';

import {
  NOTIFY_KEY,
  isNotifiable,
  newlyFinished,
  readNotifyEnabled,
  statusMap,
  writeNotifyEnabled,
} from './notifyPreference';

/**
 * THE NOTIFICATION THAT COULD NEVER FIRE.
 *
 * `notifyModel.ts` decides whether to notify and what to say, and it is
 * complete, correct and tested. Either side of it was missing: the user's on/off
 * choice was component-local state that reset on every reload, and nothing
 * anywhere called `runFinishedNotice`. A person could grant the permission,
 * flip a switch that forgot itself, and never hear a thing.
 */

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

describe('the preference survives a reload', () => {
  it('round-trips', () => {
    const store = memory();
    writeNotifyEnabled(true, store);
    expect(readNotifyEnabled(store)).toBe(true);
    writeNotifyEnabled(false, store);
    expect(readNotifyEnabled(store)).toBe(false);
  });

  it('DEFAULTS TO OFF', () => {
    /* A product that notified by default would spend a permission the reader
       never granted on an interruption they never asked for. */
    expect(readNotifyEnabled(memory())).toBe(false);
  });

  it('an unreadable value is OFF, never on', () => {
    /* A corrupt preference must not turn a notification on. */
    const store = memory();
    store.raw.set(NOTIFY_KEY, 'yes-please');
    expect(readNotifyEnabled(store)).toBe(false);
  });

  it('storage that throws costs the preference, not the panel', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readNotifyEnabled(hostile)).toBe(false);
    expect(() => writeNotifyEnabled(true, hostile)).not.toThrow();
  });
});

describe('which runs are worth announcing', () => {
  it('announces a TRANSITION, not a state', () => {
    /*
     * Notifying on every poll that finds a finished run would re-announce the
     * same run every few seconds for as long as it stayed in the list, which
     * is how a person turns notifications off and never turns them back on.
     */
    const before = statusMap([{ id: 'r1', status: 'running' }]);
    const fresh = newlyFinished(before, [{ id: 'r1', status: 'completed' }]);
    expect(fresh).toEqual([{ id: 'r1', status: 'completed' }]);

    /* Second poll, same status: silence. */
    const after = statusMap([{ id: 'r1', status: 'completed' }]);
    expect(newlyFinished(after, [{ id: 'r1', status: 'completed' }])).toEqual([]);
  });

  it('A RUN SEEN FOR THE FIRST TIME ALREADY FINISHED IS NOT ANNOUNCED', () => {
    /*
     * On a fresh load the list arrives full of yesterday's runs. Announcing all
     * of them is the same failure as re-announcing one, in a single burst.
     */
    expect(newlyFinished(new Map(), [{ id: 'r1', status: 'completed' }])).toEqual([]);
  });

  it('says nothing about a run that is still going', () => {
    const before = statusMap([{ id: 'r1', status: 'queued' }]);
    expect(newlyFinished(before, [{ id: 'r1', status: 'running' }])).toEqual([]);
  });

  it('PAUSED counts — it is the one that is a request, not a report', () => {
    /* The case a reader most wants to hear about: a run that stopped needing
       them and is sitting idle until they come back. */
    const before = statusMap([{ id: 'r1', status: 'running' }]);
    expect(newlyFinished(before, [{ id: 'r1', status: 'paused' }])).toEqual([
      { id: 'r1', status: 'paused' },
    ]);
  });

  it('every terminal status is notifiable, and running is not', () => {
    for (const s of ['completed', 'failed', 'stopped', 'paused', 'interrupted']) {
      expect(isNotifiable(s)).toBe(true);
    }
    for (const s of ['running', 'queued', 'unknown']) {
      expect(isNotifiable(s)).toBe(false);
    }
  });

  it('handles several runs finishing between two polls', () => {
    const before = statusMap([
      { id: 'a', status: 'running' },
      { id: 'b', status: 'running' },
    ]);
    const fresh = newlyFinished(before, [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'failed' },
    ]);
    expect(fresh.map((f) => f.id).sort()).toEqual(['a', 'b']);
  });
});
