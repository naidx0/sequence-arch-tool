import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { EffortFold, ModelMenu } from './ModelMenu';

/*
 * Owner, 2026-10-11: "When it updates the model difficulty based on the model you chose, it should smoothly do that,
 * not be rigid and quick." Picking a model in the agent flyout changes the effort section of the menu: the thumb and
 * fill move to the new range and default, the level read beside "Effort" eases in, and the section's height (a model
 * with no effort, or a "Recommended" caption the last one lacked) folds instead of jumping.
 */

const css = fs.readFileSync(path.join(__dirname, 'modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
const block = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`no rule for ${sel}`);
  return css.slice(i, css.indexOf('\n}', i));
};

function motion(reduce = false) {
  (Element.prototype as unknown as { getAnimations?: () => unknown[] }).getAnimations = () => [];
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as { getAnimations?: unknown }).getAnimations;
  vi.unstubAllGlobals();
});

describe('the effort row moves with the picker own motion', () => {
  it('the thumb, fill, dots and Recommended caption move with --s2-switch-dur/--s2-switch-ease, not the quick --dur-3', () => {
    for (const sel of [".s2-rt[data-ready='true'] .s2-rt-fill", ".s2-rt[data-ready='true'] .s2-rt-thumb", '.s2-rt-dot', '.s2-rt-rec']) {
      const b = block(sel);
      expect(b, sel).toMatch(/transition:[^;]*var\(--s2-switch-dur\) var\(--s2-switch-ease\)/);
      expect(b, sel).not.toMatch(/--dur-3/);
    }
    expect(block('.s2-rt-dot')).toMatch(/transition:\s*left/);
    expect(block('.s2-rt-rec')).toMatch(/transition:[^;]*transform/);
  });

  it('the section height and the level read are animated too, and all of it is off under reduced motion', () => {
    expect(block('.s2-efold')).toMatch(/transition:\s*height var\(--s2-switch-dur\) var\(--s2-switch-ease\)/);
    expect(block('.s2-effort-now')).toMatch(/animation:\s*s2-eff-in var\(--s2-switch-dur\) var\(--s2-switch-ease\)/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce) {\n  .s2-rt-thumb'));
    for (const sel of ['.s2-rt-thumb', '.s2-rt-fill', '.s2-rt-dot', '.s2-rt-rec', '.s2-efold']) expect(reduced, sel).toContain(sel);
    expect(reduced).toMatch(/\.s2-effort-now,[^{]*\{\s*animation:\s*none/);
  });
});

describe('EffortFold: the section folds open and shut instead of jumping', () => {
  it('with motion, a section that goes away stays (not interactive, closing) until it has folded, then goes', () => {
    motion();
    vi.useFakeTimers();
    const { rerender } = render(<EffortFold show={true}><p data-testid="inner">levels</p></EffortFold>);
    expect(screen.getByTestId('inner')).toBeTruthy();
    rerender(<EffortFold show={false}><p data-testid="inner">levels</p></EffortFold>);
    const inner = screen.getByTestId('inner');
    expect(inner.parentElement!.getAttribute('data-state')).toBe('closing');
    expect(inner.parentElement!.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId('inner')).toBeNull();
    rerender(<EffortFold show={true}><p data-testid="inner">levels</p></EffortFold>);
    expect(screen.getByTestId('inner').parentElement!.getAttribute('data-state')).toBe('open');
  });

  it('with reduced motion, or no animation in the DOM, it is just there or not, at once', () => {
    const { rerender } = render(<EffortFold show={true}><p data-testid="inner">levels</p></EffortFold>);
    rerender(<EffortFold show={false}><p data-testid="inner">levels</p></EffortFold>);
    expect(screen.queryByTestId('inner')).toBeNull();
    cleanup();
    motion(true);
    const r2 = render(<EffortFold show={true}><p data-testid="inner">levels</p></EffortFold>);
    r2.rerender(<EffortFold show={false}><p data-testid="inner">levels</p></EffortFold>);
    expect(screen.queryByTestId('inner')).toBeNull();
  });

  it('holds the section at its measured height, so a taller or shorter one is a transition from one number to the next', () => {
    motion();
    const sizes: (() => void)[] = [];
    let h = 70;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          sizes.push(cb);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: 0, top: 0, bottom: h, width: 0, height: h, x: 0, y: 0, toJSON() {} }) as DOMRect);
    render(<EffortFold show={true}><p>levels</p></EffortFold>);
    const fold = screen.getByTestId('s2-effort-fold');
    /* Not the review dock's .s2-fold (edits.css), whose own box rules would shrink it. */
    expect(fold.className.split(' ')).not.toContain('s2-fold');
    expect(fold.style.height).toBe('');
    act(() => sizes.forEach((cb) => cb()));
    expect(fold.style.height).toBe('70px');
    expect(fold.getAttribute('data-moving')).toBe('false');
    h = 92;
    act(() => sizes.forEach((cb) => cb()));
    expect(fold.style.height).toBe('92px');
    expect(fold.getAttribute('data-moving')).toBe('true');
  });
});

/* Through the real menu: pick another model in the flyout and the effort section changes under the open menu. */

const SID = 'chat-1';
const MODELS = [
  { id: 'wide', name: 'Wide', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', isDefault: true },
  { id: 'narrow', name: 'Narrow', efforts: ['low', 'high'], defaultEffort: 'low' },
  { id: 'plain', name: 'Plain', efforts: [] },
];

function stubServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (url === '/api/acp/agents') return json({ agents: [{ id: 'codex', label: 'codex' }] });
      if (url.startsWith('/api/onboarding/providers')) return json({ providers: [{ id: 'codex', label: 'Codex', installed: true, version: '1', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: '' }] });
      if (url.startsWith('/api/acp/capabilities')) return json({ agentRef: 'codex', models: MODELS, efforts: [], commands: [], skills: [] });
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
}

describe('picking a model in the flyout', () => {
  beforeEach(() => {
    resetSignInState();
    agentRuns.patch((s) => ({ ...s, runs: [], agents: { [SID]: 'codex' }, caps: {}, config: {}, capsError: {}, registered: undefined }));
  });

  it('moves the thumb and fill on the same elements to the new range and default (they are not rebuilt), and the read eases in', async () => {
    stubServer();
    render(
      <StoreProvider store={createStore({})}>
        <ModelMenu
          wrapRef={createRef<HTMLDivElement>()}
          open={true}
          onTrigger={() => {}}
          onClose={() => {}}
          sessionId={SID}
          agentRun="codex"
          profiles={[]}
          pickModel={() => {}}
          modelErr={null}
          effort="medium"
          effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
          pickEffort={() => {}}
          modelChip="Codex"
          modelChipShort="Codex"
          modelChipTitle="Codex"
          effortLabel="Medium"
          modes={[]}
          currentMode="plan"
          onMode={() => {}}
        />
      </StoreProvider>,
    );
    const thumb = await screen.findByTestId('s2-effort-thumb', {}, { timeout: 4000 });
    const fill = screen.getByTestId('s2-effort-fill');
    const x = (el: HTMLElement) => el.style.getPropertyValue('--rt-x');
    expect(screen.getByTestId('v3-effort-read').textContent).toBe('High');
    expect(Number(x(thumb))).toBeCloseTo(2 / 3);
    const readBefore = screen.getByTestId('v3-effort-read');
    fireEvent.click(await screen.findByTestId('s2-agent-row'));
    const flyout = await screen.findByTestId('s2-agent-flyout');
    fireEvent.click(within(flyout).getAllByTestId('agent-model').find((m) => m.getAttribute('data-model') === 'narrow')!);
    await waitFor(() => expect(screen.getByTestId('v3-effort-read').textContent).toBe('Low'));
    /* The same thumb and fill, now at the new model's default on its two-level range. */
    expect(screen.getByTestId('s2-effort-thumb')).toBe(thumb);
    expect(screen.getByTestId('s2-effort-fill')).toBe(fill);
    expect(Number(x(thumb))).toBe(0);
    expect(screen.getAllByTestId('agent-effort')).toHaveLength(2);
    /* The read is a new node, so its fade-in plays. */
    expect(screen.getByTestId('v3-effort-read')).not.toBe(readBefore);
  });
});
