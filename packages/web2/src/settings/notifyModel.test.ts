import { describe, expect, it } from 'vitest';

import { notifyControl, runFinishedNotice } from './notifyModel';

/**
 * DESKTOP NOTIFICATIONS — asked for, never sprung.
 *
 * `App.tsx` deferred this to a RULING and was right to: "A notification is an
 * OS permission surface — a prompt the user must be asked for, at a moment
 * CHOSEN BY US, with a decision that persists past the session — and that is
 * its own ruling to make."
 *
 * THE RULING IS ABOUT THE MOMENT, so this design does not have one. The prompt
 * is raised only when a person clicks a control that says what it will do. We
 * never choose a moment because they choose it, which is why this needed no
 * decision made on the owner's behalf.
 *
 * That is not politeness. A denial PERSISTS PAST THE SESSION and the prompt is
 * one-shot: springing it during a long run spends a permission you cannot ask
 * for twice, at the moment the reader is least willing to grant it.
 */

const GRANTED = { permission: 'granted', enabled: true } as const;

describe('the control', () => {
  it('offers to ask, and says the ask is coming', () => {
    const c = notifyControl({ permission: 'default', enabled: false });
    expect(c.actionable).toBe(true);
    /* The person is told a browser prompt is about to appear. A control that
       sprang one without warning is how a reader clicks Block reflexively. */
    expect(c.detail).toMatch(/ask for permission once/i);
    /* And that nothing leaves the machine, which is the first question anyone
       has about a product asking for notifications. */
    expect(c.detail).toMatch(/nothing is sent anywhere/i);
  });

  it('a denial is its own sentence, and says where to undo it', () => {
    const c = notifyControl({ permission: 'denied', enabled: false });
    /*
     * Collapsing "you said no" into "off" would put a switch in front of
     * someone that cannot turn on, and they would click it until they concluded
     * the feature was broken. We cannot re-ask — so the only useful thing left
     * is where they can.
     */
    expect(c.actionable).toBe(false);
    expect(c.detail).toMatch(/site settings/i);
    expect(c.detail).toMatch(/cannot ask again/i);
  });

  it('an unsupported browser says so rather than offering nothing', () => {
    const c = notifyControl({ permission: 'unsupported', enabled: false });
    expect(c.actionable).toBe(false);
    expect(c.detail).toMatch(/does not support/i);
  });

  it('granted-but-off and granted-and-on are different offers', () => {
    expect(notifyControl({ permission: 'granted', enabled: false }).label).toMatch(/Tell me/);
    expect(notifyControl(GRANTED).label).toMatch(/Stop telling me/);
  });
});

describe('what a finished run says', () => {
  it('says nothing without permission, and nothing when merely unsupported', () => {
    for (const permission of ['default', 'denied', 'unsupported'] as const) {
      expect(
        runFinishedNotice({
          state: { permission, enabled: true },
          visible: false,
          runName: 'nightly',
          status: 'completed',
        }),
      ).toBeNull();
    }
  });

  it('says nothing when the user has not turned it on', () => {
    expect(
      runFinishedNotice({
        state: { permission: 'granted', enabled: false },
        visible: false,
        runName: 'nightly',
        status: 'completed',
      }),
    ).toBeNull();
  });

  it('says NOTHING while the tab is visible', () => {
    /*
     * A desktop notification for a thing the reader is already looking at is an
     * interruption reporting something they can see, and the second one teaches
     * them to turn the feature off.
     */
    expect(
      runFinishedNotice({ state: GRANTED, visible: true, runName: 'nightly', status: 'completed' }),
    ).toBeNull();
  });

  it('the STATUS is the headline, not the word "finished"', () => {
    const failed = runFinishedNotice({
      state: GRANTED,
      visible: false,
      runName: 'nightly',
      status: 'failed',
    });
    /*
     * "Your run finished" is the one word that does not distinguish the
     * outcomes a person is waiting to hear — and it is the outcome, not the
     * completion, they left the tab for.
     */
    expect(failed!.title).toBe('nightly failed');

    const ok = runFinishedNotice({
      state: GRANTED,
      visible: false,
      runName: 'nightly',
      status: 'completed',
    });
    expect(ok!.title).toBe('nightly finished');
  });

  it('a paused run says it is waiting on YOU, and does NOT promise a resume', () => {
    const paused = runFinishedNotice({
      state: GRANTED,
      visible: false,
      runName: 'nightly',
      status: 'paused',
    });
    /* The one status where the notification is a request rather than a report,
       and the body says the thing that makes it actionable. */
    expect(paused!.title).toMatch(/waiting on you/i);
    /*
     * IT USED TO ASSERT "can be resumed", AND THAT WAS FALSE. `pause` sets
     * `pauseRequested`, nothing ever clears it, and there is no resume route,
     * so a paused run is paused permanently. The sentence was harmless while
     * nothing fired the notification; wiring it turned a dormant false claim
     * into one a user reads.
     *
     * The scheduler's `resume` primitive is complete and tested, so this is a
     * missing layer rather than a missing idea. A notification must not
     * promise a capability on the strength of a primitive nobody calls.
     */
    expect(paused!.body).not.toMatch(/resum/i);
    expect(paused!.body).toMatch(/where it stopped/i);
  });

  it('every status produces a distinct headline', () => {
    const titles = (['completed', 'failed', 'stopped', 'paused', 'interrupted'] as const).map(
      (status) =>
        runFinishedNotice({ state: GRANTED, visible: false, runName: 'r', status })!.title,
    );
    expect(new Set(titles).size).toBe(titles.length);
  });
});

/**
 * THE COPY MUST FIT THE HOST IT IS READ IN.
 *
 * Sequence is downloaded and run locally — an Electron app, not a tab. Every
 * sentence this control can say named a BROWSER:
 *
 *   "Blocked by your browser"
 *   "Re-allow them in your browser's site settings — this page cannot ask again"
 *   "This browser does not support desktop notifications"
 *
 * In a desktop build there is no browser, no "this site" and no site settings.
 * The instruction is unfollowable, which is the same dead end as telling a
 * reader to open Settings and giving them no way there: the product names a
 * fix the reader cannot carry out.
 *
 * `isDesktop()` has existed in `boot/desktopBridge.ts` the whole time. Nothing
 * asked it.
 */
describe('the sentence a DESKTOP reader is given', () => {
  it('never sends them to a browser setting they do not have', () => {
    const blocked = notifyControl({ permission: 'denied', enabled: false }, { desktop: true });
    expect(blocked.detail).not.toMatch(/browser/i);
    expect(blocked.detail).not.toMatch(/site settings/i);
    expect(blocked.label).not.toMatch(/browser/i);
  });

  it('points at the place a desktop reader can actually change it', () => {
    const blocked = notifyControl({ permission: 'denied', enabled: false }, { desktop: true });
    /* The OS is where a downloaded app's notification permission lives. */
    expect(blocked.detail).toMatch(/system|notification settings/i);
  });

  it('says the right thing when the host cannot notify at all', () => {
    const none = notifyControl({ permission: 'unsupported', enabled: false }, { desktop: true });
    expect(none.detail).not.toMatch(/browser/i);
  });

  it('and the prompt sentence names no browser either', () => {
    const ask = notifyControl({ permission: 'default', enabled: false }, { desktop: true });
    expect(ask.detail).not.toMatch(/browser/i);
  });

  it('KEEPS THE BROWSER WORDING when it really is a browser', () => {
    /* Sequence runs in a tab during development and from `sequence app`, and
       there "your browser's site settings" is the correct instruction. The
       host decides; neither sentence is universally right. */
    const blocked = notifyControl({ permission: 'denied', enabled: false }, { desktop: false });
    expect(blocked.detail).toMatch(/browser/i);
  });

  it('defaults to the browser wording when no host is stated', () => {
    /* Every existing caller passes no host, and the web build is the one that
       must not change by accident. */
    expect(notifyControl({ permission: 'denied', enabled: false }).detail).toMatch(/browser/i);
  });
});
