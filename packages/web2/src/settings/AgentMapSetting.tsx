/* ══════════════════════════════════════════════════════════════════════════
   "Include the architecture map in the agent's context" — on by default
   packages/web2/src/settings/AgentMapSetting.tsx

   GET/PUT /api/agent-settings (packages/analyzer/src/server/askAgentMap.ts).
   The line under the switch says how big the map is that the agent receives
   ("about 3.9k tokens"). The number is the server's count of the exact section
   it puts in the prompt, so it cannot drift from what is sent. The board-tools
   row reads its count and token cost from the same payload (`tools`, measured
   from the MCP registry), not from a string typed here.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { FailureNote } from '../components/FailureNote';

export interface AgentSettingsView {
  includeArchitectureMap: boolean;
  /** Also send the map to Claude and Codex, once per chat thread. Off until the A/B shows it helps. */
  mapToAgents?: boolean;
  /** S2a: a coding agent's session gets every board tool, not the core four. */
  allBoardTools?: boolean;
  /** Add a proposed repo note without asking (analyzer refine loop). Off until the person turns it on. */
  autoRefine?: boolean;
  map: { tokens: number } | null;
  /** The board's MCP tools as the server counts them (askAgentMap.ts, from the registry). Absent when the server could not read them. */
  tools?: ToolsView | null;
  /** Web search and fetch for agents; on unless the server says otherwise. */
  web?: { enabled: boolean };
  /** The daily update check (privacy line); on unless false. */
  updates?: { check: boolean };
}

export interface ToolsView {
  /** Every board tool. */
  all: number;
  /** The names a session gets by default. */
  core: string[];
  /** Listing tokens of all of them, and of the core ones. */
  allTokens: number;
  coreTokens: number;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** "map 3.9k tokens", "map 850 tokens". */
export function mapTokensLabel(tokens: number): string {
  return tokens >= 1000 ? `map ${(tokens / 1000).toFixed(1)}k tokens` : `map ${tokens} tokens`;
}

/** "about 3.9k tokens", "about 850 tokens". */
export function aboutTokens(tokens: number): string {
  return tokens >= 1000 ? `about ${(tokens / 1000).toFixed(1)}k tokens` : `about ${tokens} tokens`;
}

/** What "turn" means in this pane. */
export const TURN_WORDS = "A turn is one message you send and the agent's full reply.";

/** The core tools in plain words; a name this list does not know is shown with its underscores as spaces. */
const TOOL_WORDS: Record<string, string> = {
  map: 'the map',
  who_calls: 'who calls',
  impact: 'impact',
  architecture_changed: 'the architecture diff',
  list_boards: 'board list',
  create_board: 'new boards',
  draw: 'drawing',
  edit_workflow: 'workflow editing',
  drawings: 'saved drawings',
  visual: 'visuals',
  find_files: 'find files',
};
const toolWord = (name: string): string => TOOL_WORDS[name] ?? name.replace(/_/g, ' ');

/** The line under "Give coding agents every board tool", from the server's registry counts. */
export function boardToolsStatus(t: ToolsView | null | undefined): string {
  if (!t) return 'Every board tool, not only the core set.';
  return `${t.all} tools, ${aboutTokens(t.allTokens)} added to each agent session's tool list.`;
}

/** Its tooltip: what Off gives, and what a turn is. */
export function boardToolsTitle(t: ToolsView | null | undefined): string {
  const off = t ? `Off: the ${t.core.length} core tools (${t.core.map(toolWord).join(', ')}), ${aboutTokens(t.coreTokens)}.` : 'Off: the core tools (the map, who calls, impact, the architecture diff, boards, drawing, workflows, find files).';
  return `${off} ${TURN_WORDS}`;
}

/** The one line under the switch. */
export function agentMapStatus(v: AgentSettingsView | null): string {
  if (!v) return 'Reading the setting…';
  if (!v.includeArchitectureMap) return 'Off: the agent gets no map.';
  if (!v.map || typeof v.map.tokens !== 'number') return 'On, but this project has no map yet. It is written when the project is scanned.';
  return `On: the map is ${aboutTokens(v.map.tokens)}, sent with every question to Sequence's own model. Claude and Codex read it through the map tool when they need it.`;
}

/**
 * The line under "Also send it to Claude and Codex".
 *
 * IT STATES THE SWITCH, like the line above it does. The one fixed sentence
 * this replaces ended "Off until we have measured that it helps" whatever the
 * switch was set to, so a reader who had turned it ON was still being told it
 * was off. The reason it is off by default lives in the row's title instead.
 */
export function mapToAgentsStatus(v: AgentSettingsView | null): string {
  if (!v) return 'Reading the setting…';
  const size = v.map ? aboutTokens(v.map.tokens) : 'a few thousand tokens';
  return v.mapToAgents === true
    ? `On: the map also goes to Claude and Codex — ${size} on the first message of each chat thread, and again when a rescan changes the map.`
    : `Off: Claude and Codex are not sent the map. Turning it on would send ${size} on the first message of each chat thread, and again when a rescan changes the map.`;
}

/** Why the map is off for Claude and Codex until it has been measured. */
export const MAP_TO_AGENTS_TITLE =
  'Off until Sequence has measured that it helps. The map goes in the first message of each chat thread, and again when a rescan changes it.';

/** What a turn is, in the one line the Workspace tab uses. */
export const TURN_DEFINITION = 'A turn is one message from you and the agent’s reply to it.';


/** The longer words behind the board-tools switch (a note under the row, not a hint). */
export const BOARD_TOOLS_NOTE =
  'A tool’s short listing is part of the agent’s context, so each extra tool costs a little on every turn. The map above is separate.';

/** The one line on the compaction row, and the longer words behind it. */
export const COMPACTION_LINE = 'Starts by itself at 95% of the window and leaves a note in the chat.';
export const COMPACTION_DETAIL =
  'When a chat fills 95% of the agent’s context window, Sequence compacts it: a summary replaces the older turns, and a note in the chat says so. Compact, at the top of the chat, does the same on request.';

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

  const toggle = async (next: boolean, field: 'includeArchitectureMap' | 'mapToAgents' | 'allBoardTools' | 'autoRefine' | 'web' = 'includeArchitectureMap'): Promise<void> => {
    setError(null);
    try {
      const r = await fetchImpl('/api/agent-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(field === 'web' ? { web: { enabled: next } } : { [field]: next }),
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
          <span>Give agents the architecture map</span>
          <span className="sb-row-sub" data-testid="settings-agent-map-status" role="status" title={TURN_WORDS}>
            {error ? <FailureNote message={error.say} detail={error.detail} testid="settings-agent-map-error" /> : agentMapStatus(view)}
          </span>
        </span>
      </label>
      <p className="sb-note" data-testid="settings-agent-map-explain">
        A compact text map of your services and how they connect, placed in the agent&rsquo;s context so it starts out knowing the layout. {TURN_DEFINITION}
      </p>
      {/* Sent to Claude and Codex as well: its own switch, off until measured. The main switch governs Sequence's own model only. */}
      <label className="sb-row sb-row-switch">
        <input
          type="checkbox"
          role="switch"
          className="sb-switch"
          data-testid="settings-map-to-agents-toggle"
          checked={view?.mapToAgents === true}
          disabled={view === null}
          onChange={(e) => void toggle(e.currentTarget.checked, 'mapToAgents')}
        />
        <span className="sb-row-txt">
          <span>Also send it to Claude and Codex</span>
          <span className="sb-row-sub" data-testid="settings-map-to-agents-status" role="status" title={MAP_TO_AGENTS_TITLE}>{mapToAgentsStatus(view)}</span>
        </span>
      </label>
      {/* S2a: Claude and Codex sessions get the board's MCP tools: the core set by default, every one when this is on. The counts are the server's (view.tools). */}
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
          <span className="sb-row-sub" data-testid="settings-board-tools-status" title={boardToolsTitle(view?.tools)}>{boardToolsStatus(view?.tools)}</span>
        </span>
      </label>
      <p className="sb-note" data-testid="settings-board-tools-note">{BOARD_TOOLS_NOTE}</p>
      <label className="sb-row sb-row-switch">
        <input
          type="checkbox"
          role="switch"
          className="sb-switch"
          data-testid="settings-web-toggle"
          checked={view?.web?.enabled !== false}
          disabled={view === null}
          onChange={(e) => void toggle(e.currentTarget.checked, 'web')}
        />
        <span className="sb-row-txt">
          <span>Web search and fetch</span>
          <span className="sb-row-sub">Free, no key. Agents can search the web and read pages.</span>
        </span>
      </label>
      <div className="sb-row sb-row-act" data-testid="settings-compaction" title={COMPACTION_DETAIL}>
        <span className="sb-row-txt">
          <span className="sb-row-t">Auto-compaction</span>
          <span className="sb-row-sub" data-testid="settings-compaction-sub">{COMPACTION_LINE}</span>
        </span>
      </div>
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
          <span className="sb-row-sub" title="Off: you Accept or Dismiss each proposed note. On: a note in your own words is added at once and you can Undo it; a note in the agent's words still waits for you. Applies to every project.">Applies to every project. Even on, a note in the agent's words still waits for you.</span>
        </span>
      </label>
      </div>
    </section>
  );
}

/* Default export for the lazy import in SettingsPanel. */
export default AgentMapSetting;
