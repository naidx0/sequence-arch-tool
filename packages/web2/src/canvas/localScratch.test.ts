import { describe, expect, it } from 'vitest';

import {
  emptyScratchDoc,
  isScratchDoc,
  loadScratchDoc,
  migrateLegacyWorkspaceScratch,
  readScratch,
  resolveScratchSessionId,
  scratchKey,
  writeScratch,
  type ScratchStorage,
} from './localScratch';

function memoryStorage(seed: Record<string, string> = {}): ScratchStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe('localScratch', () => {
  it('keys scratch by session id (workspace when none)', () => {
    expect(resolveScratchSessionId(null)).toBe('workspace');
    expect(resolveScratchSessionId('session-a')).toBe('session-a');
    expect(scratchKey('session-a')).toBe('sequence.arch-scratch.session-a');
  });

  it('round-trips a scratch doc through storage', () => {
    const storage = memoryStorage();
    const doc = emptyScratchDoc('s1');
    expect(isScratchDoc(doc)).toBe(true);
    writeScratch(storage, 's1', {
      ...doc,
      nodes: [{ id: 'n1', label: 'Harness', kind: 'service' }],
      edges: [],
    });
    const loaded = loadScratchDoc(storage, 's1');
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0]?.label).toBe('Harness');
    expect(isScratchDoc(loaded)).toBe(true);
  });

  it('returns empty scratch when missing or corrupt', () => {
    const storage = memoryStorage({ [scratchKey('bad')]: '{not-json' });
    expect(readScratch(storage, 'missing')).toBeNull();
    expect(readScratch(storage, 'bad')).toBeNull();
    expect(loadScratchDoc(storage, 'missing').nodes).toEqual([]);
  });

  it('migrates legacy workspace scratch into a real session id once', () => {
    const storage = memoryStorage();
    const legacy = emptyScratchDoc('workspace');
    writeScratch(storage, 'workspace', {
      ...legacy,
      nodes: [{ id: 'svc:orders', label: 'orders', kind: 'service' }],
    });
    expect(migrateLegacyWorkspaceScratch(storage, 'session-a')).toBe(true);
    expect(storage.getItem(scratchKey('workspace'))).toBeNull();
    expect(loadScratchDoc(storage, 'session-a').nodes).toHaveLength(1);
    expect(migrateLegacyWorkspaceScratch(storage, 'session-a')).toBe(false);
  });

  it('does not migrate workspace scratch over an existing session key', () => {
    const storage = memoryStorage();
    writeScratch(storage, 'workspace', {
      ...emptyScratchDoc('workspace'),
      nodes: [{ id: 'svc:legacy', label: 'legacy', kind: 'service' }],
    });
    writeScratch(storage, 'session-a', {
      ...emptyScratchDoc('session-a'),
      nodes: [{ id: 'svc:current', label: 'current', kind: 'service' }],
    });
    expect(migrateLegacyWorkspaceScratch(storage, 'session-a')).toBe(false);
    expect(loadScratchDoc(storage, 'session-a').nodes[0]?.id).toBe('svc:current');
    expect(storage.getItem(scratchKey('workspace'))).toBeTruthy();
  });

  it('keeps scratch isolated per session id', () => {
    const storage = memoryStorage();
    writeScratch(storage, 'session-a', {
      ...emptyScratchDoc('session-a'),
      nodes: [{ id: 'svc:a', label: 'A', kind: 'service' }],
    });
    writeScratch(storage, 'session-b', {
      ...emptyScratchDoc('session-b'),
      nodes: [{ id: 'svc:b', label: 'B', kind: 'service' }],
    });
    expect(loadScratchDoc(storage, 'session-a').nodes[0]?.label).toBe('A');
    expect(loadScratchDoc(storage, 'session-b').nodes[0]?.label).toBe('B');
  });
});
