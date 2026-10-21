import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

/*
 * THE SHEETS UNDER TEST, IMPORTED HERE EXPLICITLY.
 *
 * Both are also imported by the components, but a stylesheet that arrives only
 * through a component import is not reliably injected into the jsdom document
 * by the time the first assertion runs — measured: with these two lines present
 * the same element resolves to the concrete value behind `--ink-4`, and without
 * them it resolves to the empty string, which makes every contrast assertion
 * SKIP rather than fail. (The literal value is deliberately not written here:
 * the firewall bans a hex outside the token file in comments as well as in
 * code, on the grounds that a colour written down anywhere is a second source
 * of truth waiting to be pasted, and it is right.) Naming the sheets here also
 * states what this file is measuring.
 */
import '../tokens/graphite.css';
import './boot.css';

import { resolvedStyle } from '../../test/support/css';
import { AttachDialog } from './AttachDialog';
import { BootSurface } from './BootSurface';
import type { BootTransport, WireResult } from './bootSequence';

/**
 * ITEM 2.4 — EVERY WORD ON THIS SURFACE CAN ACTUALLY BE READ.
 *
 * WHY THIS TEST EXISTS, AND IT IS NOT A THEORETICAL CONCERN. This repository
 * shipped the "cream canvas" defect through two full rounds with every gate
 * green (`docs/owner-feedback-log.md:36-97`), and its own conclusion was "only
 * the screenshot showed the defect". The legibility gate in `CLAUDE.md` exists
 * for the same reason. A render test that asserts an element EXISTS says
 * nothing about whether its ink is distinguishable from the ground behind it,
 * and low-contrast text is the failure that looks fine to whoever wrote it —
 * they know what it says.
 *
 * IT FOUND SOMETHING. Driving the real page at 1280x800 measured three
 * elements at **2.41:1** — the crumb separator glyph, the "Recent"/"Folders"
 * section labels, and the path on a recents row — all of them `--ink-4` at
 * `--t-10` on `--surface-2`. The floor for body text is 4.5:1 and for a glyph it is
 * 3:1. The fix was one token per rule; this test is what stops the next one.
 *
 * WHAT IT CAN AND CANNOT SEE. jsdom has no font stack and no compositor, so it
 * cannot tell you a box collapsed or a glyph is a smudge — that is Tier 4's
 * job. What it CAN do, through `test/support/css.ts`'s var() resolver, is
 * resolve the same declared values a browser would and do the arithmetic. The
 * numbers here were cross-checked against Chrome on the real page and agree.
 *
 * IT ASSERTS AGAINST DARK, DELIBERATELY. Light is DEFERRED by owner ruling
 * (`GRAPHITE-DECISIONS.md` Decision 1) and no light values are to be tuned, so
 * asserting a contrast floor against untuned light tokens would be a test
 * demanding work the owner has deferred. Dark is what ships; dark is what is
 * locked. The day light is tuned, this file gains a second pass and not a
 * second implementation.
 */

/* -------------------------------------------------------------------------- *
 * WCAG 2.1 relative luminance and contrast. Transcribed from the spec rather
 * than from a library, because a dependency for eight lines of arithmetic is a
 * dependency, and because the formula has to be readable next to the numbers it
 * produces.
 * -------------------------------------------------------------------------- */

function channels(color: string): [number, number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    const wide = h.length >= 6;
    const at = (i: number) =>
      wide ? parseInt(h.slice(i * 2, i * 2 + 2), 16) : parseInt(h[i] + h[i], 16);
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
    return [at(0), at(1), at(2), alpha];
  }
  const rgb = color.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number | null {
  const f = channels(fg);
  const b = channels(bg);
  if (!f || !b) return null;
  /* Composite a translucent foreground over its ground before measuring: an
   * alpha the eye sees through is an alpha the arithmetic has to see through
   * too, or every rgba() token scores as if it were opaque. */
  const over: [number, number, number] = [
    f[0] * f[3] + b[0] * (1 - f[3]),
    f[1] * f[3] + b[1] * (1 - f[3]),
    f[2] * f[3] + b[2] * (1 - f[3]),
  ];
  const l1 = luminance(over);
  const l2 = luminance([b[0], b[1], b[2]]);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** The nearest opaque ground behind an element, walking the way paint does. */
function groundOf(el: Element): string | null {
  let node: Element | null = el;
  while (node) {
    for (const property of ['background-color', 'background']) {
      const value = resolvedStyle(node, property);
      const parsed = channels(value.split(' ')[0] ?? '');
      if (parsed && parsed[3] > 0.95) return value.split(' ')[0];
    }
    node = node.parentElement;
  }
  return null;
}

interface Finding {
  where: string;
  sample: string;
  fg: string;
  bg: string;
  ratio: number;
  floor: number;
}

/**
 * Every element carrying its own text, plus every glyph, measured.
 *
 * Disabled controls are exempt and that is the standard's own position: a
 * disabled control is meant to read as unavailable, and WCAG 1.4.3 excludes
 * "inactive user interface components". Everything else is in.
 */
function audit(root: Element): { checked: number; failing: Finding[] } {
  const failing: Finding[] = [];
  let checked = 0;

  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.closest('[disabled]')) continue;

    const isGlyph = el.tagName.toLowerCase() === 'svg';
    const ownText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0,
    );
    if (!isGlyph && !ownText) continue;

    /* The one class that is deliberately invisible: the machine-readable state
     * token, clipped to a 1px box for the e2e tier and hidden from everyone
     * else. It carries no meaning a reader is expected to get from looking. */
    if (el.classList.contains('startup-state')) continue;

    const fg = resolvedStyle(el, isGlyph ? 'stroke' : 'color') || resolvedStyle(el, 'color');
    const bg = groundOf(el);
    if (!bg) continue;

    /* `stroke: currentColor` on the glyph resolves to the element's own colour,
     * which the resolver does not substitute — so read the colour directly. */
    const ink = fg === 'currentColor' ? resolvedStyle(el, 'color') : fg;
    const ratio = contrast(ink, bg);
    if (ratio === null) continue;

    checked += 1;

    const size = parseFloat(resolvedStyle(el, 'font-size')) || 12;
    const weight = Number(resolvedStyle(el, 'font-weight')) || 400;
    /* WCAG 1.4.3 and 1.4.11: 3:1 for a non-text graphic and for large text
     * (>=18px, or >=14px bold), 4.5:1 for everything else. This surface is
     * compact by law — nothing on it is large text — so in practice every
     * sentence here is held to 4.5. */
    const floor = isGlyph || size >= 18 || (size >= 14 && weight >= 700) ? 3 : 4.5;

    if (ratio < floor) {
      failing.push({
        where: el.getAttribute('class') ?? el.tagName,
        sample: (el.textContent ?? '').trim().slice(0, 30),
        fg: ink,
        bg,
        ratio,
        floor,
      });
    }
  }

  return { checked, failing };
}

const ok = <T,>(body: T): WireResult<T> => ({ outcome: 'ok', status: 200, body });

const BROWSE = {
  root: '/home/max',
  path: '/home/max/projects',
  parent: '/home/max',
  entries: [
    { name: 'sequence', path: '/home/max/projects/sequence', isRepo: true, hasChildren: true },
    { name: 'notes', path: '/home/max/projects/notes', isRepo: false, hasChildren: false },
  ],
};

function canned(over: Partial<BootTransport> = {}): BootTransport {
  return {
    status: async () => ({ outcome: 'unreachable', message: 'Failed to fetch' }),
    archGraph: async () => ({ outcome: 'unreachable', message: 'Failed to fetch' }),
    detach: async () => ({ outcome: 'unreachable', message: 'Failed to fetch' }),
    recent: async () => ok({ recent: [{ path: '/home/max/projects/old', name: 'old' }] }),
    browse: async () => ok(BROWSE),
    attach: async () => ({ outcome: 'error', status: 403, body: { error: 'path escapes the browse root' } }),
    ...over,
  };
}

describe('item 2.4 — contrast, in the theme that ships', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('clears the floor on every word and glyph of the boot surface', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container } = render(<BootSurface transport={canned()} />);
    await waitFor(() => expect(screen.getByTestId('boot-state').textContent).toBe('no-engine'));

    const { checked, failing } = audit(container);

    /* Non-vacuity. Every assertion below is "nothing failed", and a resolver
     * that silently returned empty strings would make all of them pass while
     * measuring nothing at all — which is the most expensive kind of green. */
    expect(checked).toBeGreaterThan(3);
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
  });

  it('clears the floor on every word and glyph of the attach dialog', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container } = render(<AttachDialog transport={canned()} onAttached={() => {}} />);
    await screen.findAllByTestId('attach-entry');

    const { checked, failing } = audit(container);

    expect(checked).toBeGreaterThan(8);
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
  });

  it('clears the floor on a rendered failure, in all three tones', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container } = render(<AttachDialog transport={canned()} onAttached={() => {}} />);
    const rows = await screen.findAllByTestId('attach-entry');
    (rows[0].querySelector('button') as HTMLButtonElement).click();
    await screen.findByTestId('attach-failure');

    const { checked, failing } = audit(container);

    expect(checked).toBeGreaterThan(8);
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
  });
});
