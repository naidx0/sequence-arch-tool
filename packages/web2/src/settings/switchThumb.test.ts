import { describe, expect, it } from 'vitest';

import css from './settings.css?raw';

/* Round 13 (O5): the toggle thumb is centred. The thumb is absolutely placed at 2px inside a 36x20 track, and
   an absolute offset is measured inside the track's border, so any border on the track pushes it off centre
   (a 1px border gave 3px/1px/3px/1px). The track has no border and no padding; the travel is track minus
   thumb minus the two 2px gaps. */

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const body = (sel: string) => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');
const px = (b: string, prop: string) => Number(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+)px`).exec(b)?.[1]);

describe('the switch', () => {
  const track = body('.settings-scope .sb-switch');
  const thumb = body('.settings-scope .sb-switch::before');
  it('has no border or padding that would shift the thumb', () => {
    expect(track).toMatch(/border:\s*0/);
    expect(track).toMatch(/padding:\s*0/);
    expect(track).toMatch(/box-sizing:\s*border-box/);
  });
  it('leaves equal gaps on every side, off and on', () => {
    const [w, h] = [px(track, 'width'), px(track, 'height')];
    const [tw, th, top, left] = [px(thumb, 'width'), px(thumb, 'height'), px(thumb, 'top'), px(thumb, 'left')];
    expect(top).toBe((h - th) / 2);
    expect(left).toBe(top);
    const travel = Number(/translate:\s*(\d+)px/.exec(body('.settings-scope .sb-switch:checked::before'))?.[1]);
    expect(w - tw - left - travel).toBe(left);
  });
});
