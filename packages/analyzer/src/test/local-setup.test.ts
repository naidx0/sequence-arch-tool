import assert from 'node:assert';
import os from 'node:os';
import { test } from 'node:test';

import {
  LOCAL_CATALOGUE,
  MODEL_MEMORY_BUDGET,
  MODEL_RUNTIME_OVERHEAD,
  bestInstalled,
  fitsInMemory,
  installedFrom,
  machineProfile,
  memoryBudgetBytes,
  planFrom,
  pullProgressFrom,
  recommendedRung,
  type InstalledModel,
  type MachineProfile,
} from '../server/localSetup.js';

/**
 * ONE CLICK TO A LOCAL MODEL.
 *
 * Owner, 2026-09-19: "render in a one-click local AI setup like Magnitude Dev
 * does." Magnitude profiles the machine and estimates tokens/second for every
 * model before anything is downloaded; we do not estimate speed, because that
 * needs a measured throughput model and a made-up figure is the exact thing
 * this product exists to catch in other tools.
 *
 * What is left is the reader's actual problem, and every test below is one
 * case where getting it wrong is worse than not offering the button at all.
 */

const GB = 1024 * 1024 * 1024;

function machine(totalGb: number): MachineProfile {
  return { totalMemoryBytes: totalGb * GB, freeMemoryBytes: (totalGb / 2) * GB, cpus: 8 };
}

function model(name: string, sizeGb: number): InstalledModel {
  return { name, bytes: sizeGb * GB };
}

test('reads a tag listing, and omits what it cannot read rather than defaulting it', () => {
  const parsed = installedFrom({
    models: [
      { name: 'qwen3:8b', size: 5 * GB, details: { parameter_size: '8.0B' } },
      { name: 'broken', size: 0 },
      { name: '', size: 100 },
      { size: 100 },
      'nonsense',
      { name: 'plain', size: 2 * GB },
    ],
  });
  /*
   * A MODEL LISTED WITH A SIZE OF ZERO SORTS TO THE FRONT of a list ranked by
   * fit, so a default of 0 would be the one wrong value that becomes the
   * recommendation. Dropping the row is the only safe reading.
   */
  assert.deepEqual(parsed.map((m) => m.name), ['qwen3:8b', 'plain']);
  assert.equal(parsed[0]!.parameters, '8.0B');
  assert.equal(parsed[1]!.parameters, undefined);
});

test('a garbage body is an empty inventory, never a throw', () => {
  for (const body of [null, undefined, 42, 'models', {}, { models: 'no' }]) {
    assert.deepEqual(installedFrom(body), []);
  }
});

test('the memory budget leaves the machine room to keep running', () => {
  /*
   * A model that does not fit does not fail — it SWAPS, which looks to the
   * reader like the product having hung and is the one outcome they cannot
   * diagnose. So the budget is a fraction of total, and weights are not the
   * whole cost: the KV cache and runtime need their share too.
   */
  assert.ok(MODEL_MEMORY_BUDGET < 1, 'the model may not have the whole machine');
  assert.ok(MODEL_RUNTIME_OVERHEAD > 1, 'a model needs more than its file');
  const m = machine(16);
  assert.equal(memoryBudgetBytes(m), Math.floor(16 * GB * MODEL_MEMORY_BUDGET));
  assert.equal(fitsInMemory(model('small', 4), m), true);
  assert.equal(fitsInMemory(model('huge', 14), m), false);
});

test('the best installed model is the BIGGEST THAT FITS', () => {
  const m = machine(16);
  const best = bestInstalled(
    [model('tiny', 1), model('mid', 5), model('enormous', 40)],
    m,
  );
  assert.equal(best?.name, 'mid');
});

test('when nothing installed fits, NOTHING is offered', () => {
  /*
   * The honest answer to "everything here is too big" is to say so. Returning
   * the least bad one would hand the reader a machine that stops responding,
   * with the product's own recommendation on it.
   */
  assert.equal(bestInstalled([model('enormous', 40), model('huge', 30)], machine(8)), null);
  assert.equal(bestInstalled([], machine(64)), null);
});

test('the same machine gets the same answer twice', () => {
  /* A recommendation that changes between two identical readings is one
     nobody can report a bug about. */
  const m = machine(32);
  const models = [model('b', 5), model('a', 5), model('c', 5)];
  assert.equal(bestInstalled(models, m)?.name, 'a');
  assert.equal(bestInstalled([...models].reverse(), m)?.name, 'a');
});

test('the catalogue is a ladder with a rung for every machine', () => {
  /*
   * The reader pressing this button has told us they do not want to choose, so
   * the catalogue is one rung per memory tier rather than a list. The last
   * rung must have no floor, or a small machine gets no answer at all.
   */
  const floors = LOCAL_CATALOGUE.map((r) => r.requiresBytes);
  assert.deepEqual(floors, [...floors].sort((a, b) => b - a), 'rungs descend');
  assert.equal(floors[floors.length - 1], 0, 'the last rung fits anything');
  assert.equal(recommendedRung(machine(64)).model, LOCAL_CATALOGUE[0]!.model);
  assert.equal(
    recommendedRung(machine(2)).model,
    LOCAL_CATALOGUE[LOCAL_CATALOGUE.length - 1]!.model,
  );
});

test('NO SIZE IS CLAIMED for a model that is not downloaded', () => {
  /*
   * A download size written into the app is a number that rots the next time
   * the tag is rebuilt, and the reader would watch our stale figure while
   * Ollama reported a different one. The pull reports the real total; the
   * catalogue names a model and a machine floor, and nothing else.
   */
  for (const rung of LOCAL_CATALOGUE) {
    assert.deepEqual(Object.keys(rung).sort(), ['model', 'note', 'requiresBytes']);
  }
});

test('each plan outcome has a case that produces only it', () => {
  const m = machine(16);
  assert.equal(planFrom(false, [], m).outcome, 'needs-ollama');
  assert.equal(planFrom(true, [], m).outcome, 'needs-model');
  assert.equal(planFrom(true, [model('enormous', 40)], m).outcome, 'needs-model');
  assert.equal(planFrom(true, [model('mid', 5)], m).outcome, 'ready');
});

test('"nothing fits" shows what IS installed, so the claim is checkable', () => {
  const plan = planFrom(true, [model('enormous', 40)], machine(8));
  assert.equal(plan.outcome, 'needs-model');
  if (plan.outcome !== 'needs-model') return;
  assert.deepEqual(plan.installed.map((m) => m.name), ['enormous']);
  assert.ok(plan.recommended.length > 0);
});

test('every plan carries the reading it was made from', () => {
  /* "This 8 GB machine gets the 4B" is checkable; "we picked the 4B" is not. */
  for (const plan of [
    planFrom(false, [], machine(8)),
    planFrom(true, [], machine(8)),
    planFrom(true, [model('mid', 2)], machine(8)),
  ]) {
    assert.equal(plan.machine.totalMemoryBytes, 8 * GB);
  }
});

test('the machine profile is read, not invented', () => {
  const p = machineProfile();
  assert.equal(p.totalMemoryBytes, os.totalmem());
  assert.ok(p.cpus > 0);
});

test('pull progress folds every line Ollama actually sends', () => {
  /* The manifest line carries no byte counts, a layer line carries both, and
     an error arrives as a 200 with a body. All three are real shapes. */
  assert.deepEqual(pullProgressFrom({ status: 'pulling manifest' }, 'm'), {
    state: 'pulling',
    model: 'm',
    status: 'pulling manifest',
  });
  assert.deepEqual(pullProgressFrom({ status: 'pulling 0ab', completed: 10, total: 100 }, 'm'), {
    state: 'pulling',
    model: 'm',
    status: 'pulling 0ab',
    completed: 10,
    total: 100,
  });
  assert.equal(pullProgressFrom({ status: 'success' }, 'm')?.state, 'done');
  assert.equal(pullProgressFrom({ error: 'no such model' }, 'm')?.state, 'error');
  assert.equal(pullProgressFrom({}, 'm'), null);
  assert.equal(pullProgressFrom('nope', 'm'), null);
});

test('a byte count is never estimated into the progress', () => {
  /* Without a total there is no percentage, and the UI draws a sweep rather
     than a bar sitting at a number nobody measured. */
  const p = pullProgressFrom({ status: 'verifying sha256' }, 'm');
  assert.equal(p?.total, undefined);
  assert.equal(p?.completed, undefined);
});
