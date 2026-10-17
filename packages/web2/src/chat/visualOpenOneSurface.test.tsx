import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProseMessage } from './ProseMessage';

/* Owner 2026-10-10 on the drawing Open dialog: two borders, three backgrounds, a "preview.html" title box. It is ONE
   surface now: the dialog's own glass, one hairline between the panes. jsdom has no layout, so the structure is read
   here and the sheet as text; the counts measured in a browser are in the commit message. */
afterEach(cleanup);
const strip = (s: string) => s.replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const dgm = strip(readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8'));
const files = strip(readFileSync(join(__dirname, '..', 'files', 'files.css'), 'utf8'));
const body = (css: string, sel: string): string => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};
const open = async () => {
  render(<ProseMessage text={'```html\n<p>hi</p>\n```'} />);
  fireEvent.click(screen.getByTestId('chat-visual-open'));
  await screen.findByTestId('files-preview-frame', undefined, { timeout: 10_000 });
  return screen.getByTestId('chat-visual-dialog');
};

describe('the drawing Open dialog is one surface', () => {
  it('has no file title box: no "preview.html", no file icon; the preview is marked as a drawing', async () => {
    const d = await open();
    expect(d.textContent).not.toContain('preview.html');
    expect(d.querySelector('.files-pv-name')).toBeNull();
    expect(d.querySelector('.files-preview-html')?.getAttribute('data-drawing')).toBe('true');
    expect(screen.getByTestId('files-preview-scripts')).toBeTruthy(); // the scripts switch stays
  });
  it('the Files panel keeps its framed preview with the name (drawing is only the dialog)', () => {
    expect(body(files, '.files-scope .files-pv-card')).toMatch(/background:\s*var\(--surface-2\)/);
  });
  it('the drawing preview has no ground, card fill, border or frame fill', () => {
    expect(body(files, '.files-scope .files-preview-html[data-drawing]')).toMatch(/background:\s*transparent/);
    const card = body(files, '.files-scope .files-preview-html[data-drawing] .files-pv-card');
    expect(card).toMatch(/border:\s*0/);
    expect(card).toMatch(/background:\s*transparent/);
    expect(card).toMatch(/box-shadow:\s*none/);
    const frame = body(files, '.files-scope .files-preview-html[data-drawing] .files-preview-frame');
    expect(frame).toMatch(/background:\s*transparent/);
    expect(frame).toMatch(/color-scheme:\s*inherit/);
    expect(body(files, '.files-scope .files-preview-html[data-drawing] .files-pv-head')).toMatch(/border-bottom:\s*0/);
  });
  it('the only divider is one faint hairline between the panes; the source has no edge, gutter rule or status rule', () => {
    expect(body(dgm, '.s2-dlg .dgm-open-pane.files-scope + .dgm-open-pane.files-scope')).toMatch(/border-left:\s*var\(--w-hair\) solid var\(--edge-faint\)/);
    expect(body(dgm, '.s2-dlg .dgm-open-pane.files-scope .files-ed')).toMatch(/border:\s*0/);
    expect(body(dgm, '.s2-dlg .dgm-open-pane.files-scope .files-ed')).toMatch(/background:\s*transparent/);
    expect(body(dgm, '.s2-dlg .dgm-open-pane.files-scope .files-ed-status')).toMatch(/border-top:\s*0/);
    expect(body(dgm, '.s2-dlg .dgm-open-pane.files-scope .files-ed-gutter')).toMatch(/border-right:\s*0/);
  });
});
