import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app/App';
import { resolvedStyle, unquoteFontStack } from './support/css';

/**
 * ITEM 0.1 — THE RENDER HALF OF THE LOCK, RE-POINTED AT INTER (Decision 32).
 *
 * Until 2026-09-18 this file locked Instrument Sans for the body, DM Sans for
 * the chrome and Sora for display sizes — three faces, each with a measured
 * reason. The owner then set Lovable as the source of truth for the whole
 * product ("I like Lovable a lot in terms of their colors, their fonts,
 * everything"), and Lovable is ONE face: Inter, for display, body and chrome
 * alike, with a mono beside it. So the lock is now the opposite of the one it
 * replaced, and for the same reason the old one existed: a stack that quietly
 * kept a second sans would make every measurement in the sheets a measurement
 * of the wrong typeface.
 *
 * These tests assert against the rendered document, never against the source
 * of a stylesheet. §4.6 bans the readFileSync-and-grep tier outright: a grep
 * for "Inter" in a .css file passes whether or not the rule reaches the body.
 */
describe('item 0.1 / Decision 32 — Inter is the one face bound to the document', () => {
  it('resolves body font-family to Inter first', () => {
    render(<App />);

    const stack = unquoteFontStack(resolvedStyle(document.body, 'font-family'));

    expect(stack.startsWith('Inter')).toBe(true);
  });

  it('keeps a real fallback stack behind it', () => {
    render(<App />);

    const stack = unquoteFontStack(resolvedStyle(document.body, 'font-family'));
    const families = stack.split(',').map((f) => f.trim());

    /*
     * A single-family declaration is a bug waiting for the first machine that
     * cannot load the woff2 — it falls all the way back to the browser default
     * serif, and the whole compact type ladder becomes unreadable rather than
     * merely off-brand. The stack ends in a generic for that reason.
     */
    expect(families.length).toBeGreaterThan(1);
    expect(families.at(-1)).toBe('sans-serif');
  });

  it('carries none of the three faces it replaced', () => {
    render(<App />);

    const stack = unquoteFontStack(resolvedStyle(document.body, 'font-family'));

    /*
     * The old lock named Instrument Sans, DM Sans and Sora. If any of them
     * appears in the stack, a fallback was "restored" and the first machine
     * that lacks the Inter woff2 renders yesterday's product while every test
     * still passes — the exact failure this file's predecessor described.
     */
    expect(stack).not.toMatch(/Instrument Sans|DM Sans|\bSora\b/);
  });

  it('binds Inter as --font-ui too — chrome and body are one face', () => {
    render(<App />);
    const ui = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim();
    expect(ui.replace(/"/g, '').startsWith('Inter')).toBe(true);
  });

  it('sets mono on code, one step down from the sans beside it', () => {
    // The mono binding is a rule in the stylesheet, not a property of whatever
    // the app happens to render first. Render the element the rule is ABOUT.
    const { container } = render(
      <>
        <App />
        <code>scanRepo()</code>
      </>,
    );

    const code = container.querySelector('code');
    expect(code).not.toBeNull();

    const stack = unquoteFontStack(resolvedStyle(code as Element, 'font-family'));
    expect(stack.startsWith('JetBrains Mono')).toBe(true);
  });
});

/**
 * DECISION 32 — THE DISPLAY FACE IS THE SAME FACE.
 *
 * Decision 13 confined Sora to the display sizes because it was 10-13% wider
 * than the body face and would have truncated every rail path had it leaked.
 * With one face there is nothing to confine, but the rule that a heading and
 * the rail title resolve through --font-display still has to reach them —
 * otherwise the token exists and the elements read whatever the cascade
 * happened to leave, which is the defect the render-half of a lock is for.
 */
describe('Decision 32 — headings and chrome titles resolve to the same face as the body', () => {
  it('binds the display token to the heading sizes of an answer', () => {
    const { container } = render(
      <>
        <App />
        <div className="chat-scope">
          <div className="prose">
            <h1 className="prose-h">A heading</h1>
            <h2 className="prose-h">A subheading</h2>
          </div>
        </div>
      </>,
    );

    for (const sel of ['h1.prose-h', 'h2.prose-h']) {
      const el = container.querySelector(sel);
      expect(el, sel).not.toBeNull();
      const stack = unquoteFontStack(resolvedStyle(el as Element, 'font-family'));
      expect(stack.startsWith('Inter'), `${sel} → ${stack}`).toBe(true);
      expect(stack.split(',').length).toBeGreaterThan(1);
    }
  });

  it('binds the chrome display titles (rail + settings) to Inter at --t-17', () => {
    const { container } = render(
      <>
        <App />
        <aside className="v3-rail">
          <div className="v3-rail-head">
            <h2 className="v3-rail-title">Chats</h2>
          </div>
        </aside>
        <div className="v3-overlay-panel">
          <h2 className="settings-title">Settings</h2>
        </div>
      </>,
    );
    for (const sel of ['.v3-rail-title', '.settings-title']) {
      const el = container.querySelector(sel);
      expect(el, sel).not.toBeNull();
      const stack = unquoteFontStack(resolvedStyle(el as Element, 'font-family'));
      expect(stack.startsWith('Inter'), `${sel} → ${stack}`).toBe(true);
    }
  });
});
