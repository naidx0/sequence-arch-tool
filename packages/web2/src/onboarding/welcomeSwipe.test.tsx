import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FirstRun } from './FirstRun';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';
import { SWIPE_DISTANCE } from '../shell2/useSwipeDismiss';

/* Decision 52: the welcome track turns a page with a swipe, both ways, on the same thresholds as a sheet's. */

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
beforeAll(() => vi.stubGlobal('PointerEvent', FakePointerEvent));
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const PROVIDERS: ProviderStatus[] = [
  { id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'ready', plan: 'Max', signInCommand: 'claude auth login', installHint: 'npm i -g x' },
];
const onboarding: OnboardingClient = {
  providers: async () => ({ ok: true, body: PROVIDERS }),
  repos: async () => ({ ok: true, body: { repos: [], truncated: false } }),
};
const settings = {
  read: vi.fn(async () => ({ outcome: 'ok' as const, body: { configured: false, localProviders: [], profiles: [] } })),
  write: vi.fn(async () => ({ outcome: 'ok' as const, body: {} })),
  selectProfile: vi.fn(async () => ({ outcome: 'ok' as const, body: {} })),
} as never;

async function toSetup() {
  render(<FirstRun client={onboarding} settings={settings} onDone={vi.fn()} />);
  vi.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response('{"agents":[]}')) as unknown as typeof fetch);
  fireEvent.click((await screen.findAllByTestId('first-run-option')).find((o) => o.getAttribute('data-option') === 'claude')!);
  fireEvent.click(await screen.findByTestId('first-run-start'));
  const setup = await screen.findByTestId('first-run-setup');
  return { setup, view: setup.querySelector<HTMLElement>('.fr-viewport')! };
}

function swipe(view: Element, dx: number, slow = false) {
  let t = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  const base = { bubbles: true, pointerId: 5, pointerType: 'touch', clientY: 200 };
  fireEvent(view, new FakePointerEvent('pointerdown', { ...base, clientX: 300 }));
  for (let i = 1; i <= 4; i++) {
    t += slow ? 300 : 10;
    fireEvent(view, new FakePointerEvent('pointermove', { ...base, clientX: 300 + (dx * i) / 4 }));
  }
  fireEvent(view, new FakePointerEvent('pointerup', { ...base, clientX: 300 + dx }));
}

describe('the welcome track swipes both ways', () => {
  it('a swipe left turns to the next card, a swipe right turns back', async () => {
    const { setup, view } = await toSetup();
    expect(setup.getAttribute('data-step')).toBe('0');
    swipe(view, -(SWIPE_DISTANCE + 40), true);
    expect(setup.getAttribute('data-step')).toBe('1');
    swipe(view, -(SWIPE_DISTANCE + 40), true);
    expect(setup.getAttribute('data-step')).toBe('2');
    swipe(view, SWIPE_DISTANCE + 40, true);
    expect(setup.getAttribute('data-step')).toBe('1');
    swipe(view, SWIPE_DISTANCE + 40, true);
    expect(setup.getAttribute('data-step')).toBe('0');
  });

  it('the first card does not swipe back past the start, and a short slow drag turns nothing', async () => {
    const { setup, view } = await toSetup();
    swipe(view, SWIPE_DISTANCE + 40, true);
    expect(setup.getAttribute('data-step')).toBe('0');
    swipe(view, -(SWIPE_DISTANCE - 20), true);
    expect(setup.getAttribute('data-step')).toBe('0');
    await waitFor(() => expect((setup.querySelector('.fr-track') as HTMLElement).style.transform).toMatch(/\+ 0px\)\)$/));
  });

  it('a quick flick turns a page without the full distance', async () => {
    const { setup, view } = await toSetup();
    swipe(view, -40);
    expect(setup.getAttribute('data-step')).toBe('1');
  });

  it('the track follows the finger while it is down', async () => {
    const { view } = await toSetup();
    const base = { bubbles: true, pointerId: 5, pointerType: 'touch', clientY: 200 };
    fireEvent(view, new FakePointerEvent('pointerdown', { ...base, clientX: 300 }));
    fireEvent(view, new FakePointerEvent('pointermove', { ...base, clientX: 250 }));
    expect((view.querySelector('.fr-track') as HTMLElement).style.transform).toContain('-50px');
    fireEvent(view, new FakePointerEvent('pointercancel', { ...base, clientX: 250 }));
    expect((view.querySelector('.fr-track') as HTMLElement).style.transform).toContain('0px');
  });
});
