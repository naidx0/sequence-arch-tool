/* ══════════════════════════════════════════════════════════════════════════
   "Include the architecture map in the agent's context" — on by default
   packages/web2/src/settings/AgentMapSetting.tsx

   GET/PUT /api/agent-settings (packages/analyzer/src/server/askAgentMap.ts).
   The line under the switch says how big the map is that the agent receives
   ("map 3.9k tokens"). The number is the server's count of the exact section
   it puts in the prompt, so it cannot drift from what is sent.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { FailureNote } from '../components/FailureNote';

export interface AgentSettingsView {
  includeArchitectureMap: boolean;
  /** S2a: a coding agent's session gets every board tool, not the core four. */
  allBoardTools?: boolean;
  /** Add a proposed repo note without asking (analyzer refine loop). Off until the person turns it on. */
  autoRefine?: boolean;
  map: { tokens: number } | null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** "map 3.9k tokens", "map 850 tokens". */
export function mapTokensLabel(tokens: number): string {
  return tokens >= 1000 ? `map ${(tokens / 1000).toFixed(1)}k tokens` : `map ${tokens} tokens`;
}

/** The one line under the switch. */
export function agentMapStatus(v: AgentSettingsView | null): string {
  if (!v) return 'Reading the setting…';
  if (!v.includeArchitectureMap) return 'Off: the agent gets no map.';
  if (!v.map) return 'On, but this project has no map yet. It is written when the project is scanned.';
  return `On: ${mapTokensLabel(v.map.tokens)} in every question about this project.`;
}

export function AgentMapSetting({ fetchImpl = fetch }: { fetchImpl?: Fetch }): JSX.Element {
  const [view, setView] = useState<AgentSettingsView | null>(null);
  /* The sentence the reader sees; `detail` is the server's own words, behind Details. */
  const [error, setError] = useState<{ say: string; detail: string } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    fetchImpl('/api/agent-settings', { headers: { accept: 'application/json' } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`the server answered ${r.status}`);
        const v = (await r.json()) as AgentSettingsView;
        if (live.current) setView(v);
      })
      .catch((e: Error) => live.current && setError({ say: 'Could not read this setting.', detail: e.message }));
    return () => {
      live.current = false;
    };
  }, [fetchImpl]);

  const toggle = async (next: boolean, field: 'includeArchitectureMap' | 'allBoardTools' | 'autoRefine' = 'includeArchitectureMap'): Promise<void> => {
    setError(null);
    try {
      const r = await fetchImpl('/api/agent-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      const v = (await r.json()) as AgentSettingsView;
      if (live.current) setView(v);
    } catch (e) {
      if (live.current) setError({ say: 'Could not save this setting.', detail: (e as Error).message });
    }
  };

  const on = view?.includeArchitectureMap ?? true;
  return (
    <section className="sb-group" data-testid="settings-agent-map">
      <h3 className="sb-lab">Architecture map</h3>
      <div className="sb-card">
      <label className="sb-row sb-row-switch">
        <input
          type="checkbox"
          role="switch"
          className="sb-switch"
          data-testid="settings-agent-map-toggle"
          checked={on}
          disabled={view === null}
          onChange={(e) => void toggle(e.currentTarget.checked)}
        />
        {/* Round 7 (A9): the state line sits under its own switch, as every other row's does. */}
        <span className="sb-row-txt">
          <span>Include the architecture map in the agent&rsquo;s context</span>
          <span className="sb-row-sub" data-testid="settings-agent-map-status" role="status">
            {error ? <FailureNote message={error.say} detail={error.detail} testid="settings-agent-map-error" /> : agentMapStatus(view)}
          </span>
        </span>
      </label>
      {/* S2a: Claude and Codex sessions get the board's MCP tools; seven by default (the four map tools and the three drawing tools, about 2k tokens of listing per turn), all sixteen (about 4.1k) when this is on. */}
      <label className="sb-row sb-row-switch">
        <input
          type="checkbox"
          role="switch"
          className="sb-switch"
          data-testid="settings-board-tools-toggle"
          checked={view?.allBoardTools === true}
          disabled={view === null}
          onChange={(e) => void toggle(e.currentTarget.checked, 'allBoardTools')}
        />
        <span className="sb-row-txt">
          <span>Give coding agents every board tool</span>
          <span className="sb-row-sub">All 16 tools, about 4.1k tokens a turn. Off: the map, who calls, impact, the architecture diff and the drawing tools.</span>
        </span>
      </label>
      {/* The refine loop: a note the app proposes after work that fell short. Asked first, unless this is on. */}
      <label className="sb-row sb-row-switch">
        <input
          type="checkbox"
          role="switch"
          className="sb-switch"
          data-testid="settings-auto-refine-toggle"
          checked={view?.autoRefine === true}
          disabled={view === null}
          onChange={(e) => void toggle(e.currentTarget.checked, 'autoRefine')}
        />
        <span className="sb-row-txt">
          <span>Add notes without asking</span>
          <span className="sb-row-sub">When work falls short, the app proposes a one-line note for this project that every agent then reads. Off: you Accept or Dismiss each one. On: a note in your own words is added at once and you can Undo it; a note in the agent's words still waits for you. Applies to every project.</span>
        </span>
      </label>
      </div>
    </section>
  );
}

/* Default export for the lazy import in SettingsPanel. */
export default AgentMapSetting;
