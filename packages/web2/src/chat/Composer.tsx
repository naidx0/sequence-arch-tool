import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  createModelPicker,
  type ModelPickerPort,
  type ModelPickerProfile,
} from './modelPicker';
import type {
  ClipboardEvent as ReactClipboardEvent,
  CompositionEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import type { ComposerSlice, ContextChip, MentionResult, PermissionMode } from '../state/types';
import type { AskContextBreakdown } from '@sequence/api-types';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import {
  attachmentLabel,
  isAttachableFile,
  nameForPaste,
  refusalFor,
  shouldAttachPaste,
  type AttachmentView,
} from './attachmentModel';
import { PermissionControl } from './PermissionControl';
import { TeachKnownCards } from './TeachKnownCards.js';
import {
  TOOLBELT,
  autosizeHeight,
  keyIntent,
  placeholderFor,
  slashCommands,
  slashMatches,
  slashQuery,
} from './composerModel';
import { ContextRing } from './ContextRing';
import { TrustStrip, type TrustStripProps } from './TrustStrip';
import { PERMISSION_MODES } from './PermissionControl';
import type { ToolbeltId } from './composerModel';
import { modelLabel } from './modelSelection';
import { SessionHomeContext, type SessionHomeContextProps } from './SessionHomeContext';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.7 — THE COMPOSER
   packages/web2/src/chat/Composer.tsx

   Sheet 12.4. Three zones, and the boundary between the second and the third is
   the decision worth defending: the field and the control row share one
   container, one border and one shadow — they are the same object, and
   everything in the control row changes what the field will send. The
   under-composer strip sits OUTSIDE that container entirely, because it
   describes the session and is true whether or not you type anything.

   THE CIRCULAR FILLED SEND BUTTON IS THE SIGNATURE ELEMENT: 28px, --r-full,
   --accent-solid, an up arrow inside it. On most screens it is the only
   saturated object present.

   This component holds no rules either. Enter vs Shift+Enter, the send state,
   the autosize cap, the placeholder and the toolbelt list are all in
   composerModel.ts. What lives here is the wiring, plus the two things that
   genuinely need a DOM: the textarea measurement and the composition guard.
   ══════════════════════════════════════════════════════════════════════════ */

/** A failed request, as the strip renders it. Never a message in the thread. */
export interface ComposerFailure {
  message: string;
  retryable: boolean;
  /**
   * WHAT WOULD FIX THIS, from the server, as data.
   *
   * `'provider'` means no usable model is configured. Absent means the failure
   * has no route out that this surface can offer - an outage, a rate limit -
   * and it must stay absent for those, or the control becomes noise.
   */
  fix?: 'provider' | null;
}

export interface ComposerProps {
  composer: ComposerSlice;
  /** True once the thread has a turn — picks which placeholder is honest. */
  live: boolean;
  /** What the assistant is grounded on, for the under-composer right slot. */
  grounding: string | null;
  /** Empty-thread repo · branch · model strip under the composer. */
  sessionStrip?: SessionHomeContextProps | null;
  failure?: ComposerFailure | null;
  /**
   * THE TRUST MOMENT, when this repository has not been trusted yet.
   *
   * Null means there is nothing to say — either the probe has not answered
   * (`trust.root === null`, the third state) or the repo IS trusted. Present
   * means the turn is behaving differently from the default and the reader is
   * being told why, which is the whole reason the strip exists: a boundary
   * nobody can see is a turn that silently misbehaves. See TrustStrip.tsx.
   */
  trust?: TrustStripProps | null;
  onDraftChange: (text: string) => void;
  /**
   * The caret moved or the draft changed — the host re-detects the `@` token
   * and re-ranks against the graph.
   *
   * The COMPOSER does not rank. Ranking needs the graph and the function index,
   * which the connected layer holds; a component that reached for them would be
   * a second place that decides what a mention may resolve against.
   */
  onMentionProbe?: (draft: string, caret: number) => void;
  /** A row was chosen — the host turns it into the same chip a card click makes. */
  onMentionPick?: (result: MentionResult) => void;
  /** Move the highlight by ±1. */
  onMentionMove?: (delta: number) => void;
  onSend: () => void;
  onStop: () => void;
  onRemoveChip: (id: string) => void;
  /**
   * The user pasted something long, or dropped a text file.
   *
   * The COMPOSER does not store it. Storing means a route and a repo root,
   * which the connected layer holds; a component that reached for them would
   * be a second place deciding what may be attached.
   */
  onAttach?: (name: string, text: string) => void;
  /**
   * Attachments this turn carries. SEPARATE FROM `composer.chips` on purpose -
   * a chip is a claim about the repository and an attachment is evidence the
   * user supplied, and a surface that drew them identically would let a pasted
   * log borrow the scan's authority.
   */
  attachments?: readonly AttachmentView[];
  onRemoveAttachment?: (id: string) => void;
  /** A dropped file that could not be attached, in the reader's terms. */
  onAttachRefused?: (message: string) => void;
  /**
   * Tokens the last metered turn put into the window, and the window itself.
   * Both null-able, and the ring draws NOTHING unless both are known - only
   * Ollama reports a context length, and a ring without a denominator would
   * have to invent one.
   */
  contextUsed?: number | null;
  contextWindow?: number | null;
  /** Last turn's prompt-section breakdown (B3.4), or null. */
  contextBreakdown?: AskContextBreakdown | null;
  onToggleToolbelt: () => void;
  /** Close the + menu without toggling — used by click-away / Escape. */
  onCloseToolbelt?: () => void;
  onToolbeltPick: (id: ToolbeltId) => void;
  onPermissionChange: (mode: PermissionMode) => void;
  onTeachToggle?: (on: boolean) => void;
  onTeachKnownChange?: (known: 'new' | 'used-it' | 'ship-it') => void;
  onOpenTerminal?: () => void;
  onOpenBrowser?: () => void;
  onRetry?: () => void;
  onDismissFailure?: () => void;
  /** Open the provider pane. Reached only from a failure that names it. */
  onOpenSettings?: () => void;
  /**
   * A follow-up typed while the current turn is still streaming.
   *
   * SHOWN, and takeable-back. A question held invisibly and fired two minutes
   * later, with no sign it was pending, is worse than one that was dropped.
   */
  queued?: string | null;
  onUnqueue?: () => void;
  /**
   * Where the model chip's menu gets its rows and sends its switch.
   *
   * Injected so a test drives it without a server, DEFAULTED so the connected
   * layer does not have to thread one more port through `App` for a control
   * that reads and writes a single route. The composer does not decide which
   * models exist — it asks.
   */
  modelPicker?: ModelPickerPort;
}

/** The real wire, built once. Overridden per-render only by a caller's prop. */
const DEFAULT_MODEL_PICKER: ModelPickerPort = createModelPicker();

/** Item 2.7: autosize with a four-line cap. */
const MAX_LINES = 4;

export function Composer(props: ComposerProps) {
  const {
    composer,
    live,
    grounding,
    sessionStrip = null,
    failure = null,
    trust = null,
    onDraftChange,
    onMentionProbe,
    onMentionPick,
    onMentionMove,
    onSend,
    onStop,
    onOpenSettings,
    onRemoveChip,
    onAttach,
    attachments,
    onRemoveAttachment,
    onAttachRefused,
    contextUsed = null,
    contextWindow = null,
    contextBreakdown = null,
    onToggleToolbelt,
    onCloseToolbelt,
    onToolbeltPick,
    onPermissionChange,
    onTeachToggle,
    onTeachKnownChange,
    onOpenTerminal,
    onOpenBrowser,
    onRetry,
    onDismissFailure,
  queued = null,
  onUnqueue,
  modelPicker = DEFAULT_MODEL_PICKER,
  } = props;

  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const toolbeltWrap = useRef<HTMLSpanElement | null>(null);

  /*
   * ── THE MODEL CHIP'S OWN MENU ─────────────────────────────────────────
   *
   * Held here rather than in the store because it is a menu, not a fact about
   * the conversation, and because the rows are read from the route at OPEN
   * time — a list fetched on mount would be stale by the time anyone looked,
   * and fetched on every render would be a request per keystroke.
   *
   * `switchedModel` is the model the SERVER confirmed after a switch. The
   * store's `composer.model` is refreshed by the connected layer's own config
   * read; until that lands, the confirmed name is the true one and showing the
   * old label would be the chip lying about who is about to answer.
   */
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelRows, setModelRows] = useState<ModelPickerProfile[] | null>(null);
  const [modelMenuFailure, setModelMenuFailure] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchedModel, setSwitchedModel] = useState<string | null>(null);
  const modelWrap = useRef<HTMLSpanElement | null>(null);
  const modelLive = useRef(true);
  useEffect(() => {
    modelLive.current = true;
    return () => {
      modelLive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const close = () => setModelMenuOpen(false);
    const onDown = (event: MouseEvent) => {
      if (modelWrap.current?.contains(event.target as Node)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [modelMenuOpen]);

  async function openModelMenu() {
    if (modelMenuOpen) {
      setModelMenuOpen(false);
      return;
    }
    setModelMenuOpen(true);
    setModelMenuFailure(null);
    const answer = await modelPicker.list();
    if (!modelLive.current) return;
    if (answer.outcome === 'ok') {
      setModelRows(answer.profiles);
      setModelMenuFailure(null);
    } else {
      /* Reported, never papered over with an empty menu. A picker that draws
         nothing when the read FAILED is indistinguishable from one with nothing
         to draw, and the two need different actions from the reader. */
      setModelRows([]);
      setModelMenuFailure(answer.message);
    }
  }

  async function pickModel(id: string) {
    setSwitching(true);
    setModelMenuFailure(null);
    const answer = await modelPicker.select(id);
    if (!modelLive.current) return;
    setSwitching(false);
    if (answer.outcome === 'ok') {
      setSwitchedModel(answer.model);
      setModelRows((rows) =>
        rows === null ? rows : rows.map((r) => ({ ...r, active: r.id === id })),
      );
      setModelMenuOpen(false);
    } else {
      setModelMenuFailure(answer.message);
    }
  }

  useEffect(() => {
    if (!composer.toolbeltOpen) return undefined;
    const close = () => onCloseToolbelt?.();
    const onDown = (event: MouseEvent) => {
      if (toolbeltWrap.current?.contains(event.target as Node)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [composer.toolbeltOpen, onCloseToolbelt]);

  /*
   * TAKE FOCUS WHEN ASKED — the palette's first row, which read "not mounted".
   *
   * `composer.focus` is the shell's host command for this surface, and it was
   * never supplied, so Cmd/Ctrl-K then Enter — the first keystroke, the
   * default-selected row — told the reader the surface was not mounted. It was
   * mounted; nothing had connected the two.
   *
   * Skipped at nonce 0 so the composer does not steal focus on mount: a page
   * that grabs the caret before the reader has looked at it is the behaviour
   * every app is disliked for.
   */
  useEffect(() => {
    if (composer.focusNonce === 0) return;
    field.current?.focus();
  }, [composer.focusNonce]);

  /*
   * THE COMPOSITION GUARD, held in a ref rather than in state.
   *
   * Two sources, because neither alone is reliable across engines: the native
   * event's own `isComposing` flag, and the compositionstart/end pair. A
   * re-render on every IME keystroke would be a re-render of the whole column
   * to change nothing that is drawn, so this is a ref.
   *
   * Ported from MLH/frontend/src/components/Composer.tsx:182-192. Without it an
   * East Asian user pressing Enter to ACCEPT a candidate sends a half-composed
   * message — a confirmed v1 bug, and one that makes the product unusable in
   * three of the world's largest languages.
   */
  const composing = useRef(false);

  const running = composer.send === 'running';

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;

    const lineHeight = lineHeightPx(el);
    /* A measurement we could not take is not a number we may act on. Leaving
       the field at its declared height is the honest fallback; forcing a
       computed height off a guessed line-height is how a composer ends up one
       pixel tall in an environment nobody tested. */
    if (lineHeight <= 0) return;

    el.style.height = 'auto';
    el.style.height = `${autosizeHeight(el.scrollHeight, lineHeight, MAX_LINES)}px`;
  }, [composer.draft]);

  /**
   * A PASTE THAT IS A DOCUMENT BECOMES AN ATTACHMENT.
   *
   * Only past the threshold, and `preventDefault` only then: pasting a path or
   * a sentence has to keep behaving exactly as it always did, because that is
   * almost every paste. Above the line, the text would otherwise sit inside a
   * one-line composer where it cannot be read, edited or removed without
   * selecting all of it.
   *
   * With no `onAttach` the handler does NOTHING and the browser pastes as
   * usual - a host that has not wired attachments must not lose the user's
   * clipboard as the price of that.
   */
  function onPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    if (!onAttach) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!shouldAttachPaste(text)) return;
    event.preventDefault();
    onAttach(nameForPaste(text), text);
  }

  /**
   * A DROPPED TEXT FILE BECOMES AN ATTACHMENT, and one that is not says so.
   *
   * Reading is asynchronous and the event object is pooled, so every file is
   * taken off `dataTransfer` synchronously before the first await.
   */
  function onDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!onAttach) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    setDragging(false);
    for (const file of files) {
      const refusal = refusalFor(file);
      if (refusal !== null) {
        /* NAMED, not swallowed. A file that vanishes on drop with no sentence
           is indistinguishable from a broken drop target. */
        onAttachRefused?.(refusal);
        continue;
      }
      if (!isAttachableFile(file)) continue;
      void file
        .text()
        .then((text) => {
          if (text.trim() === '') return;
          onAttach(file.name, text);
        })
        .catch(() => {
          onAttachRefused?.(`${file.name} could not be read.`);
        });
    }
  }

  function onDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!onAttach) return;
    /* Both are required: without preventDefault on dragover the browser never
       fires a drop, and the whole target is inert with no sign of why. */
    event.preventDefault();
    if (!dragging) setDragging(true);
  }

  /*
   * THE SLASH MENU — Decision 4 (2026-08-24).
   *
   * Derived, never a second list: `slashCommands` builds itself from TOOLBELT
   * and PERMISSION_MODES, and picking a row calls the SAME two handlers the `+`
   * menu and the permission control already call. v1's defect was three menus
   * answering "what can I do here" differently; this adds a way in, not an
   * answer.
   */
  const slashText = slashQuery(composer.draft);
  const slashHits = slashText === null ? [] : slashMatches(slashText, slashCommands(PERMISSION_MODES));
  const slashOpen = slashText !== null && slashHits.length > 0;
  const [slashIndex, setSlashIndex] = useState(0);
  const slashActive = slashHits[Math.min(slashIndex, slashHits.length - 1)] ?? null;

  function runSlash(command: (typeof slashHits)[number]): void {
    /* The draft was only ever the command. Clearing it is what makes the menu
       close, and leaves the field ready for the actual question. */
    onDraftChange('');
    setSlashIndex(0);
    if (command.source.kind === 'toolbelt') onToolbeltPick(command.source.id);
    else onPermissionChange(command.source.mode);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const native = event.nativeEvent as KeyboardEvent;
    const isComposing = composing.current || native.isComposing === true;

    /*
     * WHILE THE PICKER IS OPEN IT OWNS ARROWS, ENTER AND ESCAPE.
     *
     * Enter must choose the highlighted row rather than send: a reader who has
     * a list in front of them and presses Enter meant the list. Letting it fall
     * through would send a half-typed `@pay` as prose — an unresolvable
     * reference, which is the exact thing sheet 12.4 forbids the picker to
     * produce.
     */
    /*
     * THE SLASH MENU OWNS THE SAME KEYS, FOR THE SAME REASON as the mention
     * picker below: a reader with a list in front of them who presses Enter
     * meant the list. Letting it fall through would send "/plan" as prose, and
     * the product would have advertised an affordance in its most-read line and
     * then ignored it.
     */
    if (slashOpen && !isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashIndex((i) => {
          const next = i + (event.key === 'ArrowDown' ? 1 : -1);
          return (next + slashHits.length) % slashHits.length;
        });
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onDraftChange('');
        setSlashIndex(0);
        return;
      }
      if (event.key === 'Enter' && slashActive) {
        event.preventDefault();
        runSlash(slashActive);
        return;
      }
    }

    const picker = composer.mention;
    if (picker !== null && !isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        onMentionMove?.(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        /* Closing is a probe at a caret the token cannot contain. */
        onMentionProbe?.(composer.draft, -1);
        return;
      }
      if (event.key === 'Enter' && picker.results.length > 0) {
        event.preventDefault();
        const chosen = picker.results[picker.activeIndex] ?? picker.results[0];
        if (chosen) onMentionPick?.(chosen);
        return;
      }
    }

    const intent = keyIntent({ key: event.key, shiftKey: event.shiftKey, composing: isComposing });

    if (intent !== 'send') return;

    /*
     * preventDefault even when the send is refused. If Enter is the send key,
     * it is the send key in every state — letting it fall through mid-stream
     * would leave a stray newline at the head of the follow-up the user is
     * drafting, which they would then send without noticing.
     */
    event.preventDefault();
    /*
     * CALLED WHENEVER THERE ARE WORDS, and the caller decides what to do with
     * them. This used to be gated on `send === 'ready'`, which meant Enter
     * mid-stream reached nothing at all — the question was dropped in silence
     * and the reader had to notice and retype it.
     *
     * `running` is the case that matters: the connect layer queues it. `ready`
     * sends. `disabled` means there is nothing to send, and this guard keeps
     * an empty Enter from reaching anything.
     */
    if (composer.draft.trim() !== '') onSend();
  }

  function onComposition(event: CompositionEvent<HTMLTextAreaElement>) {
    composing.current = event.type === 'compositionstart';
  }

  return (
    <div className="chat-scope composerwrap">
      <div className="inner">
        {/*
          * ABOVE THE FAILURE STRIP, because it is a standing condition of the
          * session and a failure is a thing that just happened. Both leave the
          * composer usable underneath — an untrusted repo still scans, still
          * draws its graph, still answers grounded questions. Local-first is
          * not negotiable and a trust prompt must never become a wall.
          */}
        {trust === null ? null : <TrustStrip {...trust} />}

        {failure === null ? null : (
          <FailureStrip
            failure={failure}
            onRetry={onRetry}
            onDismiss={onDismissFailure}
            onOpenSettings={onOpenSettings}
          />
        )}

        {queued === null ? null : (
          /* THE HELD FOLLOW-UP, SHOWN — the whole reason it is queued rather
             than sent silently later. A question that fires itself two minutes
             after it was typed, with no sign it was pending, is worse than one
             that was dropped. */
          <div className="strip" role="status" data-testid="composer-queued">
            <Icon name="clock" className="i-alert" />
            <span className="msg">Sending when this finishes: {queued}</span>
            <span className="acts">
              <button
                type="button"
                className="ghost"
                data-testid="composer-unqueue"
                onClick={onUnqueue}
              >
                Cancel
              </button>
            </span>
          </div>
        )}

        <div
          className={`composer${focused ? ' focused' : ''}${dragging ? ' dragging' : ''}`}
          data-testid="composer"
          data-dragging={dragging ? 'true' : undefined}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {/* ATTACHMENTS SIT IN THEIR OWN ROW, above the grounded chips and
              visibly not among them. A chip is a claim about the repository;
              an attachment is evidence the user brought. Drawing them in one
              row would let a pasted log borrow the scan's authority, which is
              exactly what the chip ruling in `state/types.ts` forbids. */}
          {!attachments || attachments.length === 0 ? null : (
            <div className="attachrow" data-testid="composer-attachments">
              {attachments.map((a) => (
                <span className="attach" data-testid="composer-attachment" key={a.id}>
                  <Icon name="file" size={12} />
                  <span className="lbl">{attachmentLabel(a)}</span>
                  <button
                    type="button"
                    className="chipx"
                    data-testid="composer-attachment-remove"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => onRemoveAttachment?.(a.id)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {composer.chips.length === 0 ? null : (
            <div className="chiprow" data-testid="composer-chips">
              {composer.chips.map((chip) => (
                <Chip key={chip.id} chip={chip} onRemove={() => onRemoveChip(chip.id)} />
              ))}
            </div>
          )}

          {!slashOpen ? null : (
            /*
             * Decision 4. Drawn where the mention picker is drawn and with the
             * menu's own classes, because it IS the same gesture: a list the
             * reader opened from the field, chosen with the same keys, closing
             * the same way. A second visual language for the second picker
             * would make the reader learn the surface twice.
             */
            <div className="mentions" data-testid="composer-slash" role="listbox">
              {slashHits.map((command, i) => (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  aria-selected={command === slashActive}
                  className="menuitem"
                  data-testid="composer-slash-item"
                  data-command={command.name}
                  /* mousedown, not click: the textarea blurs on click and the
                     field would lose the draft before the pick lands — the same
                     reason the toolbelt row below uses it. */
                  onMouseDown={(event) => {
                    event.preventDefault();
                    runSlash(command);
                  }}
                  onMouseEnter={() => setSlashIndex(i)}
                >
                  <Icon name={command.icon} />
                  <span>{command.label}</span>
                  <span className="right">{command.hint}</span>
                </button>
              ))}
            </div>
          )}

          {composer.mention === null ? null : (
            /*
              SHEET 12.4 — "@ resolves against the graph, or it resolves against
              nothing. The picker offers only targets that exist in the attached
              repo… Where nothing matches it says so and offers no free-text
              fallback, because a reference the engine cannot resolve is the
              exact thing this product exists to prevent."

              So the no-match case is a RENDERED ROW, not an empty list and not
              a "use it anyway" affordance.
            */
            <div className="mentions" data-testid="composer-mentions" role="listbox">
              {composer.mention.results.length === 0 ? (
                <div className="mention-empty" data-testid="composer-mentions-empty">
                  No grounded matches
                </div>
              ) : (
                composer.mention.results.map((r, i) => (
                  <button
                    key={`${r.kind}:${r.ref}`}
                    type="button"
                    role="option"
                    aria-selected={i === composer.mention!.activeIndex}
                    className="mention-row"
                    data-testid="composer-mention"
                    data-kind={r.kind}
                    data-active={i === composer.mention!.activeIndex ? 'true' : 'false'}
                    /* mousedown, not click: the textarea blurs on click and the
                       picker would close before the choice landed. */
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onMentionPick?.(r);
                    }}
                  >
                    <span className="mention-name">{r.label}</span>
                    {r.detail === null ? null : <span className="mention-detail">{r.detail}</span>}
                    <span className="mention-kind">{r.kind}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <textarea
            ref={field}
            className="field"
            data-testid="composer-field"
            rows={1}
            value={composer.draft}
            placeholder={placeholderFor(live)}
            /* NEVER DISABLED WHILE A RUN IS IN FLIGHT. The user must be able to
               draft the follow-up while the answer streams; what Enter does in
               that state is decided in onKeyDown, not by taking the field away
               from them. */
            onChange={(event) => {
              onDraftChange(event.target.value);
              onMentionProbe?.(event.target.value, event.target.selectionStart ?? 0);
            }}
            /* The caret can move without the text changing — an arrow key or a
               click out of the token must close the picker, or it would hang
               over a mention the reader has left. */
            onSelect={(event) => {
              const el = event.target as HTMLTextAreaElement;
              onMentionProbe?.(el.value, el.selectionStart ?? 0);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onCompositionStart={onComposition}
            onCompositionEnd={onComposition}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />

          <div className="ctrls">
            <span className="menuwrap" ref={toolbeltWrap}>
              <button
                type="button"
                className="plusbtn"
                data-testid="composer-plus"
                aria-label="Add context and actions"
                aria-haspopup="menu"
                aria-expanded={composer.toolbeltOpen}
                onClick={onToggleToolbelt}
              >
                <Icon name="plus" />
              </button>

              {composer.toolbeltOpen ? (
                <div className="menu" role="menu" data-testid="composer-toolbelt">
                  {TOOLBELT.map((item) => (
                    <span key={item.id}>
                      {item.separatorBefore ? <hr /> : null}
                      <button
                        type="button"
                        role="menuitem"
                        className="menuitem"
                        data-testid="toolbelt-item"
                        onClick={() => onToolbeltPick(item.id)}
                      >
                        <Icon name={item.icon} />
                        <span>{item.label}</span>
                        <span className="right">{item.hint}</span>
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </span>

            {/*
             * THE CHEVRON MEANS A MENU NOW.
             *
             * Sheet 12.4 always drew one here, and this control always answered
             * it by opening the WHOLE Settings dialog — because, as
             * `modelSelection.ts` puts it, "no route serves a list". The route
             * serves one now (`profiles` on /api/ai-config), so the chevron
             * opens the menu it has been promising, and the door to Settings is
             * the last row rather than the only behaviour.
             *
             * Rows are read at OPEN time and never invented: a failed read says
             * so, and a config with no saved models draws the Settings row
             * alone.
             */}
            <span className="menuwrap" ref={modelWrap}>
              <button
                type="button"
                className="modelsel"
                data-testid="composer-model"
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                title={switchedModel ?? modelLabel(composer.model)}
                onClick={() => void openModelMenu()}
              >
                <Icon name="key" size={12} />
                {/* THE LABEL IS TRUE NOW. This rendered `composer.model.model`
                    directly, which is the empty string until something
                    dispatches `composer/model` — and nothing did. A blank where
                    the answer's author should be reads as a broken control;
                    naming the next action reads as an instruction. After a
                    switch it names the model the SERVER confirmed. */}
                <span className="mono">{switchedModel ?? modelLabel(composer.model)}</span>
                <Icon name="chevdown" size={12} />
              </button>
              {modelMenuOpen ? (
                <div className="menu" role="menu" data-testid="composer-model-menu">
                  {modelRows === null ? (
                    <span className="menuitem" data-testid="composer-model-loading">
                      <span>Reading your models…</span>
                    </span>
                  ) : null}
                  {(modelRows ?? []).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      role="menuitem"
                      className="menuitem"
                      data-testid="composer-model-option"
                      data-profile={row.id}
                      data-active={row.active ? 'true' : 'false'}
                      disabled={switching || row.active}
                      onClick={() => void pickModel(row.id)}
                    >
                      <span>{row.name}</span>
                      {/* A WORD, not a colour — sheet 12.5. */}
                      <span className="right">{row.active ? 'in use' : row.model}</span>
                    </button>
                  ))}
                  {modelRows !== null && modelRows.length === 0 && modelMenuFailure === null ? (
                    /*
                     * A MENU WITH NOTHING IN IT IS NOT AN ANSWER.
                     *
                     * `profilesFromConfig` returns [] for any config that is not
                     * `configured: true`, so on a first run this opened as a
                     * "Reading your models…" flash, then nothing, then a rule
                     * and a Settings row — the reader clicked a control that
                     * named a destination and met an empty list. Two clicks
                     * through nothing, when the owner's ask for this build is
                     * "connect your own model from one click".
                     *
                     * ONE ROW THAT SAYS WHY IT IS EMPTY AND GOES WHERE THE FIX
                     * IS. It does not reverse the ruling that this chip opens a
                     * MENU rather than the whole dialog: that ruling is about
                     * the case where there ARE models to choose between, and it
                     * still holds untouched — the menu still opens, and this row
                     * only exists when the list came back empty.
                     *
                     * The sentence is true in both local states. Settings LOOKS
                     * for a model already running here (`/api/ai-config` carries
                     * `localProviders` from a loopback probe of Ollama); whether
                     * it finds one is not this row's claim to make.
                     */
                    <button
                      type="button"
                      role="menuitem"
                      className="menuitem"
                      data-testid="composer-model-none"
                      onClick={() => {
                        setModelMenuOpen(false);
                        onToolbeltPick('models');
                      }}
                    >
                      <span>No model connected — Settings looks for one already running here, or takes a key</span>
                    </button>
                  ) : null}
                  {modelMenuFailure !== null ? (
                    <span className="menuitem" data-testid="composer-model-failure">
                      <span>{modelMenuFailure}</span>
                    </span>
                  ) : null}
                  <hr />
                  <button
                    type="button"
                    role="menuitem"
                    className="menuitem"
                    data-testid="composer-model-settings"
                    onClick={() => {
                      setModelMenuOpen(false);
                      onToolbeltPick('models');
                    }}
                  >
                    <span>Manage models</span>
                    <span className="right">settings</span>
                  </button>
                </div>
              ) : null}
            </span>

            {/* Beside the model, because they answer the same question - what is
                doing the thinking, and how much room is left to think in. It
                draws nothing at all when the window is unknown. */}
            <ContextRing
              used={contextUsed}
              window={contextWindow}
              breakdown={contextBreakdown}
            />

            <span className="right">
              <button
                type="button"
                className="iconbtn"
                data-testid="composer-browser"
                aria-label={
                  onOpenBrowser === undefined ? 'Browser — not shipped yet' : 'Browser'
                }
                title={
                  onOpenBrowser === undefined ? 'Browser — not shipped yet' : 'Open browser'
                }
                disabled={onOpenBrowser === undefined}
                onClick={onOpenBrowser}
              >
                <Icon name="link" />
              </button>
              <button
                type="button"
                className="iconbtn"
                data-testid="composer-terminal"
                aria-label={
                  onOpenTerminal === undefined ? 'Terminal — not shipped yet' : 'Terminal'
                }
                title={
                  onOpenTerminal === undefined ? 'Terminal — not shipped yet' : 'Open terminal'
                }
                disabled={onOpenTerminal === undefined}
                onClick={onOpenTerminal}
              >
                <Icon name="terminal" />
              </button>

              {/* THE SIGNATURE ELEMENT, and the one control that owns both ends
                  of the work: while a run is in flight the same circle becomes
                  stop. Disabled is a substituted surface, never a faded accent —
                  see chat.css. */}
              <button
                type="button"
                className="sendbtn"
                data-testid="composer-send"
                aria-label={running ? 'Stop' : 'Send'}
                disabled={composer.send === 'disabled'}
                onClick={running ? onStop : onSend}
              >
                <Icon name={running ? 'stop' : 'send'} />
              </button>
            </span>
          </div>
        </div>

        <div className="undercomposer">
          <div className="undercomposer-inner">
          {/* ONE CONTROL FOR "WHAT WILL THIS TURN DO": Plan / Propose /
              Auto-edit / Full access / Teach, one word on the trigger. Teach
              used to be its own chip here (Teach ↔ Teaching, a title each
              way) — owner, 2026-09-02: one mode menu, less telling. */}
          <PermissionControl
            control={composer.permission}
            onChange={onPermissionChange}
            teach={composer.teach}
            {...(onTeachToggle ? { onTeach: onTeachToggle } : {})}
          />

          {!live && sessionStrip ? (
            <SessionHomeContext {...sessionStrip} variant="strip" />
          ) : (
            <span className="branch" data-testid="composer-grounding">
              <Icon name="board" size={12} />
              {grounding === null ? 'no repo attached' : `grounded on ${grounding}`}
            </span>
          )}
          </div>
          {/* The one click, and ONLY in Teach mode. It is not a general
              preference — it is what this lesson should skip — so it appears
              with the mode and leaves with it, rather than sitting in Settings
              where nobody would connect it to the lesson they are about to get. */}
          {composer.teach && onTeachKnownChange ? (
            <TeachKnownCards value={composer.teachKnown} onChange={onTeachKnownChange} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A CONTEXT CHIP. Its glyph is the one its kind owns on the board, per sheet
 * 12.4 — the same mark in the composer and on the canvas, or the reference is
 * not visibly the same object.
 *
 * There is no `text` chip and there can never be one: `@` resolves against the
 * graph or it resolves against nothing, and types.ts leaves the member out of
 * the union so that adding one is a change to the contract rather than a change
 * to a component.
 */
function Chip({ chip, onRemove }: { chip: ContextChip; onRemove: () => void }) {
  const grounded =
    chip.kind === 'node'
      ? `Grounded ask context (not a tool call) · node:${chip.ref} — included in the next message scope`
      : chip.kind === 'file'
        ? `Grounded ask context · file:${chip.ref} — included in the next message scope`
        : chip.kind === 'canvas-block'
          ? `Grounded ask context · AI Canvas block:${chip.ref} — included in the next message scope`
          : `Grounded ask context · ${chip.kind}:${chip.ref}`;
  return (
    <span className="chip" data-testid="composer-chip" title={grounded} aria-label={grounded}>
      <Icon name={chipGlyph(chip)} size={12} />
      <span className="lbl">{chip.label}</span>
      <span className="chip-ctx">context</span>
      <button
        type="button"
        className="chipx"
        data-testid="composer-chip-remove"
        aria-label={`Remove ${chip.label}`}
        onClick={onRemove}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

function chipGlyph(chip: ContextChip): IconName {
  if (chip.kind === 'canvas-block') return 'spark';
  if (chip.kind === 'file') return 'file';
  if (chip.kind === 'function') return 'fn';

  switch (chip.nodeKind) {
    case 'service':
      return 'service';
    case 'datastore':
      return 'database';
    case 'topic':
      return 'topic';
    case 'module':
      return 'module';
    case 'file':
      return 'file';
    default:
      return 'board';
  }
}

/**
 * ERRORS ARE A STRIP ABOVE THE COMPOSER, NEVER A MESSAGE IN THE THREAD.
 *
 * Graphite page 20.4 makes it a law and the adoption study records v1 breaking
 * it twice — ProductChat.tsx:646-651 turns a failed ask into an ASSISTANT
 * MESSAGE, which is an error permanently in the artifact you hand to someone
 * else. The composer stays fully usable underneath, which is the second half of
 * the law: a failure is a thing that happened, not a mode you are now in.
 *
 * Retry is here from the start. MLH ships the strip and leaves `dismissError`
 * wired to nothing (useChat.ts:179), and page 19.3 state 7 draws a Retry that
 * MLH never built; adoption §3.6 says build both, so both are built.
 */
function FailureStrip({
  failure,
  onRetry,
  onDismiss,
  onOpenSettings,
}: {
  failure: ComposerFailure;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** Opens the provider pane. Only reached when `failure.fix === 'provider'`. */
  onOpenSettings?: () => void;
}) {
  return (
    <div className="strip" role="status" data-testid="composer-strip">
      <Icon name="alert" className="i-alert" />
      <span className="msg">{failure.message}</span>
      <span className="acts">
        {/*
          * THE WAY OUT, WHEN THE FAILURE HAS ONE.
          *
          * With no model configured the turn ends saying "add your own API key
          * in Settings to chat" — on a strip whose only controls were Retry
          * (which fails identically) and Dismiss (which hides it). The product
          * told the reader exactly what to do and gave them no way to do it:
          * the same dead end the owner walk opened on, where "the whole path
          * out of 'the free default is unavailable' ended in a dead end".
          *
          * Rendered on `fix`, NEVER on the wording. A surface that matched the
          * sentence would break the moment the sentence improved.
          */}
        {failure.fix === 'provider' && onOpenSettings ? (
          <button
            type="button"
            className="solid"
            data-testid="composer-strip-settings"
            onClick={onOpenSettings}
          >
            Open Settings
          </button>
        ) : null}
        {failure.retryable && onRetry ? (
          <button type="button" className="ghost" data-testid="composer-strip-retry" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        <button
          type="button"
          className="iconbtn"
          data-testid="composer-strip-dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon name="x" />
        </button>
      </span>
    </div>
  );
}

/**
 * The field's line-height in pixels.
 *
 * jsdom implements the cascade but not custom-property substitution, so
 * `getComputedStyle(el).lineHeight` comes back as the literal `var(--lh-14)`
 * there. Falling back to the token's own declared value reproduces what a
 * browser would have returned without hardcoding a number in this file — and
 * returning 0 when even that is unavailable is what makes the caller skip the
 * resize rather than act on a guess.
 */
function lineHeightPx(el: HTMLElement): number {
  const view = el.ownerDocument.defaultView;
  if (!view) return 0;

  const direct = parseFloat(view.getComputedStyle(el).lineHeight);
  if (Number.isFinite(direct)) return direct;

  const token = view
    .getComputedStyle(el.ownerDocument.documentElement)
    .getPropertyValue('--lh-14');
  const fromToken = parseFloat(token);
  return Number.isFinite(fromToken) ? fromToken : 0;
}
