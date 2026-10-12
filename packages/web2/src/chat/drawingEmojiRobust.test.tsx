import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProseMessage } from './ProseMessage';
import { EMOJI_BOOTSTRAP, LONE_SVG, stripEmoji, stripEmojiHtml } from './drawingEmoji';
import { isLoneSvg } from '../files/FilePreview';

vi.mock('../app/MermaidBlock', () => ({
  canDrawDiagrams: () => true,
  drawMermaid: async (src: string) => {
    if (/\[\]|\[""\]/.test(src)) throw new Error('Parse error: empty label');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 40');
    for (const m of src.matchAll(/\[([^\]]*)\]/g)) {
      const t = document.createElementNS(ns, 'text');
      t.textContent = m[1]!.replace(/^"|"$/g, '');
      svg.appendChild(t);
    }
    return { node: svg };
  },
}));

afterEach(cleanup);

const ms = (f: () => void): number => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe('1. the pattern does not backtrack: long ZWJ runs are linear', () => {
  const FAMILY = '👨‍👩‍👧‍👦';
  const TECH = '🧑🏽‍💻';
  it('10 family emoji then a letter, and 50 x technologist with skin tone then a letter, each under 50 ms and fully stripped', () => {
    const a = 'Team ' + FAMILY.repeat(10) + 'x';
    const b = TECH.repeat(50) + 'x';
    expect(ms(() => stripEmoji(a))).toBeLessThan(50);
    expect(ms(() => stripEmoji(b))).toBeLessThan(50);
    expect(stripEmoji(a)).toBe('Team x');
    expect(stripEmoji(b)).toBe('x');
  });
  it('a fuzz of 200 random emoji, ZWJ and modifier strings, each under 50 ms', () => {
    const parts = ['🚀', '👍', '🏽', '‍', '️', '👨', '👧', '❤', '⚠', '🇺', '🇸', ' ', 'a', '1', '⃣', '→', '🧑', '💻', '\u{E0067}'];
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i += 1) {
      let s = '';
      const n = 20 + Math.floor(rnd() * 120);
      for (let k = 0; k < n; k += 1) s += parts[Math.floor(rnd() * parts.length)]!;
      const t = ms(() => stripEmoji(s));
      expect(t, JSON.stringify(s)).toBeLessThan(50);
    }
  });
  it('the spacing rule is the same as before', () => {
    expect(stripEmoji('Ship 🚀 it')).toBe('Ship it');
    expect(stripEmoji('Ship 🚀it')).toBe('Ship it');
    expect(stripEmoji('go 🚀')).toBe('go');
    expect(stripEmoji('A[Ship 🚀]')).toBe('A[Ship]');
  });
});

describe('2. a lone svg stays a lone svg through the static strip', () => {
  it('isLoneSvg holds on the output, and the two lone-svg tests agree', () => {
    const svg = '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><text>Go 🔥 now</text></svg>';
    const out = stripEmojiHtml(svg);
    expect(out).toContain('Go now');
    expect(isLoneSvg(out)).toBe(true);
    expect(out.startsWith('<svg')).toBe(true);
    for (const s of [svg, '<div>' + svg + '</div>', '<?xml version="1.0"?>' + svg, '<p>x</p>']) expect(LONE_SVG.test(s)).toBe(isLoneSvg(s));
  });
});

describe('3. a page observer that puts the emoji back cannot hang the frame', () => {
  it('re-strips each node at most 3 times, then lets it be', async () => {
    document.body.innerHTML = '<p id="p">start</p>';
    const p = document.getElementById('p')!;
    const code = /<script>([\s\S]*)<\/script>/.exec(EMOJI_BOOTSTRAP)![1]!;
    new Function(code)();
    let puts = 0;
    const text = p.firstChild as Text;
    // the page's own observer: whenever the text changes it writes the emoji back
    const mo = new MutationObserver(() => {
      if (!/🚀/u.test(text.data)) {
        puts += 1;
        text.data = 'back 🚀';
      }
    });
    mo.observe(p, { characterData: true, subtree: true, childList: true });
    text.data = 'again 🚀';
    await new Promise((r) => setTimeout(r, 200));
    mo.disconnect();
    expect(puts).toBeGreaterThan(0);
    expect(puts).toBeLessThanOrEqual(4);
    expect(text.data).toContain('🚀'); // the page won after three strips; the frame is alive
    document.body.innerHTML = '';
  });
});

describe('4. mermaid: a label that was only an emoji draws, and the drawn text has no emoji', () => {
  it('A[🚀] --> B["✅"] falls back to the original and the result is stripped', async () => {
    const { container } = render(<ProseMessage text={'```mermaid\nflowchart TD\nA[🚀] --> B["✅"] --> C[Ship 🚢 now]\n```'} />);
    await vi.waitFor(() => expect(container.querySelector('svg text')).toBeTruthy());
    const all = Array.from(container.querySelectorAll('svg text')).map((t) => t.textContent);
    expect(all.join('|')).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(screen.queryByTestId('chat-diagram-error')).toBeNull();
  });
});

describe('5. keycaps and alphanumerics before FE0F', () => {
  it('"1️⃣ Install" keeps its 1; a letter or digit before FE0F is never deleted', () => {
    expect(stripEmoji('1️⃣ Install')).toBe('1 Install');
    expect(stripEmoji('#️⃣ tag')).toBe('# tag');
    expect(stripEmoji('a️ b 2️ c')).toBe('a b 2 c');
    expect(stripEmoji('warn ⚠️ now')).toBe('warn now');
  });
});

describe('6. only 2B00-2B1A is kept: stars, squares and circles go', () => {
  it('⭐ ⬛ ⬜ ⭕ are stripped; the arrows in 2B00-2B1A stay', () => {
    expect(stripEmoji('a ⭐ b ⬛ c ⬜ d ⭕ e')).toBe('a b c d e');
    expect(stripEmoji('⬅ ⬆ ⬇ ➡')).toBe('⬅ ⬆ ⬇ ➡');
  });
});
