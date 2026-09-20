/*
 * THE CARRY STORE — the plumbing that was missing.
 *
 * The case that matters most here is `separateThreads`. Keying this store on
 * `sessionId` would work perfectly in every single-conversation test and would
 * hand one conversation's file names, lists and taught concepts to a DIFFERENT
 * conversation of the same person. That is a privacy fault, not a quality one,
 * and it is invisible unless a test deliberately runs two threads.
 *
 * Registered before the code: docs/research/carry-wiring-registration.md.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_THREADS,
  carryStoreSize,
  carryWiringEnabled,
  readCarry,
  resetCarryStore,
  writeCarry,
} from '../server/carryStore.js';
import { EMPTY_CARRY, extendCarry } from '../server/turnCarry.js';

const withWiring = (on: boolean, fn: () => void): void => {
  const before = process.env.SEQUENCE_ASK_CARRY_WIRE;
  try {
    if (on) process.env.SEQUENCE_ASK_CARRY_WIRE = '1';
    else delete process.env.SEQUENCE_ASK_CARRY_WIRE;
    resetCarryStore();
    fn();
  } finally {
    resetCarryStore();
    if (before === undefined) delete process.env.SEQUENCE_ASK_CARRY_WIRE;
    else process.env.SEQUENCE_ASK_CARRY_WIRE = before;
  }
};

const carryNaming = (name: string) =>
  extendCarry(EMPTY_CARRY, 1, {
    referents: { tool: 'who_calls', subject: name, items: [name], total: 1 },
  });

test('DEFAULT OFF — with the flag unset the store is inert, which is the control arm', () => {
  withWiring(false, () => {
    assert.equal(carryWiringEnabled(), false);
    writeCarry('thread-a', carryNaming('a.ts'));
    assert.equal(readCarry('thread-a'), undefined, 'nothing is stored while the flag is off');
    assert.equal(carryStoreSize(), 0);
  });
});

test('a thread gets back what it carried out', () => {
  withWiring(true, () => {
    writeCarry('thread-a', carryNaming('a.ts'));
    const back = readCarry('thread-a');
    assert.equal(back?.carry.referents?.subject, 'a.ts');
    assert.equal(back?.turnIndex, 1, 'the turn index advances with each stored turn');
  });
});

test('LEAK CASE — two conversations do not share a carry', () => {
  /*
   * The whole reason this store is keyed on the resolved THREAD and not on
   * `sessionId`, which on the ask route is the authenticated USER. If this ever
   * fails, one person's two conversations are bleeding into each other.
   */
  withWiring(true, () => {
    writeCarry('thread-a', carryNaming('secret-a.ts'));
    writeCarry('thread-b', carryNaming('secret-b.ts'));
    assert.equal(readCarry('thread-a')?.carry.referents?.subject, 'secret-a.ts');
    assert.equal(readCarry('thread-b')?.carry.referents?.subject, 'secret-b.ts');
    assert.equal(readCarry('thread-c'), undefined, 'an unknown thread carries nothing');
  });
});

test('NO SHARED BUCKET — an unthreadable turn gets no carry and leaves no trace', () => {
  /* A default bucket for "unknown thread" would be the same leak renamed. */
  withWiring(true, () => {
    writeCarry(undefined, carryNaming('a.ts'));
    writeCarry('', carryNaming('b.ts'));
    assert.equal(carryStoreSize(), 0);
    assert.equal(readCarry(undefined), undefined);
    assert.equal(readCarry(''), undefined);
  });
});

test('BOUNDED — the store never exceeds its cap, and evicts the least recently used', () => {
  withWiring(true, () => {
    for (let i = 0; i < MAX_THREADS; i += 1) writeCarry(`t${i}`, carryNaming(`f${i}.ts`));
    assert.equal(carryStoreSize(), MAX_THREADS);

    /* Touch the oldest so it is no longer the victim. */
    assert.ok(readCarry('t0'));
    writeCarry('overflow', carryNaming('overflow.ts'));

    assert.equal(carryStoreSize(), MAX_THREADS, 'the bound holds');
    assert.ok(readCarry('t0'), 'a thread read recently survives');
    assert.equal(readCarry('t1'), undefined, 'the least recently used was evicted');
  });
});

test('an evicted thread degrades to TODAY, not to an error', () => {
  /* A cache in front of a prompt may only ever fail toward current behaviour. */
  withWiring(true, () => {
    writeCarry('gone', carryNaming('a.ts'));
    for (let i = 0; i < MAX_THREADS; i += 1) writeCarry(`t${i}`, carryNaming(`f${i}.ts`));
    assert.equal(readCarry('gone'), undefined, 'no throw, no empty-carry stub — just nothing');
  });
});

test('a turn that carried nothing still advances the turn index', () => {
  /* Turn numbers are what the rendered block uses to say how old an item is. */
  withWiring(true, () => {
    writeCarry('t', carryNaming('a.ts'));
    writeCarry('t', extendCarry(readCarry('t')!.carry, 2, {}));
    assert.equal(readCarry('t')?.turnIndex, 2);
  });
});
