/**
 * Stand-alone entry for the shared find_files host (findFilesHost.ts):
 * `node findFilesHostMain.js --find-files-host <repo>`. The MCP server's own
 * entry (packages/mcp server.ts, and the packaged sequence-mcp.cjs) handles the
 * same flag, so the app never needs this file; tests and library callers do.
 */
import { maybeRunFindFilesHost } from './findFilesHost.js';

if (!maybeRunFindFilesHost()) {
  process.stderr.write('usage: findFilesHostMain.js --find-files-host <repo>\n');
  process.exit(2);
}
