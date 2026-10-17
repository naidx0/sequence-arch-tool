/**
 * toolListing.ts: the figures behind the Settings row "Give coding agents every board tool".
 * The copy used to say "All 16 tools, about 4.1k tokens" while the registry had 23; these tests tie
 * the numbers to the registry and to the listing a session really gets (the s2a measurement).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CORE_TOOLS, TOOLS, createServer } from '../index.js';
import { listingTokens, toolListingTokens, toolsSummary } from '../toolListing.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(HERE, '../../../..', 'packages/analyzer/test/fixtures/shopfront');
const SERVER_JS = path.resolve(HERE, '..', 'server.js');

async function listed(tools: 'core' | 'all') {
  const server = createServer({ tools, repo: SHOPFRONT });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'listing-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

test('the count is the registry: all equals TOOLS.length and core equals CORE_TOOLS (not a number typed in a settings row)', async () => {
  const s = await toolsSummary();
  assert.equal(s.all, TOOLS.length);
  assert.ok(TOOLS.length > 16, 'the old copy said 16');
  assert.deepEqual(s.core, [...CORE_TOOLS]);
  for (const n of s.core) assert.ok(TOOLS.some((t) => t.name === n), n);
});

test('toolListingTokens(CORE_TOOLS) is the listing s2a-session measures for a core session, and all is the whole listing', async () => {
  const core = listingTokens(await listed('core'));
  const all = listingTokens(await listed('all'));
  const got = await toolListingTokens(CORE_TOOLS);
  assert.ok(Math.abs(got - core) <= Math.ceil(core * 0.01), `core ${got} vs measured ${core}`);
  const s = await toolsSummary();
  assert.equal(s.coreTokens, got);
  assert.ok(Math.abs(s.allTokens - all) <= Math.ceil(all * 0.01), `all ${s.allTokens} vs measured ${all}`);
  assert.ok(s.allTokens > s.coreTokens);
  assert.equal(await toolListingTokens([]), listingTokens([]));
  assert.equal(await toolListingTokens(['no_such_tool']), listingTokens([]));
});

test('the stdio entry prints the same summary with --listing and exits', () => {
  const out = execFileSync(process.execPath, [SERVER_JS, '--listing'], { encoding: 'utf8', timeout: 60_000 });
  const parsed = JSON.parse(out.trim().split('\n').pop()!) as { all: number; core: string[]; allTokens: number; coreTokens: number };
  assert.equal(parsed.all, TOOLS.length);
  assert.deepEqual(parsed.core, [...CORE_TOOLS]);
  assert.ok(parsed.allTokens > parsed.coreTokens && parsed.coreTokens > 0);
});
