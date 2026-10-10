import { describe, expect, it } from 'vitest';

import { roleIconFor } from './roleIconMap';
import type { KindPresentation } from './kinds';

const service: KindPresentation = { kind: 'service', entry: false };
const agent: KindPresentation = { kind: 'agent', entry: false };
const entryService: KindPresentation = { kind: 'service', entry: true };

describe('roleIconMap — label heuristics to book glyphs', () => {
  it('maps model/llm labels to the model glyph', () => {
    expect(roleIconFor('gpt-4-model', service)).toBe('b-model');
    expect(roleIconFor('order-llm', agent)).toBe('b-model');
  });

  it('maps adapter to module', () => {
    expect(roleIconFor('stripe-adapter', service)).toBe('b-module');
  });

  it('maps datastore/memory/cache/vault to database', () => {
    expect(roleIconFor('redis-cache', service)).toBe('b-db');
    expect(roleIconFor('user-memory', service)).toBe('b-db');
    expect(roleIconFor('orders-datastore', service)).toBe('b-db');
    expect(roleIconFor('secrets-vault', service)).toBe('b-db');
    expect(roleIconFor('api-keystore', service)).toBe('b-db');
  });

  it('maps filesystem-ish labels to file while keeping service chassis', () => {
    expect(roleIconFor('search-tool', agent)).toBe('b-file');
    expect(roleIconFor('dev-toolbox', agent)).toBe('b-file');
    expect(roleIconFor('src/scan.ts', service)).toBe('b-file');
    expect(roleIconFor('archKinds.ts', service)).toBe('b-file');
    expect(roleIconFor('config-file', service)).toBe('b-file');
  });

  it('maps directory-shaped labels to folder', () => {
    expect(roleIconFor('src/lib/', service)).toBe('b-folder');
    expect(roleIconFor('packages-directory', service)).toBe('b-folder');
    expect(roleIconFor('repo-folder', service)).toBe('b-folder');
  });

  it('maps queue/bus/stream/broker to topic', () => {
    expect(roleIconFor('event-bus', service)).toBe('b-queue');
    expect(roleIconFor('order-queue', service)).toBe('b-queue');
    expect(roleIconFor('audit-stream', service)).toBe('b-queue');
    expect(roleIconFor('orders-kafka', service)).toBe('b-queue');
    expect(roleIconFor('events-broker', service)).toBe('b-queue');
  });

  it('maps proxy/cdn/lb to filter', () => {
    expect(roleIconFor('edge-proxy', service)).toBe('b-filter');
    expect(roleIconFor('assets-cdn', service)).toBe('b-filter');
    expect(roleIconFor('api-loadbalancer', service)).toBe('b-filter');
  });

  it('maps skill to agent on board', () => {
    expect(roleIconFor('lint-skill', service)).toBe('b-spark');
  });

  it('keeps kind icon for gateway/router/ingress labels', () => {
    expect(roleIconFor('api-gateway', service)).toBe('b-box');
    expect(roleIconFor('edge-router', { kind: 'module', entry: false })).toBe('b-module');
    expect(roleIconFor('k8s-ingress', service)).toBe('b-box');
  });

  it('draws the way in as a globe, and a gateway in the entry position as its box', () => {
    expect(roleIconFor('api-gateway', entryService)).toBe('b-box');
    expect(roleIconFor('edge', entryService)).toBe('b-globe');
    expect(roleIconFor('redis-cache', entryService)).toBe('b-globe');
  });

  it('falls back to kind silhouette glyph for unmatched labels', () => {
    expect(roleIconFor('checkout', service)).toBe('b-box');
    expect(roleIconFor('billing-worker', agent)).toBe('b-spark');
    expect(roleIconFor('orders-db', { kind: 'storage', entry: false })).toBe('b-db');
  });
});

describe('roleIconMap — LOD icon-yields-first contract', () => {
  it('only uses BoardIcon names that exist in the board glyph set (Decision 49)', () => {
    const names = new Set([
      roleIconFor('gpt-model', service),
      roleIconFor('stripe-adapter', service),
      roleIconFor('redis-cache', service),
      roleIconFor('secrets-vault', service),
      roleIconFor('search-tool', agent),
      roleIconFor('src/scan.ts', service),
      roleIconFor('src/lib/', service),
      roleIconFor('event-bus', service),
      roleIconFor('edge-proxy', service),
      roleIconFor('lint-skill', service),
      roleIconFor('checkout', service),
    ]);
    expect([...names].sort()).toEqual([
      'b-box',
      'b-db',
      'b-file',
      'b-filter',
      'b-folder',
      'b-model',
      'b-module',
      'b-queue',
      'b-spark',
    ]);
  });
});
