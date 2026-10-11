import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './chat.css';

import { ConnectedChatColumn, StoreProvider, createStore, type Store } from '../state';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';

/**
 * THE REGISTER'S GATE: "`@` + type + Enter adds the same chip a click adds."
 *
 * `mentionModel.test.ts` proves the matcher. This proves a PERSON can use it,
 * and that the chip it produces is the one the board already makes — because
 * two shapes for one concept is how a composer ends up with a reference the
 * engine can resolve from one path and cannot from the other.
 *
 * `ConnectedBoard` builds a node chip as
 *   `{ id: 'node:<ArchNode.id>', kind: 'node', ref: <ArchNode.id>, label, nodeKind }`
 * and says at that call site that it is "the same one the `@` picker uses".
 * That sentence is what this file makes true.
 */

const GRAPH = {
  repoName: 'shop',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [
    { id: 'svc:payments', label: 'payments', kind: 'service', file: 'src/pay.ts', line: 1 },
    { id: 'svc:orders', label: 'orders', kind: 'service', file: 'src/order.ts', line: 1 },
  ],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function attached(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/shop',
      repoName: 'shop',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
  return store;
}

function mount(store: Store) {
  render(
    <StoreProvider store={store}>
      <ConnectedChatColumn />
    </StoreProvider>,
  );
  return screen.getByTestId('composer-field') as HTMLTextAreaElement;
}

/** Type into the field the way a person does: value + caret, then fire. */
function type(field: HTMLTextAreaElement, text: string) {
  fireEvent.change(field, { target: { value: text, selectionStart: text.length } });
}

describe('the @ picker', () => {
  it('is closed until an @ is typed', () => {
    const field = mount(attached());
    expect(screen.queryByTestId('composer-mentions')).toBeNull();
    type(field, 'what calls payments');
    expect(screen.queryByTestId('composer-mentions')).toBeNull();
  });

  it('opens on @ and offers only things in the attached repo', () => {
    const field = mount(attached());
    type(field, 'what calls @pay');

    const rows = screen.getAllByTestId('composer-mention');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.textContent).toContain('payments');
  });

  it('Enter adds the SAME chip a card click adds', () => {
    const store = attached();
    const field = mount(store);
    type(field, 'what calls @pay');
    fireEvent.keyDown(field, { key: 'Enter' });

    const chips = store.getState().composer.chips;
    expect(chips).toHaveLength(1);
    /*
     * Byte-for-byte the object `ConnectedBoard.onGround` builds. `ref` is the
     * real `ArchNode.id`, which is what makes the chip grounded: the turn that
     * follows carries an identifier the engine can resolve rather than a name
     * the model has to guess at.
     */
    expect(chips[0]).toEqual({
      id: 'node:svc:payments',
      kind: 'node',
      ref: 'svc:payments',
      label: 'payments',
      nodeKind: 'service',
    });
  });

  it('the @token leaves the draft — the chip IS the reference now', () => {
    const store = attached();
    const field = mount(store);
    type(field, 'what calls @pay');
    fireEvent.keyDown(field, { key: 'Enter' });

    /* Leaving "@pay" behind would send the name twice: once as a resolvable
       chip and once as prose the engine cannot resolve. */
    expect(store.getState().composer.draft).toBe('what calls ');
    expect(screen.queryByTestId('composer-mentions')).toBeNull();
  });

  it('arrows move the highlight, and Enter takes the highlighted row', () => {
    const store = attached();
    const field = mount(store);
    type(field, '@');

    const before = screen.getAllByTestId('composer-mention');
    expect(before[0]!.getAttribute('data-active')).toBe('true');

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const after = screen.getAllByTestId('composer-mention');
    expect(after[1]!.getAttribute('data-active')).toBe('true');

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(store.getState().composer.chips[0]!.label).toBe(after[1]!.textContent?.includes('orders') ? 'orders' : 'payments');
  });

  it('says so when nothing matches, and offers no free-text fallback', () => {
    const field = mount(attached());
    type(field, '@zzzznotathing');
    /*
     * Sheet 12.4's ruling, rendered. The empty row is the answer; there is no
     * "use it anyway", because a reference the engine cannot resolve is the
     * exact thing this product exists to prevent.
     */
    expect(screen.getByTestId('composer-mentions-empty').textContent).toMatch(/No grounded matches/i);
    expect(screen.queryAllByTestId('composer-mention')).toHaveLength(0);
  });

  it('Enter with no matches does not send, and adds no chip', () => {
    const store = attached();
    const field = mount(store);
    type(field, '@zzzznotathing');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(store.getState().composer.chips).toHaveLength(0);
  });

  it('Escape closes the picker and leaves the text alone', () => {
    const store = attached();
    const field = mount(store);
    type(field, 'what calls @pay');
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(screen.queryByTestId('composer-mentions')).toBeNull();
    expect(store.getState().composer.draft).toBe('what calls @pay');
  });

  it('clicking a row adds its chip', () => {
    const store = attached();
    const field = mount(store);
    type(field, '@orders');
    fireEvent.mouseDown(screen.getAllByTestId('composer-mention')[0]!);
    expect(store.getState().composer.chips[0]!.ref).toBe('svc:orders');
  });

  it('with no repo attached, @ opens nothing at all', () => {
    const store = createStore({
      project: (g) => seqdFromGraph(g, g.nodeDetail),
      tokens: readShellTokens(document.documentElement),
      persisted: readShellPersisted(),
    });
    const field = mount(store);
    type(field, '@pay');
    /* Nothing is attached, so there is nothing a reference could resolve
       against — and an empty picker over an empty repo would promise one. */
    expect(screen.queryByTestId('composer-mentions')).toBeNull();
  });
});
