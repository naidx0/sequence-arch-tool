// Entry of the FULL bridge bundle (SEQUENCE_BUNDLE_CLAUDE_BRIDGE=1 builds only): readies the environment,
// then runs the bridge folded into the same file. See src/server/claudeBoot.ts.
import { prepareClaudeEnv } from '../dist/server/claudeBoot.js';

prepareClaudeEnv();
await import('@agentclientprotocol/claude-agent-acp/dist/index.js');
