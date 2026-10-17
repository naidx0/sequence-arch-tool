// Entry of dist/claude-agent-acp-launch.mjs: our code only (no third-party code is folded in). Started as
//   <node> claude-agent-acp-launch.mjs <path to the downloaded bridge's dist/index.js>
// it readies the environment (src/server/claudeBoot.ts) and then runs that bridge in this process.
import { pathToFileURL } from 'node:url';
import { prepareClaudeEnv } from '../dist/server/claudeBoot.js';

const entry = process.argv[2];
if (!entry) {
  process.stderr.write('claude-agent-acp-launch: expected the bridge entry file as its argument\n');
  process.exit(2);
}
prepareClaudeEnv();
await import(pathToFileURL(entry).href);
