/* ══════════════════════════════════════════════════════════════════════════
   THE ASK POPOVER: A CHAT BOX WHERE YOU POINTED
   packages/web2/src/askInPlace/AskPopover.tsx

   "You can type on that screen and it sends that message to your main
   assistant; it pops up and references that exact drawing." (owner)

   One small glass composer, anchored next to the target, shared by the
   whiteboard and the architecture board. The same glass, radius, shadow and
   button tokens as the whiteboard's toolbar pill and its Ask panel
   (whiteboard.css), so it reads as part of the board and not as a dialog
   laid over it.

   KEYBOARD (all of it locked by AskPopover.test.tsx)
     Enter          sends (never while an IME composition is open)
     Shift+Enter    a new line
     Escape         closes, and focus goes back to where it was
   The field is one line and grows to four, then scrolls.

   WHAT IT DOES NOT DO: it does not talk to the chat itself. It hands the typed
   words to `onSend` and the host (sendBoardAsk.ts) owns the message, the chip,
   the image and the focus move.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { Icon } from '../chat/Icon';
import './askInPlace.css';
import type { AskReference } from './askReference';
import { placePopover, type Rect } from './placement';

/** Lines the field grows to before it scrolls. */
export const ASK_MAX_LINES = 4;

export interface AskPopoverProps {
  reference: AskReference;
  /** The target, in the container's coordinates. */
  target: Rect;
  /** The container's size: the popover stays inside the BOARD. */
  bounds: { width: number; height: number };
  onSend: (text: string) => void;
  onClose: () => void;
  /** Where focus goes on close; the board's own element when there is no better one. */
  returnFocus?: HTMLElement | null;
}

export function AskPopover({ reference, target, bounds, onSend, onClose, returnFocus }: AskPopoverProps) {
  const [text, setText] = useState('');
  const root = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const [size, setSize] = useState({ width: 340, height: 132 });
  const placed = placePopover(target, size, bounds);

  /* The popover's own size, measured before paint so the first frame is placed. */
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Open on the field; on close, hand focus back. */
  useEffect(() => {
    field.current?.focus();
    return () => {
      if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  /* One line that grows to four. */
  const grow = useCallback(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight);
    const cap = Number.isFinite(line) ? line * ASK_MAX_LINES : Infinity;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, []);
  useLayoutEffect(grow, [text, grow]);

  const send = () => {
    const words = text.trim();
    if (words === '') return;
    onSend(words);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      /* The board's own Escape drops the selection; this one only closes the box. */
      event.stopPropagation();
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div
      ref={root}
      className="ask-pop"
      data-testid="ask-pop"
      data-side={placed.side}
      role="dialog"
      aria-label="Ask about this"
      style={{ left: placed.left, top: placed.top }}
      onKeyDown={onKeyDown}
      /* Nothing typed or clicked here is a gesture on the board underneath. */
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="ask-pop-field">
        <span className="ask-pop-chip" data-testid="ask-pop-chip" title={reference.block}>
          <Icon name="board" size={12} />
          <span className="ask-pop-chip-label">{reference.summary}</span>
        </span>
        <textarea
          ref={field}
          className="ask-pop-input"
          data-testid="ask-pop-input"
          rows={1}
          value={text}
          placeholder="Ask about this"
          aria-label="Ask about this"
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
      </div>
      <div className="ask-pop-btns">
        <button type="button" className="ask-btn" data-testid="ask-pop-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
        <button
          type="button"
          className="ask-btn ask-btn-solid"
          data-testid="ask-pop-send"
          aria-label="Send"
          disabled={text.trim() === ''}
          onClick={send}
        >
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
}
