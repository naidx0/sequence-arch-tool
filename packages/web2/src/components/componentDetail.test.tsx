import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComponentDetail, DETAIL_EXCERPT_CHARS } from './ComponentDetail';

/* A component's definition: name, group, source, a SHORT excerpt in a box that scrolls, Use and Close. */

const LONG = Array.from({ length: 400 }, (_, i) => `Line ${i} of a very long component definition body.`).join('\n');

function stub(body: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url) === '/api/components'
        ? new Response(JSON.stringify({ enabled: true, mode: 'auto', groups: [{ id: 'ml', name: 'ML and research', blurb: '', components: [{ id: 'ml/rsi-anything', name: 'Rsi Anything' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : String(url) === '/api/components/ml/rsi-anything'
        ? new Response(JSON.stringify({ id: 'ml/rsi-anything', name: 'Rsi Anything', blurb: 'Propose, predict, select, evaluate.', source: 'Gen-Verse/RSI-Anything', license: 'Apache-2.0', installed: true, inWorkspace: true, status: 'ready', body }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404 }),
    ),
  );
}
beforeEach(() => stub(LONG));
afterEach(() => vi.unstubAllGlobals());

describe('ComponentDetail', () => {
  it('shows name, group, source and the blurb', async () => {
    render(<ComponentDetail id="ml/rsi-anything" onUse={() => {}} onClose={() => {}} />);
    expect((await screen.findByTestId('component-detail-name')).textContent).toBe('Rsi Anything');
    await waitFor(() => expect(screen.getByTestId('component-detail').textContent).toContain('ML and research from Gen-Verse/RSI-Anything'));
    expect(screen.getByTestId('component-detail').textContent).not.toMatch(/\bMl\b/);
    expect(screen.getByTestId('component-detail').textContent).toContain('Gen-Verse/RSI-Anything');
    expect(screen.getByTestId('component-detail').textContent).toContain('Propose, predict, select, evaluate.');
  });

  it('caps a long body to a short excerpt and says so', async () => {
    render(<ComponentDetail id="ml/rsi-anything" onUse={() => {}} onClose={() => {}} />);
    const excerpt = await screen.findByTestId('component-detail-excerpt');
    expect(LONG.length).toBeGreaterThan(DETAIL_EXCERPT_CHARS * 5);
    expect((excerpt.textContent ?? '').length).toBeLessThanOrEqual(DETAIL_EXCERPT_CHARS + 2);
    expect(excerpt.textContent).toContain('Line 0 ');
    expect(excerpt.textContent).not.toContain('Line 399 ');
    expect(screen.getByTestId('component-detail').textContent).toMatch(/first part|shortened/i);
  });

  it('a short body is shown whole, with no cap note', async () => {
    stub('Short and sweet.');
    render(<ComponentDetail id="ml/rsi-anything" onUse={() => {}} onClose={() => {}} />);
    expect((await screen.findByTestId('component-detail-excerpt')).textContent).toBe('Short and sweet.');
    expect(screen.getByTestId('component-detail').textContent).not.toMatch(/shortened/i);
  });

  it('the excerpt sits in a box that scrolls (the CSS caps its height)', async () => {
    render(<ComponentDetail id="ml/rsi-anything" onUse={() => {}} onClose={() => {}} />);
    const box = await screen.findByTestId('component-detail-scroll');
    expect(box.classList.contains('s2-comp-detail-body')).toBe(true);
    expect(box.contains(screen.getByTestId('component-detail-excerpt'))).toBe(true);
    const css = readFileSync(resolve(process.cwd(), 'src/shell2/modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = css.match(/\.s2-comp-detail-body\s*\{([^}]*)\}/);
    expect(rule, 'a .s2-comp-detail-body rule').toBeTruthy();
    expect(rule![1]).toMatch(/max-height:\s*[^;]+;/);
    expect(rule![1]).toMatch(/overflow-y:\s*auto/);
  });

  it('Use hands back the id; Back goes back to the list', async () => {
    const onUse = vi.fn();
    const onClose = vi.fn();
    render(<ComponentDetail id="ml/rsi-anything" onUse={onUse} onClose={onClose} />);
    await screen.findByTestId('component-detail-name');
    fireEvent.click(screen.getByTestId('component-detail-use'));
    expect(onUse).toHaveBeenCalledWith('ml/rsi-anything');
    expect(screen.getByTestId('component-detail-back').textContent).toBe('Back');
    fireEvent.click(screen.getByTestId('component-detail-back'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a missing definition says so and still offers Back', async () => {
    render(<ComponentDetail id="nope/missing" onUse={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('component-detail-error')).toBeTruthy());
    expect(screen.getByTestId('component-detail-back')).toBeTruthy();
  });
});

describe('ComponentDetail group name', () => {
  it('falls back to the id prefix, capitalised, when the listing cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url) === '/api/components/security/x'
          ? new Response(JSON.stringify({ id: 'security/x', name: 'X', blurb: '', source: 'S', license: null, installed: true, inWorkspace: false, status: 'ready', body: 'b' }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{}', { status: 500 }),
      ),
    );
    render(<ComponentDetail id="security/x" onUse={() => {}} onClose={() => {}} />);
    await screen.findByTestId('component-detail-name');
    expect(screen.getByTestId('component-detail').textContent).toContain('Security from S');
  });
});

describe('ComponentDetail keeps its actions in view', () => {
  it('draws Back then Use in a row at the top, before the name and the excerpt', async () => {
    render(<ComponentDetail id="ml/rsi-anything" onUse={() => {}} onClose={() => {}} />);
    await screen.findByTestId('component-detail-excerpt');
    const detail = screen.getByTestId('component-detail');
    const row = detail.firstElementChild as HTMLElement;
    expect(row.className).toContain('s2-comp-detail-foot');
    const back = screen.getByTestId('component-detail-back');
    const use = screen.getByTestId('component-detail-use');
    expect(row.contains(back) && row.contains(use)).toBe(true);
    expect(back.compareDocumentPosition(use) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(screen.getByTestId('component-detail-name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the action row has Back at the start and Use at the end', () => {
    const css = readFileSync(resolve(__dirname, '../shell2/modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = css.match(/\.s2-comp-detail-foot\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).toMatch(/justify-content:\s*space-between/);
  });
});
