/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT'S LIVE CARDS IN THE CHAT, AND THE SAVED ONES BACK AFTER A RELOAD
   packages/web2/src/genui/chatSurfaces.tsx

   The part the chat imports. It is small on purpose: the chat is on the path to the composer, the cards are not.
   Everything that draws or streams a card (ChatGenUI, the GenUI session, GenUISurface, @sequence/genui and its
   schema library, genui.css) lives in chatSurfacesImpl.tsx and loads after the first paint, or at once when an
   agent turn starts. boot/entryGraph.test.ts keeps it out of the entry chunk.

   The MCP `ui` tool posts ops to /api/genui/ingest?session=<chat id>; the server streams them on
   GET /api/genui/events?session=<chat id>. One `ChatGenUI` belongs to one open chat:

     while an agent turn runs   one EventSource on that chat's events; each frame goes to the session of the
                                turn that is running (a GenUISession per turn, onSettled = persistSettled)
     on load                    listChatSurfaces(chatId) puts each saved surface back at its turn
     chat switch, unmount       the stream is closed

   `<TurnSurfaces turnId />` draws a turn's cards where the transcript draws that turn (an agent run's foot, an
   assistant message). Until the lazy half is in there is no ChatGenUI and it draws nothing.
   ══════════════════════════════════════════════════════════════════════════ */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { ChatGenUI, ChatGenUIOptions } from './chatSurfacesImpl';
import { readSurfaceMark } from './surfaceMarks';

export type { ChatGenUI, ChatGenUIOptions, EventSourceLike, TurnCard } from './chatSurfacesImpl';

export const ChatGenUIContext = createContext<ChatGenUI | null>(null);

let implLoad: Promise<typeof import('./chatSurfacesImpl')> | null = null;
const loadImpl = (): Promise<typeof import('./chatSurfacesImpl')> => (implLoad ??= import('./chatSurfacesImpl'));

/** Run `fn` when the page is idle (a timeout caps the wait), or on the next tick where there is no idle callback. */
function whenIdle(fn: () => void): () => void {
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const h = w.requestIdleCallback(fn, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(h);
  }
  const h = setTimeout(fn, 0);
  return () => clearTimeout(h);
}

/** A chat never checked for saved cards is checked once, long after the boot window (surfaceMarks.ts). */
const CHECK_AFTER_MS = 20000;
function afterBoot(fn: () => () => void): () => void {
  let cancel: (() => void) | null = null;
  const h = setTimeout(() => (cancel = fn()), CHECK_AFTER_MS);
  return () => {
    clearTimeout(h);
    cancel?.();
  };
}

/**
 * One ChatGenUI for the open chat. The lazy half loads when an agent turn starts, when the chat is known to hold saved
 * cards (idle), or once 20 s after a chat nobody has checked is opened; then the saved cards are read. The stream is open while an agent turn runs (`busy`); a new
 * chat gets a new instance and the old one is closed, as is the stream when the chat unmounts.
 */
export function useChatGenUI(chatId: string | null, busy: boolean, turnId: string | null, opts?: ChatGenUIOptions): ChatGenUI | null {
  const [made, setMade] = useState<ChatGenUI | null>(null);
  const chat = made && made.chatId === chatId ? made : null;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const startRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!chatId) return undefined;
    let live = true;
    let instance: ChatGenUI | null = null;
    let started = false;
    const start = (): void => {
      if (started) return;
      started = true;
      void loadImpl().then(({ ChatGenUI: Impl }) => {
        if (!live) return;
        instance = new Impl(chatId, optsRef.current);
        instance.load();
        setMade(instance);
      });
    };
    startRef.current = start;
    /* Saved cards are the only reason to load without a turn, and only a chat that has some needs them. */
    const mark = readSurfaceMark(chatId);
    const cancel = mark === 'has' ? whenIdle(start) : mark === 'unknown' ? afterBoot(() => whenIdle(start)) : () => {};
    return () => {
      live = false;
      cancel();
      startRef.current = null;
      instance?.dispose();
    };
  }, [chatId]);
  /* A running agent turn cannot wait for the idle callback: its cards would arrive with nobody to draw them. */
  useEffect(() => {
    if (busy) startRef.current?.();
  }, [busy, chatId]);
  if (chat) chat.setTurn(turnId);
  useEffect(() => {
    if (!chat) return;
    if (busy) chat.connect();
    else chat.disconnect();
  }, [chat, busy]);
  return chat;
}

export function TurnSurfaces({ turnId }: { turnId: string }): JSX.Element | null {
  const chat = useContext(ChatGenUIContext);
  useSyncExternalStore(chat?.subscribe ?? noSubscribe, chat?.snapshot ?? zero, chat?.snapshot ?? zero);
  return chat ? chat.renderCards(turnId) : null;
}

const noSubscribe = (): (() => void) => () => {};
const zero = (): number => 0;
