import assert from 'node:assert';
import { test } from 'node:test';

import { withKind } from '../explain/explain.js';

/* A datastore the scan named "Database" was titled "Database database" on
   the board (codeforge ds:analyzer-db, ml-harness). The kind word is added
   only when the name does not already say it. */

test('a name that already says its kind keeps it once', () => {
  assert.equal(withKind('Database', 'database'), 'Database');
  assert.equal(withKind('Orders database', 'database'), 'Orders database');
  assert.equal(withKind('Analyzer db', 'database'), 'Analyzer database');
  assert.equal(withKind('Session cache', 'cache'), 'Session cache');
  assert.equal(withKind('Data store', 'data store'), 'Data store');
});

test('a name without its kind gets it', () => {
  assert.equal(withKind('Postgres', 'database'), 'Postgres database');
  assert.equal(withKind('Redis', 'cache'), 'Redis cache');
  assert.equal(withKind('Blobs', 'data store'), 'Blobs data store');
});
