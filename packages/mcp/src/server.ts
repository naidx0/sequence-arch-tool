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
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { maybeRunFindFilesHost, setFindFilesHostEntry, warmFindFilesShared } from '@sequence/analyzer';
import { createServer, type CreateServerOptions } from './index.js';

/**
 * What a session Sequence starts sets (S2a, analyzer `sequenceMcp.ts`):
 * SEQUENCE_REPO the repository (or worktree) the agent works in, and
 * SEQUENCE_MCP_TOOLS `core` for the small default set. Unset, the server is
 * what a standalone install has always been: every tool, `repoPath` required.
 */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): CreateServerOptions {
  const repo = env.SEQUENCE_REPO?.trim();
  return { tools: env.SEQUENCE_MCP_TOOLS === 'core' ? 'core' : 'all', ...(repo ? { repo } : {}) };
}

export async function main(): Promise<void> {
  /* `<this entry> --find-files-host <repo>`: this process is the one shared find_files index for that repo (analyzer findFilesHost.ts), not an MCP server. */
  if (maybeRunFindFilesHost()) return;
  /* Sessions start the host with this same entry (here, or the packaged sequence-mcp.cjs), by absolute path. */
  if (process.argv[1]) setFindFilesHostEntry(process.argv[1]);
  const opts = optionsFromEnv();
  const server = createServer(opts);
  /* The repo's shared index starts building (or is reached, if another session started it) from the first moment, so the first find_files call finds it warm. Never awaited. */
  if (opts.repo && process.env.SEQUENCE_FIND_FILES_WARM !== '0') warmFindFilesShared(opts.repo);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: never write to stdout here — stdout is the JSON-RPC channel. Any
  // diagnostics must go to stderr so they can't corrupt the protocol stream.
  process.stderr.write('sequence-mcp: ready on stdio\n');
}

/** True when `argv1` is this module, compared by real path too: on macOS the temp folder is /var -> /private/var,
 *  so a bundle started by its /var path saw a /private/var __filename, did not run main() and exited 0 (0.1.4 mac release build). */
export function isEntry(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  if (metaUrl === pathToFileURL(argv1).href) return true;
  try {
    return fs.realpathSync(fileURLToPath(metaUrl)) === fs.realpathSync(argv1);
  } catch {
    return false;
  }
}

const invokedDirectly = isEntry(import.meta.url, process.argv[1]);
if (invokedDirectly) {
  main().catch((e) => {
    process.stderr.write(`sequence-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
