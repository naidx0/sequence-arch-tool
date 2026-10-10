/**
 * Load Settings workspace counts from the engines that already serve them.
 *
 * Kept pure of React so a test can prove Memory / Sessions / Tools leave
 * "waiting" once the routes answer — ConnectedSettings used to hardcode null.
 */

export interface WorkspaceCountFacts {
  recentCount: number;
  sessionCount: number | null;
  memoryAvailable: boolean | null;
  hookCount: number | null;
  /** Readonly plugins from GET /api/plugins; null when not fetched / no repo. */
  pluginCount: number | null;
  /** Honest parse error from plugins.json when present. */
  pluginError: string | null;
  /** Whether ask may dispatch via call_plugin; null when not fetched. */
  pluginAskWired: boolean | null;
  /** MCP server count from GET /api/mcp; null when not fetched. */
  mcpServerCount: number | null;
}

export type CountWire<T> =
  | { outcome: 'ok'; body: T }
  | { outcome: 'error' }
  | { outcome: 'unreachable' }
  | { outcome: 'not-json' };

export async function loadWorkspaceCountFacts(args: {
  recent: () => Promise<CountWire<{ recent: unknown[] }>>;
  sessions: () => Promise<CountWire<{ index: { sessions: unknown[] } }>>;
  memory: () => Promise<{ turns?: unknown[] } | null>;
  hooks: () => Promise<CountWire<{ declared: Record<string, unknown> }>>;
  plugins?: () => Promise<
    CountWire<{ ok: boolean; plugins: unknown[]; error?: string; askWired: boolean }>
  >;
  mcp?: () => Promise<CountWire<{ document: { servers: Record<string, unknown> } }>>;
}): Promise<WorkspaceCountFacts> {
  const [recent, sessions, memory, hooks, plugins, mcp] = await Promise.all([
    args.recent(),
    args.sessions(),
    args.memory(),
    args.hooks(),
    args.plugins ? args.plugins() : Promise.resolve({ outcome: 'unreachable' as const }),
    args.mcp ? args.mcp() : Promise.resolve({ outcome: 'unreachable' as const }),
  ]);

  let pluginCount: number | null = null;
  let pluginError: string | null = null;
  let pluginAskWired: boolean | null = null;
  if (plugins.outcome === 'ok') {
    pluginAskWired = plugins.body.askWired === true;
    if (plugins.body.ok) {
      pluginCount = plugins.body.plugins.length;
    } else {
      pluginCount = 0;
      pluginError = typeof plugins.body.error === 'string' ? plugins.body.error : 'invalid plugins.json';
    }
  }

  let mcpServerCount: number | null = null;
  if (mcp.outcome === 'ok') {
    mcpServerCount = Object.keys(mcp.body.document.servers).length;
  }

  return {
    recentCount: recent.outcome === 'ok' ? recent.body.recent.length : 0,
    sessionCount: sessions.outcome === 'ok' ? sessions.body.index.sessions.length : null,
    memoryAvailable:
      memory === null ? null : Array.isArray(memory.turns) && memory.turns.length > 0,
    hookCount: hooks.outcome === 'ok' ? Object.keys(hooks.body.declared).length : null,
    pluginCount,
    pluginError,
    pluginAskWired,
    mcpServerCount,
  };
}
