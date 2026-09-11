import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BootTransport, WireResult } from '../boot';
import { deriveSendState } from '../chat';
import {
  ConnectedBootHydrate,
  ConnectedBootSurface,
  ConnectedChatColumn,
  ConnectedShell,
  StoreProvider,
} from './connect';
import { createInitialState } from './initial';
import { createStore } from './store';
import type { Action } from './store';
import type { AppState } from './types';

/* ══════════════════════════════════════════════════════════════════════════
   THE STORE'S TWO LOCKS
   packages/web2/src/state/store.test.tsx

   Wave 2's gate was "there is no store — the lanes are three disconnected
   islands". This file asserts the two properties that make the store a store
   rather than a bag of props with a nicer name.

   LOCK A — A SURFACE RE-RENDERS FROM A TRANSITION, NOT FROM A PROP.
   `ConnectedChatColumn` takes NO props. Everything it draws it reads out of the
   store, and the only way this test changes what is on screen is by
   dispatching. If the subscription is not wired, the assertions after the first
   dispatch fail — which is the exact failure the test exists to catch, because
   a store that holds state and never notifies is indistinguishable from a
   store that works right up until the moment something changes.

   LOCK B — `send` CANNOT DISAGREE WITH `deriveSendState`.
   The item's own words: "a send state computed in two places is a second source
   of truth and the Enter key is what contradicts it". So the invariant is
   asserted against the FUNCTION, not against an expected literal — an
   assertion that `send === 'ready'` would pass just as happily against a store
   that hardcoded it. Every dispatch in this file re-checks it, including the
   ones that have nothing to do with the composer, because the failure mode is
   a transition somewhere else leaving the derived field behind.

   And it is asserted at the KEYBOARD too. `Composer.tsx:126` reads
   `composer.send === 'ready'` to decide whether Enter sends. That single line
   is why the invariant matters: if `send` can be stale by one transition, Enter
   sends a turn the button says cannot be sent.
   ══════════════════════════════════════════════════════════════════════════ */

/** The invariant, in one place, so every call site asserts the same thing. */
function sendAgrees(state: AppState): boolean {
  return state.composer.send === deriveSendState(state.composer.draft, state.session.inFlight);
}

function pressEnter(field: HTMLElement) {
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
}

function field(): HTMLTextAreaElement {
  return screen.getByTestId('composer-field') as HTMLTextAreaElement;
}

function sendButton(): HTMLButtonElement {
  return screen.getByTestId('composer-send') as HTMLButtonElement;
}

describe('lock A — a surface re-renders from a store transition', () => {
  it('draws the empty thread with no props passed in', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        {/* No props. Not one. Everything below is read from the store. */}
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    expect(screen.getByTestId('chat-empty')).toBeTruthy();
    expect(field().value).toBe('');
    expect(sendButton().hasAttribute('disabled')).toBe(true);
  });

  it('re-renders the composer when the store transitions', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    act(() => {
      store.dispatch({ type: 'composer/draft', text: 'which services call the gateway?' });
    });

    expect(field().value).toBe('which services call the gateway?');
    expect(sendButton().hasAttribute('disabled')).toBe(false);
    expect(sendButton().getAttribute('aria-label')).toBe('Send');
  });

  it('re-renders the transcript when a turn is committed by the store', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    act(() => {
      store.dispatch({ type: 'composer/draft', text: 'what breaks if I change the scanner?' });
      store.dispatch({ type: 'turn/send', at: 1 });
    });

    expect(screen.queryByTestId('chat-empty')).toBeNull();
    expect(screen.getByTestId('chat-user-bubble').textContent).toBe(
      'what breaks if I change the scanner?',
    );
    // The draft was consumed by the turn, so the field is empty again — and the
    // field is a controlled input, so this only passes if the re-render came
    // from the store rather than from React holding the last typed value.
    expect(field().value).toBe('');
  });

  it('stops notifying after unsubscribe, and never after the last listener leaves', () => {
    const store = createStore();
    let seen = 0;
    const off = store.subscribe(() => {
      seen += 1;
    });

    store.dispatch({ type: 'composer/draft', text: 'a' });
    expect(seen).toBe(1);

    off();
    store.dispatch({ type: 'composer/draft', text: 'ab' });
    expect(seen).toBe(1);
    expect(store.getState().composer.draft).toBe('ab');
  });

  it('does not notify when a transition changes nothing', () => {
    const store = createStore();
    let seen = 0;
    store.subscribe(() => {
      seen += 1;
    });

    store.dispatch({ type: 'composer/draft', text: 'same' });
    expect(seen).toBe(1);
    store.dispatch({ type: 'composer/draft', text: 'same' });
    expect(seen).toBe(1);
  });
});

describe('lock B — send is derived and cannot disagree', () => {
  /**
   * Every action the store accepts, in a sequence that walks a whole turn.
   * The point is coverage of TRANSITIONS, not of the composer: the invariant is
   * re-checked after each one, so a repo transition that rebuilt the composer
   * slice and dropped the derivation would fail here and not three waves later.
   */
  const script: Action[] = [
    { type: 'composer/draft', text: 'why is the gateway hot?' },
    { type: 'composer/chip-add', chip: { id: 'c1', kind: 'node', ref: 'svc:gateway', label: 'gateway', nodeKind: null } },
    { type: 'composer/toolbelt', open: true },
    { type: 'composer/toolbelt', open: false },
    { type: 'composer/permission', mode: 'propose' },
    { type: 'composer/model', model: { model: 'local-model', origin: 'api-key' } },
    { type: 'shell/theme', theme: 'dark' },
    { type: 'shell/overlay', overlay: { kind: 'attach' } },
    { type: 'shell/overlay', overlay: null },
    { type: 'shell/frame', frame: { width: 1280, height: 800 } },
    { type: 'turn/send', at: 10 },
    { type: 'turn/event', event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' }, at: 11 },
    { type: 'turn/event', event: { type: 'file:read', path: 'src/a.ts' }, at: 12 },
    { type: 'composer/draft', text: 'a follow-up typed mid-stream' },
    { type: 'turn/event', event: { type: 'file:done', path: 'src/a.ts' }, at: 13 },
    { type: 'turn/event', event: { type: 'delta', text: 'Because ' }, at: 14 },
    { type: 'turn/event', event: { type: 'usage', inputTokens: 10, outputTokens: 2, estimated: false }, at: 15 },
    { type: 'turn/event', event: { type: 'result', text: 'Because it fans in.' }, at: 16 },
    { type: 'composer/chip-remove', id: 'c1' },
    { type: 'turn/send', at: 20 },
    { type: 'turn/stopped', at: 21 },
    { type: 'net/failed', failure: { status: 500, message: 'boom', route: 'POST /api/ask/stream', at: 22 } },
  ];

  it('holds the invariant after every single transition', () => {
    const store = createStore();
    expect(sendAgrees(store.getState())).toBe(true);

    const broken: string[] = [];
    for (const action of script) {
      store.dispatch(action);
      if (!sendAgrees(store.getState())) broken.push(action.type);
    }

    expect(broken).toEqual([]);
  });

  it('corrects a hydrated state that lies about send', () => {
    // The forged value is the one a caller would most plausibly persist: the
    // button was ready when the tab closed, and the draft was not.
    const lying = createInitialState();
    const store = createStore({
      hydrate: { ...lying, composer: { ...lying.composer, draft: '', send: 'ready' } },
    });

    expect(store.getState().composer.send).toBe('disabled');
    expect(sendAgrees(store.getState())).toBe(true);
  });

  it('refuses a send the derived state calls disabled', () => {
    const store = createStore();
    store.dispatch({ type: 'turn/send', at: 1 });

    expect(store.getState().session.turns).toEqual([]);
    expect(store.getState().session.inFlight).toBeNull();
    expect(sendAgrees(store.getState())).toBe(true);
  });

  it('refuses a second send while one is running, and stop stays stop', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'first' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'composer/draft', text: 'second, typed mid-stream' });

    expect(store.getState().composer.send).toBe('running');

    store.dispatch({ type: 'turn/send', at: 2 });

    expect(store.getState().session.turns).toHaveLength(1);
    expect(store.getState().composer.draft).toBe('second, typed mid-stream');
    expect(sendAgrees(store.getState())).toBe(true);
  });

  it('marks an in-flight ask as abortable after send (G3)', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'what breaks?' });
    store.dispatch({ type: 'turn/send', at: 1 });

    expect(store.getState().session.inFlight?.abortable).toBe(true);
  });

  /* ── THE KEYBOARD, WHICH IS WHAT CONTRADICTS A SECOND SOURCE OF TRUTH ──── */

  it('Enter sends exactly when the derived state says ready', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    // Empty draft: derived `disabled`, so Enter must commit nothing.
    pressEnter(field());
    expect(store.getState().session.turns).toEqual([]);

    act(() => {
      store.dispatch({ type: 'composer/draft', text: 'trace the attach path' });
    });
    pressEnter(field());

    expect(store.getState().session.turns).toHaveLength(1);
    expect(store.getState().session.inFlight).not.toBeNull();
    expect(sendAgrees(store.getState())).toBe(true);
  });

  it('Enter mid-stream commits nothing and the button still reads Stop', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ConnectedChatColumn />
      </StoreProvider>,
    );

    act(() => {
      store.dispatch({ type: 'composer/draft', text: 'first' });
      store.dispatch({ type: 'turn/send', at: 1 });
      store.dispatch({ type: 'composer/draft', text: 'typed while it runs' });
    });

    expect(sendButton().getAttribute('aria-label')).toBe('Stop');

    pressEnter(field());

    expect(store.getState().session.turns).toHaveLength(1);
    expect(sendButton().getAttribute('aria-label')).toBe('Stop');
    expect(sendAgrees(store.getState())).toBe(true);
  });

  it('whitespace alone is not a question', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: '   \n  ' });

    expect(store.getState().composer.send).toBe('disabled');
    store.dispatch({ type: 'turn/send', at: 1 });
    expect(store.getState().session.turns).toEqual([]);
  });

  it('a chip without words is a reference, not a question', () => {
    const store = createStore();
    store.dispatch({
      type: 'composer/chip-add',
      chip: { id: 'c1', kind: 'node', ref: 'svc:gateway', label: 'gateway', nodeKind: null },
    });

    expect(store.getState().composer.send).toBe('disabled');
    expect(sendAgrees(store.getState())).toBe(true);
  });
});

describe('the store fabricates nothing', () => {
  it('starts with no turns, no chips, no draft and no model', () => {
    const state = createStore().getState();

    expect(state.session.turns).toEqual([]);
    expect(state.session.inFlight).toBeNull();
    expect(state.composer.chips).toEqual([]);
    expect(state.composer.draft).toBe('');
    expect(state.composer.model).toEqual({ model: '', origin: 'unconfigured' });
    expect(state.repo.phase).toBe('unattached');
  });

  it('keeps origin unconfigured until something answers with a model', () => {
    const store = createStore();
    store.dispatch({ type: 'shell/frame', frame: { width: 1440, height: 900 } });
    store.dispatch({ type: 'composer/draft', text: 'anything' });

    expect(store.getState().composer.model.origin).toBe('unconfigured');
    expect(store.getState().composer.model.model).toBe('');
  });

  /*
   * THE OTHER HALF, AND IT WAS DEAD END TO END.
   *
   * The engine computed coverage and put it on the result event; the shared
   * contract never declared it, so the reducer wrote `coverage: null`
   * unconditionally and the rail rendered a field nothing could ever fill. CANON
   * calls this "the single strongest thing we have" — the one claim Codex and
   * Claude Code structurally cannot make — and it reached the client and was
   * dropped on the floor.
   */
  it('carries the coverage the engine sent, so the cut can be named', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'result',
        text: 'a',
        coverage: { edgesSeen: 296, edgesTotal: 2326, packagesSeen: ['packages/analyzer'], packagesMissed: ['packages/web2', 'packages/mcp'] },
      },
      at: 2,
    });
    const turn = store.getState().session.turns.at(-1)!;
    expect(turn.role).toBe('assistant');
    if (turn.role !== 'assistant') return;
    expect(turn.coverage).toEqual({
      edgesSeen: 296,
      edgesTotal: 2326,
      packagesSeen: ['packages/analyzer'],
      packagesMissed: ['packages/web2', 'packages/mcp'],
    });
  });

  it('records coverage as absent, never as zero, when nothing measured it', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'a' }, at: 2 });

    const turn = store.getState().session.turns[1];
    expect(turn.role).toBe('assistant');
    if (turn.role !== 'assistant') throw new Error('unreachable');
    expect(turn.coverage).toBeNull();
    expect(turn.usage).toBeNull();
  });

  it('will not paint a repo it has no projection for', () => {
    // `ScannedRepo` requires `doc: SeqDiagramV1`. With no projector the store
    // must NOT report attached — an empty diagram would be a canvas the store
    // invented. This is the branch that fired on every boot of the shipped
    // bundle until the projector was bound, and it stays reachable on purpose:
    // a guard nothing can reach is a guard nobody can prove.
    const store = createStore();
    store.dispatch({
      type: 'repo/loaded',
      at: 1,
      draft: {
        root: '/repo',
        repoName: 'repo',
        graph: { nodes: [], edges: [], scannedAt: '2026-08-20T00:00:00.000Z', nodeDetail: {} } as never,
        summary: { nodes: 0, edges: 0 } as never,
        scannedAt: '2026-08-20T00:00:00.000Z',
      },
    });

    expect(store.getState().repo.phase).toBe('unattached');
    expect(store.getState().net.lastFailure?.message).toContain('projection');
  });

  it('attaches when a projection is supplied', () => {
    const doc = { version: 1, nodes: [], edges: [] };
    const store = createStore({ project: () => doc as never });
    store.dispatch({
      type: 'repo/loaded',
      at: 1,
      draft: {
        root: '/repo',
        repoName: 'repo',
        graph: { nodes: [], edges: [], scannedAt: '2026-08-20T00:00:00.000Z', nodeDetail: {} } as never,
        summary: { nodes: 0, edges: 0 } as never,
        scannedAt: '2026-08-20T00:00:00.000Z',
      },
    });

    const repo = store.getState().repo;
    expect(repo.phase).toBe('attached');
    if (repo.phase !== 'attached') throw new Error('unreachable');
    expect(repo.repo.doc).toBe(doc);
    expect(store.getState().net.lastFailure).toBeNull();
  });

  it('will not switch to a permission mode the user has not enabled', () => {
    // `autoEdit` and `full` are typed and gated: Sequence has no permission
    // system, so accepting the mode would make the control claim an
    // enforcement that does not exist.
    const store = createStore();
    store.dispatch({ type: 'composer/permission', mode: 'full' });

    expect(store.getState().composer.permission.mode).toBe('propose');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE FOLD, AND THE OTHER TWO SURFACES
   ══════════════════════════════════════════════════════════════════════════ */

describe('the stream fold', () => {
  function running() {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'change the scanner' });
    store.dispatch({ type: 'turn/send', at: 1 });
    return store;
  }

  it('opens a row on start and closes the same row on done', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'file:read', path: 'src/a.ts' }, at: 2 });

    expect(store.getState().session.inFlight?.work).toHaveLength(1);
    expect(store.getState().session.inFlight?.work[0].status).toBe('running');
    expect(store.getState().session.inFlight?.work[0].opens).toBe('rail');
    expect(store.getState().session.inFlight?.work[0].identifier).toBe('src/a.ts');

    store.dispatch({ type: 'turn/event', event: { type: 'file:done', path: 'src/a.ts' }, at: 3 });

    expect(store.getState().session.inFlight?.work).toHaveLength(1);
    expect(store.getState().session.inFlight?.work[0].status).toBe('done');
    expect(store.getState().session.inFlight?.evidence.filesRead).toEqual(['src/a.ts']);
  });

  it('opens fetch_url tool row with browser affordance (C2.5)', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'tool:start', id: 'u1', name: 'fetch_url', evidence: 'https://example.com' },
      at: 2,
    });

    expect(store.getState().session.inFlight?.work[0].opens).toBe('browser');
    expect(store.getState().session.inFlight?.work[0].verb).toBe('Called fetch_url');
  });

  it('command:log row opens Terminal affordance (C1.5)', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'command:log',
        cmd: 'pnpm test',
        exitCode: 0,
        output: 'ok\n',
        ok: true,
      },
      at: 2,
    });

    expect(store.getState().session.inFlight?.work[0].opens).toBe('terminal');
    expect(store.getState().session.inFlight?.work[0].identifier).toBe('pnpm test');
  });

  it('keeps command:log stdout on the exit outcome (C1.5)', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'command:log',
        cmd: 'pnpm test',
        exitCode: 0,
        output: 'ok 12 tests\n',
        ok: true,
      },
      at: 2,
    });

    const row = store.getState().session.inFlight?.work[0];
    expect(row?.from).toBe('command:log');
    expect(row?.identifier).toBe('pnpm test');
    expect(row?.outcome).toEqual({
      kind: 'exit',
      code: 0,
      output: 'ok 12 tests\n',
    });
    expect(row?.status).toBe('done');
  });

  it('resolves a still-running row from the terminal event, not from a guess', () => {
    const answered = running();
    answered.dispatch({ type: 'turn/event', event: { type: 'provider:start' }, at: 2 });
    answered.dispatch({ type: 'turn/event', event: { type: 'result', text: 'done' }, at: 3 });

    const ok = answered.getState().session.turns[1];
    if (ok.role !== 'assistant') throw new Error('unreachable');
    expect(ok.work[0].status).toBe('done');
    expect(ok.failure).toBeNull();

    const stopped = running();
    stopped.dispatch({ type: 'turn/event', event: { type: 'provider:start' }, at: 2 });
    stopped.dispatch({ type: 'turn/stopped', at: 3 });

    const cut = stopped.getState().session.turns[1];
    if (cut.role !== 'assistant') throw new Error('unreachable');
    expect(cut.work[0].status).toBe('error');
    expect(cut.failure).toEqual({ kind: 'stopped', at: 3 });
  });

  it('records a topology proposal with a canvas affordance and keeps it on the board slice', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'topology:proposal',
        title: 'Add a rate limiter',
        rationale: 'the gateway has no backpressure',
        nodes: [{ id: 'svc:limiter', label: 'limiter', kind: 'service' }],
        edges: [{ id: 'e1', from: 'svc:gateway', to: 'svc:limiter', family: 'http' }],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Added a limiter.' }, at: 3 });

    const turn = store.getState().session.turns[1];
    if (turn.role !== 'assistant') throw new Error('unreachable');
    const row = turn.work.find((w) => w.from === 'topology:proposal');
    expect(row?.opens).toBe('canvas');
    expect(row?.verb).toBe('Proposed architecture');
    expect(store.getState().session.topology?.title).toBe('Add a rate limiter');
    expect(store.getState().session.topology?.nodes.map((n) => n.id)).toEqual(['svc:limiter']);
  });

  it('records a proposal once and resolves the turn to exactly one effect', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'edit:proposal',
        title: 'widen the scanner',
        files: [{ path: 'src/scan.ts', content: 'x' }],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'here' }, at: 3 });

    const turn = store.getState().session.turns[1];
    if (turn.role !== 'assistant') throw new Error('unreachable');
    expect(turn.effect.kind).toBe('propose');
    expect(Object.keys(store.getState().session.proposals)).toHaveLength(1);
    // A proposal is a proposal until a human accepts it, and no diff has been
    // read off disk, so `diff` is null rather than an empty string.
    const proposal = Object.values(store.getState().session.proposals)[0];
    expect(proposal.status).toBe('pending');
    expect(proposal.files[0].decision).toBe('pending');
    expect(proposal.files[0].diff).toBeNull();
  });

  it('B4.2 proposal/file-decide syncs Accept/Deny into session.proposals', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'edit:proposal',
        title: 'two files',
        files: [
          { path: 'src/a.ts', content: 'a' },
          { path: 'src/b.ts', content: 'b' },
        ],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'here' }, at: 3 });
    const id = Object.keys(store.getState().session.proposals)[0]!;

    store.dispatch({
      type: 'proposal/file-decide',
      proposalId: id,
      path: 'src/a.ts',
      decision: 'accepted',
    });
    store.dispatch({
      type: 'proposal/file-decide',
      proposalId: id,
      path: 'src/b.ts',
      decision: 'rejected',
    });

    const proposal = store.getState().session.proposals[id]!;
    expect(proposal.files[0].decision).toBe('accepted');
    expect(proposal.files[1].decision).toBe('rejected');
    expect(proposal.status).toBe('partial');
  });

  it('B4.2 proposal/apply-finished marks applied when every accepted file landed', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'edit:proposal',
        title: 'one file',
        files: [{ path: 'src/a.ts', content: 'a' }],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'here' }, at: 3 });
    const id = Object.keys(store.getState().session.proposals)[0]!;
    store.dispatch({
      type: 'proposal/file-decide',
      proposalId: id,
      path: 'src/a.ts',
      decision: 'accepted',
    });
    store.dispatch({
      type: 'proposal/apply-finished',
      proposalId: id,
      writtenPaths: ['src/a.ts'],
    });
    expect(store.getState().session.proposals[id]!.status).toBe('applied');
  });

  it('never appends a half-streamed answer to the record', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'delta', text: 'Half a ' }, at: 2 });

    // One committed turn — the user's. The streaming answer is outside it.
    expect(store.getState().session.turns).toHaveLength(1);
    expect(store.getState().session.inFlight?.text).toBe('Half a ');
    expect(store.getState().session.inFlight?.firstTokenAt).toBe(2);
  });

  it('strips tool JSON from streaming deltas before it reaches inFlight text', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'delta',
        text: 'Here:\n{"id":"x","name":"propose_topology","args":{',
      },
      at: 2,
    });
    expect(store.getState().session.inFlight?.text).toBe('Here:\n');
  });

  it('keeps stripping across deltas so SVG tails never pollute chat', () => {
    const store = running();
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'delta',
        text: 'Canvas:\n{"id":"c1","name":"canvas.write_svg","args":{"content":"<svg>',
      },
      at: 2,
    });
    expect(store.getState().session.inFlight?.text).toBe('Canvas:\n');
    store.dispatch({
      type: 'turn/event',
      event: { type: 'delta', text: '<rect/></svg>"}}' },
      at: 3,
    });
    expect(store.getState().session.inFlight?.text).toBe('Canvas:\n');
    expect(store.getState().session.inFlight?.text).not.toMatch(/svg|rect/i);
  });

  it('ignores a frame that arrives after the turn is settled', () => {
    const store = running();
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'answered' }, at: 2 });
    const after = store.getState();

    store.dispatch({ type: 'turn/event', event: { type: 'delta', text: 'stray' }, at: 3 });

    expect(store.getState()).toBe(after);
  });
});

describe('the shell and the boot surface are driven by the same store', () => {
  it('re-renders the shell from a theme transition', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ConnectedShell chat={null} canvas={null} rail={null} />
      </StoreProvider>,
    );

    expect(screen.getByTestId('shell')).toBeTruthy();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      store.dispatch({ type: 'shell/theme', theme: 'system' });
    });

    // "system" REMOVES the attribute rather than setting a third value, or the
    // third state is unreachable. The point here is only that the shell read
    // the change out of the store.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  /** The five calls the boot ladder may make, answered without a server. */
  function transportFor(status: WireResult<never>): BootTransport {
    const refuse = <T,>(): Promise<WireResult<T>> =>
      Promise.resolve({ outcome: 'unreachable', message: 'not asked in this test' });
    return {
      status: () => Promise.resolve(status),
      archGraph: refuse,
      recent: refuse,
      detach: refuse,
      browse: refuse,
      attach: refuse,
    };
  }

  it('takes the platform probe into the store rather than into a local hook', async () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ConnectedBootSurface
          transport={transportFor({ outcome: 'unreachable', message: 'no engine' })}
        />
      </StoreProvider>,
    );

    /*
     * BEFORE THE PROBE ANSWERS, THE STORE KNOWS NOTHING — and `null` is the
     * contract's word for that, distinct from `false`. "We have not asked" and
     * "we asked and nothing answered" are different facts and a surface that
     * conflated them would show an offline banner during boot.
     */
    expect(store.getState().net.reachable).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId('boot-state').textContent).toBe('no-engine');
    });

    /*
     * THE SEAM, ASSERTED AS THE INVARIANT RATHER THAN AS THE GAP.
     *
     * This test's NAME has always been "takes the platform probe into the
     * store rather than into a local hook". Its body used to assert the
     * opposite: that after the surface settled, `net.reachable` was still
     * `null` — and then dispatched `boot/settled` BY HAND to show the reducer
     * worked. Both halves passed while nothing in the product dispatched that
     * action at all, which is precisely how the Wave 3 gate came to measure a
     * board with zero nodes against a repository that had loaded: the ladder's
     * answer reached the screen and never reached the store.
     *
     * So the assertion is now the one the name always described. No hand
     * dispatch: `ConnectedBootSurface` is rendered, the probe settles, and the
     * STORE is asked what it learned. The reducer's own mapping still has its
     * own tests below, driven directly — this one is about the wire.
     */
    await waitFor(() => {
      expect(store.getState().net.reachable).toBe(false);
    });
    expect(store.getState().repo.phase).toBe('unattached');
  });

  it('headless hydrate still settles the store when BootSurface is not mounted', async () => {
    /*
     * OpenCode boot dropped the third-region BootSurface. Without a headless
     * wire, `--repo` left the store unattached forever — board empty, chat
     * unrestored — while /api/status said attached.
     */
    const store = createStore({
      project: () =>
        ({
          version: 1,
          kind: 'architecture',
          title: 'shop',
          grounded: { repoRoot: '/tmp/shop', scannedAt: '2026-08-26T00:00:00.000Z' },
          nodes: [{ id: 'svc:orders', label: 'orders', kind: 'service', evidenceRef: 'scan:o.ts:1' }],
          edges: [],
        }) as never,
    });
    const graph = {
      version: 1,
      repoName: 'shop',
      repoRoot: '/tmp/shop',
      scannedAt: '2026-08-26T00:00:00.000Z',
      nodes: [{ id: 'svc:orders', label: 'orders', kind: 'service', file: 'o.ts', line: 1 }],
      edges: [],
      warnings: [],
      nodeDetail: {},
    };
    render(
      <StoreProvider store={store}>
        <ConnectedBootHydrate
          transport={{
            status: () =>
              Promise.resolve({
                outcome: 'ok' as const,
                status: 200,
                body: { attached: true, repoName: 'shop', root: '/tmp/shop' },
              }),
            archGraph: () =>
              Promise.resolve({ outcome: 'ok' as const, status: 200, body: graph }),
            recent: () => Promise.resolve({ outcome: 'unreachable' as const, message: 'n' }),
            detach: () => Promise.resolve({ outcome: 'unreachable' as const, message: 'n' }),
            browse: () => Promise.resolve({ outcome: 'unreachable' as const, message: 'n' }),
            attach: () => Promise.resolve({ outcome: 'unreachable' as const, message: 'n' }),
          }}
        />
      </StoreProvider>,
    );
    await waitFor(() => {
      expect(store.getState().repo.phase).toBe('attached');
    });
    const repo = store.getState().repo;
    expect(repo.phase === 'attached' && repo.repo.repoName).toBe('shop');
  });

  it('maps a foreign repo to unattached, never to an error wall', () => {
    const store = createStore();
    store.dispatch({
      type: 'boot/settled',
      outcome: {
        kind: 'foreign-repo',
        platform: { reachable: true, detail: 'the engine answered', at: 1 },
      },
    });

    expect(store.getState().repo.phase).toBe('unattached');
    expect(store.getState().net.reachable).toBe(true);
  });

  it('does not demote an already-attached repo when boot reports no-engine', () => {
    const doc = { version: 1, nodes: [], edges: [] };
    const store = createStore({ project: () => doc as never });
    store.dispatch({
      type: 'repo/loaded',
      at: 1,
      draft: {
        root: '/repo',
        repoName: 'repo',
        graph: { nodes: [], edges: [], scannedAt: '2026-08-20T00:00:00.000Z', nodeDetail: {} } as never,
        summary: { nodes: 0, edges: 0 } as never,
        scannedAt: '2026-08-20T00:00:00.000Z',
      },
    });
    expect(store.getState().repo.phase).toBe('attached');
    store.dispatch({
      type: 'boot/settled',
      outcome: {
        kind: 'no-engine',
        platform: { reachable: false, detail: 'offline', at: 2 },
      },
    });
    expect(store.getState().repo.phase).toBe('attached');
    expect(store.getState().net.reachable).toBe(false);
  });

  it('maps a failed hydrate to the failed phase, carrying the classified failure', () => {
    const store = createStore();
    store.dispatch({
      type: 'boot/settled',
      outcome: {
        kind: 'hydrate-failed',
        failure: { kind: 'not-found', message: 'that directory is not there' },
        platform: { reachable: true, detail: 'the engine answered', at: 1 },
      },
    });

    const repo = store.getState().repo;
    expect(repo.phase).toBe('failed');
    if (repo.phase !== 'failed') throw new Error('unreachable');
    expect(repo.failure.kind).toBe('not-found');
  });
});

/* The composer focus request — the palette's first row.

   A NONCE RATHER THAN A BOOLEAN: focus is an event, not a state. A
   `focused: true` flag would have to be cleared by whoever consumed it, and a
   second request arriving before that clear would be swallowed — which is
   exactly the case a reader hits by pressing Cmd-K twice. */
describe('composer/focus', () => {
  it('bumps a nonce that only ever goes up', () => {
    const store = createStore({});
    expect(store.getState().composer.focusNonce).toBe(0);

    store.dispatch({ type: 'composer/focus' });
    expect(store.getState().composer.focusNonce).toBe(1);

    store.dispatch({ type: 'composer/focus' });
    expect(store.getState().composer.focusNonce).toBe(2);
  });

  it('does not disturb the draft', () => {
    /* Focusing must not touch what the reader has typed. */
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'half a question' });
    store.dispatch({ type: 'composer/focus' });
    expect(store.getState().composer.draft).toBe('half a question');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE RAIL MOVES WHEN THE BOARD DOES.

   `RailSlice.selectedPath` and `selectedFunctionId` existed in the type and in
   the initial state from the day the rail was written, with NO reducer arm
   able to set either. Clicking a card on the board changed nothing in the
   index: the matching row might be four hundred rows down and unhighlighted.

   Two panes that are supposed to drive each other, talking in one direction.
   ══════════════════════════════════════════════════════════════════════════ */
describe('rail/reveal', () => {
  it('selects the path', () => {
    const store = createStore({});
    store.dispatch({ type: 'rail/reveal', path: 'src/scan.ts' as never });
    expect(store.getState().rail.selectedPath).toBe('src/scan.ts');
  });

  it('EXPANDS the file, so the revealed row is actually on screen', () => {
    /* Revealing a row that is collapsed inside its file reveals nothing. */
    const store = createStore({});
    store.dispatch({ type: 'rail/reveal', path: 'src/scan.ts' as never });
    expect(store.getState().rail.expanded).toContain('src/scan.ts');
  });

  it('clears a stale function selection', () => {
    /* A file and a function are different grains of the same answer. Leaving a
       function lit under a newly revealed file points at something the reader
       did not choose. */
    const store = createStore({});
    store.dispatch({ type: 'rail/reveal', path: 'a.ts' as never });
    expect(store.getState().rail.selectedFunctionId).toBeNull();
  });

  it('revealing the same path twice is identity — no churn, no duplicate expand', () => {
    const store = createStore({});
    store.dispatch({ type: 'rail/reveal', path: 'a.ts' as never });
    const before = store.getState();
    store.dispatch({ type: 'rail/reveal', path: 'a.ts' as never });
    expect(store.getState()).toBe(before);
    expect(store.getState().rail.expanded.filter((p) => p === 'a.ts')).toHaveLength(1);
  });

  it('null clears the selection without collapsing anything', () => {
    const store = createStore({});
    store.dispatch({ type: 'rail/reveal', path: 'a.ts' as never });
    store.dispatch({ type: 'rail/reveal', path: null });
    expect(store.getState().rail.selectedPath).toBeNull();
    /* What the reader opened stays open — closing it would undo a gesture they
       made, on the strength of a selection changing. */
    expect(store.getState().rail.expanded).toContain('a.ts');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE TRANSCRIPT COMES BACK.

   `SessionSlice.hydrating` existed from the day the slice was written with no
   action able to set it and nothing able to fill the transcript from disk. A
   reload showed a blank thread while the conversation sat in
   `.sequence/sessions/<id>/chat.json` — the user's own work reachable by the
   server and not by them.
   ══════════════════════════════════════════════════════════════════════════ */
describe('session hydration', () => {
  const stored = [
    { id: 'restored:0', role: 'user' as const, text: 'what does scan.ts do', at: 1, restored: true },
    { id: 'restored:1', role: 'assistant' as const, text: 'It walks the repo.', at: 2, restored: true },
  ];

  it('puts a stored conversation back on screen', () => {
    const store = createStore({});
    store.dispatch({ type: 'session/hydrating' });
    expect(store.getState().session.hydrating).toBe(true);

    store.dispatch({ type: 'session/hydrated', turns: stored as never });
    expect(store.getState().session.hydrating).toBe(false);
    expect(store.getState().session.turns.map((t) => t.text)).toEqual([
      'what does scan.ts do',
      'It walks the repo.',
    ]);
  });

  it('REFUSES TO OVERWRITE A LIVE THREAD', () => {
    /*
     * If the reader asked something while the fetch was in flight, what
     * arrives from disk is OLDER than what is on screen. Replacing it would
     * delete a question they just watched being answered.
     */
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'a live question' });
    store.dispatch({ type: 'turn/send', at: 1 });

    const live = store.getState().session.turns.length;
    store.dispatch({ type: 'session/hydrated', turns: stored as never });

    expect(store.getState().session.turns).toHaveLength(live);
    expect(store.getState().session.turns[0]!.text).toBe('a live question');
    /* And it still stops saying it is hydrating — the fetch did finish. */
    expect(store.getState().session.hydrating).toBe(false);
  });

  it('hydrating with nothing stored leaves an empty thread, not an error', () => {
    const store = createStore({});
    store.dispatch({ type: 'session/hydrated', turns: [] });
    expect(store.getState().session.turns).toEqual([]);
    expect(store.getState().session.hydrating).toBe(false);
  });

  it('session/index sets activeId and the session list from GET /api/sessions', () => {
    const store = createStore({});
    expect(store.getState().session.activeId).toBeNull();

    store.dispatch({
      type: 'session/index',
      activeId: 'session-b',
      sessions: [
        {
          id: 'session-a',
          title: 'First',
          mode: 'code',
          createdAt: '2026-08-22T00:00:00.000Z',
          updatedAt: '2026-08-22T00:00:00.000Z',
        },
        {
          id: 'session-b',
          title: 'Second',
          mode: 'code',
          createdAt: '2026-08-22T01:00:00.000Z',
          updatedAt: '2026-08-22T01:00:00.000Z',
        },
      ],
    });

    expect(store.getState().session.activeId).toBe('session-b');
    expect(store.getState().session.sessions.map((s) => s.id)).toEqual(['session-a', 'session-b']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   A FOLLOW-UP TYPED MID-STREAM.

   `send` refuses while a turn is unsettled, so pressing Enter during a stream
   did nothing at all — no error, no queue, no sign. The reader had to notice
   their question had not been asked, and ask it again.
   ══════════════════════════════════════════════════════════════════════════ */
describe('turn/queue', () => {
  function streaming() {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'first question' });
    store.dispatch({ type: 'turn/send', at: 1 });
    return store;
  }

  it('holds a follow-up while a turn is in flight', () => {
    const store = streaming();
    store.dispatch({ type: 'turn/queue', text: 'and the callers?' });
    expect(store.getState().session.queued).toBe('and the callers?');
  });

  it('CLEARS THE DRAFT, because the words moved', () => {
    /* Leaving them in the field shows the same question twice and invites a
       second send. */
    const store = streaming();
    store.dispatch({ type: 'composer/draft', text: 'and the callers?' });
    store.dispatch({ type: 'turn/queue', text: 'and the callers?' });
    expect(store.getState().composer.draft).toBe('');
  });

  it('refuses to queue when NOTHING is running', () => {
    /* The composer could simply send. A second path to the same act is two
       paths that disagree the first time either changes. */
    const store = createStore({});
    store.dispatch({ type: 'turn/queue', text: 'ask me now' });
    expect(store.getState().session.queued).toBeNull();
  });

  it('refuses to queue nothing', () => {
    const store = streaming();
    store.dispatch({ type: 'turn/queue', text: '   ' });
    expect(store.getState().session.queued).toBeNull();
  });

  it('CAN BE TAKEN BACK', () => {
    /*
     * The reason it is held visibly rather than sent silently later: a
     * question that fires itself two minutes after it was typed, with no sign
     * it was pending, is worse than one that was dropped.
     */
    const store = streaming();
    store.dispatch({ type: 'turn/queue', text: 'never mind' });
    store.dispatch({ type: 'turn/unqueue' });
    expect(store.getState().session.queued).toBeNull();
  });

  it('unqueueing nothing is identity', () => {
    const store = streaming();
    const before = store.getState();
    store.dispatch({ type: 'turn/unqueue' });
    expect(store.getState()).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   REWRITING A QUESTION.

   `send` appends and never mutates, so a typo in a question was permanent. The
   only remedy was to ask a corrected question underneath the wrong one and
   leave both in the thread — and both then went to the model as history, so it
   saw the mistake as well as the correction.
   ══════════════════════════════════════════════════════════════════════════ */
describe('turn/edit', () => {
  function threadOfTwo() {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'waht does scan.ts do' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'An answer.' }, at: 2 });
    store.dispatch({ type: 'composer/draft', text: 'and the callers?' });
    store.dispatch({ type: 'turn/send', at: 3 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Another.' }, at: 4 });
    return store;
  }

  it('puts the corrected question in the composer', () => {
    const store = threadOfTwo();
    const first = store.getState().session.turns[0]!;
    store.dispatch({ type: 'turn/edit', id: first.id, text: 'what does scan.ts do' });
    expect(store.getState().composer.draft).toBe('what does scan.ts do');
  });

  it('DROPS EVERYTHING AFTER IT', () => {
    /*
     * The answers below a rewritten question were answers to the OLD question.
     * Keeping them leaves a thread whose replies do not follow from what is
     * above them — and every one of them would be sent to the model as history
     * for the new ask.
     */
    const store = threadOfTwo();
    const first = store.getState().session.turns[0]!;
    expect(store.getState().session.turns.length).toBeGreaterThan(2);

    store.dispatch({ type: 'turn/edit', id: first.id, text: 'what does scan.ts do' });
    expect(store.getState().session.turns).toEqual([]);
  });

  it('drops a queued follow-up too', () => {
    /* It was queued against a thread that no longer exists. */
    const store = threadOfTwo();
    store.dispatch({ type: 'composer/draft', text: 'later' });
    const first = store.getState().session.turns[0]!;
    store.dispatch({ type: 'turn/edit', id: first.id, text: 'corrected' });
    expect(store.getState().session.queued).toBeNull();
  });

  it('REFUSES MID-STREAM', () => {
    /* Rewriting the question a turn is currently answering would leave an
       answer on screen to a question that is no longer there. */
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'first' });
    store.dispatch({ type: 'turn/send', at: 1 });
    const first = store.getState().session.turns[0]!;
    const before = store.getState();

    store.dispatch({ type: 'turn/edit', id: first.id, text: 'changed' });
    expect(store.getState()).toBe(before);
  });

  it('refuses to edit an ASSISTANT turn', () => {
    /* Putting words in the assistant's mouth and re-sending them as the user's
       question is a different act entirely, and not this one. */
    const store = threadOfTwo();
    const assistant = store.getState().session.turns.find((t) => t.role === 'assistant')!;
    const before = store.getState();
    store.dispatch({ type: 'turn/edit', id: assistant.id, text: 'nope' });
    expect(store.getState()).toBe(before);
  });

  it('an unchanged or empty edit is identity', () => {
    const store = threadOfTwo();
    const first = store.getState().session.turns[0]!;
    const before = store.getState();
    store.dispatch({ type: 'turn/edit', id: first.id, text: first.text });
    expect(store.getState()).toBe(before);
    store.dispatch({ type: 'turn/edit', id: first.id, text: '   ' });
    expect(store.getState()).toBe(before);
  });

  it('an unknown id is identity', () => {
    const store = threadOfTwo();
    const before = store.getState();
    store.dispatch({ type: 'turn/edit', id: 'nope' as never, text: 'x' });
    expect(store.getState()).toBe(before);
  });
});

describe('a lesson the user did not switch on says so in the record', () => {
  /*
   * Owner's screen, 2026-09-02: "teach me this: …" typed with the Teach row
   * unselected. The server now engages the teach contract on the question
   * alone (askPipeline's isTeachTurn) and streams `step:teach-mode` so the
   * switch is not silent — CANON's defect is a surface asserting something the
   * user did not choose, and an invisible mode switch is exactly that.
   */
  it('renders the teach-mode step as English, not as a slug', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'teach me this' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'step:start', id: 'teach-mode' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'step:done', id: 'teach-mode' }, at: 3 });

    const row = store.getState().session.inFlight!.work.find((r) => r.id === 'step:teach-mode')!;
    /* THE VERB NAMES THE MODE. It read "Taught this as a lesson", which is
       false on a turn that taught nothing — and this row is emitted on the
       question alone, so those turns exist. See `NAMED_STEP_ROW`. */
    expect(row.verb).toBe('Ran in Teach mode');
    expect(row.identifier).toBeNull();
    expect(row.status).toBe('done');
    /* English alone left it invisible: a settled reason row renders inside a
       disclosure that starts closed. `announce` is what keeps it unfolded —
       see WorkProofStack.test.tsx, which locks the rendered document. */
    expect(row.announce).toBe(true);
  });

  /*
   * LOCK E (client half) — the unattended autonomy mode.
   *
   * The analyzer half (`packages/analyzer/src/test/auto-approve.test.ts`)
   * proves the pipeline streams the pair; this proves the client turns it into
   * a row a human can read, unfolded. Both halves are needed: the event with no
   * mapping renders "Worked a step · auto-approve" inside a closed disclosure,
   * which is the built-but-not-reached failure across a package seam.
   */
  it('renders the auto-approve step as English, announced', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'fix the failing test' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'step:start', id: 'auto-approve' }, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'step:done', id: 'auto-approve' }, at: 3 });

    const row = store.getState().session.inFlight!.work.find((r) => r.id === 'step:auto-approve')!;
    expect(row.verb).toBe('Ran unattended — auto-approve is on');
    expect(row.identifier).toBeNull();
    expect(row.status).toBe('done');
    expect(row.announce).toBe(true);
  });

  it('leaves the bookkeeping steps exactly as they were', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'step:start', id: 'intents' }, at: 2 });

    const row = store.getState().session.inFlight!.work.find((r) => r.id === 'step:intents')!;
    expect(row.verb).toBe('Worked a step');
    expect(row.identifier).toBe('intents');
  });
});
