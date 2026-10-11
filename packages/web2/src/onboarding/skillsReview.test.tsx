import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { createStore, StoreProvider } from '../state';
import { FirstRun } from './FirstRun';
import { FirstRunGate, OPEN_SKILLS_FINDER } from './FirstRunGate';
import { FirstRunSkills } from './FirstRunSkills';
import type { OnboardingClient, SkillsFound } from './onboardingClient';
import { SKILLS_PROMPT } from './skillsPrompt';

const cand = (n: string) => ({ path: `/h/${n}`, shown: `~/.claude/skills/${n}`, kind: 'skill' as const, folder: true, slug: n, bytes: 100 });
const FOUND = (extra: Partial<SkillsFound> = {}): SkillsFound => ({ mode: 'default', looked: [], unknown: [], truncated: false, skipped: [], candidates: [cand('a'), cand('b')], ...extra });

function fake(over: Partial<OnboardingClient> = {}) {
  const imp = vi.fn(async (_t: string, _s: string[]) => ({ ok: true as const, body: { imported: ['a', 'b'], kept: [], problems: [] as string[] } }));
  const client = {
    providers: async () => ({ ok: true as const, body: [] }),
    repos: async () => ({ ok: true as const, body: { repos: [], truncated: false } }),
    skillsFind: async () => ({ ok: true as const, body: FOUND() }),
    skillsImport: imp,
    ...over,
  } as OnboardingClient;
  return { client, imp };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('review fix 4: a long list is not cut silently', () => {
  it('says "+ more not shown" when the server still truncated', async () => {
    const f = fake({ skillsFind: async () => ({ ok: true as const, body: FOUND({ truncated: true }) }) });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    expect((await screen.findByTestId('first-run-skills-more')).textContent).toContain('+ more not shown');
  });
  it('says nothing when it is not truncated', async () => {
    const f = fake();
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    await screen.findByTestId('first-run-skills-bring');
    expect(screen.queryByTestId('first-run-skills-more')).toBeNull();
  });
});

describe('review fix 5: problems are shown, and a full request runs again for the rest', () => {
  it('asks again when the server says the request was full, and adds up what came in', async () => {
    const cap = 'big: not imported this time (one import takes up to 400 files); press Import again for the rest';
    const imp = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: { imported: ['a'], kept: [], problems: [cap, 'bad: could not be read'] } })
      .mockResolvedValueOnce({ ok: true, body: { imported: ['b'], kept: ['a'], problems: ['bad: could not be read'] } });
    const f = fake({ skillsImport: imp as never });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    expect((await screen.findByTestId('first-run-skills-result')).textContent).toBe('Brought 2 skills: a, b.');
    expect(imp).toHaveBeenCalledTimes(2);
    expect(imp.mock.calls[1]![1]).toEqual(imp.mock.calls[0]![1]);
    const p = screen.getByTestId('first-run-skills-problems');
    expect(p.textContent).toBe('+ 1 not brought');
    expect(p.getAttribute('title')).toBe('bad: could not be read');
  });
  it('stops when a repeat brings nothing new, and names why', async () => {
    const cap = 'big: not imported this time; press Import again for the rest';
    const imp = vi.fn().mockResolvedValue({ ok: true, body: { imported: [], kept: ['a'], problems: [cap] } });
    const f = fake({ skillsImport: imp as never });
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    await screen.findByTestId('first-run-skills-result');
    expect(imp).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('first-run-skills-problems').getAttribute('title')).toContain('big');
  });
});

describe('review fix 6: the live Copy button is not aria-disabled', () => {
  it('the greyed row carries no aria-disabled', async () => {
    const f = fake();
    render(<FirstRunSkills client={f.client} active onNext={() => {}} />);
    const row = await screen.findByTestId('first-run-skills-agent');
    expect(row.getAttribute('data-live')).toBe('false');
    expect(row.hasAttribute('aria-disabled')).toBe(false);
    expect(row.querySelector('[aria-disabled]')).toBeNull();
  });
});

describe('review fix 2: the finder from Settings takes focus, keeps it, and owns Escape', () => {
  async function openFinder() {
    const f = fake();
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    const behind = vi.fn();
    render(
      <StoreProvider store={store}>
        <FirstRunGate client={f.client} />
      </StoreProvider>,
    );
    /* Settings opens after the app is up, so its Escape handler is added after the gate's. */
    window.addEventListener('keydown', behind, true);
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_SKILLS_FINDER));
    });
    await screen.findByTestId('skills-finder');
    return { f, behind, off: () => window.removeEventListener('keydown', behind, true) };
  }

  it('focuses Bring them on open', async () => {
    const { off } = await openFinder();
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('first-run-skills-bring'));
    off();
  });

  it('Escape closes the finder and never reaches a window handler behind it', async () => {
    const { behind, off } = await openFinder();
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('first-run-skills-bring'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('skills-finder')).toBeNull());
    expect(behind).not.toHaveBeenCalled();
    off();
  });

  it('Tab wraps inside the dialog in both directions', async () => {
    const { off } = await openFinder();
    const bring = await screen.findByTestId('first-run-skills-bring');
    await waitFor(() => expect(document.activeElement).toBe(bring));
    const buttons = Array.from(screen.getByTestId('skills-finder').querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea'));
    const last = buttons[buttons.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0]!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    off();
  });

  it('after Bring them and after Edit > Done the focus is on Continue, not the page', async () => {
    const f = fake({ skillsRemove: async () => ({ ok: true as const, body: { removed: [] } }) });
    render(<FirstRunSkills client={f.client} modal active onNext={() => {}} />);
    fireEvent.click(await screen.findByTestId('first-run-skills-bring'));
    const next = await screen.findByTestId('first-run-skills-next');
    await waitFor(() => expect(document.activeElement).toBe(next));
    fireEvent.click(screen.getByTestId('first-run-skills-edit'));
    const done = await screen.findByTestId('first-run-skills-edit-done');
    await waitFor(() => expect(document.activeElement).toBe(done));
    fireEvent.click(done);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('first-run-skills-next')));
  });

  it('Escape works while the first look is still running', async () => {
    let release: (v: unknown) => void = () => {};
    const f = fake({ skillsFind: () => new Promise((r) => (release = r)) as never });
    const onNext = vi.fn();
    render(<FirstRunSkills client={f.client} modal active onNext={onNext} />);
    fireEvent.keyDown(screen.getByTestId('first-run-setup-skills'), { key: 'Escape' });
    expect(onNext).toHaveBeenCalledTimes(1);
    release({ ok: true, body: FOUND() });
  });
});

describe('review fix 3: first run right after connecting an agent offers Ask my agent', () => {
  it('passes the connected flag and hands the prompt to the host, then finishes setup', async () => {
    const onDone = vi.fn();
    const onAsk = vi.fn();
    const f = fake({ providers: async () => ({ ok: true as const, body: [{ id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'ready', plan: 'Max', signInCommand: 'claude auth login', installHint: 'npm i -g x' }] }) });
    render(<FirstRun client={f.client} settings={{ read: async () => ({ outcome: 'ok', body: {} }) } as never} onDone={onDone} onAskAgent={onAsk} />);
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response('{"agents":[]}')) as unknown as typeof fetch);
    fireEvent.click((await screen.findAllByTestId('first-run-option')).find((o) => o.getAttribute('data-option') === 'claude')!);
    fireEvent.click(await screen.findByTestId('first-run-start'));
    await screen.findByTestId('first-run-setup');
    fireEvent.click(screen.getByTestId('first-run-setup-project-skip'));
    fireEvent.click(screen.getByTestId('first-run-setup-trust-skip'));
    const ask = await screen.findByTestId('first-run-skills-ask-agent');
    expect(screen.queryByTestId('first-run-skills-no-agent')).toBeNull();
    fireEvent.click(ask);
    expect(onAsk).toHaveBeenCalledWith(SKILLS_PROMPT);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]![0]).toBe(true);
  });

});
