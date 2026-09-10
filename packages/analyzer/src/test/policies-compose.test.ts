import assert from 'node:assert';
import { test } from 'node:test';
import type { Policy } from '@sequence/schema';
import { composePolicies } from '../policies/compose.js';

const globalPolicy: Policy = {
  version: 1,
  name: 'Global hops',
  rules: [{ kind: 'flag-network-hop' }],
};

const ordersPolicy: Policy = {
  version: 1,
  name: 'Orders latency',
  scope: 'svc:orders',
  rules: [{ kind: 'no-sync-into', target: 'svc:pricing' }],
};

const pricingPolicy: Policy = {
  version: 1,
  name: 'Pricing writes',
  scope: 'svc:pricing',
  rules: [{ kind: 'no-db-write-into', target: 'ds:postgres' }],
};

test('composePolicies: no policies is an honest no-op', () => {
  assert.deepEqual(composePolicies([]), []);
  assert.deepEqual(composePolicies([], 'svc:orders'), []);
});

test('composePolicies: without a service id, only repo-wide policies apply', () => {
  const all = [globalPolicy, ordersPolicy, pricingPolicy];
  assert.deepEqual(composePolicies(all), [globalPolicy]);
});

test('composePolicies: merges global plus service-scoped policies for the named service', () => {
  const all = [globalPolicy, ordersPolicy, pricingPolicy];
  assert.deepEqual(composePolicies(all, 'svc:orders'), [globalPolicy, ordersPolicy]);
  assert.deepEqual(composePolicies(all, 'svc:pricing'), [globalPolicy, pricingPolicy]);
});

test('composePolicies: an unknown service keeps only global policies', () => {
  const all = [globalPolicy, ordersPolicy];
  assert.deepEqual(composePolicies(all, 'svc:reports'), [globalPolicy]);
});

test('composePolicies: preserves filename order within the merged set', () => {
  const a: Policy = { version: 1, name: 'A', rules: [{ kind: 'flag-network-hop' }] };
  const b: Policy = { version: 1, name: 'B', scope: 'svc:orders', rules: [{ kind: 'flag-network-hop' }] };
  const c: Policy = { version: 1, name: 'C', scope: 'svc:orders', rules: [{ kind: 'no-sync-into', target: 'svc:pricing' }] };
  assert.deepEqual(composePolicies([a, b, c], 'svc:orders').map((p) => p.name), ['A', 'B', 'C']);
});
