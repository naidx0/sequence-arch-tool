/* ══════════════════════════════════════════════════════════════════════════
   THE NOTIFICATION PREFERENCE, WHICH DID NOT SURVIVE A RELOAD
   packages/web2/src/settings/notifyPreference.ts

   `notifyModel.ts` decides WHETHER to notify and what to say, and it is
   complete, correct and tested. What was missing sat either side of it:

     · the user's on/off choice was component-local `useState` in
       SettingsPanel, so it reset on every reload and on every close of the
       overlay — a switch that forgets is a switch that does not work,
     · and nothing anywhere called `runFinishedNotice`, so even with the
       permission granted and the switch on, nothing could ever fire.

   THE PERMISSION IS THE BROWSER'S AND IS NOT STORED HERE. Only the user's own
   preference is. Caching "granted" would be a second, staler copy of a fact the
   browser already owns and can revoke at any moment — and acting on the stale
   copy is how a product tries to notify after being told not to.

   PURE, with storage injected, so the decision is answerable without a browser.
   ══════════════════════════════════════════════════════════════════════════ */

/** Where the preference lives. Namespaced like every other key this app sets. */
export const NOTIFY_KEY = 'sequence.notify.runs';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

/**
 * Whether the user asked to be told when a run finishes.
 *
 * DEFAULTS TO FALSE, and the default is the whole point: a product that
 * notified by default would be spending a permission the reader never granted
 * on an interruption they never asked for. Anything unreadable is also false —
 * a corrupt value must not turn a notification on.
 */
export function readNotifyEnabled(store: Store | undefined = storage()): boolean {
  try {
    return store?.getItem(NOTIFY_KEY) === 'on';
  } catch {
    /* Storage can be denied outright. That costs the preference, and must not
       cost the settings panel. */
    return false;
  }
}

export function writeNotifyEnabled(enabled: boolean, store: Store | undefined = storage()): void {
  try {
    store?.setItem(NOTIFY_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Quota, or denied. The switch still moves on screen for this session. */
  }
}

/**
 * Run statuses that mean the run is over, or is waiting for a person.
 *
 * `paused` is included and is the interesting one: it is the only status where
 * the notification is a REQUEST rather than a report, and it is the case a
 * reader most wants to hear about — a run that stopped needing them and is
 * sitting idle until they come back.
 */
export const NOTIFIABLE_STATUSES = [
  'completed',
  'failed',
  'stopped',
  'paused',
  'interrupted',
] as const;

export type NotifiableStatus = (typeof NOTIFIABLE_STATUSES)[number];

export function isNotifiable(status: string): status is NotifiableStatus {
  return (NOTIFIABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Which runs just reached a notifiable status.
 *
 * TRANSITIONS, NOT STATES. Notifying on every poll that finds a finished run
 * would re-announce the same run every few seconds for as long as it stayed in
 * the list — which is how a person turns notifications off and never turns them
 * back on.
 *
 * A run seen for the FIRST TIME already finished is not a transition either.
 * On a fresh load the list arrives full of yesterday's runs, and announcing all
 * of them is the same failure in one burst.
 */
export function newlyFinished(
  previous: ReadonlyMap<string, string>,
  current: readonly { id: string; status: string }[],
): { id: string; status: NotifiableStatus }[] {
  const out: { id: string; status: NotifiableStatus }[] = [];
  for (const run of current) {
    if (!isNotifiable(run.status)) continue;
    const before = previous.get(run.id);
    /* Unknown means this poll is the first time we have seen the run at all. */
    if (before === undefined) continue;
    if (before === run.status) continue;
    out.push({ id: run.id, status: run.status });
  }
  return out;
}

/** Snapshot the statuses, for the next comparison. */
export function statusMap(
  runs: readonly { id: string; status: string }[],
): Map<string, string> {
  return new Map(runs.map((r) => [r.id, r.status]));
}
