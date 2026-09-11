import type {
  AssistantTurn,
  ComposerSlice,
  InFlightTurn,
  UserTurn,
  WorkRow,
} from '../state/types';
import type { ComposerProps } from './Composer';
import { deriveSendState } from './composerModel';

/* ══════════════════════════════════════════════════════════════════════════
   TEST FIXTURES FOR THE CHAT COLUMN
   packages/web2/src/chat/fixtures.ts

   Imported by this directory's tests and BY NOTHING ELSE. It lives in src/
   rather than test/ because the shapes it builds are the state contract's, and
   a fixture that drifts from the contract should fail typecheck in the same
   program the components compile in — which is the whole reason item 2.1 was
   written and frozen before any surface was built.

   These builders are deliberately thin. Every field a test cares about is
   passed in by the test; everything else is the contract's least interesting
   legal value. A fixture that quietly supplies an interesting value is a
   fixture that makes assertions pass for reasons the test does not state.
   ══════════════════════════════════════════════════════════════════════════ */

export function userTurn(id: string, text: string, over: Partial<UserTurn> = {}): UserTurn {
  return {
    id,
    role: 'user',
    text,
    intents: [],
    chips: [],
    contextLines: [],
    surface: null,
    at: 0,
    ...over,
  };
}

export function workRow(id: string, over: Partial<WorkRow> = {}): WorkRow {
  return {
    id,
    group: 'read',
    verb: 'Read the attached graph',
    identifier: null,
    outcome: null,
    provenance: null,
    status: 'done',
    from: 'tool:done',
    opens: null,
    ...over,
  };
}

/**
 * The default carries ONE work row, because the ordinary assistant turn in this
 * product has done something — a turn with no rows at all is the exception
 * (`answer` with no tools) and the tests that care about it pass `work: []`
 * explicitly rather than relying on a default that says nothing happened.
 */
export function assistantTurn(
  id: string,
  replyTo: string,
  over: Partial<AssistantTurn> = {},
): AssistantTurn {
  return {
    id,
    role: 'assistant',
    replyTo,
    text: '',
    work: [workRow(`${id}-w`)],
    effect: { kind: 'answer' },
    coverage: null,
    evidence: { tools: [], filesRead: [], proposals: [] },
    usage: null,
    metrics: null,
    contextBreakdown: null,
    advisor: null,
    diagram: null,
    source: null,
    runId: null,
    failure: null,
    at: 0,
    ...over,
  };
}

/**
 * The default carries NO work rows and NO text, which is the honest shape of a
 * turn between send and the first server frame. A fixture that started with
 * rows would hide the `queued` case the transcript is specified to draw as
 * nothing at all.
 */
export function inFlight(over: Partial<InFlightTurn> = {}): InFlightTurn {
  return {
    turnId: 'inflight',
    replyTo: 'u1',
    runId: null,
    phase: 'streaming',
    startedAt: 0,
    firstTokenAt: null,
    text: '',
    work: [],
    evidence: { tools: [], filesRead: [], proposals: [] },
    usage: null,
    providerRound: 0,
    roundCap: 8,
    lastActivityAt: 0,
    abortable: false,
    ...over,
  };
}

/**
 * `send` is DERIVED from the draft unless a test overrides it, so a fixture can
 * never hand the composer a button state its own draft contradicts. The store
 * derives it the same way, through the same function.
 */
export function composerSlice(over: Partial<ComposerSlice> = {}): ComposerSlice {
  const draft = over.draft ?? '';
  return {
    draft,
    /* Unknown by default: the fixture must not imply a window the provider
       never reported. */
    contextWindow: null,
    focusNonce: 0,
    chips: [],
    attachments: [],
    mention: null,
    model: { model: 'gpt-4o-mini', origin: 'unconfigured' },
    permission: { mode: 'propose', enabled: ['propose'] },
    jobMode: 'code',
    send: deriveSendState(draft, null),
    toolbeltOpen: false,
    history: [],
    askSurface: null,
  teach: false,
  teachKnown: null,
    ...over,
  };
}

/** Every callback the composer needs, stubbed to a no-op, so a test overrides
 *  only the one it is asserting on. */
export function composerHandlers(
  over: Partial<ComposerProps> = {},
): Omit<ComposerProps, 'composer'> {
  const noop = () => {};
  return {
    live: false,
    grounding: null,
    failure: null,
    onDraftChange: noop,
    onSend: noop,
    onStop: noop,
    onRemoveChip: noop,
    onToggleToolbelt: noop,
    onToolbeltPick: noop,
    onPermissionChange: noop,
    onOpenTerminal: noop,
    onOpenBrowser: noop,
    onRetry: noop,
    onDismissFailure: noop,
    ...over,
  };
}
