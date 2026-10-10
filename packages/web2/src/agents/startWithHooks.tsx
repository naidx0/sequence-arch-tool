/* ══════════════════════════════════════════════════════════════════════════
   START CLAUDE CODE WITH SEQUENCE'S HOOKS — the empty Agents panel's action
   packages/web2/src/agents/startWithHooks.tsx

   THE EMPTY PANEL IS ONE ACTION (S2b). The server writes this session's hook
   settings (POST /api/agent-hooks/claude: a fresh file, never the user's own
   ~/.claude/settings.json) and records a launch for them.

   Round 7 (A5): "Click to start Claude Code with hooks. Could not start it."
   The command used to be typed into the Terminal tab's shell, which the
   server refuses when no project is attached, while this panel said it was
   running. Now the panel opens its own terminal on the recorded launch: the
   server starts claude with argv (no shell line, no quoting), in the project
   or the home folder, and the panel says what actually happened: running,
   ended, or why it could not start.

   Lazy: the Agents panel is in the boot chunk, and this is drawn only while
   the panel is empty.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';

import { TerminalPane } from '../terminal/TerminalPane';

const pageFetch = (input: string, init?: RequestInit) => fetch(input, init);

type State =
  | { phase: 'idle' }
  | { phase: 'busy' }
  | { phase: 'running'; launchId: string; command: string }
  | { phase: 'ended'; launchId: string; command: string }
  | { phase: 'failed'; error: string };

export default function StartWithHooks({
  fetchImpl = pageFetch,
  Terminal = TerminalPane,
}: {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Test seam: the terminal that runs the launch. */
  Terminal?: typeof TerminalPane;
}) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const start = async (): Promise<void> => {
    setState({ phase: 'busy' });
    try {
      const r = await fetchImpl('/api/agent-hooks/claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const j = (await r.json().catch(() => ({}))) as { command?: string; launchId?: string; error?: string };
      if (!r.ok || !j.command || !j.launchId) throw new Error(j.error ?? `the server answered ${r.status}`);
      setState({ phase: 'running', launchId: j.launchId, command: j.command });
    } catch (e) {
      setState({ phase: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  };
  const busy = state.phase === 'busy' || state.phase === 'running';
  return (
    <div className="ag-empty" data-testid="agents-empty">
      <p className="ag-empty-text">No agent activity yet. Claude Code started with Sequence&apos;s hooks shows up here, on the board, as it works.</p>
      <button type="button" className="s2-btn s2-btn-sm s2-blue ag-empty-act" data-testid="agents-start-hooks" disabled={busy} onClick={() => void start()}>
        {state.phase === 'ended' ? 'Start Claude Code again' : 'Start Claude Code with hooks'}
      </button>
      {state.phase === 'running' || state.phase === 'ended' ? (
        <>
          <p className="ag-empty-text" data-testid="agents-start-command" data-phase={state.phase}>
            {state.phase === 'running' ? 'Claude Code is running with Sequence’s hooks:' : 'Claude Code ended:'} <code>{state.command}</code>
          </p>
          <div className="ag-hooks-term" data-testid="agents-hooks-terminal">
            <Terminal launch={state.launchId} onExit={() => setState((s) => (s.phase === 'running' ? { ...s, phase: 'ended' } : s))} />
          </div>
        </>
      ) : null}
      {state.phase === 'failed' ? (
        <p className="ag-empty-text" role="alert" data-testid="agents-start-failed">
          Could not start Claude Code: {state.error}
        </p>
      ) : null}
    </div>
  );
}
