/* ══════════════════════════════════════════════════════════════════════════
   DESKTOP NOTIFICATIONS — asked for, never sprung
   packages/web2/src/settings/notifyModel.ts

   `App.tsx` deferred this to a RULING rather than to a wave, and was right to:

     "A notification is an OS permission surface — a prompt the user must be
      asked for, at a moment CHOSEN BY US, with a decision that persists past
      the session — and that is its own ruling to make, not a detail of this
      one."

   THE RULING IS ABOUT THE MOMENT, so this design does not have one. The browser
   prompt is raised only when the person clicks a control in Settings that says
   what it will do. We never pick a moment, because they pick it — which is why
   this needs no decision made on the owner's behalf, and why the deferral it
   was blocked on does not apply.

   That matters beyond politeness. A permission a user denies is a decision that
   PERSISTS PAST THE SESSION and cannot be re-asked by us — springing the prompt
   during a long run is how a product spends a one-shot permission at the moment
   the reader is least willing to grant it.

   ── AND IT IS PURE, so the policy is testable without a browser ───────────

   Everything that decides WHETHER to notify lives here and touches no global.
   The one line that actually calls `new Notification` is in the component,
   because that is the only part that cannot be asked a question in a test.
   ══════════════════════════════════════════════════════════════════════════ */

/** What the environment says, narrowed to what this decision needs. */
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface NotifyState {
  permission: NotifyPermission;
  /** The user's own switch, which is not the same as the OS permission. */
  enabled: boolean;
}

/** What the Settings control should read and do. */
export interface NotifyControl {
  label: string;
  /** A sentence saying what will happen, or why nothing can. */
  detail: string;
  /** False when clicking it could not achieve anything. */
  actionable: boolean;
}

/**
 * The control's whole state machine.
 *
 * FOUR CASES AND EACH IS A DIFFERENT SENTENCE. Collapsing "you said no" into
 * "off" would put a switch in front of someone that cannot turn on, and they
 * would click it until they concluded the feature was broken.
 */
/**
 * WHICH HOST THE READER IS IN.
 *
 * Sequence is downloaded and run locally, so the same control is read in two
 * completely different places: an Electron window, and a browser tab during
 * development or from `sequence app`.
 *
 * Every sentence below used to name a BROWSER. In a desktop build there is no
 * browser, no "this site" and no site settings, so "re-allow them in your
 * browser's site settings" is an instruction the reader cannot carry out -
 * the same dead end as naming a fix and offering no route to it.
 *
 * DEFAULTS TO THE BROWSER WORDING. Every existing caller passes nothing, and
 * the web build is the one that must not change by accident; `isDesktop()`
 * from `boot/desktopBridge` is what a caller passes when it knows.
 */
export interface NotifyHost {
  desktop?: boolean;
}

export function notifyControl(state: NotifyState, host: NotifyHost = {}): NotifyControl {
  const desktop = host.desktop === true;

  if (state.permission === 'unsupported') {
    return {
      label: 'Not available',
      detail: desktop
        ? 'This computer does not support desktop notifications.'
        : 'This browser does not support desktop notifications.',
      actionable: false,
    };
  }
  if (state.permission === 'denied') {
    return {
      /* NEITHER LABEL NAMES A BROWSER IN THE DESKTOP CASE. A reader told they
         are "blocked by your browser" inside a downloaded app goes looking for
         a browser and finds none. */
      label: desktop ? 'Blocked on this computer' : 'Blocked by your browser',
      /* We cannot re-ask: a denial persists past the session and the prompt is
         one-shot. Saying WHERE to undo it is the only useful thing left - and
         where differs entirely between the two hosts. */
      detail: desktop
        ? 'Notifications for Sequence are turned off. Re-allow them in your system notification settings — the app cannot ask again.'
        : 'You blocked notifications for this site. Re-allow them in your browser’s site settings — this page cannot ask again.',
      actionable: false,
    };
  }
  if (state.permission === 'default') {
    return {
      label: 'Tell me when a run finishes',
      detail: desktop
        ? 'You will be asked for permission once. Nothing is sent anywhere — the notification is drawn by your own computer.'
        : 'Your browser will ask for permission once. Nothing is sent anywhere — the notification is drawn by your own computer.',
      actionable: true,
    };
  }
  return state.enabled
    ? {
        label: 'Stop telling me',
        /* "this tab" is also a browser word. In a desktop window the honest
           phrasing is about the window not being in front. */
        detail: desktop
          ? 'You will be notified when a run finishes while this window is in the background.'
          : 'You will be notified when a run finishes while this tab is in the background.',
        actionable: true,
      }
    : {
        label: 'Tell me when a run finishes',
        detail: 'Permission is granted. Turn this on to be notified when a run finishes.',
        actionable: true,
      };
}

/** What a finished run should say, or null when it should say nothing. */
export interface RunFinishedNotice {
  title: string;
  body: string;
}

export interface RunFinishedInput {
  state: NotifyState;
  /** True when the tab is visible — a notification for what is on screen is noise. */
  visible: boolean;
  runName: string;
  status: 'completed' | 'failed' | 'stopped' | 'paused' | 'interrupted';
}

/**
 * Whether to notify, and what to say.
 *
 * NOTHING WHILE THE TAB IS VISIBLE. A desktop notification for a thing the
 * reader is already looking at is an interruption reporting something they can
 * see, and the second one teaches them to turn the feature off.
 */
export function runFinishedNotice(input: RunFinishedInput): RunFinishedNotice | null {
  if (input.state.permission !== 'granted' || !input.state.enabled) return null;
  if (input.visible) return null;

  /* The STATUS is the headline, because "your run finished" is the one word
     that does not distinguish the outcomes a person is waiting to hear. */
  const headline: Record<RunFinishedInput['status'], string> = {
    completed: 'finished',
    failed: 'failed',
    stopped: 'was stopped',
    paused: 'is waiting on you',
    interrupted: 'was interrupted',
  };
  return {
    title: `${input.runName} ${headline[input.status]}`,
    body:
      input.status === 'paused'
        ? /*
           * WHAT IS TRUE TODAY, AND NOT MORE.
           *
           * This said "and can be resumed". It cannot: `pause` sets
           * `pauseRequested`, nothing ever clears it, and there is no resume
           * route — a paused run is paused permanently. The sentence was
           * harmless while nothing fired the notification; wiring the
           * notification turned a dormant false claim into one a user reads.
           *
           * The scheduler's `resume` primitive is complete and tested, so the
           * capability is buildable and is recorded as gap 37. Until it is
           * built, this says where the run stopped and nothing about getting
           * it going again.
           */
          'It halted at a step boundary. Open Sequence to see where it stopped.'
        : 'Open Sequence to see what happened.',
  };
}
