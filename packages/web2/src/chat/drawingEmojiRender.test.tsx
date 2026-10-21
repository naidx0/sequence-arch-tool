import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProseMessage } from './ProseMessage';
import { cardTitle } from './cardState';
import { EMOJI_BOOTSTRAP } from './drawingEmoji';
import { FALLBACK_DARK, visualDocument } from './visualDoc';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const fence = (lang: string, body: string): string => '```' + lang + '\n' + body + '\n```';
const HTML = '<h3>🚀 Deploy 🎉</h3><p>日本語 → ok ✅</p><button>Ship it 🚢</button><script>var re=/🚀/u,s="🚀";</script>';
const SVG = '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><title>Plan 🚀</title><text x="10" y="20">Go 🔥 now</text></svg>';
const ORIGIN = { chat: 'c1', turn: 't1', repoRoot: '/work', at: 5, prompt: 'draw' };

describe('emoji guard at render, source untouched', () => {
  it('the html source is not text-replaced: the document carries it as written plus the frame guard', () => {
    const doc = visualDocument(HTML, FALLBACK_DARK);
    expect(doc).toContain('var re=/🚀/u,s="🚀";');
    expect(doc).toContain(EMOJI_BOOTSTRAP);
    render(<ProseMessage text={fence('html', HTML)} />);
    expect(screen.getByTestId('chat-html-frame').getAttribute('srcdoc')).toContain(EMOJI_BOOTSTRAP);
  });

  it('the saved source is what the agent wrote', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ drawing: { id: 'd1' }, name: '1-x.html', version: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ProseMessage text={fence('html', HTML)} drawing={ORIGIN} />);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/drawings')).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls.find((c) => c[0] === '/api/drawings')![1].body).source).toBe(HTML);
  });

  it('an svg drawing is drawn without the emoji in its text and its card header has none either', async () => {
    const { container } = render(<ProseMessage text={fence('svg', SVG)} />);
    await vi.waitFor(() => expect(container.querySelector('svg text')).toBeTruthy());
    expect(container.querySelector('svg text')!.textContent).toBe('Go now');
    expect(screen.getByTestId('chat-card-title').textContent).toBe('Plan');
    expect(screen.getByTestId('chat-card-title').getAttribute('title') ?? '').not.toMatch(/\p{Emoji_Presentation}/u);
  });

  it('a saved title with an emoji shows without it', () => {
    expect(cardTitle('Deploy 🚀 plan', 'Page')).toBe('Deploy plan');
    expect(cardTitle('🚀', 'Page')).toBe('Page');
  });
});
