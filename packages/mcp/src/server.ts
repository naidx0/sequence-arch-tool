#!/usr/bin/env node
/**
 * The `sequence-mcp` stdio entrypoint. Builds the wired MCP server (see
 * ./index.ts) and connects it over stdio so an MCP client (e.g. Claude Desktop)
 * can list and call Sequence's tools.
 *
 * `main()` auto-runs ONLY when this file is the process entrypoint — the same
 * `import.meta.url === pathToFileURL(process.argv[1])` idiom the analyzer CLI
 * uses — so importing this module (e.g. from a test) never starts a transport.
 */
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './index.js';

export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: never write to stdout here — stdout is the JSON-RPC channel. Any
  // diagnostics must go to stderr so they can't corrupt the protocol stream.
  process.stderr.write('sequence-mcp: ready on stdio\n');
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {
    process.stderr.write(`sequence-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
