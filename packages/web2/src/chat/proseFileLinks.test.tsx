import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore, StoreProvider } from '../state';
import { ProseMessage } from './ProseMessage';
import { refFromCode, refFromLink } from './repoPathRef';

describe('B11: files named in an answer open in the Files surface', () => {
  it('a code-span path:line and a markdown link are two buttons that open the file at the right line', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ProseMessage text={'It starts at `packages/web2/src/main.tsx:12`, see [main](packages/web2/src/main.tsx) and plain packages/web2/src/boot/x.ts#L7 too.'} />
      </StoreProvider>,
    );
    const targets = screen.getAllByTestId('chat-path');
    expect(targets).toHaveLength(3);
    expect(targets.every((t) => t.tagName === 'BUTTON')).toBe(true);
    fireEvent.click(targets[0]!);
    expect(store.getState().session.filesFocus).toMatchObject({ path: 'packages/web2/src/main.tsx', line: 12 });
    fireEvent.click(targets[1]!);
    const f = store.getState().session.filesFocus as { path: string; line?: number };
    expect(f.path).toBe('packages/web2/src/main.tsx');
    expect(f.line).toBeUndefined();
    fireEvent.click(targets[2]!);
    expect(store.getState().session.filesFocus).toMatchObject({ path: 'packages/web2/src/boot/x.ts', line: 7 });
  });

  it('keeps the web link and does not read a URL path as a file', () => {
    render(<ProseMessage text="Docs at https://example.com/a/b.html and `npm run build`." />);
    expect(screen.queryAllByTestId('chat-path')).toHaveLength(0);
  });

  it('absolute links under the repo root become repo-relative', () => {
    expect(refFromLink(['C:','Users','dev','app','src','a.ts:3'].join(String.fromCharCode(92)), 'C:/Users/dev/app')).toEqual({ path: 'src/a.ts', line: 3 });
    expect(refFromCode('src/a.ts')).toEqual({ path: 'src/a.ts' });
    expect(refFromCode('npm run build')).toBeNull();
  });
});

describe('review fixes: file refs never throw and read more spellings', () => {
  const BS = String.fromCharCode(92);
  it('a malformed escape in a file: link renders as plain text instead of unmounting', () => {
    const bad = 'file:///C:/a%ZZ.ts';
    expect(() => refFromLink(bad)).not.toThrow();
    render(<ProseMessage text={`see [a](${bad}) now`} />);
    expect(screen.getByTestId('v3-prose').textContent).toContain('see');
  });

  it('a render error inside one message falls back to its text, not a dead chat', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ProseMessage text={null as unknown as string} />)).not.toThrow();
    expect(screen.getByTestId('v3-prose-fallback')).toBeTruthy();
    spy.mockRestore();
  });

  it('reads Windows backslash paths in code spans and prose against a backslash root', () => {
    const root = ['C:', 'repo'].join(BS);
    const p = ['C:', 'repo', 'src', 'a.ts'].join(BS);
    expect(refFromCode(`${p}:12`, root)).toEqual({ path: 'src/a.ts', line: 12 });
    render(<ProseMessage text={`open ${p}:7 please`} />);
    expect(screen.getByTestId('chat-path').getAttribute('data-path')).toBe(`C:/repo/src/a.ts`);
  });

  it('reads spaces and %20 in a path', () => {
    expect(refFromCode('docs/my notes/a b.md')).toEqual({ path: 'docs/my notes/a b.md' });
    expect(refFromLink('docs/my%20notes/a.md')).toEqual({ path: 'docs/my notes/a.md' });
  });

  it('does not linkify a web address as a file', () => {
    expect(refFromCode('www.example.com/a/b.js')).toBeNull();
    render(<ProseMessage text="see www.example.com/a/b.js or github.com/x/y.md" />);
    expect(screen.queryAllByTestId('chat-path')).toHaveLength(0);
  });

  it('following the same path:line twice bumps the focus so the line is revealed again', () => {
    const store = createStore();
    store.dispatch({ type: 'files/open', path: 'a.ts', line: 3 });
    const first = store.getState().session.filesFocus?.nonce;
    store.dispatch({ type: 'files/open', path: 'a.ts', line: 3 });
    expect(store.getState().session.filesFocus?.nonce).toBe((first ?? 0) + 1);
  });
});
