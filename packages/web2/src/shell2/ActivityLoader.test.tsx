import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityLoader, CELL_FRAMES, CELL_STILL, RADAR_CELLS_X, RADAR_CELLS_Y, RADAR_FRAMES, RADAR_STEPS, RADAR_STILL, STEP_MS } from './ActivityLoader';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const RADAR_SHAPE = new RegExp(`^[\\u2800-\\u28FF]{${RADAR_CELLS_X}}(\\n[\\u2800-\\u28FF]{${RADAR_CELLS_X}}){${RADAR_CELLS_Y - 1}}$`, 'u');
const dots = (frame: string) => [...frame].reduce((n, ch) => n + (ch === '\n' ? 0 : (ch.codePointAt(0)! & 0xff).toString(2).replace(/0/g, '').length), 0);

describe('the frames are derived from the geometry', () => {
  it('every radar frame is a braille field of the same shape, and every frame is different (the sweep really turns)', () => {
    expect(RADAR_FRAMES).toHaveLength(RADAR_STEPS);
    for (const f of RADAR_FRAMES) expect(f).toMatch(RADAR_SHAPE);
    expect(new Set(RADAR_FRAMES).size).toBe(RADAR_STEPS);
    /* The disc is never blank and never solid. */
    for (const f of RADAR_FRAMES) {
      expect(dots(f)).toBeGreaterThan(12);
      expect(dots(f)).toBeLessThan(RADAR_CELLS_X * RADAR_CELLS_Y * 8);
    }
  });
  it('the compact frames are two braille cells, all different, none of the old star glyphs', () => {
    expect(CELL_FRAMES.length).toBeGreaterThanOrEqual(8);
    for (const f of CELL_FRAMES) expect(f).toMatch(/^[⠀-⣿]{2}$/u);
    expect(new Set(CELL_FRAMES).size).toBe(CELL_FRAMES.length);
    for (const f of [...CELL_FRAMES, ...RADAR_FRAMES]) expect(f).not.toMatch(/[✢✳✶✻✽]/u);
  });
  it('the still frames are frames', () => {
    expect(RADAR_FRAMES).toContain(RADAR_STILL);
    expect(CELL_FRAMES).toContain(CELL_STILL);
  });
});

describe('the component', () => {
  beforeEach(() => vi.useFakeTimers());
  it('radar: its own testid, variant and a stepping timer that stops on unmount', () => {
    const { unmount } = render(<ActivityLoader variant="radar" />);
    const el = screen.getByTestId('activity-loader');
    expect(el.getAttribute('data-variant')).toBe('radar');
    expect(el.textContent).toBe(RADAR_FRAMES[0]);
    act(() => void vi.advanceTimersByTime(STEP_MS));
    expect(el.textContent).toBe(RADAR_FRAMES[1]);
    act(() => void vi.advanceTimersByTime(STEP_MS * (RADAR_STEPS - 1)));
    expect(el.textContent).toBe(RADAR_FRAMES[0]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('radar under prefers-reduced-motion: one still frame, no timer; and inactive does the same', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    render(<ActivityLoader variant="radar" />);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByTestId('activity-loader').textContent).toBe(RADAR_STILL);
    expect(screen.getByTestId('activity-loader').getAttribute('data-still')).toBe('true');
    cleanup();
    vi.unstubAllGlobals();
    render(<ActivityLoader variant="radar" active={false} />);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByTestId('activity-loader').textContent).toBe(RADAR_STILL);
  });
  it('motion (the positive control for the two above): a live loader holds a timer', () => {
    render(<ActivityLoader variant="radar" />);
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('one shared clock, and the motion preference is watched', () => {
  beforeEach(() => vi.useFakeTimers());
  it('50 loaders share one interval; none are left after they unmount', () => {
    const { unmount } = render(
      <>
        {Array.from({ length: 50 }, (_, i) => (
          <ActivityLoader key={i} variant={i % 2 ? 'radar' : 'cell'} testId={'l' + i} />
        ))}
      </>,
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(STEP_MS));
    expect(screen.getByTestId('l0').textContent).toBe(CELL_FRAMES[1]);
    expect(screen.getByTestId('l1').textContent).toBe(RADAR_FRAMES[1]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('a loader that mounts into a quiet page starts on frame 0 (the tick resets with the clock)', () => {
    const first = render(<ActivityLoader variant="radar" />);
    act(() => void vi.advanceTimersByTime(STEP_MS * 3));
    first.unmount();
    render(<ActivityLoader variant="radar" />);
    expect(screen.getByTestId('activity-loader').textContent).toBe(RADAR_FRAMES[0]);
  });
  it('reduced motion switched OFF mid-session resumes the sweep, and ON again holds it, without a remount', () => {
    let matches = true;
    const handlers = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({
      get matches() {
        return matches && /reduce/.test(q);
      },
      media: q,
      addEventListener: (_: string, h: () => void) => void handlers.add(h),
      removeEventListener: (_: string, h: () => void) => void handlers.delete(h),
    }));
    render(<ActivityLoader variant="radar" />);
    const el = screen.getByTestId('activity-loader');
    expect(vi.getTimerCount()).toBe(0);
    expect(el.textContent).toBe(RADAR_STILL);
    expect(handlers.size).toBe(1);
    matches = false;
    act(() => handlers.forEach((h) => h()));
    expect(vi.getTimerCount()).toBe(1);
    act(() => void vi.advanceTimersByTime(STEP_MS));
    expect(el.textContent).toBe(RADAR_FRAMES[1]);
    matches = true;
    act(() => handlers.forEach((h) => h()));
    expect(vi.getTimerCount()).toBe(0);
    expect(el.textContent).toBe(RADAR_STILL);
    cleanup();
    expect(handlers.size).toBe(0);
  });
});

describe('centring contract (the box centres its ink; measured in a browser at 1x and 2x, in every slot)', () => {
  const css = readFileSync(join(__dirname, 'shell2.css'), 'utf8').replace(/\r\n/g, '\n');
  /** The declarations of every rule whose selector is exactly `sel`. */
  const rule = (sel: string): string => {
    const out: string[] = [];
    for (const m of css.matchAll(/(?:^|\n)([^{}\n@][^{}\n]*) \{([^}]*)\}/g)) if (m[1] === sel) out.push(m[2]!);
    return out.join('\n');
  };
  it('the rule finder finds a rule (positive) and not an absent one (negative)', () => {
    expect(rule('.act-loader')).not.toBe('');
    expect(rule('.act-loader.nope')).toBe('');
  });
  it('the box is a flex box centring its ink on both axes (a block line that overflows starts at the left edge)', () => {
    const b = rule('.act-loader');
    expect(b).toMatch(/display:\s*inline-flex/);
    expect(b).toMatch(/align-items:\s*center/);
    expect(b).toMatch(/justify-content:\s*center/);
    expect(rule('.act-loader > .act-ink')).toMatch(/flex:\s*none/);
  });
  it('the compact cell is 12px type (two cells are 14.4 px) in a 14px box whose line-height is its height; no text-align or letter-spacing patches', () => {
    const b = rule('.act-loader.is-cell');
    expect(b).toMatch(/font-size:\s*var\(--t-12\)/);
    expect(b).toMatch(/width:\s*14px/);
    expect(b).toMatch(/height:\s*14px/);
    expect(b).toMatch(/line-height:\s*14px/);
    expect(b).not.toMatch(/letter-spacing|text-align/);
  });
  it('the radar box is a whole number of pixels wide (4 cells are 28.8)', () => {
    expect(rule('.act-loader.is-radar')).toMatch(/width:\s*29px/);
  });
});

/* ── no spinning brand mark ─────────────────────────────────────────────────────────────────────────────────── */
const SRC = resolve(__dirname, '..');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.css$/.test(name)) out.push(p);
  }
  return out;
};
/** Keyframe names whose frames rotate. */
const rotatingKeyframes = (css: string): string[] =>
  [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\n\})/g)].filter((m) => /rotate\(/.test(m[2]!)).map((m) => m[1]!);
/** Rules that run a rotating keyframe on something that is, or holds, a brand or provider mark. */
const spinningBrandRules = (css: string): string[] => {
  const spinning = rotatingKeyframes(css);
  const hits: string[] = [];
  for (const m of css.matchAll(/(^|\n)([^{}@\n][^{}]*)\{([^}]*)\}/g)) {
    const sel = m[2]!.trim();
    const decl = m[3]!;
    if (!/animation(-name)?\s*:/.test(decl)) continue;
    if (!spinning.some((k) => new RegExp(`\\b${k}\\b`).test(decl))) continue;
    if (/brand|provider|chat-icon|sparkfold-mark|sparkle|\.s2-i\b|claude|openai/i.test(sel)) hits.push(sel);
  }
  return hits;
};

describe('no spinning provider icon anywhere', () => {
  it('the scan finds a planted spinning brand mark (positive control) and passes a still one (negative control)', () => {
    const planted = '@keyframes t {\n  to { transform: rotate(360deg); }\n}\n.s2-brand svg {\n  animation: t 1s linear infinite;\n}\n';
    expect(spinningBrandRules(planted)).toEqual(['.s2-brand svg']);
    expect(spinningBrandRules('.s2-brand svg {\n  color: red;\n}\n')).toEqual([]);
    expect(spinningBrandRules('@keyframes t {\n  to { transform: rotate(360deg); }\n}\n.v3-ring {\n  animation: t 1s linear infinite;\n}\n')).toEqual([]);
  });
  it('no stylesheet in the app turns a brand, provider or sparkle mark', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(40);
    const bad = files.flatMap((f) => spinningBrandRules(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).map((s) => `${relative(SRC, f)}: ${s}`));
    expect(bad).toEqual([]);
  });
  it('the reasoning fold no longer turns its sparkle, and the old braille-sprite and ring keyframes are gone', () => {
    const chat = readFileSync(join(SRC, 'chat/chat.css'), 'utf8');
    expect(chat).not.toMatch(/sparkturn/);
    expect(chat).not.toMatch(/spin-braille|spin-ring/);
  });
  it('the busy mark in a row is the loader, never a provider icon: ProviderIcon is not rendered beside any busy state in the shell or chat sources', () => {
    for (const f of ['shell2/StatusBar.tsx', 'chat/AgentRunThread.tsx', 'chat/ThinkingMark.tsx']) {
      const src = readFileSync(join(SRC, f), 'utf8');
      expect(src).not.toMatch(/working[^\n]*<ProviderIcon/);
    }
    expect(readFileSync(join(SRC, 'chat/ThinkingMark.tsx'), 'utf8')).toMatch(/<ActivityLoader/);
    expect(readFileSync(join(SRC, 'chat/ToolCallCard.tsx'), 'utf8')).toMatch(/<ActivityLoader/);
  });
  it('the reduced-motion query is made once: many renders and re-renders do not call matchMedia again', () => {
    vi.useFakeTimers();
    const mm = vi.fn((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('matchMedia', mm);
    const a = render(<ActivityLoader variant="radar" />);
    render(<ActivityLoader variant="cell" />);
    for (let i = 0; i < 20; i += 1) {
      a.rerender(<ActivityLoader variant="radar" className={`n${i}`} />);
      act(() => void vi.advanceTimersByTime(STEP_MS));
    }
    expect(mm).toHaveBeenCalledTimes(1);
  });
});
