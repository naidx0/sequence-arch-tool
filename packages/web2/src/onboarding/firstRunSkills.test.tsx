import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FirstRunSkills } from './FirstRunSkills';
import { createOnboardingClient, type OnboardingClient, type SkillsFound } from './onboardingClient';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { createStore, StoreProvider } from '../state';
import { FirstRunGate, OPEN_SKILLS_FINDER } from './FirstRunGate';
import { SKILLS_PROMPT } from './skillsPrompt';
import { pendingNotice, readPendingSkills, runPendingSkills, savePendingSkills } from './skillsPending';

const cand = (shown: string, kind: 'skill' | 'instructions' = 'skill') => ({ path: `/h/${shown}`, shown, kind, folder: kind === 'skill', slug: shown.split('/').pop()!, bytes: 2048 });
const DEFAULT: SkillsFound = { mode: 'default', looked: ['~/.claude/skills'], unknown: [], truncated: false, skipped: [], candidates: [cand('~/.claude/skills/demo'), cand('~/proj/AGENTS.md', 'instructions')] };

function fake(over: Partial<OnboardingClient> = {}) {
  const find = vi.fn(async (_t: string) => ({ ok: true as const, body: DEFAULT }));
  const imp = vi.fn(async (_t: string, _s: string[]) => ({ ok: true as const, body: { imported: ['demo', 'agents-proj'], kept: [], problems: [] } }));
  const client = { providers: async () => ({ ok: true as const, body: [] }), repos: async () => ({ ok: true as const, body: { repos: [], truncated: false } }), skillsFind: find, skillsImport: imp, ...over } as OnboardingClient;
  return { client, find, imp };
}

describe('First run, skills step: a compact pop-up', () => {
  it('shows a short title, one line, and Bring them, Skip, Choose which; no text field and no path', async () => {
    const f = fake();
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    expect(screen.getByRole('heading').textContent).toBe('Bring your skills?');
    expect(screen.getByTestId('first-run-skills-where').textContent).toBe('Looks in Claude, Codex and Cursor.');
    expect(screen.getByTestId('first-run-skills-bring').className).toContain('fr-primary');
    expect(screen.getByTestId('first-run-skills-skip').className).toContain('fr-ghost');
    expect(screen.getByTestId('first-run-skills-choose').textContent).toBe('Choose which');
    expect(document.querySelector('input[type="text"], input:not([type]), textarea')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\.claude|~\//);
    expect(screen.queryByTestId('first-run-skills-rows')).toBeNull();
  });

  it('Skip is one click and imports nothing; the step does not look until it is on screen', async () => {
    const f = fake();
    const onNext = vi.fn();
    const { rerender } = render(<FirstRunSkills client={f.client} active={false} onNext={onNext} />);
    expect(f.find).not.toHaveBeenCalled();
    rerender(<FirstRunSkills client={f.client} active onNext={onNext} />);
    await waitFor(() => expect(f.find).toHaveBeenCalledWith(''));
    fireEvent.click(screen.getByTestId('first-run-skills-skip'));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(f.imp).not.toHaveBeenCalled();
  });

  it('Bring them imports everything found in one click with no pre-selection list', async () => {
    const f = fake();
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('first-run-skills-bring'));
    await screen.findByTestId('first-run-skills-result');
    expect(f.imp).toHaveBeenCalledWith('', ['/h/~/.claude/skills/demo', '/h/~/proj/AGENTS.md']);
    expect(screen.queryByTestId('first-run-skills-rows')).toBeNull();
  });

  it('Choose which opens a checklist, all checked; Bring N sends only what stays checked', async () => {
    const f = fake();
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('first-run-skills-choose'));
    const checks = (await screen.findAllByTestId('first-run-skills-check')) as HTMLInputElement[];
    expect(checks.map((c) => c.checked)).toEqual([true, true]);
    const names = screen.getAllByTestId('first-run-skills-row').map((r) => r.textContent);
    expect(names).toEqual(['demoClaude', 'AGENTS.mdThis project']);
    expect(names.join(' ')).not.toMatch(/~|[\/]/);
    fireEvent.click(checks[1]!);
    expect(screen.getByTestId('first-run-skills-import').textContent).toBe('Bring 1');
    fireEvent.click(screen.getByTestId('first-run-skills-import'));
    await screen.findByTestId('first-run-skills-result');
    expect(f.imp).toHaveBeenCalledWith('', ['/h/~/.claude/skills/demo']);
  });

  it('nothing found says so and Bring them is off; a refused import shows the server words', async () => {
    const none = fake({ skillsFind: async () => ({ ok: true as const, body: { ...DEFAULT, candidates: [] } }) });
    const { unmount } = render(<FirstRunSkills client={none.client} active onNext={() => {}} />);
    expect((await screen.findByTestId('first-run-skills-where')).textContent).toBe('Nothing found in Claude, Codex or Cursor.');
    expect((screen.getByTestId('first-run-skills-bring') as HTMLButtonElement).disabled).toBe(true);
    unmount();
    const refused = fake({ skillsImport: async () => ({ ok: false as const, message: 'Open a project first.' }) });
    render(<FirstRunSkills client={refused.client} active onNext={() => {}} />);
    await waitFor(() => expect(refused.find).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    expect((await screen.findByTestId('first-run-skills-error')).textContent).toBe('Open a project first.');
  });

  it('the client posts text and selected paths as JSON to the onboarding routes', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      calls.push({ url: String(u), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ imported: [], kept: [], problems: [] }));
    }) as unknown as typeof fetch;
    const c = createOnboardingClient(fetchImpl);
    await c.skillsFind!('codex');
    await c.skillsImport!('codex', ['/a']);
    expect(calls).toEqual([
      { url: '/api/onboarding/skills/find', body: { text: 'codex' } },
      { url: '/api/onboarding/skills/import', body: { text: 'codex', selected: ['/a'] } },
    ]);
  });
});

describe('First run, skills step: the result line and Edit', () => {
  it('one result line names what came in, and Edit removes only the unticked ones by name', async () => {
    const imported = ['demo', 'review-pr', 'a', 'b', 'c'];
    const remove = vi.fn(async (_n: string[]) => ({ ok: true as const, body: { removed: ['review-pr'] } }));
    const f = fake({ skillsImport: async () => ({ ok: true as const, body: { imported, kept: ['older'], problems: [] } }), skillsRemove: remove });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    expect((await screen.findByTestId('first-run-skills-result')).textContent).toBe('Brought 5 skills: demo, review-pr, a, +2.');
    fireEvent.click(screen.getByTestId('first-run-skills-edit'));
    const checks = (await screen.findAllByTestId('first-run-skills-edit-check')) as HTMLInputElement[];
    expect(checks).toHaveLength(5);
    expect(checks.every((c) => c.checked)).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(checks[1]!);
    fireEvent.click(screen.getByTestId('first-run-skills-edit-done'));
    await waitFor(() => expect(screen.getByTestId('first-run-skills-result').textContent).toBe('Brought 4 skills: demo, a, b, +1.'));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(['review-pr']);
  });

  it('when everything was already in the project, the line says so instead of "Brought 0"', async () => {
    const f = fake({ skillsImport: async () => ({ ok: true as const, body: { imported: [], kept: ['demo', 'agents-proj'], problems: [] } }) });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    expect((await screen.findByTestId('first-run-skills-result')).textContent).toBe('Nothing new: already in this project.');
    expect(screen.queryByTestId('first-run-skills-edit')).toBeNull();
    expect(screen.getByTestId('first-run-skills-next')).toBeTruthy();
  });

  it('Done with nothing unticked removes nothing', async () => {
    const remove = vi.fn(async (_n: string[]) => ({ ok: true as const, body: { removed: [] } }));
    const f = fake({ skillsRemove: remove });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    fireEvent.click(await screen.findByTestId('first-run-skills-edit'));
    fireEvent.click(screen.getByTestId('first-run-skills-edit-done'));
    await screen.findByTestId('first-run-skills-result');
    expect(remove).not.toHaveBeenCalled();
  });

  it('with no project open, Bring them waits, and Edit changes what waits (nothing is removed from disk)', async () => {
    window.localStorage.clear();
    const remove = vi.fn();
    const f = fake({ skillsImport: async () => ({ ok: false as const, message: 'Open a project first', needsProject: true }), skillsRemove: remove as never });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    await screen.findByTestId('first-run-skills-result');
    fireEvent.click(screen.getByTestId('first-run-skills-edit'));
    fireEvent.click((await screen.findAllByTestId('first-run-skills-edit-check'))[1]!);
    fireEvent.click(screen.getByTestId('first-run-skills-edit-done'));
    await waitFor(() => expect(screen.getByTestId('first-run-skills-result').textContent).toBe('Saved. 1 will come in when you open a project.'));
    expect(readPendingSkills()).toEqual({ text: '', selected: ['/h/~/.claude/skills/demo'] });
    expect(remove).not.toHaveBeenCalled();
  });

  it('the client posts the names to the remove route', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (u: string, init?: RequestInit) => {
      calls.push({ url: String(u), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ removed: ['demo'] }));
    }) as unknown as typeof fetch;
    await createOnboardingClient(fetchImpl).skillsRemove!(['demo']);
    expect(calls).toEqual([{ url: '/api/onboarding/skills/remove', body: { names: ['demo'] } }]);
  });
});

describe('First run, skills step: the agent row', () => {
  it('with an agent connected, Ask my agent hands the ready prompt over and closes the pop-up', async () => {
    const f = fake();
    const ask = vi.fn();
    const onNext = vi.fn();
    render(<FirstRunSkills client={f.client} active agentConnected onAskAgent={ask} onNext={onNext} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    expect(screen.queryByTestId('first-run-skills-copy-prompt')).toBeNull();
    fireEvent.click(screen.getByTestId('first-run-skills-ask-agent'));
    expect(ask).toHaveBeenCalledTimes(1);
    const prompt = ask.mock.calls[0]![0] as string;
    expect(prompt).toContain('.sequence/skills');
    expect(prompt).toMatch(/skills and instruction/);
    expect(onNext).toHaveBeenCalled();
    expect(f.imp).not.toHaveBeenCalled();
  });

  it('with no agent the row is greyed and Copy prompt puts the same text on the clipboard', async () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const f = fake();
    const ask = vi.fn();
    render(<FirstRunSkills client={f.client} active onAskAgent={ask} onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    expect(screen.getByTestId('first-run-skills-agent').getAttribute('data-live')).toBe('false');
    expect(screen.queryByTestId('first-run-skills-ask-agent')).toBeNull();
    fireEvent.click(screen.getByTestId('first-run-skills-copy-prompt'));
    await waitFor(() => expect(screen.getByTestId('first-run-skills-copy-prompt').textContent).toBe('Copied'));
    expect(writeText).toHaveBeenCalledWith(SKILLS_PROMPT);
    expect(ask).not.toHaveBeenCalled();
  });

  it('when the clipboard refuses, the prompt shows as selected text instead', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    const f = fake();
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('first-run-skills-copy-prompt'));
    const box = (await screen.findByTestId('first-run-skills-prompt-text')) as HTMLTextAreaElement;
    expect(box.value).toBe(SKILLS_PROMPT);
    expect(box.readOnly).toBe(true);
  });

  it('the Settings finder asks the registry and the Ask button drops the prompt in the chat draft', async () => {
    window.localStorage.clear();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ agents: [{ id: 'claude' }] }))) as unknown as typeof fetch;
    try {
      const f = fake();
      const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
      store.dispatch({ type: 'composer/draft', text: 'mine' });
      render(
        <StoreProvider store={store}>
          <FirstRunGate client={f.client} />
        </StoreProvider>,
      );
      act(() => {
        window.dispatchEvent(new CustomEvent(OPEN_SKILLS_FINDER));
      });
      fireEvent.click(await screen.findByTestId('first-run-skills-ask-agent'));
      expect(store.getState().composer.draft).toBe(`mine\n${SKILLS_PROMPT}`);
      await waitFor(() => expect(screen.queryByTestId('skills-finder')).toBeNull());
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('First run, skills step: minimal text, Skip always there', () => {
  it('Escape skips from the ask view and the checklist, and imports nothing', async () => {
    const f = fake();
    const onNext = vi.fn();
    render(<FirstRunSkills client={f.client} active onNext={onNext} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByTestId('first-run-setup-skills'), { key: 'Escape' });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByTestId('first-run-skills-choose'));
    expect(screen.getByTestId('first-run-skills-skip')).toBeTruthy();
    fireEvent.keyDown((await screen.findAllByTestId('first-run-skills-check'))[0]!, { key: 'Escape' });
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(f.imp).not.toHaveBeenCalled();
  });

  it('no line of text is longer than one short line in any state', async () => {
    const f = fake({ skillsImport: async () => ({ ok: true as const, body: { imported: ['demo', 'review-pr', 'a', 'b', 'c'], kept: ['x'], problems: ['y'] } }) });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    const lines = () => Array.from(document.querySelectorAll('.fr-card-t, .fr-card-sub, .fr-agent-l')).map((e) => e.textContent ?? '');
    const states: string[][] = [lines()];
    fireEvent.click(screen.getByTestId('first-run-skills-choose'));
    states.push(lines());
    fireEvent.click(screen.getByTestId('first-run-skills-import'));
    await screen.findByTestId('first-run-skills-result');
    states.push(lines());
    fireEvent.click(screen.getByTestId('first-run-skills-edit'));
    states.push(lines());
    for (const l of states.flat()) expect(l.length, l).toBeLessThanOrEqual(60);
    expect(states[0]!.length).toBeLessThanOrEqual(3);
  });
});

describe('First run, skills confirmed before a project exists', () => {
  it('waits in storage with a plain line, and runs once a project is attached, then forgets', async () => {
    window.localStorage.clear();
    const f = fake({ skillsImport: vi.fn(async () => ({ ok: false as const, message: 'Open a project first', needsProject: true })) });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await waitFor(() => expect(f.find).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    expect((await screen.findByTestId('first-run-skills-result')).textContent).toContain('when you open a project');
    expect(readPendingSkills()).toEqual({ text: '', selected: ['/h/~/.claude/skills/demo', '/h/~/proj/AGENTS.md'] });
    /* Still no project: kept. A project: imported once, then cleared. */
    expect(await runPendingSkills(f.client)).toBeNull();
    expect(readPendingSkills()).not.toBeNull();
    const ok = fake();
    expect((await runPendingSkills(ok.client))?.imported).toEqual(['demo', 'agents-proj']);
    expect(ok.imp).toHaveBeenCalledWith('', ['/h/~/.claude/skills/demo', '/h/~/proj/AGENTS.md']);
    expect(readPendingSkills()).toBeNull();
    expect(await runPendingSkills(ok.client)).toBeNull();
  });
});

describe('Deferred import: when it runs, when it is kept, what it says', () => {
  it('a request that threw keeps the saved import; an HTTP refusal clears it', async () => {
    window.localStorage.clear();
    savePendingSkills({ text: '', selected: ['/a'] });
    const thrown = fake({ skillsImport: async () => ({ ok: false as const, message: 'offline', networkError: true }) });
    expect(await runPendingSkills(thrown.client)).toBeNull();
    expect(readPendingSkills()).not.toBeNull();
    const refused = fake({ skillsImport: async () => ({ ok: false as const, message: 'none were found again' }) });
    expect((await runPendingSkills(refused.client))?.error).toBe('none were found again');
    expect(readPendingSkills()).toBeNull();
  });

  it('the notice line says how many came in, or why not', () => {
    expect(pendingNotice({ imported: ['a', 'b'], kept: [], problems: [] }, 'shop')).toBe('Imported 2 skills into shop.');
    expect(pendingNotice({ imported: [], kept: ['a'], problems: [] }, 'shop')).toContain('already there');
    expect(pendingNotice({ imported: [], kept: [], problems: [], error: 'nope' }, 'shop')).toBe('Skills were not imported: nope');
  });

  it('the gate runs it on a failed attach followed by a scan, once, and shows the line', async () => {
    window.localStorage.clear();
    savePendingSkills({ text: 'claude', selected: ['/a'] });
    const imp = vi.fn(async () => ({ ok: true as const, body: { imported: ['demo'], kept: [], problems: [] } }));
    const f = fake({ skillsImport: imp });
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(
      <StoreProvider store={store}>
        <FirstRunGate client={f.client} />
      </StoreProvider>,
    );
    act(() => store.dispatch({ type: 'repo/failed', attempted: null, failure: { kind: 'outside-browse-root', message: 'x' } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(imp).not.toHaveBeenCalled();
    act(() => store.dispatch({ type: 'repo/scanning', root: '/p', repoName: 'shop', at: 1 }));
    expect((await screen.findByTestId('skills-pending-notice')).textContent).toBe('Imported 1 skill into shop.');
    expect(imp).toHaveBeenCalledTimes(1);
    expect(readPendingSkills()).toBeNull();
  });
});

describe('Skills finder from Settings', () => {
  it('the Settings event opens the same skills step over an attached app, and Skip closes it', async () => {
    window.localStorage.clear();
    const f = fake({});
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    render(
      <StoreProvider store={store}>
        <FirstRunGate client={f.client} />
      </StoreProvider>,
    );
    expect(screen.queryByTestId('skills-finder')).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_SKILLS_FINDER));
    });
    expect(await screen.findByTestId('skills-finder')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('first-run-skills-skip'));
    await waitFor(() => expect(screen.queryByTestId('skills-finder')).toBeNull());
  });
});
