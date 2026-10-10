/* ══════════════════════════════════════════════════════════════════════════
   THE ASK LEDGER: THE PERSON'S ONE SWITCH (t3gap/asks)
   packages/web2/src/settings/askLedgerPreference.ts

   off   nothing changes (the default until the agent A/B in
         harness-study/t3gap/asks says it helps)
   chip  Claude and Codex chats only: a short private instruction asks the
         agent to end a multi-request reply on one closing line naming each
         request, done or not done. A request it marks not done ends the run
         on "The agent reports not done: X" with Ask again. Nothing shows otherwise. The
         built-in (local) chat gets no ledger.
   auto  the same, and Ask again is sent once, automatically.

   Stored in this browser (per device).

   Only the person's choice is stored; a missing or corrupt value is off.
   ══════════════════════════════════════════════════════════════════════════ */

export const ASK_LEDGER_KEY = 'sequence.askLedger';

export type AskLedgerMode = 'off' | 'chip' | 'auto';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readAskLedgerMode(store: Store | undefined = storage()): AskLedgerMode {
  try {
    const v = store?.getItem(ASK_LEDGER_KEY);
    return v === 'chip' || v === 'auto' ? v : 'off';
  } catch {
    return 'off';
  }
}

export function writeAskLedgerMode(mode: AskLedgerMode, store: Store | undefined = storage()): void {
  try {
    store?.setItem(ASK_LEDGER_KEY, mode);
  } catch {
    /* Quota or denied: the choice still holds for this session's next read failing closed (off). */
  }
}
