/* ══════════════════════════════════════════════════════════════════════════
   TURN-END AND APPROVAL NOTIFICATIONS: the person's two switches (S5)
   packages/web2/src/settings/attentionPreference.ts

   ON BY DEFAULT, unlike the long-run switch in notifyPreference.ts, and the
   difference is what each one reports. A run finishing is news; an agent
   that has stopped to ask you something, or has stopped altogether, is the
   thing you are waiting for. Missing it costs the whole wait.

   ON BY DEFAULT IS NOT A PROMPT. In a browser nothing fires until the
   permission is granted, and the permission is only ever asked for when the
   person clicks to enable (SettingsPanel, notifyModel's ruling). In the
   desktop app the OS draws the notification and there is no browser prompt.

   Only the person's choice is stored. 'off' turns one off; anything else,
   including nothing or a corrupt value, is on.
   ══════════════════════════════════════════════════════════════════════════ */

export const NOTIFY_TURNS_KEY = 'sequence.notify.turns';
export const NOTIFY_APPROVALS_KEY = 'sequence.notify.approvals';

export type AttentionKind = 'turns' | 'approvals';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

const keyOf = (kind: AttentionKind): string => (kind === 'turns' ? NOTIFY_TURNS_KEY : NOTIFY_APPROVALS_KEY);

export function readAttentionEnabled(kind: AttentionKind, store: Store | undefined = storage()): boolean {
  try {
    return store?.getItem(keyOf(kind)) !== 'off';
  } catch {
    return true;
  }
}

export function writeAttentionEnabled(kind: AttentionKind, enabled: boolean, store: Store | undefined = storage()): void {
  try {
    store?.setItem(keyOf(kind), enabled ? 'on' : 'off');
  } catch {
    /* Quota or denied: the switch still moves for this session. */
  }
}
