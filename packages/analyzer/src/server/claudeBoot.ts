/**
 * What runs inside the bridge process before the bridge does (shared by the full bundle's entry and the
 * launcher that starts a downloaded bridge). Pure environment work; nothing here reads a login.
 *
 *  1. Point the bridge at the person's own signed-in `claude` (CLAUDE_CODE_EXECUTABLE, which the bridge reads).
 *     Only a native `claude` is accepted (see MIN_CLAUDE_VERSION): the SDK starts a JS-entry one as the bare
 *     name `node`, which on Windows is searched in the opened repo first.
 *  2. Drop ELECTRON_RUN_AS_NODE from this process's environment: it started this process as node, and must
 *     not reach `claude` or the tools it runs (an Electron app's CLI would start as plain node).
 */

import { resolveClaudeExecutable } from './claudeCli.js';

export function prepareClaudeEnv(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): void {
  const delegating = argv.includes('--cli') || argv.includes('--version') || argv.includes('-v');
  if (!delegating) {
    const found = resolveClaudeExecutable({ env });
    if (found) env.CLAUDE_CODE_EXECUTABLE = found.path;
    else if (!env.CLAUDE_CODE_EXECUTABLE) {
      process.stderr.write('Claude Code (`claude`) was not found, or is older than Sequence can drive. Install or update it (`claude update`), sign in with `claude auth login`, then try again.\n');
      process.exit(1);
    }
  }
  delete env.ELECTRON_RUN_AS_NODE;
}
