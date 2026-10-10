import { describe, expect, it } from 'vitest';

import first from './onboarding.css?raw';
import settings from '../settings/settings.css?raw';

/* Round 13 (N1 to N3): the welcome ground, centred content, and one button hierarchy. */
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (c: string) => [...strip(c).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const last = (rs: { sel: string; body: string }[], sel: string) => rs.filter((r) => r.sel === sel).pop();

describe('welcome and setup surfaces', () => {
  const fr = rulesOf(first);

  it('sits on the normal app ground, translucent, so the app behind shows faintly (not a flat dark screen)', () => {
    const root = last(fr, '.fr-root')!;
    expect(root.body).toMatch(/background:\s*color-mix\(in srgb, var\(--bg-ground\) \d+%, transparent\)/);
    const pct = Number(/var\(--bg-ground\) (\d+)%/.exec(root.body)![1]);
    expect(pct).toBeGreaterThanOrEqual(60);
    expect(pct).toBeLessThan(100);
  });

  it('centres the column and its route content', () => {
    expect(last(fr, '.fr-col')!.body).toMatch(/align-items:\s*center/);
    expect(last(fr, '.fr-route-acts, .fr-key-acts, .fr-card-acts, .fr-foot')!.body).toMatch(/justify-content:\s*center/);
  });

  it('buttons have a clear outline and a soft token shadow, the primary a deeper one', () => {
    const btn = last(fr, '.fr-btn')!;
    expect(btn.body).toMatch(/border:\s*var\(--w-hair\) solid var\(--edge-strong\)/);
    expect(btn.body).toMatch(/box-shadow:\s*var\(--e1\)/);
    expect(btn.body).toMatch(/justify-content:\s*center/);
    expect(last(fr, '.fr-btn.fr-primary')!.body).toMatch(/box-shadow:\s*var\(--e2\)/);
  });

  it('uses tokens only for colour and shadow', () => {
    expect(strip(first)).not.toMatch(/box-shadow:[^;]*(rgba?\(|#[0-9a-f]{3})/i);
  });
});

describe('Settings button hierarchy', () => {
  const st = rulesOf(settings);

  it('primary lifts, quiet has no outline or fill, secondary keeps its outline', () => {
    expect(last(st, '.settings-scope .sb-pill-solid')!.body).toMatch(/box-shadow:\s*var\(--e1\)/);
    const quiet = last(st, '.settings-scope .sb-pill-quiet')!;
    expect(quiet.body).toMatch(/border-color:\s*transparent/);
    expect(quiet.body).toMatch(/background:\s*transparent/);
    expect(st.some((r) => r.sel === '.settings-scope .sb-pill')).toBe(true);
  });

  it('the Local model and API key choices read as primary: accent outline, wash and lift', () => {
    const choice = last(st, '.settings-scope .sb-choice')!;
    expect(choice.body).toMatch(/border-color:\s*var\(--accent-edge\)/);
    expect(choice.body).toMatch(/accent-wash/);
    expect(choice.body).toMatch(/box-shadow:\s*var\(--e1\)/);
  });
});
