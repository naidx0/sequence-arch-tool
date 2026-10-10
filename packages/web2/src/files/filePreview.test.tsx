import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { FILES } from './anchors';
import { hasOwnStyles, previewDocument, previewKind, rawFileUrl } from './FilePreview';
import { FilesPanel } from './FilesPanel';
import type { FileLoad, FilesPanelProps, FilesView } from './FilesPanel';

/*
 * ROUND 7, B8 (Jaden: "opening things and HTMLs, they show just the code").
 * HTML renders in a sandboxed frame (no network; scripts off until the reader
 * runs them), Markdown renders as prose, images show; everything else keeps
 * the code view; Preview / Code in the file's header switches the two.
 */

const ready = (text: string): FileLoad => ({ state: 'ready', text });
const HTML = '<!doctype html><html><body><h1>Status</h1><img src="https://example.com/x.png"><script>document.title="ran"</script></body></html>';

function mount(selected: string, text: string, view: FilesView = 'preview', extra: Partial<FilesPanelProps> = {}) {
  const onView = vi.fn();
  const props: FilesPanelProps = {
    paths: ['status.html', 'README.md', 'logo.png', 'icon.svg', 'src/app.ts'],
    selected,
    expanded: new Set<string>(),
    query: '',
    view,
    content: ready(text),
    diff: ready(''),
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onQuery: vi.fn(),
    onView,
    ...extra,
  };
  const r = render(<FilesPanel {...props} />);
  return { ...r, onView, rerender: (p: Partial<FilesPanelProps>) => r.rerender(<FilesPanel {...props} {...p} />) };
}

/* The preview is its own chunk (off the boot path). Render one and wait for it
   once, so every case below reads the resolved component, in any order. */
beforeAll(async () => {
  const r = mount('status.html', '<p>x</p>');
  await screen.findByTestId(FILES.previewFrame);
  r.unmount();
});

const modes = () => within(screen.getByTestId(FILES.view)).getAllByRole('button').map((b) => b.textContent);
const frame = () => screen.getByTestId(FILES.previewFrame) as HTMLIFrameElement;

describe('previewKind: what renders and what stays code', () => {
  it('maps HTML, Markdown, SVG and raster images; the rest is null', () => {
    expect(previewKind('a/b/page.HTML')).toBe('html');
    expect(previewKind('index.htm')).toBe('html');
    expect(previewKind('README.md')).toBe('markdown');
    expect(previewKind('icon.svg')).toBe('svg');
    for (const p of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp']) expect(previewKind(p)).toBe('image');
    for (const p of ['src/app.ts', 'Dockerfile', 'x.json', 'style.css']) expect(previewKind(p)).toBeNull();
    expect(previewKind(null)).toBeNull();
  });
});

describe('an HTML file renders in a shut frame', () => {
  it('opens rendered: a sandbox with no allowances, a policy that refuses the network and scripts', async () => {
    mount('status.html', HTML);
    /* The preview is its own chunk (off the boot path): the first one waits for it. */
    const f = (await screen.findByTestId(FILES.previewFrame)) as HTMLIFrameElement;
    expect(f.getAttribute('sandbox')).toBe('');
    const doc = f.getAttribute('srcdoc') ?? '';
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<h1>'));
    expect(doc).toMatch(/default-src 'none'/);
    expect(doc).toMatch(/script-src 'none'/);
    expect(doc).toContain('<h1>Status</h1>');
    expect(screen.getByTestId(FILES.previewScripts).getAttribute('aria-pressed')).toBe('false');
  });

  it('"Run scripts" allows scripts only: never same-origin, and the network stays refused', () => {
    mount('status.html', HTML);
    fireEvent.click(screen.getByTestId(FILES.previewScripts));
    const f = frame();
    expect(f.getAttribute('sandbox')).toBe('allow-scripts');
    expect(f.getAttribute('sandbox')).not.toMatch(/same-origin/);
    const doc = f.getAttribute('srcdoc') ?? '';
    expect(doc).toMatch(/script-src 'unsafe-inline'/);
    expect(doc).toMatch(/default-src 'none'/);
    expect(screen.getByTestId(FILES.previewScripts).textContent).toBe('Stop scripts');
  });

  it('opening another file shuts the scripts again', () => {
    const m = mount('status.html', HTML);
    fireEvent.click(screen.getByTestId(FILES.previewScripts));
    m.rerender({ selected: 'README.md', content: ready('# Hi') });
    m.rerender({ selected: 'status.html', content: ready(HTML) });
    expect(frame().getAttribute('sandbox')).toBe('');
  });

  it("the policy goes first even when the page brings its own doctype", () => {
    const doc = previewDocument('<!DOCTYPE html><p>x</p>', false);
    expect(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc.match(/doctype/gi)).toHaveLength(1);
  });
});

describe('Markdown and images render; source stays code', () => {
  it('Markdown renders as prose, not as lines of source', () => {
    mount('README.md', '# Shopfront\n\nEight **services**.');
    const pv = screen.getByTestId(FILES.preview);
    expect(pv.getAttribute('data-kind')).toBe('markdown');
    expect(pv.querySelector('h1, h2, h3')?.textContent).toBe('Shopfront');
    expect(pv.querySelector('strong')?.textContent).toBe('services');
    expect(screen.queryByTestId(FILES.code)).toBeNull();
  });

  it('a raster image is the image, from its raw bytes; an SVG draws as an image (no script)', () => {
    mount('logo.png', '��PNG');
    expect(screen.getByTestId(FILES.previewImage).getAttribute('src')).toBe(rawFileUrl('logo.png'));
    expect(rawFileUrl('a b/logo.png')).toBe('/api/file?path=a%20b%2Flogo.png&raw=1');
    const svg = mount('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const imgs = screen.getAllByTestId(FILES.previewImage);
    expect(imgs[imgs.length - 1]!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    svg.unmount();
  });

  it('a raster image offers no Code or Edit (its bytes are not text, and a save would corrupt it)', () => {
    mount('logo.png', '\uFFFD\uFFFDPNG', 'code', { onDraft: vi.fn() });
    expect(modes()).not.toContain('Code');
    expect(modes()).not.toContain('Edit');
    expect(screen.getByTestId(FILES.previewImage)).toBeTruthy();
    expect(screen.queryByTestId(FILES.code)).toBeNull();
  });

  it('a source file has no Preview option and shows its code', () => {
    mount('src/app.ts', 'export const x = 1;');
    expect(modes()).not.toContain('Preview');
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
    expect(screen.queryByTestId(FILES.preview)).toBeNull();
  });

  it('Preview / Edit in the header switch the two', () => {
    const m = mount('status.html', HTML);
    expect(modes().slice(0, 2)).toEqual(['Preview', 'Code']);
    fireEvent.click(within(screen.getByTestId(FILES.view)).getByRole('button', { name: 'Code' }));
    expect(m.onView).toHaveBeenCalledWith('edit');
    m.rerender({ view: 'code' });
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
    expect(screen.queryByTestId(FILES.previewFrame)).toBeNull();
  });
});

/*
 * ROUND 8, item 9 (Jaden: "I don't like how it's random black HTML preview").
 * The page is a framed card with a header (name, Preview / Code, a Scripts
 * chip); an unstyled page takes the theme's reading defaults, a styled page
 * renders as authored.
 */
describe('the HTML preview is a page in a framed card (round 8)', () => {
  it('knows a styled page from an unstyled one', () => {
    expect(hasOwnStyles('<p>x</p>')).toBe(false);
    expect(hasOwnStyles('<p style="color:red">x</p>')).toBe(false);
    expect(hasOwnStyles('<head><style>body{}</style></head>')).toBe(true);
    expect(hasOwnStyles('<link rel="stylesheet" href="a.css">')).toBe(true);
    expect(hasOwnStyles("<LINK href='a.css' rel=stylesheet>")).toBe(true);
    expect(hasOwnStyles('<link rel="icon" href="a.png">')).toBe(false);
  });

  it('an unstyled page gets the reading defaults, after the policy; a styled page does not', () => {
    mount('status.html', HTML);
    const doc = frame().getAttribute('srcdoc') ?? '';
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('data-sequence-defaults'));
    expect(doc).toMatch(/<style data-sequence-defaults>/);
    expect(screen.getByTestId(FILES.preview).getAttribute('data-styled')).toBe('theme');
  });

  it('a styled page renders as authored', () => {
    mount('status.html', '<html><head><style>body{color:#123}</style></head><body>x</body></html>');
    expect(frame().getAttribute('srcdoc')).not.toMatch(/data-sequence-defaults/);
    expect(screen.getByTestId(FILES.preview).getAttribute('data-styled')).toBe('own');
  });

  it('the card has a header: the name, Preview / Code, and the Scripts chip', () => {
    const m = mount('status.html', HTML);
    const card = screen.getByTestId(FILES.preview).querySelector('.files-pv-card')!;
    expect(card.querySelector('.files-pv-name')?.textContent).toBe('status.html');
    expect(card.querySelector('.files-pv-chip')?.textContent).toBe('Scripts off');
    fireEvent.click(within(card as HTMLElement).getByTestId('files-preview-to-code'));
    expect(m.onView).toHaveBeenCalledWith('edit');
    fireEvent.click(screen.getByTestId(FILES.previewScripts));
    expect(card.querySelector('.files-pv-chip')?.textContent).toBe('Scripts on');
  });
});
