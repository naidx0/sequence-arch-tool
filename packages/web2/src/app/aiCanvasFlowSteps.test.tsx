import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SeqChart } from '@sequence/schema';

import { createStore, StoreProvider } from '../state';
import type { CanvasDoc } from '../state/types';
import { AiCanvas, ConnectedAiCanvas } from './AiCanvas';
import { materializeCanvasArtifacts } from './materializeCanvasArtifacts';

/*
 * THE FLOW, PLAYED ON THE AI CANVAS — owner, 2026-09-22: "a detailed maybe even
 * animated diagram on the AI canvas which shows the flows coming from engine
 * sending all of the AI token requests into the harness".
 *
 * WHAT THESE READ: the rendered DOM's `data-active` / `data-focused` /
 * `data-dim` attributes and the stepper's own count. They prove which hop is
 * lit and that the cursor moves; they do NOT prove the dash marches — jsdom
 * paints no CSS, and that is a screenshot's job.
 */
const flow: SeqChart = {
  version: 1,
  kind: 'data-flow',
  title: 'A token request, hop by hop',
  items: [
    { id: 'engine', label: 'Engine' },
    { id: 'provider', label: 'Provider' },
    { id: 'model', label: 'Model' },
    { id: 'harness', label: 'Harness' },
  ],
  links: [
    { from: 'engine', to: 'provider' },
    { from: 'provider', to: 'model' },
    { from: 'model', to: 'harness' },
  ],
  steps: [
    { from: 'engine', to: 'provider', says: 'the request' },
    { from: 'provider', to: 'model', says: 'tokens', detail: 'the prompt goes out as tokens' },
    { from: 'model', to: 'harness', says: 'the answer' },
  ],
};
const { steps: _steps, ...plain } = flow;

function reducedMotion(on: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: on && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

const edge = (key: string) => document.querySelector(`[data-item="${key}"]`);
const item = (id: string) => document.querySelector(`.seqchart [data-item="${id}"]`);
const count = () => screen.getByTestId('flow-stepper-count').textContent;

function mountConnected(doc: CanvasDoc) {
  const store = createStore({});
  store.dispatch({
    type: 'session/index',
    sessions: [{ id: 's-flow', title: 'Flow', createdAt: 'x', updatedAt: 'x' }],
    activeId: 's-flow',
  });
  store.dispatch({ type: 'session/canvas-hydrated', doc, forSession: 's-flow' });
  return render(
    <StoreProvider store={store}>
      <ConnectedAiCanvas />
    </StoreProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a flow chart with steps plays on the AI Canvas', () => {
  it('the mounted canvas (ConnectedAiCanvas) shows the stepper, and Next moves the lit hop', () => {
    reducedMotion(true);
    mountConnected({ blocks: [], charts: [flow] });
    expect(screen.getByTestId('flow-stepper')).toBeTruthy();
    expect(screen.getAllByTestId('flow-stepper-step')).toHaveLength(3);
    expect(count()).toBe('1 of 3');
    expect(edge('engine->provider')?.getAttribute('data-active')).toBe('true');
    expect(edge('provider->model')?.getAttribute('data-active')).toBe('false');

    fireEvent.click(screen.getByTestId('flow-stepper-next'));
    expect(count()).toBe('2 of 3');
    expect(edge('engine->provider')?.getAttribute('data-active')).toBe('false');
    expect(edge('provider->model')?.getAttribute('data-active')).toBe('true');
    /* Both ends of the hop are lit; everything else recedes. */
    expect(item('provider')?.getAttribute('data-focused')).toBe('true');
    expect(item('model')?.getAttribute('data-focused')).toBe('true');
    expect(item('engine')?.getAttribute('data-dim')).toBe('true');
    expect(screen.getByTestId('seqchart').getAttribute('data-focus')).toBe('on');
    /* The current hop's detail is under the list. */
    expect(screen.getByTestId('flow-stepper-detail').textContent).toBe('the prompt goes out as tokens');
  });

  it('the in-app AiCanvas list mounts the same stepper, and a step can be clicked to', () => {
    reducedMotion(true);
    render(<AiCanvas doc={{ blocks: [], charts: [flow] }} />);
    fireEvent.click(screen.getAllByTestId('flow-stepper-step')[2]!.querySelector('button')!);
    expect(count()).toBe('3 of 3');
    expect(edge('model->harness')?.getAttribute('data-active')).toBe('true');
    fireEvent.keyDown(screen.getByTestId('flow-stepper'), { key: 'ArrowLeft' });
    expect(count()).toBe('2 of 3');
  });

  it('plays by itself one hop per ~1.2s and stops at the last hop', () => {
    reducedMotion(false);
    vi.useFakeTimers();
    render(<AiCanvas doc={{ blocks: [], charts: [flow] }} />);
    expect(count()).toBe('1 of 3');
    expect(screen.getByTestId('flow-stepper-play').textContent).toBe('Pause');
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(count()).toBe('1 of 3');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(count()).toBe('2 of 3');
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(count()).toBe('3 of 3');
    expect(edge('model->harness')?.getAttribute('data-active')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(count()).toBe('3 of 3');
    expect(screen.getByTestId('flow-stepper-play').textContent).toBe('Play');
  });

  it('with reduced motion it waits for Play', () => {
    reducedMotion(true);
    vi.useFakeTimers();
    render(<AiCanvas doc={{ blocks: [], charts: [flow] }} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(count()).toBe('1 of 3');
    expect(screen.getByTestId('flow-stepper-play').textContent).toBe('Play');
    fireEvent.click(screen.getByTestId('flow-stepper-play'));
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(count()).toBe('2 of 3');
  });

  it('a chart WITHOUT steps renders exactly as before: no stepper, no lit hop', () => {
    reducedMotion(false);
    const withSteps = render(<AiCanvas doc={{ blocks: [], charts: [plain] }} />);
    expect(screen.queryByTestId('flow-stepper')).toBeNull();
    expect(document.querySelector('[data-active]')).toBeNull();
    expect(screen.getByTestId('seqchart').getAttribute('data-focus')).toBe('off');
    expect(document.querySelector('[data-dim="true"]')).toBeNull();
    const svg = screen.getByTestId('seqchart-svg').outerHTML;
    withSteps.unmount();

    /* Byte for byte: the same spec, rendered by the chart alone. */
    mountConnected({ blocks: [], charts: [plain] });
    expect(screen.queryByTestId('flow-stepper')).toBeNull();
    expect(screen.getByTestId('seqchart-svg').outerHTML).toBe(svg);
  });

  it('the worked example lights the part it is on (onFocusPart is wired)', () => {
    reducedMotion(true);
    render(
      <AiCanvas
        doc={{
          blocks: [],
          charts: [plain],
          teachWalk: {
            input: 'one prompt',
            steps: [
              { partId: 'engine', says: 'the engine builds the request' },
              { partId: 'model', says: 'the model answers' },
            ],
          },
        }}
      />,
    );
    expect(item('engine')?.getAttribute('data-focused')).toBe('true');
    fireEvent.click(screen.getByTestId('teach-walk-next'));
    expect(item('model')?.getAttribute('data-focused')).toBe('true');
    expect(item('engine')?.getAttribute('data-dim')).toBe('true');
  });

  it('a stepped chart starts in a taller frame, room for its step list', () => {
    const [stepped] = materializeCanvasArtifacts({ blocks: [], charts: [flow] });
    const [bare] = materializeCanvasArtifacts({ blocks: [], charts: [plain] });
    expect(stepped!.size.h).toBeGreaterThan(bare!.size.h);
  });
});
