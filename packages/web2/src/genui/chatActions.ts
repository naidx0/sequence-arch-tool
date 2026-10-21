/* ══════════════════════════════════════════════════════════════════════════
   CLICKS BACK TO THE AGENT: the chat's side
   packages/web2/src/genui/chatActions.ts

   A click on a generated Button raises the window event `sequence:genui-action`
   (detail: { action, prompt, whileBusy }, from GenUIFence's agent). The chat that owns the
   agent answers it with `createChatActionHandler`:

     idle                          send the prompt as the next user turn, once
     busy, action is whileBusy     steer the prompt into the running turn
     busy, anything else           dropped (the button is inert while the agent works, this is the net)
     the same button, pending      dropped: a double click is one turn

   The chat tells the cards when its turn starts and ends with `announceGenUITurn(busy)`
   (window event `sequence:genui-turn`); the fence's agent turns that into the session's
   `turn` event, which is what clears the clicked button's spinner. The handler forgets its
   pending clicks at `turnEnded()`, and on its own after `ttlMs` so a send that never
   became a turn cannot lock a button for good.

   Pure and DOM-free except `listenForGenUIActions` / `announceGenUITurn`. How to wire it
   into the chat is in docs/genui/README.md ("Clicks back to the agent").
   ══════════════════════════════════════════════════════════════════════════ */
import type { UIAction } from '@sequence/genui';

export const GENUI_ACTION_EVENT = 'sequence:genui-action';
export const GENUI_TURN_EVENT = 'sequence:genui-turn';

export interface GenUIActionDetail {
  action: UIAction;
  /** `actionToPrompt(action)`: the click as a user message. */
  prompt: string;
  /** The action was declared `whileBusy`: it may steer a running turn. */
  whileBusy?: boolean;
}

export type ChatActionResult = 'sent' | 'steered' | 'duplicate' | 'busy' | 'invalid';

export interface ChatActionDeps {
  /** Is this chat's agent mid-turn right now? Read at click time. */
  isBusy: () => boolean;
  /** Send `prompt` as the next user turn. */
  send: (prompt: string) => void;
  /** Put `prompt` into the running turn (the chat's steer, which queues when the agent cannot take it). */
  steer: (prompt: string) => void;
  now?: () => number;
  /** How long a pending click blocks the same button when no turn end arrives. Default 30 s. */
  ttlMs?: number;
}

export interface ChatActionHandler {
  handle(detail: unknown): ChatActionResult;
  /** The chat's turn ended: every pending click is done. */
  turnEnded(): void;
  /** How many clicks are waiting for their turn to end. */
  pending(): number;
}

const valid = (d: unknown): d is GenUIActionDetail => {
  const x = d as Partial<GenUIActionDetail> | null;
  const a = x?.action as Partial<UIAction> | undefined;
  return !!x && typeof x.prompt === 'string' && x.prompt.trim() !== '' && !!a && a.kind === 'ui.action' && typeof a.name === 'string' && typeof a.surfaceId === 'string' && typeof a.elementId === 'string';
};

export function createChatActionHandler(deps: ChatActionDeps): ChatActionHandler {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? 30_000;
  /* key -> when it was sent. One entry per button (surface, element, action). */
  const pending = new Map<string, number>();
  const live = (): void => {
    const t = now();
    for (const [k, at] of pending) if (t - at >= ttl) pending.delete(k);
  };
  return {
    handle(detail) {
      if (!valid(detail)) return 'invalid';
      live();
      const key = `${detail.action.surfaceId}|${detail.action.elementId}|${detail.action.name}`;
      if (pending.has(key)) return 'duplicate';
      if (deps.isBusy()) {
        if (detail.whileBusy !== true) return 'busy';
        pending.set(key, now());
        deps.steer(detail.prompt);
        return 'steered';
      }
      pending.set(key, now());
      deps.send(detail.prompt);
      return 'sent';
    },
    turnEnded() {
      pending.clear();
    },
    pending() {
      live();
      return pending.size;
    },
  };
}

/** Subscribe a handler to the window event. Returns the unsubscribe. */
export function listenForGenUIActions(handler: ChatActionHandler, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const on = (e: Event): void => void handler.handle((e as CustomEvent).detail);
  target.addEventListener(GENUI_ACTION_EVENT, on);
  return () => target.removeEventListener(GENUI_ACTION_EVENT, on);
}

/** The chat's turn started (true) or ended (false). Cards use it to disable controls and clear a clicked button's spinner. */
export function announceGenUITurn(busy: boolean, target: Pick<Window, 'dispatchEvent'> = window): void {
  target.dispatchEvent(new CustomEvent(GENUI_TURN_EVENT, { detail: { busy } }));
}
