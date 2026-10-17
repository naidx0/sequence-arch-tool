/**
 * What the board's tools cost an agent, measured from the listing a client really receives.
 *
 * The Settings row "Give coding agents every board tool" used to carry a hard-coded count and token
 * figure ("All 16 tools, about 4.1k tokens") that drifted from the registry (23 tools by 0.1.7). The
 * numbers now come from here: the server is built the way a session builds it, a client lists its
 * tools over an in-memory transport, and the unit is the one s2a-session.test.ts measures,
 * `ceil(JSON listing chars / 4)` (the same rule as the analyzer's agentMap.ts).
 *
 * This module never edits the tool lists; it reads them (index.ts `TOOLS`, `CORE_TOOLS`).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CORE_TOOLS, createServer } from './index.js';

/** A session always has a repository, so `repoPath` is optional and described as defaulting to it. Only the shape of the listing matters, nothing is read. */
const SESSION_REPO = 'session-repo';

/** The unit every listing figure uses: characters of the JSON listing divided by four, rounded up. */
export const listingTokens = (listing: unknown): number => Math.ceil(JSON.stringify(listing).length / 4);

export interface ToolsSummary {
  /** Every tool the server registers. */
  all: number;
  /** The names a session gets by default. */
  core: string[];
  /** Listing tokens of every tool, as one session lists them. */
  allTokens: number;
  /** Listing tokens of the core names. */
  coreTokens: number;
}

async function listAll(): Promise<{ name: string }[]> {
  const server = createServer({ tools: 'all', repo: SESSION_REPO });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tool-listing', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

/** Listing tokens for `names` as a session lists them (unknown names count for nothing). */
export async function toolListingTokens(names: readonly string[]): Promise<number> {
  const want = new Set(names);
  return listingTokens((await listAll()).filter((t) => want.has(t.name)));
}

/** The counts the settings payload carries. */
export async function toolsSummary(): Promise<ToolsSummary> {
  const tools = await listAll();
  const core = new Set(CORE_TOOLS);
  return { all: tools.length, core: [...CORE_TOOLS], allTokens: listingTokens(tools), coreTokens: listingTokens(tools.filter((t) => core.has(t.name))) };
}
