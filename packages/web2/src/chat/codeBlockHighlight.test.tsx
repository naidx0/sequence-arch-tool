import { act, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../review/syntax', async () => {
  const real = await vi.importActual<typeof import('../review/syntax')>('../review/syntax');
  return { ...real, highlight: (line: string, lang: Parameters<typeof real.highlight>[1]) => { calls.n += 1; return real.highlight(line, lang); } };
});

import { CodeBlock } from './CodeBlock';

/* 0.1.8.4 P3: CodeBlock re-highlighted every line on every render, the open fence included, so a long streamed fence
   cost O(n^2). It now draws an open fence as plain text and highlights once, when the fence closes. */

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const source = (n: number) => Array.from({ length: n }, (_, i) => `const v${i} = ${i}; // line ${i}`).join('\n');

describe('a code block highlights once and only when its fence closes', () => {
  /* CodeBlock loads the highlighter with its first block (a dynamic import). Cold, that import outlasts settle()'s five ticks and the
     close would be drawn before the highlighter exists; the first case then saw 0 calls where it wants 200. Load it once up front. */
  beforeAll(async () => { await import('../review/syntax'); });
  beforeEach(() => { calls.n = 0; });

  it('a 200-chunk stream of an open fence makes no highlight call, then the close highlights each line once', async () => {
    const { rerender } = render(<CodeBlock text={source(1)} language="ts" open />);
    await settle();
    for (let n = 2; n <= 200; n++) rerender(<CodeBlock text={source(n)} language="ts" open />);
    await settle();
    expect(calls.n).toBe(0);
    expect(screen.getByTestId('chat-code').textContent).toBe(source(200));
    expect(screen.getByTestId('chat-code').querySelector('[class*="r9-t-"]')).toBeNull();
    rerender(<CodeBlock text={source(200)} language="ts" />);
    await settle();
    expect(calls.n).toBe(200);
    expect(screen.getByTestId('chat-code').querySelector('[class*="r9-t-"]')).not.toBeNull();
    expect(screen.getByTestId('chat-code').textContent).toBe(source(200));
  });

  it('a closed block that renders again with the same text, or mounts again, is not highlighted again', async () => {
    const { rerender, unmount } = render(<CodeBlock text={source(30)} language="ts" />);
    await settle();
    expect(calls.n).toBe(30);
    for (let i = 0; i < 20; i++) rerender(<CodeBlock text={source(30)} language="ts" />);
    unmount();
    render(<CodeBlock text={source(30)} language="ts" />);
    await settle();
    expect(calls.n).toBe(30);
  });

  it('a language the highlighter does not colour never calls it (negative control for the counter)', async () => {
    render(<CodeBlock text={source(10)} language="text" />);
    await settle();
    expect(calls.n).toBe(0);
  });
});
