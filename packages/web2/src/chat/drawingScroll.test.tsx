import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProseMessage } from './ProseMessage';

afterEach(cleanup);

const fence = (body: string): string => '```html\n' + body + '\n```';
const report = (frame: HTMLElement, n: number): void => {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { seqVisualHeight: n }, source: (frame as HTMLIFrameElement).contentWindow }));
  });
};

describe('a tall html drawing scrolls once, inside the card clip', () => {
  it('a page taller than the frame maximum marks its frame to follow the card clip', () => {
    render(<ProseMessage text={fence('<div>tall one</div>')} />);
    const frame = screen.getByTestId('chat-html-frame');
    expect(frame.getAttribute('data-scrolls')).toBeNull();
    report(frame, 1696);
    expect(frame.getAttribute('data-scrolls')).toBe('true');
    expect((frame as HTMLElement).style.height).toBe('640px');
  });

  it('a page that fits is not marked: the card clips it at 1:1 with no nested scroll', () => {
    render(<ProseMessage text={fence('<div>short one</div>')} />);
    const frame = screen.getByTestId('chat-html-frame');
    report(frame, 300);
    expect(frame.getAttribute('data-scrolls')).toBeNull();
    report(frame, 640);
    expect(frame.getAttribute('data-scrolls')).toBeNull();
  });

  it('the stylesheet makes a marked frame follow the card clip (--card-h) and only that', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/chat/diagramBlock.css'), 'utf8');
    expect(css).toMatch(/\.dgm-frame\[data-scrolls='true'\]\s*\{\s*max-height:\s*var\(--card-h,\s*none\);?\s*\}/);
    expect(css).not.toMatch(/\.dgm-frame\s*\{[^}]*max-height/);
  });
});
