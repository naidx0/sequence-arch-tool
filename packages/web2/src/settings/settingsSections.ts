/* ══════════════════════════════════════════════════════════════════════════
   WHAT SETTINGS IS FOR — the owner's own list, answered honestly
   packages/web2/src/settings/settingsSections.ts

   Owner walk 2026-08-22: "What are the settings? It says it's not ready yet,
   right? … A lot of settings things we can improve on: Open a new folder ·
   Start a new session · Session history · Memory · Context · Windows ·
   Planning · Skills · Tools."

   ── THE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────

   Every section either shows REAL STATE or says plainly what is missing.
   Neither is allowed to be an empty frame.

   That is CANON law 4 — never invent a number — applied to empty states,
   which is where it is usually forgotten. A settings pane with nine headings
   and nothing under them is nine promises, and a reader who opens two of them
   stops opening the rest. "Not built yet, here is what it will do" is a
   smaller disappointment than a blank box, and it is the truth.

   ── AND MOST OF THESE ALREADY HAVE PRODUCERS ─────────────────────────────

   Checked against the server before this file was written:
   `/api/recent` and `/api/attach` (folders), `/api/sessions` (sessions and
   history), `/api/chat-memory` (memory), `/api/hooks` (tools). Panes are local
   shell state. Planning is the mode built in `packages/acp/planMode.ts`.

   Skills are LOADED by the ask harness from `.sequence/skills/` (summaries
   always; full body on match) — there is no Settings editor for them yet, so
   this section tells the reader to edit files on disk rather than claiming
   "nothing loads".

   PURE. Given what the app knows, it returns the list. No fetch, no React.
   ══════════════════════════════════════════════════════════════════════════ */

/** What the app currently knows, narrowed to what these sections need. */
export interface SettingsFacts {
  /** The attached repository's name, or null. */
  repoName: string | null;
  /** How many repositories the server remembers. */
  recentCount: number;
  /** Sessions the server is holding, or null when it has not answered. */
  sessionCount: number | null;
  /** Whether chat memory is reachable. Null means not asked yet. */
  memoryAvailable: boolean | null;
  /** Nodes and edges in the current graph — the context that grounds a turn. */
  graphNodes: number;
  graphEdges: number;
  /** Source files the scan never reached. See `unscanned`. */
  unreadFiles: number;
  /** Panes the shell can show or hide. */
  paneCount: number;
  /** Hook events this repository has handlers for. */
  hookCount: number | null;
  /** Readonly plugins listed from `.sequence/plugins.json` (null = not loaded). */
  pluginCount: number | null;
  /** Parse error from plugins.json when the file is invalid. */
  pluginError: string | null;
  /**
   * Whether ask may dispatch declared plugin tools via `call_plugin`.
   * Null when the plugins route has not answered yet.
   */
  pluginAskWired: boolean | null;
  /** MCP servers from `.sequence/mcp.json` (null = not loaded). */
  mcpServerCount: number | null;
}

export type SectionState =
  /** There is something real to show or change. */
  | { kind: 'ready'; detail: string }
  /**
   * Nothing to show YET, and the reason is a fact about this session — no repo
   * attached, the server has not answered. It will become ready.
   */
  | { kind: 'waiting'; detail: string }
  /**
   * Nothing behind it at all. This is the honest one, and the one a heading
   * over an empty box would have hidden.
   */
  | { kind: 'unbuilt'; detail: string };

export interface SettingsSection {
  id: string;
  title: string;
  /** What this section is for, in the reader's terms. */
  purpose: string;
  state: SectionState;
}

/**
 * The owner's nine, in the order they were asked for.
 *
 * ORDER IS THE OWNER'S, not alphabetical and not by how finished each one is.
 * Sorting the built ones to the top would hide the shape of the list he
 * described, and the shape is the request.
 */
export function settingsSections(facts: SettingsFacts): SettingsSection[] {
  const attached = facts.repoName !== null;

  return [
    {
      id: 'default-workspace',
      title: 'Default workspace',
      purpose: 'Return to the home catalog — every session and repository, not just this project.',
      state: attached
        ? {
            kind: 'ready',
            detail:
              'Leaves the attached repository and shows the full session list again. Same as Leave project in the repo menu.',
          }
        : {
            kind: 'ready',
            detail: 'You are already on the default workspace — every session and repository is visible.',
          },
    },
    {
      id: 'open-folder',
      title: 'Open a folder',
      purpose: 'Attach a different repository (folder picker).',
      state: {
        kind: 'ready',
        detail: attached
          ? `Reading ${facts.repoName}. Choose another folder to switch projects.`
          : 'Nothing attached yet — pick a folder to scan and chat.',
      },
    },
    {
      id: 'leave-repo',
      title: 'Leave this repository',
      purpose: 'Return to the workspace catalog and detach the current project.',
      state: attached
        ? {
            kind: 'ready',
            detail:
              'Stops reading this repository and shows every workspace session again. Same as Leave project in the repo menu or Cmd/Ctrl-K → Leave this repository.',
          }
        : {
            kind: 'waiting',
            detail: 'Nothing is attached right now.',
          },
    },
    {
      id: 'folder',
      title: 'Recent repositories',
      purpose: 'What this machine remembers (Attach lists them too).',
      /*
       * Status only — switching happens via Open a folder above.
       */
      state: attached
        ? {
            kind: 'ready',
            detail:
              facts.recentCount > 0
                ? `Reading ${facts.repoName}. ${facts.recentCount} repositor${facts.recentCount === 1 ? 'y' : 'ies'} remembered.`
                : `Reading ${facts.repoName}.`,
          }
        : {
            kind: 'ready',
            detail:
              facts.recentCount > 0
                ? `${facts.recentCount} repositor${facts.recentCount === 1 ? 'y' : 'ies'} remembered. Open a folder to attach one.`
                : 'Nothing attached yet. Open a folder or use Attach (Cmd/Ctrl-K).',
          },
    },
    {
      id: 'session-new',
      title: 'Start a new session',
      purpose: 'Begin a fresh thread (Sessions — not this list).',
      state: attached
        ? {
            kind: 'ready',
            detail:
              'This panel does not start a thread — open Sessions and use New session against the attached repository.',
          }
        : {
            kind: 'waiting',
            detail: 'A session is a conversation about a repository, so one has to be attached first.',
          },
    },
    {
      id: 'session-history',
      title: 'Session history',
      purpose: 'Every thread this machine has run (switch in Sessions).',
      state:
        facts.sessionCount === null
          ? { kind: 'waiting', detail: 'The server has not answered yet.' }
          : {
              kind: 'ready',
              detail:
                facts.sessionCount === 0
                  ? 'No sessions recorded yet. The first one you run appears under Sessions.'
                  : `${facts.sessionCount} session${facts.sessionCount === 1 ? '' : 's'} recorded. This panel does not open them — switch in Sessions.`,
            },
    },
    {
      id: 'memory',
      title: 'Memory',
      purpose: 'What the assistant carries between turns (clear via a new session in Sessions).',
      state:
        facts.memoryAvailable === null
          ? { kind: 'waiting', detail: 'The server has not answered yet.' }
          : facts.memoryAvailable
            ? {
                kind: 'ready',
                detail:
                  'Chat memory holds this session’s transcript on disk. This panel does not clear it — start a new session from Sessions.',
              }
            : {
                kind: 'waiting',
                detail: 'No memory is stored for this repository yet.',
              },
    },
    {
      id: 'context',
      title: 'Context',
      purpose: 'What actually reaches the model, and what does not.',
      state: attached
        ? {
            kind: 'ready',
            /* THE NUMBER THAT MATTERS IS THE ONE LEFT OUT. Coverage is this
               product's strongest claim, and the reader should be able to see
               it here rather than only on an answer. */
            detail:
              `${facts.graphNodes} nodes and ${facts.graphEdges} edges are available to ground a turn` +
              (facts.unreadFiles > 0
                ? `. ${facts.unreadFiles} source file${facts.unreadFiles === 1 ? '' : 's'} sit outside every service and were not read.`
                : '. Every source file in this repository was read.'),
          }
        : { kind: 'waiting', detail: 'Attach a repository and its graph becomes the context.' },
    },
    {
      id: 'windows',
      title: 'Windows',
      purpose: 'Which shell panes are open, and how wide (reset via command palette).',
      state: {
        kind: 'ready',
        detail:
          facts.paneCount === 1
            ? '1 pane open. Widths are remembered per machine. This panel does not reset them — use the command palette (pane reset).'
            : `${facts.paneCount} panes open. Widths are remembered per machine. This panel does not reset them — use the command palette (pane reset).`,
      },
    },
    {
      id: 'planning',
      title: 'Planning',
      purpose: 'How Sequence behaves when you ask it to think before it touches anything.',
      /*
       * Control lives under the composer Permission menu (planMode.ts). The
       * in-depth PLAN_MODE_INSTRUCTIONS constant is injected into asks when
       * Plan is selected — claiming "can be read here" was a Settings lie.
       */
      state: {
        kind: 'ready',
        detail:
          'Plan mode is the composer Permission control: it reads the repository and changes nothing. In-depth plan instructions are injected into the ask when Plan is selected — this panel does not edit them.',
      },
    },
    {
      id: 'skills',
      title: 'Skills',
      purpose: 'Reusable instructions you can invoke by name.',
      /*
       * LOADED, not editable here. The ask harness injects summaries from
       * `.sequence/skills/<slug>/SKILL.md` on every turn (full body on match).
       * Claiming "nothing loads" was a lie once skillLoader shipped — Settings
       * still has no skill editor, so point at the files.
       */
      state: attached
        ? {
            kind: 'ready',
            detail:
              'Ask loads named skills from `.sequence/skills/*/SKILL.md` (summaries always; full body when the question matches). Edit those files on disk — this panel does not edit them yet.',
          }
        : {
            kind: 'waiting',
            detail:
              'Attach a repository to load skills from its `.sequence/skills/` folder. There is no Settings editor for skills yet.',
          },
    },
    {
      id: 'tools',
      title: 'Tools',
      purpose: 'What the assistant may call (Workspace Tool permissions), and what runs around it.',
      /*
       * Rule file lives on Settings → Workspace (GET/PUT /api/permissions).
       * Composer Permission is plan / auto-edit / full only — pointing Tools
       * at the composer was the same class of door-lie as Planning's old
       * "can be read here".
       */
      state:
        facts.hookCount === null
          ? { kind: 'waiting', detail: 'The server has not answered yet.' }
          : {
              kind: 'ready',
              detail:
                facts.hookCount === 0
                  ? 'No hooks configured for this repository. Tool permissions are edited under Settings → Workspace — not under the composer Permission menu.'
                  : `${facts.hookCount} hook${facts.hookCount === 1 ? '' : 's'} configured. Tool permissions are edited under Settings → Workspace — not under the composer Permission menu.`,
            },
    },
    {
      id: 'mcp-servers',
      title: 'MCP servers',
      purpose: 'Allowlisted tools the assistant may call via call_mcp.',
      /*
       * C2.2: Settings edits `.sequence/mcp.json` via GET/PUT /api/mcp.
       */
      state: !attached
        ? {
            kind: 'waiting',
            detail: 'Attach a repository to configure MCP servers in `.sequence/mcp.json`.',
          }
        : facts.mcpServerCount === null
          ? {
              kind: 'waiting',
              detail: 'The server has not answered the MCP config yet.',
            }
          : {
              kind: 'ready',
              detail:
                facts.mcpServerCount === 0
                  ? 'No MCP servers yet. Add stdio servers below — ask calls them via `call_mcp`.'
                  : `${facts.mcpServerCount} MCP server${facts.mcpServerCount === 1 ? '' : 's'} in \`.sequence/mcp.json\`. Edit below; \`call_mcp\` and /api/mcp/* use this file.`,
            },
    },
    {
      id: 'plugins',
      title: 'Plugins',
      purpose: 'Read-only plugin tools declared in `.sequence/plugins.json` (v0).',
      /*
       * C2.3: Settings lists what is on disk. When askWired, ask may call
       * declared tools via call_plugin (closed builtins; honest no-handler).
       */
      state: !attached
        ? {
            kind: 'waiting',
            detail:
              'Attach a repository to list plugins from `.sequence/plugins.json`.',
          }
        : facts.pluginCount === null
          ? {
              kind: 'waiting',
              detail: 'The server has not answered the plugins list yet.',
            }
          : facts.pluginError
            ? {
                kind: 'ready',
                detail: `Could not read plugins.json: ${facts.pluginError}. Fix the file on disk — Settings does not invent tools.`,
              }
            : {
                kind: 'ready',
                detail:
                  facts.pluginCount === 0
                    ? 'No plugins in `.sequence/plugins.json`. Edit that file to declare readonly tools; ask calls them via `call_plugin` when listed.'
                    : `${facts.pluginCount} readonly plugin${facts.pluginCount === 1 ? '' : 's'} listed from \`.sequence/plugins.json\`. Ask may call declared tools via \`call_plugin\` (builtins with handlers only; others refuse honestly).`,
              },
    },
  ];
}

/** How many sections have nothing behind them. Used for an honest header line. */
export function unbuiltCount(sections: readonly SettingsSection[]): number {
  return sections.filter((s) => s.state.kind === 'unbuilt').length;
}
