import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createStore, StoreProvider } from '../state';
import type { CanvasDoc } from '../state/types';
import { ConnectedAiCanvas } from './AiCanvas';
import {
  activeSurface,
  canvasSurfaces,
  nextSurfaceName,
  normaliseSurfaceName,
  seqDrawKeyFor,
  surfaceLabel,
} from './canvasSurfaces';
import { materializeCanvasArtifacts } from './materializeCanvasArtifacts';

/*
 * THE AI CANVAS HAS TABS — owner, 2026-09-22: "in the canvas you can switch
 * between multiple free form surfaces … like Chrome tabs, like default
 * surface, plan surface, etc."
 */
const block = (id: string, surface?: string) => ({
  id,
  type: 'markdown' as const,
  payload: `# ${id}`,
  status: 'landed' as const,
  ...(surface ? { surface } : {}),
});
const doc = (over: Partial<CanvasDoc> = {}): CanvasDoc => ({ blocks: [], ...over });

describe('the surface model', () => {
  it('a canvas from before tabs is all on the default tab', () => {
    expect(canvasSurfaces(doc({ blocks: [block('a'), block('b')] }))).toEqual(['canvas']);
  });

  it('Plan comes second as soon as anything is on it', () => {
    expect(canvasSurfaces(doc({ blocks: [block('a'), block('p', 'plan')] }))).toEqual(['canvas', 'plan']);
  });

  it('tabs a person opened keep their order, then anything a block names', () => {
    const d = doc({ surfaces: ['ideas', 'surface 2'], blocks: [block('x', 'later')] });
    expect(canvasSurfaces(d)).toEqual(['canvas', 'ideas', 'surface 2', 'later']);
  });

  it('each tab shows only its own artifacts', () => {
    const d = doc({ blocks: [block('a'), block('p', 'plan')] });
    expect(materializeCanvasArtifacts(d, 'canvas').map((a) => a.id)).toEqual(['artifact:block:a']);
    expect(materializeCanvasArtifacts(d, 'plan').map((a) => a.id)).toEqual(['artifact:block:p']);
    expect(materializeCanvasArtifacts(d).length).toBe(2);
  });

  it('the Plan tab reads in two columns: text left, pictures beside it', () => {
    const d = doc({
      blocks: [
        block('spine', 'plan'),
        { id: 'before', type: 'mermaid' as const, payload: 'flowchart LR', status: 'landed' as const, surface: 'plan' },
        block('risks', 'plan'),
      ],
    });
    const placed = materializeCanvasArtifacts(d, 'plan');
    const at = (id: string) => placed.find((a) => a.id === `artifact:block:${id}`)!.at;
    expect(at('spine').x).toBe(at('risks').x);
    expect(at('before').x).toBeGreaterThan(at('spine').x);
    expect(at('before').y).toBe(at('spine').y);
    /* Every other tab keeps its single column. */
    const plain = materializeCanvasArtifacts(doc({ blocks: [block('a'), block('b')] }), 'canvas');
    expect(plain[0]!.at.x).toBe(plain[1]!.at.x);
  });

  it('the default tab keeps the pad key it always had', () => {
    expect(seqDrawKeyFor('s1', 'canvas')).toBe('sequence.seqdraw.s1');
    expect(seqDrawKeyFor('s1', 'plan')).toBe('sequence.seqdraw.s1#plan');
  });

  it('names are cleaned, labelled and numbered', () => {
    expect(normaliseSurfaceName('  Plan!! ')).toBe('plan');
    expect(normaliseSurfaceName('')).toBeNull();
    expect(surfaceLabel('surface 2')).toBe('Surface 2');
    expect(nextSurfaceName(['canvas', 'surface 2'])).toBe('surface 3');
  });

  it('an active tab that no longer exists falls back to the default', () => {
    expect(activeSurface(doc({ activeSurface: 'gone' }))).toBe('canvas');
  });
});

describe('the store', () => {
  function running() {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'plan it' });
    store.dispatch({ type: 'turn/send', at: 1 });
    return store;
  }

  it('a block written to the Plan tab lands there and brings the tab forward', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'canvas:block', id: 'p1', blockType: 'markdown', payload: '# Plan', status: 'live', surface: 'plan' },
      at: 2,
    });
    const d = store.getState().session.canvasDoc;
    expect(d.blocks[0]!.surface).toBe('plan');
    expect(d.activeSurface).toBe('plan');
  });

  it('a block with no surface stays on the default and carries no field', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'canvas:block', id: 'c1', blockType: 'markdown', payload: '# A', status: 'live' },
      at: 2,
    });
    expect('surface' in store.getState().session.canvasDoc.blocks[0]!).toBe(false);
  });

  it('opening a tab records it once', () => {
    const store = createStore();
    store.dispatch({ type: 'session/canvas-surface', surface: 'Surface 2' });
    store.dispatch({ type: 'session/canvas-surface', surface: 'surface 2' });
    expect(store.getState().session.canvasDoc.surfaces).toEqual(['surface 2']);
    expect(store.getState().session.canvasDoc.activeSurface).toBe('surface 2');
  });
});

describe('the strip', () => {
  it('draws a tab per surface, and + opens the next and shows it', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ConnectedAiCanvas />
      </StoreProvider>,
    );
    expect(screen.getByTestId('ai-canvas-tab-canvas').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('ai-canvas-tab-add'));
    expect(screen.getByTestId('ai-canvas-tab-surface-2').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('ai-canvas-tab-canvas').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByTestId('ai-canvas-tab-canvas'));
    expect(screen.getByTestId('ai-canvas-tab-canvas').getAttribute('aria-selected')).toBe('true');
  });
});
