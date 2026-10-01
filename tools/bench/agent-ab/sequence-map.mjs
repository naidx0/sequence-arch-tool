#!/usr/bin/env node
/*
 * sequence-map — the Sequence MCP tools as one shell command, for the bash agent.
 *
 *   sequence-map who_calls <name> [--imports]
 *   sequence-map impact <node>
 *   sequence-map path_between <from> <to>
 *
 * Runs against the current directory. Calls the same handlers the MCP server
 * registers (packages/mcp/dist/index.js TOOLS), so the bash agent and an MCP
 * client get the same answers.
 */
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const { TOOLS } = await import(url.pathToFileURL(path.resolve(HERE, '..', '..', '..', 'packages', 'mcp', 'dist', 'index.js')).href);
const [cmd, ...rest] = process.argv.slice(2);
const repoPath = process.cwd();
const tool = TOOLS.find((t) => t.name === cmd);
const usage = 'usage: sequence-map who_calls <name> [--imports] | impact <node> | path_between <from> <to>';
if (!tool || !['who_calls', 'impact', 'path_between'].includes(cmd)) {
  console.log(usage);
  process.exit(2);
}
const pos = rest.filter((a) => !a.startsWith('--'));
const input =
  cmd === 'who_calls'
    ? { repoPath, name: pos[0], includeImports: rest.includes('--imports') || undefined }
    : cmd === 'impact'
      ? { repoPath, node: pos[0] }
      : { repoPath, from: pos[0], to: pos[1] };
if (Object.values(input).some((v) => v === undefined && v !== input.includeImports)) {
  console.log(usage);
  process.exit(2);
}
const r = await tool.handler(input);
for (const c of r.content ?? []) if (c.type === 'text') console.log(c.text);
process.exit(r.isError ? 1 : 0);
