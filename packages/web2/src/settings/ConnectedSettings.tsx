import { useEffect, useState } from 'react';

import { sessionsClient } from '../sessions/sessionsClient';
import { useAppState } from '../state/connect';
import { SettingsPanel, type SettingsPanelProps } from './SettingsPanel';
import { loadWorkspaceCountFacts, type WorkspaceCountFacts } from './settingsFactsLoad';
import type { BootTransport } from '../boot/bootSequence';

/**
 * SETTINGS, WITH THE FACTS IT NEEDS (the overlay host's Settings).
 *
 * The panel draws This workspace / Open a folder / Default workspace only when it is handed `facts`, and the v3 overlay host
 * mounted it without any, so the Workspace tab lost all three (recovery 2026-10-20). Graph size and the repo name come from the
 * store (one answer to "how big is this graph"); the counts the server owns are fetched once when Settings opens. A count not
 * answered stays null ("waiting"), never zero.
 */
export function ConnectedSettings({ recent, ...panel }: Omit<SettingsPanelProps, 'facts'> & { recent: BootTransport['recent'] }) {
  const state = useAppState();
  const repo = state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo : null;
  const graph = repo?.graph ?? null;
  const unscanned = (graph as { unscanned?: { files: number }[] } | null)?.unscanned;
  const paneCount = 1 + (state.shell.chat.open ? 1 : 0) + (state.shell.rail.open ? 1 : 0);

  const [counts, setCounts] = useState<WorkspaceCountFacts | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    const get = async <T,>(url: string) => {
      try {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) return { outcome: 'error' as const };
        return { outcome: 'ok' as const, body: (await r.json()) as T };
      } catch {
        return { outcome: 'unreachable' as const };
      }
    };
    void loadWorkspaceCountFacts({
      recent: () => recent(),
      sessions: () => sessionsClient.list(controller.signal),
      memory: async () => {
        const r = await get<{ turns?: unknown[] }>('/api/chat-memory');
        return r.outcome === 'ok' ? r.body : null;
      },
      hooks: () => panel.client.hooks(controller.signal),
      plugins: () => get('/api/plugins'),
      mcp: () => get('/api/mcp'),
      memorySummary: () => get('/api/memory/summary'),
    }).then(
      (next) => {
        if (live) setCounts(next);
      },
      () => {
        /* an odd answer leaves the counts "waiting"; it never throws into the panel */
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetched once per open; the client and transport are module singletons
  }, []);

  return (
    <SettingsPanel
      {...panel}
      facts={{
        repoName: repo?.repoName ?? null,
        recentCount: counts?.recentCount ?? 0,
        sessionCount: counts?.sessionCount ?? null,
        memoryAvailable: counts?.memoryAvailable ?? null,
        memory: counts?.memory ?? null,
        graphNodes: graph?.nodes.length ?? 0,
        graphEdges: graph?.edges.length ?? 0,
        unreadFiles: (unscanned ?? []).reduce((n, r) => n + r.files, 0),
        paneCount,
        hookCount: counts?.hookCount ?? null,
        pluginCount: counts?.pluginCount ?? null,
        pluginError: counts?.pluginError ?? null,
        pluginAskWired: counts?.pluginAskWired ?? null,
        mcpServerCount: counts?.mcpServerCount ?? null,
      }}
    />
  );
}
