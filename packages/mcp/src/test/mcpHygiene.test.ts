/**
 * MCP server hygiene — the four things a client reads or pays for BEFORE it ever
 * gets a useful answer out of this server.
 *
 * The MCP position is the strategic bet: Sequence's strongest surface may be as
 * the server Codex and Claude Code CONSUME rather than replace. That only pays
 * off if the server is a good citizen of the protocol, and four things were
 * measured wrong on 2026-08-20:
 *
 *   1. `instructions` was undefined. A client that discovers servers by their
 *      description had nothing to match on — the server was invisible to
 *      tool-search.
 *   2. `who_calls`'s listing entry was 2,390 bytes, over the 2 KB ceiling a
 *      client truncates a tool's advertised text at. The one thing an agent
 *      reads before choosing a tool was being cut off mid-sentence.
 *   3. No tool declared `anthropic/maxResultSizeChars`, so a client had no
 *      server-stated budget for a result that can run to megabytes.
 *   4. `scan_repo` pretty-printed. Measured on this monorepo: 31.5% of the
 *      payload was leading spaces and newlines — nearly a third of the bytes of
 *      the one result whose own description warns it can exhaust a context
 *      window. A share, not a char count: the absolute size moves with the
 *      corpus, the share does not.
 *
 * Every assertion below is on an INVARIANT, not on a figure: sizes are compared
 * against the protocol ceiling and against each other, never against a number
 * measured from this repo's corpus. A corpus number moves every week; see
 * `graphQueryRepo.test.ts` and commit e54f822e for what pinning one costs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, TOOLS } from '../index.js';

/**
 * The truncation ceiling. A client keeps a bounded amount of advertised text per
 * tool; past it the description is cut, and a half-sentence is worse than a
 * short one because the model cannot tell it was truncated.
 */
const TOOL_TEXT_CEILING_BYTES = 2048;

/** The `_meta` key an Anthropic client reads for a server-declared result budget. */
const MAX_RESULT_SIZE_KEY = 'anthropic/maxResultSizeChars';

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** Connect an in-memory Client to a fresh wired server; returns both + cleanup. */
async function connectClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'hygiene-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test('the server declares instructions, so a client discovering by description can find it', async () => {
  const { client, close } = await connectClient();
  try {
    const instructions = client.getInstructions();
    assert.ok(
      typeof instructions === 'string' && instructions.trim() !== '',
      'server declares no `instructions`; tool-search discovery has nothing to match on',
    );
    // Instructions are advertised text like a description, and are truncated the
    // same way. A server that pays the whole budget on its own preamble has
    // nothing left to say that survives.
    assert.ok(
      bytes(instructions) <= TOOL_TEXT_CEILING_BYTES,
      `instructions are ${bytes(instructions)} bytes, over the ${TOOL_TEXT_CEILING_BYTES}-byte ceiling`,
    );
    // The instructions exist to steer a client to the targeted tool rather than
    // the whole-graph dump. If they never name it, they are not doing that job.
    assert.ok(
      instructions.includes('who_calls'),
      'instructions never name `who_calls`, the tool they exist to steer clients toward',
    );
  } finally {
    await close();
  }
});

test('every tool description stays under the 2 KB truncation ceiling', async () => {
  const { client, close } = await connectClient();
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0, 'no tools registered');
    for (const tool of tools) {
      const description = tool.description ?? '';
      assert.ok(description.trim() !== '', `${tool.name} has no description`);
      assert.ok(
        bytes(description) <= TOOL_TEXT_CEILING_BYTES,
        `${tool.name} description is ${bytes(description)} bytes, over the ${TOOL_TEXT_CEILING_BYTES}-byte ceiling`,
      );
    }
  } finally {
    await close();
  }
});

test('every tool listing entry stays under the 2 KB truncation ceiling', async () => {
  const { client, close } = await connectClient();
  try {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      // The description is not the whole story: every `.describe()` on the input
      // shape ships inside `inputSchema` and is read by the same agent, out of
      // the same budget. `who_calls` had a 894-byte description and 1,044 more
      // bytes of argument prose, and the entry the client actually caches came
      // to 2,390 bytes. Measure what is sent, not the half of it that is easy
      // to count.
      const entry = bytes(JSON.stringify(tool));
      assert.ok(
        entry <= TOOL_TEXT_CEILING_BYTES,
        `${tool.name}'s listing entry is ${entry} bytes, over the ${TOOL_TEXT_CEILING_BYTES}-byte ceiling`,
      );
    }
  } finally {
    await close();
  }
});

test('every tool declares a maximum result size, and the targeted tool declares a smaller one than the dump', async () => {
  const { client, close } = await connectClient();
  try {
    const { tools } = await client.listTools();
    const declared = new Map<string, number>();
    for (const tool of tools) {
      const meta = (tool._meta ?? {}) as Record<string, unknown>;
      const value = meta[MAX_RESULT_SIZE_KEY];
      assert.ok(
        typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
        `${tool.name} declares no positive integer ${MAX_RESULT_SIZE_KEY}; got ${JSON.stringify(value)}`,
      );
      declared.set(tool.name, value as number);
    }
    // The whole argument for `who_calls` existing is that it answers one question
    // instead of returning the topology. If it advertises the same budget as
    // `scan_repo`, the server is not telling the client which is which.
    const targeted = declared.get('who_calls');
    const dump = declared.get('scan_repo');
    assert.ok(typeof targeted === 'number' && typeof dump === 'number', 'both tools must be registered');
    assert.ok(
      targeted < dump,
      `who_calls declares ${targeted} and scan_repo declares ${dump}; the targeted tool must budget for less than the whole-graph dump`,
    );
  } finally {
    await close();
  }
});

test('scan_repo does not pretty-print its payload', async () => {
  // A throwaway repo, not `packages/analyzer/test/fixtures/` — `scanRepoCached`
  // writes a graph cache into whatever directory it scans, and the fixtures are
  // not ours to write into.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-mcp-hygiene-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mini', version: '1.0.0' }));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'b.ts'), "import { a } from './a.js';\nexport const b = a + 1;\n");

    const { client, close } = await connectClient();
    try {
      const result = await client.callTool({ name: 'scan_repo', arguments: { repoPath: dir } });
      assert.notEqual(result.isError, true, `scan_repo failed: ${JSON.stringify(result.content)}`);
      const content = (result.content ?? []) as { type: string; text?: string }[];
      const text = content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n');

      // The invariant, not the expression: the payload is byte-identical to the
      // compact serialization of itself. That is true of exactly one formatting
      // — no indent, no spacing — and it survives whatever `JSON.stringify`
      // argument someone reaches for next.
      const parsed: unknown = JSON.parse(text);
      assert.equal(
        text,
        JSON.stringify(parsed),
        `scan_repo is pretty-printed: ${bytes(text)} bytes where ${bytes(JSON.stringify(parsed))} carry the same data`,
      );
    } finally {
      await close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the tool table and the wired server advertise the same surface', async () => {
  // `TOOLS` is exported as the contract; `createServer` is what a client sees.
  // A hygiene rule enforced against the table and not the server is a rule the
  // server can quietly break.
  const { client, close } = await connectClient();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      TOOLS.map((t) => t.name).sort(),
      'the registered tools and the exported TOOLS table have diverged',
    );
  } finally {
    await close();
  }
});
