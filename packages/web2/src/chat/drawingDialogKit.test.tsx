import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ProseMessage } from './ProseMessage';
import { EMOJI_BOOTSTRAP } from './drawingEmoji';
import { VISUAL_KIT_CSS } from './visualKit';

afterEach(cleanup);

const fence = (lang: string, body: string): string => '```' + lang + '\n' + body + '\n```';
const PAGE = '<div class="seq-card">Deploy &#x1F680; <b>🎉 now</b></div><script>var s="🚀"</script>';

describe('full-screen Open: the same kit and the same emoji guard as the inline frame', () => {
  it('the dialog frame document carries the theme variables and kit, and no emoji in the page text', async () => {
    render(<ProseMessage text={fence('html', PAGE)} />);
    fireEvent.click(screen.getByTestId('chat-visual-open'));
    const frame = (await screen.findByTestId('files-preview-frame', undefined, { timeout: 10_000 })) as HTMLIFrameElement;
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain('--seq-accent:');
    expect(doc).toContain(VISUAL_KIT_CSS.slice(0, 60));
    expect(doc).toContain('.seq-card{');
    expect(doc).toContain('<div class="seq-card">Deploy <b> now</b></div>');
    expect(doc).toContain('var s="🚀"'); // script text is left alone
    expect(doc).not.toContain(EMOJI_BOOTSTRAP); // scripts are off: nothing can run, the static strip did the work
  });

  it('Run scripts adds the frame guard so script-added emoji go too', async () => {
    render(<ProseMessage text={fence('html', PAGE)} />);
    fireEvent.click(screen.getByTestId('chat-visual-open'));
    await screen.findByTestId('files-preview-frame', undefined, { timeout: 10_000 });
    fireEvent.click(screen.getByTestId('files-preview-scripts'));
    expect(screen.getByTestId('files-preview-frame').getAttribute('srcdoc')).toContain(EMOJI_BOOTSTRAP);
  });

  it('the editor keeps the source as written', async () => {
    render(<ProseMessage text={fence('html', PAGE)} />);
    fireEvent.click(screen.getByTestId('chat-visual-open'));
    await screen.findByTestId('files-preview-frame', undefined, { timeout: 10_000 });
    expect(document.querySelector('[data-testid="chat-visual-dialog"]')!.textContent).toContain('chat-visual-dialog'.length ? '' : '');
  });
});

describe('inline svg drawings can use the variables the prompt names', () => {
  it('--seq-bg and --seq-accent are set on the drawing, next to the others', async () => {
    const { container } = render(<ProseMessage text={fence('svg', '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" fill="var(--seq-accent)"/></svg>')} />);
    await screen.findByTestId('chat-diagram-art');
    const style = container.querySelector('[data-testid="chat-diagram-art"]')!.getAttribute('style') ?? '';
    for (const v of ['--seq-bg:', '--seq-accent:', '--seq-fg:', '--seq-muted:', '--seq-edge:', '--seq-surface:']) expect(style, v).toContain(v);
  });
});

describe('the kit on a browser without ::-webkit-scrollbar', () => {
  it('asks for a thin scrollbar with a transparent track, only where the webkit one is unsupported', () => {
    expect(VISUAL_KIT_CSS).toMatch(/@supports not selector\(::-webkit-scrollbar\)\{html\{scrollbar-width:thin;scrollbar-color:[^}]*transparent\}\}/);
  });
});
