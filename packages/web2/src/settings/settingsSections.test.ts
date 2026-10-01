import { describe, expect, it } from 'vitest';

import { settingsSections, unbuiltCount, type SettingsFacts } from './settingsSections';

/**
 * SETTINGS — the owner's own list, answered honestly.
 *
 * Owner walk 2026-08-22: "What are the settings? It says it's not ready yet,
 * right?" followed by the nine things he wanted in there.
 *
 * The rule every test below enforces: a section either shows REAL STATE or
 * says plainly what is missing, and neither is allowed to be an empty frame.
 * Nine headings over nothing is nine promises, and a reader who opens two of
 * them stops opening the rest.
 */

const ATTACHED: SettingsFacts = {
  repoName: 'sequence',
  recentCount: 3,
  sessionCount: 4,
  memoryAvailable: true,
  graphNodes: 685,
  graphEdges: 1575,
  unreadFiles: 56,
  paneCount: 3,
  hookCount: 2,
  pluginCount: 1,
  pluginError: null,
  pluginAskWired: true,
  mcpServerCount: 1,
};

const COLD: SettingsFacts = {
  repoName: null,
  recentCount: 0,
  sessionCount: null,
  memoryAvailable: null,
  graphNodes: 0,
  graphEdges: 0,
  unreadFiles: 0,
  paneCount: 3,
  hookCount: null,
  pluginCount: null,
  pluginError: null,
  pluginAskWired: null,
  mcpServerCount: null,
};

describe("the owner's nine are all present", () => {
  it('carries every section he named, in the order he named them', () => {
    /*
     * ORDER IS HIS. Sorting the finished ones to the top would hide the shape
     * of the list he described, and the shape is the request.
     */
    expect(settingsSections(ATTACHED).map((s) => s.id)).toEqual([
      'default-workspace',
      'open-folder',
      'leave-repo',
      'folder',
      'session-new',
      'session-history',
      'memory',
      'context',
      'windows',
      'planning',
      'skills',
      'tools',
      'mcp-servers',
      'plugins',
    ]);
  });

  it('EVERY section says something — none is an empty frame', () => {
    for (const facts of [ATTACHED, COLD]) {
      for (const section of settingsSections(facts)) {
        expect(section.purpose.length).toBeGreaterThan(20);
        expect(section.state.detail.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('what is real is shown, with its real numbers', () => {
  it('context reports the graph AND what was left out of it', () => {
    const context = settingsSections(ATTACHED).find((s) => s.id === 'context')!;
    expect(context.state.kind).toBe('ready');
    expect(context.state.detail).toMatch(/685 nodes/);
    expect(context.state.detail).toMatch(/1575 edges/);
    /* THE NUMBER THAT MATTERS IS THE ONE LEFT OUT. Coverage is this product's
       strongest claim and the reader should meet it here, not only on an
       answer. */
    expect(context.state.detail).toMatch(/56 source files/);
    expect(context.state.detail).toMatch(/not read/);
  });

  it('context says so plainly when nothing was missed', () => {
    const clean = settingsSections({ ...ATTACHED, unreadFiles: 0 }).find((s) => s.id === 'context')!;
    /* "Nothing was missed" and "we did not check" must not look alike. */
    expect(clean.state.detail).toMatch(/every source file .* was read/i);
  });

  it('history counts sessions, and says so when there are none', () => {
    expect(
      settingsSections(ATTACHED).find((s) => s.id === 'session-history')!.state.detail,
    ).toMatch(/4 sessions/);
    const none = settingsSections({ ...ATTACHED, sessionCount: 0 }).find(
      (s) => s.id === 'session-history',
    )!;
    expect(none.state.kind).toBe('ready');
    /* Zero is an answer. "No sessions yet" and "we could not ask" are different
       facts and must not render the same. */
    expect(none.state.detail).toMatch(/no sessions recorded yet/i);
  });

  it('tools counts hooks, and zero hooks is still a ready section', () => {
    const none = settingsSections({ ...ATTACHED, hookCount: 0 }).find((s) => s.id === 'tools')!;
    expect(none.state.kind).toBe('ready');
    expect(none.state.detail).toMatch(/no hooks configured/i);
  });

  it('TOOLS points at Workspace permissions, not the composer Permission menu', () => {
    const tools = settingsSections({ ...ATTACHED, hookCount: 0 }).find((s) => s.id === 'tools')!;
    expect(tools.state.kind).toBe('ready');
    if (tools.state.kind !== 'ready') return;
    expect(tools.state.detail).toMatch(/Settings → Workspace/i);
    expect(tools.state.detail).toMatch(/not under the composer Permission/i);
    expect(tools.purpose).toMatch(/Workspace Tool permissions/i);
    expect(tools.state.detail).not.toMatch(/permissions are set under the composer/i);
  });

  it('singular and plural both read as English', () => {
    const one = settingsSections({ ...ATTACHED, sessionCount: 1, hookCount: 1, recentCount: 1 });
    expect(one.find((s) => s.id === 'session-history')!.state.detail).toMatch(/1 session\b/);
    expect(one.find((s) => s.id === 'tools')!.state.detail).toMatch(/1 hook\b/);
    expect(one.find((s) => s.id === 'folder')!.state.detail).toMatch(/1 repository\b/);
  });
});

describe('WAITING AND UNBUILT ARE DIFFERENT, and never render alike', () => {
  it('an unanswered server is WAITING, not unbuilt', () => {
    /*
     * "The server has not answered yet" will become an answer. "Not built" will
     * not. Collapsing them would tell a reader a working feature is missing.
     */
    const cold = settingsSections(COLD);
    for (const id of ['session-history', 'memory', 'tools']) {
      expect(cold.find((s) => s.id === id)!.state.kind).toBe('waiting');
    }
  });

  it('SKILLS names the on-disk loader, and does not claim nothing loads (P1 honesty)', () => {
    /*
     * skillLoader injects `.sequence/skills/` into asks. Settings has no skill
     * editor yet — say that, never "Not built / nothing loads".
     */
    const skills = settingsSections(ATTACHED).find((s) => s.id === 'skills')!;
    expect(skills.state.kind).toBe('ready');
    expect(skills.state.detail).toMatch(/\.sequence\/skills/i);
    expect(skills.state.detail).not.toMatch(/not built yet|nothing .*loads/i);
    expect(skills.purpose).toMatch(/instructions/i);
  });

  it('skills waits for attach rather than pretending the feature is missing', () => {
    const skills = settingsSections(COLD).find((s) => s.id === 'skills')!;
    expect(skills.state.kind).toBe('waiting');
    expect(skills.state.detail).toMatch(/attach a repository/i);
    expect(skills.state.detail).not.toMatch(/nothing .*loads/i);
  });

  it('mcp-servers lists count and points at Settings editor (C2.2)', () => {
    const mcp = settingsSections(ATTACHED).find((s) => s.id === 'mcp-servers')!;
    expect(mcp.state.kind).toBe('ready');
    expect(mcp.state.detail).toMatch(/1 MCP server/);
    expect(mcp.state.detail).toMatch(/call_mcp/);
  });

  it('mcp-servers waits for attach rather than inventing a config UI', () => {
    const mcp = settingsSections(COLD).find((s) => s.id === 'mcp-servers')!;
    expect(mcp.state.kind).toBe('waiting');
    expect(mcp.state.detail).toMatch(/attach a repository/i);
  });

  it('plugins lists readonly count and says ask is wired via call_plugin (C2.3)', () => {
    const plugins = settingsSections(ATTACHED).find((s) => s.id === 'plugins')!;
    expect(plugins.state.kind).toBe('ready');
    expect(plugins.state.detail).toMatch(/1 readonly plugin/);
    expect(plugins.state.detail).toMatch(/call_plugin/);
  });

  it('plugins waits for attach rather than inventing a catalog', () => {
    const plugins = settingsSections(COLD).find((s) => s.id === 'plugins')!;
    expect(plugins.state.kind).toBe('waiting');
    expect(plugins.state.detail).toMatch(/Attach a repository/);
  });

  it('skills tell the truth; no unbuilt rows when attached with facts', () => {
    expect(unbuiltCount(settingsSections(ATTACHED))).toBe(0);
    expect(unbuiltCount(settingsSections(COLD))).toBe(0);
  });
});

describe('with nothing attached', () => {
  it('the folder section still offers the one thing that works', () => {
    /* With no repository, opening one is the ONLY useful act — and Attach is
       the door, not this status row. */
    const folder = settingsSections(COLD).find((s) => s.id === 'folder')!;
    expect(folder.state.kind).toBe('ready');
    if (folder.state.kind !== 'ready') return;
    expect(folder.state.detail).toMatch(/Attach/i);
    expect(folder.state.detail).toMatch(/Open a folder/i);
  });

  it('a new session waits, and says what it is waiting for', () => {
    const s = settingsSections(COLD).find((s) => s.id === 'session-new')!;
    expect(s.state.kind).toBe('waiting');
    /* Not "unavailable" — the sentence names the thing the reader can do to
       make it available. */
    expect(s.state.detail).toMatch(/attached first/i);
  });

  it('windows works with no repository at all', () => {
    /* Pane widths are a property of the frame, not of any repository. */
    expect(settingsSections(COLD).find((s) => s.id === 'windows')!.state.kind).toBe('ready');
  });

  it('planning works with no repository at all', () => {
    /* Plan mode is a permission, and permissions are not repository-scoped. */
    expect(settingsSections(COLD).find((s) => s.id === 'planning')!.state.kind).toBe('ready');
  });

  it('PLANNING points at the composer control and does not claim instructions are readable here', () => {
    const s = settingsSections(COLD).find((row) => row.id === 'planning')!;
    expect(s.state.kind).toBe('ready');
    if (s.state.kind !== 'ready') return;
    expect(s.state.detail).toMatch(/composer Permission/i);
    expect(s.state.detail).not.toMatch(/can be read here/i);
  });

  it('MEMORY does not claim Settings can clear the transcript', () => {
    const s = settingsSections(ATTACHED).find((row) => row.id === 'memory')!;
    expect(s.state.kind).toBe('ready');
    if (s.state.kind !== 'ready') return;
    expect(s.state.detail).toMatch(/does not clear/i);
    expect(s.state.detail).not.toMatch(/can be cleared/i);
  });

  it('FOLDER lists recents — Open a folder is the action row', () => {
    const cold = settingsSections(COLD).find((row) => row.id === 'folder')!;
    expect(cold.state.kind).toBe('ready');
    if (cold.state.kind !== 'ready') return;
    expect(cold.state.detail).toMatch(/Open a folder/i);
    expect(cold.purpose).toMatch(/remembers/i);

    const attached = settingsSections(ATTACHED).find((row) => row.id === 'folder')!;
    expect(attached.state.kind).toBe('ready');
    if (attached.state.kind !== 'ready') return;
    expect(attached.state.detail).toMatch(/Reading sequence/i);
  });

  it('OPEN-FOLDER is ready and points at the picker', () => {
    const open = settingsSections(COLD).find((row) => row.id === 'open-folder')!;
    expect(open.state.kind).toBe('ready');
    if (open.state.kind !== 'ready') return;
    expect(open.purpose).toMatch(/Attach/i);
  });

  it('SESSION-NEW does not claim Settings starts a thread', () => {
    const s = settingsSections(ATTACHED).find((row) => row.id === 'session-new')!;
    expect(s.state.kind).toBe('ready');
    if (s.state.kind !== 'ready') return;
    expect(s.state.detail).toMatch(/does not start a thread/i);
    expect(s.state.detail).toMatch(/Sessions/i);
    expect(s.state.detail).not.toMatch(/^Starts an empty thread/i);
    expect(s.purpose).toMatch(/Sessions/i);
  });

  it('WINDOWS does not claim Settings resets pane widths', () => {
    const s = settingsSections(COLD).find((row) => row.id === 'windows')!;
    expect(s.state.kind).toBe('ready');
    if (s.state.kind !== 'ready') return;
    expect(s.state.detail).toMatch(/does not reset/i);
    expect(s.state.detail).not.toMatch(/can be reset/i);
    expect(s.purpose).toMatch(/command palette/i);
  });

  it('MEMORY purpose does not claim Settings forgets for you', () => {
    const s = settingsSections(ATTACHED).find((row) => row.id === 'memory')!;
    expect(s.purpose).toMatch(/Sessions/i);
    expect(s.purpose).not.toMatch(/what you can make it forget/i);
  });
});
