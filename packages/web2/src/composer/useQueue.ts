/* ══════════════════════════════════════════════════════════════════════════
   THE QUEUE'S HOOKS, APART FROM ITS LIST (S5)
   packages/web2/src/composer/useQueue.ts

   The composer drains the queue and asks whether it has anything from the
   first frame, so these two hooks are on the boot path. The list that draws
   the queue (PromptQueueList.tsx, with its stylesheet) is not: it loads the
   first time something is queued.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { createQueueDrain, followOtherWindows, promptQueue, type PromptQueue, type QueuedPrompt } from './promptQueue';

export function useQueuedPrompts(queueKey: string, queue: PromptQueue = promptQueue): readonly QueuedPrompt[] {
  return useSyncExternalStore(
    queue.subscribe,
    () => queue.items(queueKey),
    () => queue.items(queueKey),
  );
}

/**
 * Send the next queued prompt each time this chat's turn settles. `send` is
 * the composer's own send (the same path Enter takes when nothing runs).
 */
/** Whether this chat's queue came back from a restart and waits for Resume. */
export function useQueueHeld(queueKey: string, queue: PromptQueue = promptQueue): boolean {
  return useSyncExternalStore(
    queue.subscribe,
    () => queue.held(queueKey),
    () => queue.held(queueKey),
  );
}

export function useQueueDrain(queueKey: string, running: boolean, send: (text: string) => void, queue: PromptQueue = promptQueue): void {
  const sendRef = useRef(send);
  sendRef.current = send;
  const keyRef = useRef(queueKey);
  keyRef.current = queueKey;
  useEffect(() => (typeof window === 'undefined' ? undefined : followOtherWindows(queue)), [queue]);
  const drain = useMemo(() => createQueueDrain(queue, () => keyRef.current, (t) => sendRef.current(t)), [queue]);
  const items = useQueuedPrompts(queueKey, queue);
  const held = useQueueHeld(queueKey, queue);
  useEffect(() => {
    drain.update(running);
  }, [drain, running, items, held]);
}
