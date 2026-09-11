import { describe, expect, it, vi } from 'vitest';

import type { PostAskStreamRequest } from '@sequence/api-types';
import type { ArchGraph } from '@sequence/schema';

import { createStore } from './store';
import { composerPropsFrom } from './connect';
import type { AskTransport } from '../chat/askClient';
import { seqdFromGraph } from '../canvas/seqdFromGraph';

/**
 * WHAT ACTUALLY GOES ON THE WIRE WHEN SOMEBODY PRESSES SEND.
 *
 * This file exists because of how the conversation-history defect survived. The
 * server half was complete and tested. The wire type declared the field. The
 * pure mapping function, once written, was tested. And the client still did not
 * send it — because nothing tested THE MOUNT, only the pieces either side of
 * it.
 *
 * The same shape of hole let session activation 400 on every click while 991
 * tests stayed green: `SessionsPanel.test.tsx` asserted the body the client
 * happened to send rather than the body the contract requires.
 *
 * So this asserts the REQUEST OBJECT, built by the real `composerPropsFrom`,
 * against the real store. A fake transport captures it. Nothing here is a
 * mirror of the implementation — every expectation below is readable off
 * `PostAskRequest` and the server's own parse.
 */

const GRAPH = {
  version: 1,
  scannedAt: '2026-08-22T00:00:00.000Z',
  repoRoot: 'C:/repos/sequence',
  repoName: 'sequence',
  nodes: [{ id: 'svc:api', kind: 'service', label: 'api', files: [] }],
  edges: [],
  warnings: [],
  nodeDetail: {},
} as unknown as ArchGraph;

/** Attach a tiny repo so send may touch the wire (Wave 5 blocks unattached). */
function withRepo(store: ReturnType<typeof createStore>) {
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: 'C:/repos/sequence',
      repoName: 'sequence',
      graph: GRAPH,
      summary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  } as never);
  return store;
}

function attachedStore(seed: Parameters<typeof createStore>[0] = {}) {
  return withRepo(
    createStore({
      project: (g) => seqdFromGraph(g, g.nodeDetail),
      persisted: null,
      ...seed,
    }),
  );
}

function capturing() {
  const sent: PostAskStreamRequest[] = [];
  const transport: AskTransport = {
    /* The handlers parameter is part of the contract even though this fake
       never calls back — omitting it made the object structurally incompatible
       and failed the build, which is the type system doing exactly the job
       this whole file is about. */
    stream: async (request, _handlers) => {
      sent.push(request);
      return { outcome: 'ok', status: 200, body: null };
    },
  };
  return { sent, transport };
}

/** A store with a committed exchange already in it. */
function storeWithThread() {
  const store = attachedStore();
  store.dispatch({ type: 'composer/draft', text: 'what does scan.ts do' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({ type: 'turn/event', event: { type: 'delta', text: 'It walks ' }, at: 2 });
  store.dispatch({
    type: 'turn/event',
    event: { type: 'result', text: 'It walks the repository.' },
    at: 3,
  });
  return store;
}

function send(store: ReturnType<typeof createStore>, transport: AskTransport, text: string) {
  store.dispatch({ type: 'composer/draft', text });
  const props = composerPropsFrom(store.getState(), store, transport);
  props.onSend();
}

describe('the send payload', () => {
  it('CARRIES THE CONVERSATION on a follow-up', async () => {
    /*
     * The defect, stated as a test. Ask a question, get an answer, ask "and its
     * callers?" — and the second request must contain the first exchange, or
     * the model has nothing to resolve "its" against.
     */
    const { sent, transport } = capturing();
    const store = storeWithThread();

    send(store, transport, 'and its callers?');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const history = sent[0]!.history ?? [];
    expect(history.length).toBeGreaterThan(0);
    expect(history.map((h) => h.role)).toContain('user');
    expect(history.some((h) => h.text.includes('what does scan.ts do'))).toBe(true);
  });

  it('does NOT put the question being asked into its own history', () => {
    /*
     * `onSend` dispatches `turn/send` before it builds the request, so a naive
     * read of the store afterwards would send the new question twice — once as
     * `question` and once as the last history turn. The model would see the
     * user ask the same thing twice in a row and answer the echo.
     *
     * It is safe because `state` is the render snapshot taken before that
     * dispatch, and this is what says so.
     */
    const { sent, transport } = capturing();
    const store = storeWithThread();

    send(store, transport, 'and its callers?');

    const history = sent[0]!.history ?? [];
    expect(history.some((h) => h.text === 'and its callers?')).toBe(false);
    expect(sent[0]!.question).toBe('and its callers?');
  });

  it('sends an empty history on the FIRST message, not a missing field', () => {
    /* An empty array and an absent field mean the same thing to the server's
       `Array.isArray(body.history) ? body.history : []`, but only one of them
       says "there was no conversation" rather than "this client is old". */
    const { sent, transport } = capturing();
    const store = attachedStore();

    send(store, transport, 'first question');
    expect(sent[0]!.history).toEqual([]);
  });

  it('CARRIES THE WORKSPACE SURFACE when Architecture is open (P2.7 deictic)', async () => {
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({
      type: 'composer/ask-surface',
      surface: { id: 'architecture', title: 'Architecture' },
    });
    send(store, transport, 'what am I looking at');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.surface).toEqual({ id: 'architecture', title: 'Architecture' });
  });

  it('omits surface on chat-alone so deictic board questions stay honest', async () => {
    const { sent, transport } = capturing();
    const store = attachedStore();
    expect(store.getState().composer.askSurface).toBeNull();
    send(store, transport, 'hello');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.surface).toBeUndefined();
  });

  it('names Whiteboard via task-board wire id with Whiteboard title', async () => {
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({
      type: 'composer/ask-surface',
      surface: { id: 'task-board', title: 'Whiteboard' },
    });
    send(store, transport, 'explain this drawing');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.surface).toEqual({ id: 'task-board', title: 'Whiteboard' });
  });

  it('still sends the question and the grounded chips', () => {
    /* A regression guard on the two fields that already worked. Adding history
       must not disturb them. */
    const { sent, transport } = capturing();
    const store = attachedStore();

    send(store, transport, 'hello');
    expect(sent[0]!.question).toBe('hello');
    expect(sent[0]).toHaveProperty('history');
  });

  it('serializes canvas-block chip refs for grounded ask scope', () => {
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({
      type: 'composer/chip-add',
      chip: {
        id: 'canvas-block:b1',
        kind: 'canvas-block',
        ref: 'b1',
        label: 'Markdown · Plan',
        nodeKind: null,
      },
    } as never);
    send(store, transport, 'explain this block');
    expect(sent[0]!.context?.lines).toEqual(['canvas-block:b1 (Markdown · Plan)']);
  });

  it('serializes chip refs as grounded ids for dual-board ask scope', () => {
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({
      type: 'composer/chip-add',
      chip: {
        id: 'node:svc:api',
        kind: 'node',
        ref: 'svc:api',
        label: 'api',
        nodeKind: 'service',
      },
    } as never);
    send(store, transport, 'how does this talk to claims?');
    expect(sent[0]!.context?.lines).toEqual(['node:svc:api (api)']);
  });

  it('sends a design-mode payload when nothing is attached — blank workspace can chat', () => {
    /*
     * Owner: blank workspace must let you chat. Engine accepts design:{outline}
     * without a repo; the client must send that rather than blocking or walking
     * into a raw 409.
     */
    const { sent, transport } = capturing();
    const store = createStore({});

    send(store, transport, 'show me how an agentic harness works');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.question).toBe('show me how an agentic harness works');
    expect(sent[0]!.design).toEqual({
      title: 'Blank workspace',
      outline: 'show me how an agentic harness works',
      proposeArchitecture: true,
    });
    expect(store.getState().net.lastFailure).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE FAILURE STRIP — recoverable, and dismissable.

   `FailureStrip` shipped with a Retry button and a Dismiss X, both wired to
   optional callbacks that `connect.tsx` never supplied, and `retryable`
   hardcoded false. So a failed ask left a permanent error above the composer
   for the rest of the session, with no way to re-run the question.

   The original comment's warning still binds — "a Retry that did nothing would
   be worse than no Retry" — so retryable is false when there is nothing to
   re-ask.
   ══════════════════════════════════════════════════════════════════════════ */
describe('recovering from a failed ask', () => {
  function failedStore() {
    const store = storeWithThread();
    store.dispatch({
      type: 'net/failed',
      failure: { status: 500, message: 'boom', route: 'POST /api/ask/stream', at: 9 },
    });
    return store;
  }

  it('a failure with a question behind it is RETRYABLE', () => {
    const store = failedStore();
    const props = composerPropsFrom(store.getState(), store, capturing().transport);
    expect(props.failure?.retryable).toBe(true);
  });

  it('a failure with NOTHING to re-ask is not retryable', () => {
    /* The original comment's rule, kept: a Retry that did nothing would be
       worse than no Retry. */
    const store = createStore({});
    store.dispatch({
      type: 'net/failed',
      failure: { status: 500, message: 'boom', route: 'POST /api/ask/stream', at: 9 },
    });
    const props = composerPropsFrom(store.getState(), store, capturing().transport);
    expect(props.failure?.retryable).toBe(false);
  });

  it('DISMISS clears the strip — it was permanent for the whole session', () => {
    const store = failedStore();
    composerPropsFrom(store.getState(), store, capturing().transport).onDismissFailure?.();
    expect(store.getState().net.lastFailure).toBeNull();
    expect(composerPropsFrom(store.getState(), store, capturing().transport).failure).toBeNull();
  });

  it('RETRY re-asks the last question the user actually asked', () => {
    /*
     * The last USER TURN, not the composer draft. The draft is cleared on send
     * and may since have been typed into, so retrying it would re-send
     * something the user never asked and did not know was queued.
     */
    const { sent, transport } = capturing();
    const store = failedStore();
    store.dispatch({ type: 'composer/draft', text: 'something else entirely' });

    composerPropsFrom(store.getState(), store, transport).onRetry?.();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.question).toBe('what does scan.ts do');
  });

  it('retrying clears the old error as the new attempt starts', () => {
    /* Leaving the previous failure above a running turn says the thing now in
       flight has already failed. */
    const { transport } = capturing();
    const store = failedStore();
    composerPropsFrom(store.getState(), store, transport).onRetry?.();
    expect(store.getState().net.lastFailure).toBeNull();
  });
});

describe('attachments on the wire', () => {
  const LOG = { id: 'f'.repeat(64), name: 'crash.log', bytes: 80 };

  it('SENDS IDS, NOT CONTENT', async () => {
    /*
     * The text is already on disk under `.sequence/attachments`. Re-sending it
     * would push the same log through the request body on every follow-up.
     */
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({ type: 'composer/attachment-add', attachment: LOG });

    send(store, transport, 'why does this crash?');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]!.attachmentIds).toEqual([LOG.id]);
    expect(JSON.stringify(sent[0])).not.toContain('Traceback');
  });

  it('sends the ids even though the composer clears them in the same handler', async () => {
    /*
     * THE ORDER TRAP. `composer/attachments-clear` is dispatched before the
     * payload literal is evaluated; it only works because the payload reads
     * `state`, this render's snapshot, rather than the live store. If someone
     * later reads `store.getState()` there instead, the ids silently become
     * `undefined` and every attachment stops reaching the model with nothing
     * on screen to show it.
     */
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({ type: 'composer/attachment-add', attachment: LOG });

    send(store, transport, 'why does this crash?');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]!.attachmentIds).toEqual([LOG.id]);
    /* And the composer really is empty afterwards, so the next turn does not
       silently carry the same log again. */
    expect(store.getState().composer.attachments).toEqual([]);
  });

  it('omits the field entirely when nothing is attached', async () => {
    /* An empty array would be a claim that the turn carried attachments and
       they were all removed; absent is the honest shape for "none". */
    const { sent, transport } = capturing();
    const store = attachedStore();

    send(store, transport, 'plain question');
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]!.attachmentIds).toBeUndefined();
  });
});

describe('a turn that fails must offer a way out', () => {
  /**
   * `net/failed` was dispatched only when the TRANSPORT failed. A turn that
   * streams perfectly and ends in an `error` EVENT — a 200, an SSE frame
   * saying the provider refused — left `net.lastFailure` null, so no strip
   * appeared and neither Retry nor any other action was ever offered.
   *
   * That is the most common failure there is: no model configured. The reader
   * was told "add your own API key in Settings to chat" on a line in the
   * transcript, with nothing to press.
   */
  function failingTransport(event: Record<string, unknown>): AskTransport {
    return {
      stream: async (_request, handlers) => {
        handlers.onEvent(event as never);
        return { outcome: 'ok', status: 200, body: null };
      },
    };
  }

  it('RAISES THE STRIP when the turn ends in an error event', async () => {
    const store = attachedStore();
    const transport = failingTransport({
      type: 'error',
      error: 'the free assistant is not live yet — add your own API key in Settings to chat',
      httpStatus: 502,
      fix: 'provider',
    });

    send(store, transport, 'what breaks?');
    await vi.waitFor(() => expect(store.getState().net.lastFailure).not.toBeNull());
    /* The SERVER'S sentence, not one composed here. */
    expect(store.getState().net.lastFailure?.message).toMatch(/add your own API key/);
  });

  it('carries the FIX through to the composer props, so the route can be offered', async () => {
    const store = attachedStore();
    const transport = failingTransport({
      type: 'error',
      error: 'the free assistant is not live yet — add your own API key in Settings to chat',
      httpStatus: 502,
      fix: 'provider',
    });

    send(store, transport, 'what breaks?');
    await vi.waitFor(() => expect(store.getState().net.lastFailure).not.toBeNull());

    const props = composerPropsFrom(store.getState(), store, transport);
    expect(props.failure?.fix).toBe('provider');
  });

  it('does NOT claim a fix for a failure that has none', async () => {
    /* An outage is not fixed by opening Settings. */
    const store = attachedStore();
    const transport = failingTransport({
      type: 'error',
      error: 'the provider did not answer',
      httpStatus: 502,
    });

    send(store, transport, 'what breaks?');
    await vi.waitFor(() => expect(store.getState().net.lastFailure).not.toBeNull());

    const props = composerPropsFrom(store.getState(), store, transport);
    expect(props.failure?.fix ?? null).toBeNull();
  });
});

describe('the conversation this ask belongs to', () => {
  /*
   * THE SAME HOLE AS `history`, ONE FIELD ALONG.
   *
   * A teach turn's lesson is filed under the thread the request names. web2 named
   * none, so the server fell back to the session index's `activeId` — a guess at
   * which conversation the person meant. On 2026-09-06 the scripted seat ran a
   * real teach turn (`step:teach-mode` done) and the session on screen ended with
   * chat.json, canvas.json and NO lesson.json: no concept, so no chart, so no
   * check-in, and the model closed with a clarifying question the contract bans.
   * The seat reported that as three separate faults.
   *
   * Every piece either side of the mount was in place — the server reads
   * `body.threadId`, `resolveAskThreadId` validates it, and `beginTeachTurn`
   * files under it. Only the client never sent it, which is precisely why this
   * file exists.
   */
  it('SENDS THE DISPLAYED SESSION as threadId', async () => {
    const { sent, transport } = capturing();
    const store = attachedStore();
    store.dispatch({ type: 'session/index', activeId: 'session-2999', sessions: [] } as never);
    send(store, transport, 'Teach me how brief.ts works.');
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.threadId).toBe('session-2999');
  });

  it('omits threadId entirely when no session is active, rather than sending an empty one', async () => {
    /*
     * An empty string is not a thread id, and the server's own validator refuses
     * one — sending it would turn "I do not know which conversation" into a
     * rejected request instead of an absent field.
     */
    const { sent, transport } = capturing();
    const store = attachedStore();
    send(store, transport, 'Teach me how brief.ts works.');
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect('threadId' in sent[0]!).toBe(false);
  });
});
