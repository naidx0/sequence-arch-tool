import { describe, expect, it } from 'vitest';

import { mergeMcpServerEntry } from './mcpConfigDraft';

describe('mergeMcpServerEntry', () => {
  it('adds a server to empty JSON', () => {
    const out = mergeMcpServerEntry('', 'demo', 'node', ['server.js']);
    const parsed = JSON.parse(out) as { servers: Record<string, { command: string; args: string[] }> };
    expect(parsed.servers.demo.command).toBe('node');
    expect(parsed.servers.demo.args).toEqual(['server.js']);
  });

  it('merges into existing servers object', () => {
    const base = JSON.stringify({ servers: { a: { command: 'x' } } }, null, 2);
    const out = mergeMcpServerEntry(base, 'b', 'y', []);
    const parsed = JSON.parse(out) as { servers: Record<string, { command: string }> };
    expect(parsed.servers.a.command).toBe('x');
    expect(parsed.servers.b.command).toBe('y');
  });
});
