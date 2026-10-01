import { describe, expect, it } from 'vitest';

import { roleIconFor } from './roleIconMap';
import type { KindPresentation } from './kinds';

const service: KindPresentation = { kind: 'service', entry: false };
const agent: KindPresentation = { kind: 'agent', entry: false };
const entryService: KindPresentation = { kind: 'service', entry: true };

describe('roleIconMap — label heuristics to book glyphs', () => {
  it('maps model/llm labels to the model glyph', () => {
    expect(roleIconFor('gpt-4-model', service)).toBe('model');
    expect(roleIconFor('order-llm', agent)).toBe('model');
  });

  it('maps adapter to module', () => {
    expect(roleIconFor('stripe-adapter', service)).toBe('module');
  });

  it('maps datastore/memory/cache/vault to database', () => {
    expect(roleIconFor('redis-cache', service)).toBe('database');
    expect(roleIconFor('user-memory', service)).toBe('database');
    expect(roleIconFor('orders-datastore', service)).toBe('database');
    expect(roleIconFor('secrets-vault', service)).toBe('database');
    expect(roleIconFor('api-keystore', service)).toBe('database');
  });

  it('maps filesystem-ish labels to file while keeping service chassis', () => {
    expect(roleIconFor('search-tool', agent)).toBe('file');
    expect(roleIconFor('dev-toolbox', agent)).toBe('file');
    expect(roleIconFor('src/scan.ts', service)).toBe('file');
    expect(roleIconFor('archKinds.ts', service)).toBe('file');
    expect(roleIconFor('config-file', service)).toBe('file');
  });

  it('maps directory-shaped labels to folder', () => {
    expect(roleIconFor('src/lib/', service)).toBe('folder');
    expect(roleIconFor('packages-directory', service)).toBe('folder');
    expect(roleIconFor('repo-folder', service)).toBe('folder');
  });

  it('maps queue/bus/stream/broker to topic', () => {
    expect(roleIconFor('event-bus', service)).toBe('topic');
    expect(roleIconFor('order-queue', service)).toBe('topic');
    expect(roleIconFor('audit-stream', service)).toBe('topic');
    expect(roleIconFor('orders-kafka', service)).toBe('topic');
    expect(roleIconFor('events-broker', service)).toBe('topic');
  });

  it('maps proxy/cdn/lb to filter', () => {
    expect(roleIconFor('edge-proxy', service)).toBe('filter');
    expect(roleIconFor('assets-cdn', service)).toBe('filter');
    expect(roleIconFor('api-loadbalancer', service)).toBe('filter');
  });

  it('maps skill to agent on board', () => {
    expect(roleIconFor('lint-skill', service)).toBe('agent');
  });

  it('keeps kind icon for gateway/router/ingress labels', () => {
    expect(roleIconFor('api-gateway', service)).toBe('service');
    expect(roleIconFor('edge-router', { kind: 'module', entry: false })).toBe('module');
    expect(roleIconFor('k8s-ingress', service)).toBe('service');
  });

  it('keeps base kind icon when entry position is set', () => {
    expect(roleIconFor('api-gateway', entryService)).toBe('service');
    expect(roleIconFor('redis-cache', entryService)).toBe('service');
  });

  it('falls back to kind silhouette glyph for unmatched labels', () => {
    expect(roleIconFor('checkout', service)).toBe('service');
    expect(roleIconFor('billing-worker', agent)).toBe('agent');
    expect(roleIconFor('orders-db', { kind: 'storage', entry: false })).toBe('database');
  });
});

describe('roleIconMap — LOD icon-yields-first contract', () => {
  it('only uses BoardIcon names that exist in the book atlas', () => {
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
      'agent',
      'database',
      'file',
      'filter',
      'folder',
      'model',
      'module',
      'service',
      'topic',
    ]);
  });
});
