import assert from 'node:assert/strict';
import test from 'node:test';
import { profileForScenario, validateBoardSample, installFirstBoardObserver } from '../lib/first-board-scenario.mjs';

test('fresh profile is empty; restored architecture is an explicit separate subject', () => {
  assert.deepEqual(profileForScenario('fresh'), {});
  const stored = profileForScenario('restored-architecture');
  assert.equal(JSON.parse(stored['v3.chromeTabs']).active, 'architecture');
  assert.throws(() => profileForScenario('unknown'), /scenario/);
});

test('layout observer rejects hidden, seed, failed and unrelated roots before accepting an arranged board', () => {
  const saved = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  let callback;
  globalThis.window = {};
  globalThis.document = {};
  globalThis.MutationObserver = class { constructor(fn) { callback = fn; } observe() {} };
  try {
    installFirstBoardObserver();
    const root = (over = {}) => ({
      matches: () => true, getAttribute: (key) => key === 'data-layout' ? 'idle' : 'true',
      getBoundingClientRect: () => ({ width: 800, height: 600 }), querySelector: () => ({}), ...over,
    });
    const send = (target) => callback([{ target, oldValue: 'laying-out' }]);
    for (const bad of [
      root({ matches: () => false }),
      root({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
      root({ getAttribute: (key) => key === 'data-layout' ? 'idle' : 'false' }),
      root({ getAttribute: (key) => key === 'data-layout' ? 'failed' : 'true' }),
      root({ querySelector: () => null }),
    ]) {
      send(bad);
      assert.equal(window.__seqFirstLayout, undefined);
    }
    send(root());
    assert.equal(window.__seqFirstLayout, 'idle');
  } finally {
    Object.assign(globalThis, saved);
  }
});

test('a ratchet sample requires visible applied Architecture, no corrective click', () => {
  const good = { scenario: 'restored-architecture', boardVisible: true, layout: 'idle', clicks: 0, landedOnBoard: true };
  assert.equal(validateBoardSample(good, true), true);
  for (const bad of [{ boardVisible: false }, { layout: 'failed' }, { layout: null }, { clicks: 1 }, { landedOnBoard: false }, { scenario: 'fresh' }]) {
    assert.throws(() => validateBoardSample({ ...good, ...bad }, true), /first-board/);
  }
  assert.equal(validateBoardSample({ ...good, scenario: 'fresh', clicks: 1, landedOnBoard: false }), true);
});
