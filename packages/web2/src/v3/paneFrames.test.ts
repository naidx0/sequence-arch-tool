import { describe, expect, it } from 'vitest';

import { frameOf, snapOnRelease, snapSplit, snapToFrame } from './paneFrames';

/**
 * Owner walk 2026-09-17: at a 1256px window the chat column had been dragged
 * to ~455px, a width no surface was designed for, and the composer's Plan /
 * model / Med / Send controls stacked into two rows. The frames exist so a
 * drag lands on a designed width instead.
 */
describe('snapToFrame', () => {
  const TOTAL = 1000;

  it('locks to the nearest frame', () => {
    /* 1/2 of 1000 is 500; a drag that lets go at 512 lands on the half. */
    expect(snapToFrame(512, TOTAL, 260, 900)).toEqual({ width: 500, frame: '1/2' });
    expect(snapToFrame(322, TOTAL, 260, 900)).toEqual({ width: 333, frame: '1/3' });
  });

  it('snaps at ANY distance — no free width between the frames', () => {
    /* Owner, 2026-09-17: "make sure it makes people snap to those frames
       instead of letting them infinitely choose." 455 is 122px from the third
       and 45px from the half — under the old 22px magnet it stayed at 455,
       which is the exact width that stacked the composer into two rows. */
    expect(snapToFrame(455, TOTAL, 260, 900)).toEqual({ width: 500, frame: '1/2' });
    /* Dead centre between the third (333) and the half (500): the nearer of
       the two by a pixel wins, and neither answer is a free width. */
    expect(snapToFrame(416, TOTAL, 260, 900)).toEqual({ width: 333, frame: '1/3' });
    expect(snapToFrame(417, TOTAL, 260, 900)).toEqual({ width: 500, frame: '1/2' });
  });

  it('never offers a frame the clamp forbids', () => {
    /* 1/4 of 1000 is 250, below the 260 floor. A drag to 252 is nearest to
       that quarter and STILL does not get it — the floor outranks the frames,
       so the nearest frame the pane may actually have is the third. */
    expect(snapToFrame(252, TOTAL, 260, 900)).toEqual({ width: 333, frame: '1/3' });
  });

  it('falls back to the clamped width when the clamp admits no frame at all', () => {
    /* [520, 600] of 1000 contains none of 250/333/500/667/750. There is
       nothing to snap to, so the clamp answers alone and says `frame: null`
       rather than naming a frame the pane is not on. */
    expect(snapToFrame(700, TOTAL, 520, 600)).toEqual({ width: 600, frame: null });
    expect(snapToFrame(400, TOTAL, 520, 600)).toEqual({ width: 520, frame: null });
  });

  it('is a no-op with no shared width to measure against', () => {
    expect(snapToFrame(480, 0, 260, 900)).toEqual({ width: 480, frame: null });
    expect(snapToFrame(480, Number.NaN, 260, 900)).toEqual({ width: 480, frame: null });
  });
});

/**
 * Owner walk 2026-09-18, on the installed app: "I like the snap frames… but I
 * kind of like the fluid drag motion. Right now it's purely snapping and no
 * drag-to-snap."
 *
 * The frames stayed; the gesture came back. These are the two halves of the
 * same pointer position — where the edge IS while the finger is down, and where
 * it will BE when the finger lifts — and the whole point is that they differ.
 */
describe('snapOnRelease', () => {
  const TOTAL = 1000;

  it('follows the pointer while the drag runs, and names the landing', () => {
    const out = snapOnRelease(455, TOTAL, 260, 900);
    /* The width is the pointer's own — 455, not a frame. This is the exact
       number that made the drag feel like a five-position switch when
       `snapToFrame` was called on every move. */
    expect(out.width).toBe(455);
    /* …and the landing is still compulsory: the guide line points at the half. */
    expect(out.release).toEqual({ width: 500, frame: '1/2' });
  });

  it('the live width and the landing are different numbers between frames', () => {
    /* The claim the guide line exists to make. If these ever agreed for every
       input, the drag would be snapping again and nobody would notice the guide
       had stopped moving independently. */
    for (const raw of [300, 355, 410, 470, 540, 610, 700]) {
      const out = snapOnRelease(raw, TOTAL, 260, 900);
      expect(out.width).toBe(raw);
      expect(out.release.frame).not.toBeNull();
    }
    expect(snapOnRelease(410, TOTAL, 260, 900).width).not.toBe(
      snapOnRelease(410, TOTAL, 260, 900).release.width,
    );
  });

  it('CLAMPS THE LIVE WIDTH — fluid is not unbounded', () => {
    /* A pane that follows the pointer past its own floor is a pane whose
       composer has already stacked, whatever the release later does about it.
       The clamp binds the live width exactly as it binds the landing. */
    expect(snapOnRelease(40, TOTAL, 260, 900).width).toBe(260);
    expect(snapOnRelease(4000, TOTAL, 260, 900).width).toBe(900);
  });

  it('agrees with snapToFrame about the landing, always', () => {
    /* One decision, made in one place. A second nearest-frame rule inside the
       shell is a second answer waiting to drift from this one. */
    for (const raw of [252, 333, 455, 512, 700, 880]) {
      expect(snapOnRelease(raw, TOTAL, 260, 900).release).toEqual(
        snapToFrame(raw, TOTAL, 260, 900),
      );
    }
  });
});

describe('snapSplit', () => {
  it('splits two live panes on thirds and halves, both above the floor', () => {
    expect(snapSplit(410, 800, 160)).toEqual({ left: 400, right: 400, frame: '1/2' });
    expect(snapSplit(270, 800, 160)).toEqual({ left: 267, right: 533, frame: '1/3' });
  });

  it('keeps the right pane above the floor when the left is dragged wide', () => {
    const out = snapSplit(700, 800, 160);
    expect(out.right).toBeGreaterThanOrEqual(160);
    expect(out.left + out.right).toBe(800);
  });
});

describe('frameOf', () => {
  it('names the frame a settled width sits on, within a pixel of rounding', () => {
    expect(frameOf(333, 1000)).toBe('1/3');
    expect(frameOf(334, 1000)).toBe('1/3');
    expect(frameOf(455, 1000)).toBeNull();
  });
});
