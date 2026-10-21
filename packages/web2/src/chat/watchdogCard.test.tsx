/* ══════════════════════════════════════════════════════════════════════════
   017 H5: THE RUN WATCHDOG IS A SHADED CARD WITH A HIERARCHY
   Owner review: more presence, emphasis on the key words, Keep waiting primary and Stop secondary, from the kit.
   0161 S2: one line only. The detail moves to the sentence's tooltip and screen-reader text; the buttons are flat.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AgentRun } from '../agents/agentRuns';
import { HUNG_MS, QUIET_MS, RunWatchdog } from './RunWatchdog';

const t0 = 1_800_000_000_000;
const running = (over: Partial<AgentRun> = {}): AgentRun =>
  ({ id: 'r', sessionId: 's', agentRef: 'claude', prompt: 'q', status: 'running', startedAt: t0, endedAt: null, items: [{ kind: 'note', id: 'n', text: 'x' }], approvals: [], retry: { question: 'q' }, lastEventAt: t0, ...over }) as AgentRun;
const cls = (id: string) => screen.getByTestId(id).className.split(/\s+/);
const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const agentRun = strip(readFileSync(join(__dirname, 'agentRun.css'), 'utf8'));
const tokens = strip(readFileSync(join(__dirname, '../tokens/graphite.css'), 'utf8'));
const rule = (sel: string) => new RegExp(`${sel.replace(/[[\]'.]/g, '\\$&')} \\{([^}]*)\\}`).exec(agentRun)?.[1] ?? '';
const keys = () => [...document.querySelectorAll('.agnote-key')].map((n) => n.textContent);

describe('the watchdog words: the agent and the elapsed time are the emphasis', () => {
  it('quiet: "No response from Claude for 48s" with the name and the time emphasised, the text unchanged', () => {
    render(<RunWatchdog run={running()} now={t0 + 48_000} onStop={() => {}} />);
    expect(screen.getByTestId('agent-run-watchdog-text').textContent).toBe('No response from Claude for 48s');
    expect(keys()).toEqual(['Claude', '48s']);
  });
  it('hung: the agent name is the emphasis; starting: the name and the time', () => {
    const { unmount } = render(<RunWatchdog run={running()} now={t0 + HUNG_MS + 1000} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.getByTestId('agent-run-watchdog-text').textContent).toBe("Claude isn't responding.");
    expect(keys()).toEqual(['Claude']);
    unmount();
    render(<RunWatchdog run={running({ items: [] })} now={t0 + QUIET_MS + 3000} onStop={() => {}} />);
    expect(keys()).toEqual(['Claude', '48s']);
  });
});

describe('the actions are plain kit buttons: Keep waiting (Retry when hung) the primary by weight, Stop the secondary', () => {
  const primary = (id: string) => screen.getByTestId(id).getAttribute('data-primary');
  it('quiet: both are .s2-btn.s2-btn-sm with no accent fill; Keep waiting is the primary, Stop is not', () => {
    render(<RunWatchdog run={running()} now={t0 + 48_000} onStop={() => {}} />);
    for (const id of ['agent-run-watchdog-wait', 'agent-run-watchdog-stop']) {
      expect(cls(id)).toEqual(['s2-btn', 's2-btn-sm']);
    }
    expect(primary('agent-run-watchdog-wait')).toBe('true');
    expect(primary('agent-run-watchdog-stop')).toBeNull();
  });
  it('hung: Retry is the primary, Stop the secondary, neither accent-filled', () => {
    render(<RunWatchdog run={running()} now={t0 + HUNG_MS + 1000} onStop={() => {}} onRetry={() => {}} />);
    expect(cls('agent-run-watchdog-retry')).toEqual(['s2-btn', 's2-btn-sm']);
    expect(primary('agent-run-watchdog-retry')).toBe('true');
    expect(primary('agent-run-watchdog-stop')).toBeNull();
    expect(screen.queryByTestId('agent-run-watchdog-wait')).toBeNull();
  });
  it('the primary is told apart by weight and ink in the css, and the source never fills a button with the accent', () => {
    const p = rule(".agnote[data-watch='film'] .agnote-acts .s2-btn[data-primary='true']");
    expect(p).toMatch(/color: var\(--b-ink1\)/);
    expect(p).toMatch(new RegExp(`${['font', 'weight'].join('-')}: var\\(--fw-solid\\)`));
    expect(readFileSync(join(__dirname, 'RunWatchdog.tsx'), 'utf8')).not.toMatch(/s2-blue/);
  });
  it('control: the primary and the secondary are told apart', () => {
    render(<RunWatchdog run={running()} now={t0 + 48_000} onStop={() => {}} />);
    expect(primary('agent-run-watchdog-wait')).not.toBe(primary('agent-run-watchdog-stop'));
  });
});

describe('the detail is a tooltip and screen-reader text, never a visible line', () => {
  const detailOf = (run: AgentRun, now: number) => {
    const { unmount } = render(<RunWatchdog run={run} now={now} onStop={() => {}} onRetry={() => {}} />);
    const text = screen.getByTestId('agent-run-watchdog-text');
    const out = { title: text.getAttribute('title'), describedBy: text.getAttribute('aria-describedby'), sentence: text.textContent };
    unmount();
    return out;
  };
  it('quiet: the sentence has the detail as its title, and the same words as its accessible description', () => {
    const got = detailOf(running(), t0 + 48_000);
    expect(got.sentence).toBe('No response from Claude for 48s');
    expect(got.title).toBe('The turn is still open.');
    expect(got.describedBy, 'the sentence names its description').toBeTruthy();
    render(<RunWatchdog run={running()} now={t0 + 48_000} onStop={() => {}} />);
    expect(document.getElementById(screen.getByTestId('agent-run-watchdog-text').getAttribute('aria-describedby')!)?.textContent).toBe('The turn is still open.');
  });
  it('starting and hung carry their own detail the same way', () => {
    expect(detailOf(running({ items: [] }), t0 + QUIET_MS + 3000)).toMatchObject({ sentence: 'Claude is still starting, 48s', title: 'It may still be warming up.' });
    expect(detailOf(running(), t0 + HUNG_MS + 1000)).toMatchObject({ sentence: "Claude isn't responding.", title: 'Stop the turn, or try it again.' });
  });
  it('the detail text sits only in the screen-reader span, which the css takes out of the layout and clips to nothing', () => {
    const { container } = render(<RunWatchdog run={running({ items: [] })} now={t0 + QUIET_MS + 3000} onStop={() => {}} />);
    const holders = [...container.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent === 'It may still be warming up.');
    expect(holders.map((e) => e.className)).toEqual(['agnote-sr']);
    const sr = rule(".agnote[data-watch='film'] .agnote-sr");
    expect(sr).toMatch(/position: absolute/);
    expect(sr).toMatch(/clip: rect\(0 0 0 0\)/);
    expect(sr).toMatch(/overflow: hidden/);
    expect(rule(".agnote[data-watch='film'] .agnote-detail"), 'no visible detail style remains').toBe('');
  });
});

describe('the watchdog buttons are flat: no drop shadow, no glow, no raised look', () => {
  it('the kit pill carries a drop shadow, and the watchdog overrides it to none on its buttons', () => {
    const kit = readFileSync(join(__dirname, '../shell2/shell2.css'), 'utf8');
    expect(kit).toMatch(/\.s2-btn,\s*\.s2-ibtn\.s2-g \{\s*box-shadow: var\(--b-shadow\);/);
    expect(rule(".agnote[data-watch='film'] .agnote-acts .s2-btn")).toMatch(/box-shadow: none/);
  });
  it('no watchdog rule that styles a button gives it a shadow, glow or drop-shadow filter', () => {
    const btnRules = [...agentRun.matchAll(/([^{}]*agnote-acts[^{}]*)\{([^}]*)\}/g)].filter((m) => /\.s2-btn/.test(m[1]!));
    expect(btnRules.length).toBeGreaterThan(0);
    for (const m of btnRules) {
      for (const s of m[2]!.match(/box-shadow:\s*[^;]+/g) ?? []) expect(s, m[1]).toMatch(/box-shadow:\s*none/);
      expect(m[2], m[1]).not.toMatch(/drop-shadow|text-shadow: [^n]/);
    }
  });
});

describe('the card: soft glass from theme tokens, never a literal colour (R4)', () => {
  const card = rule(".agnote[data-watch='film']");
  const alpha = Number(/background: color-mix\(in srgb, var\(--b-s2\) (\d+)%, transparent\)/.exec(card)?.[1]);
  it('the fill is the panel surface at a low alpha over nothing, with a glass hairline: no accent tint, no blur', () => {
    expect(alpha, 'the fill alpha').toBeLessThanOrEqual(45);
    expect(alpha).toBeGreaterThanOrEqual(20);
    expect(card).toMatch(/box-shadow: inset 0 0 0 var\(--w-hair\) var\(--b-glassedge\)/);
    expect(card).not.toMatch(/--b-acc|backdrop-filter/);
    expect(agentRun).not.toMatch(/\.agnote[^{]*\{[^}]*backdrop-filter/);
    expect(rule(".agnote[data-watch='film'][data-tone='warn']"), 'the warn tone adds no tint of its own').toBe('');
    for (const body of [card, rule('.agnote-key')]) expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
  it('the key words use the accent ink, heavier than the sentence', () => {
    expect(rule('.agnote-key')).toMatch(/color: var\(--accent-ink\)/);
    expect(rule('.agnote-key')).toMatch(new RegExp(`${['font', 'weight'].join('-')}: var\\(--fw-label\\)`));
  });
});

describe('the card lays out on a grid so the parts share a centre line and the insets are even', () => {
  const row = rule(".agnote[data-watch='film'] .agnote-row");
  it('the row is a three-column grid centred on one line, with named areas for the mark, sentence and actions', () => {
    expect(row).toMatch(/display: grid/);
    expect(row).toMatch(/align-items: center/);
    expect(row).toMatch(/grid-template-columns: auto minmax\(0, 1fr\) auto/);
    for (const [cls, area] of [['.agnote-mark', 'mark'], ['.agnote-text', 'text'], ['.agnote-acts', 'acts']]) {
      expect(rule(`.agnote[data-watch='film'] ${cls}`)).toMatch(new RegExp(`grid-area: ${area}`));
    }
  });
  it('the padding is even left and right, and the actions are right-aligned in both layouts', () => {
    const pad = /padding: (var\(--sp-\d+\)) (var\(--sp-\d+\))/.exec(rule(".agnote[data-watch='film']"));
    expect(pad, 'one vertical and one horizontal padding token').not.toBeNull();
    expect(rule(".agnote[data-watch='film'] .agnote-acts")).toMatch(/justify-self: end/);
  });
  it('wide puts the actions on the sentence row; narrow (the default) wraps them below', () => {
    const q = /@container \(min-width: (\d+)px\) \{([\s\S]*?)\n\}/.exec(agentRun);
    expect(q, 'a container query on the card').not.toBeNull();
    expect(Number(q![1])).toBeGreaterThanOrEqual(340);
    expect(q![2]).toMatch(/'mark text acts'/);
    expect(row).toMatch(/'\. acts acts'/);
    expect(agentRun).toMatch(/\.agnote\[data-watch='film'\] \{[^}]*container-type: inline-size/);
  });
});

/* Contrast, computed from the token values: the key words (accent ink) and the sentence (ink-1) on the card's own
   fill (the panel surface at its alpha over the chat ground), for both the surface-1 and the surface-2 ground, and
   the button labels on the card with the kit's glass on top. The detail is no longer visible text (see below), so it
   has no contrast of its own on screen. */
type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const mix = (a: RGB, b: RGB, p: number): RGB => a.map((v, i) => v * p + b[i]! * (1 - p)) as RGB;
const decl = (block: string, name: string) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)![1]!;
const rgba = (block: string, name: string) => {
  const m = new RegExp(`${name}:\\s*rgba\\((\\d+),(\\d+),(\\d+),([.\\d]+)\\)`).exec(block)!;
  return { c: [Number(m[1]), Number(m[2]), Number(m[3])] as RGB, a: Number(m[4]) };
};

describe('the card text keeps its contrast on the glass fill', () => {
  const light = tokens.slice(tokens.indexOf(':root {'));
  const blue = tokens.slice(tokens.indexOf(':root:not([data-accent])[data-theme="light"]'));
  /* The default dark room (no attribute is blue): the block the app paints, not the gold base below it. */
  const dark = tokens.slice(tokens.indexOf(':root:not([data-accent]):not([data-theme="light"]) {'));
  const alpha = Number(/background: color-mix\(in srgb, var\(--b-s2\) (\d+)%, transparent\)/.exec(rule(".agnote[data-watch='film']"))![1]) / 100;
  const darkGlass = tokens.slice(tokens.indexOf(':root[data-theme="dark"] {'));
  const cases: Array<[string, string, string, string]> = [
    ['light', light, blue, light],
    ['dark', dark, dark, darkGlass],
  ];
  for (const [theme, base, accent, glassBlock] of cases) {
    for (const ground of ['--surface-1', '--surface-2']) {
      it(`${theme} over ${ground}: key words, sentence, detail and both buttons are all >= 4.5:1`, () => {
        const g = hex(decl(base, ground));
        const fill = mix(hex(decl(base, '--surface-2')), g, alpha);
        const key = hex(decl(accent, '--accent-ink'));
        expect(ratio(key, fill), 'key words').toBeGreaterThanOrEqual(4.5);
        expect(ratio(hex(decl(base, '--ink-1')), fill), 'sentence and primary button').toBeGreaterThanOrEqual(4.5);
        /* the secondary button: ink-2 on the kit's glass pill, laid over the card fill */
        const glass = rgba(glassBlock, '--glass-ctl');
        const pill = mix(glass.c, fill, glass.a);
        expect(ratio(hex(decl(base, '--ink-2')), pill), 'secondary button').toBeGreaterThanOrEqual(4.5);
        expect(ratio(hex(decl(base, '--ink-1')), pill), 'primary button').toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('control: the checker fails a low-contrast pair', () => {
    expect(ratio(hex('#777777'), hex('#888888'))).toBeLessThan(4.5);
  });
});
