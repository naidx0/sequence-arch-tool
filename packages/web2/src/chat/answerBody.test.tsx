/* S4 review, item 6: the chat answer is body text (body size, body weight),
   and tool rows share the message column's width with the cards above them. */
import { afterEach, describe, expect, it } from 'vitest';

import { resolvedStyle } from '../../test/support/css';
import '../tokens/graphite.css';
import '../styles/base.css';
import './chat.css';
import '../v3/v3.css';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});

function mount(): { prose: HTMLElement; tools: HTMLElement } {
  document.body.innerHTML = `
    <div class="v3-msg v3-msg-assistant chat-scope">
      <div class="prose" data-testid="answer"><p>The gateway authorises the card first.</p></div>
      <div class="v3-tools" data-testid="tools"></div>
    </div>`;
  return {
    prose: document.querySelector('[data-testid="answer"]') as HTMLElement,
    tools: document.querySelector('[data-testid="tools"]') as HTMLElement,
  };
}

describe('the answer is body text', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`renders at the body's size and weight — ${theme}`, () => {
      document.documentElement.setAttribute('data-theme', theme);
      const { prose } = mount();
      expect(resolvedStyle(prose, 'font-size')).toBe(resolvedStyle(document.body, 'font-size'));
      expect(resolvedStyle(prose, 'line-height')).toBe(resolvedStyle(document.body, 'line-height'));
      /* jsdom does not inherit: an empty value is "nothing declares one", so
         the answer (and its message) take the body's weight. */
      expect(resolvedStyle(document.body, 'font-weight')).toBe('400') /* Decision 49: one body weight in both rooms */;
      expect(resolvedStyle(prose, 'font-weight')).toBe('');
      expect(resolvedStyle(prose.parentElement!, 'font-weight')).toBe('');
    });
  }

  it('tool rows take the full message width, as the Thought fold and the status strip do', () => {
    const { tools } = mount();
    expect(resolvedStyle(tools, 'max-width')).toBe('100%');
  });
});
