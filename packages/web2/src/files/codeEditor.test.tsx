import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FILES } from './anchors';
import { CodeEditor, caretAt, findAll, languageName } from './CodeEditor';
import { FilesPanel } from './FilesPanel';
import type { FilesPanelProps } from './FilesPanel';

/*
 * ROUND 8, item 9 (Jaden: better file editing, "a real code editor
 * experience", in uiarc's language). No editor package is in the lockfile, so
 * this is the repository's own tokenizer under a textarea: highlighting, a
 * gutter that cannot drift (one scroller), the current line, Find, Save on
 * Mod+S with a dirty dot, Discard, and a status row.
 */

const TS = "const a = 1;\n// note\nexport function f() {\n  return 'x';\n}";

function editor(extra: Partial<Parameters<typeof CodeEditor>[0]> = {}) {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  render(<CodeEditor path="src/a.ts" value={TS} onChange={onChange} dirty={false} onSave={onSave} onDiscard={onDiscard} {...extra} />);
  return { onChange, onSave, onDiscard, field: screen.getByTestId(FILES.editor) as HTMLTextAreaElement };
}

describe('the pieces', () => {
  it('names the language, finds every match, and places the caret', () => {
    expect(languageName('src/a.tsx')).toBe('TypeScript / JavaScript');
    expect(languageName('page.html')).toBe('HTML');
    expect(languageName('docker-compose.yml')).toBe('YAML');
    expect(languageName('Dockerfile')).toBe('Plain text');
    expect(findAll('aXa xa', 'xa')).toEqual([1, 4]);
    expect(findAll('abc', '')).toEqual([]);
    expect(caretAt('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
    expect(caretAt('ab', 0)).toEqual({ line: 1, col: 1 });
  });
});

describe('the editor', () => {
  it('highlights with the tokenizer, numbers every line, one scroller holds both', () => {
    editor();
    const root = screen.getByTestId('files-code-editor');
    expect(root.querySelectorAll('.files-ed-gutter > span')).toHaveLength(5);
    expect(root.querySelector('.files-t-kw')?.textContent).toBe('const');
    expect(root.querySelector('.files-t-com')?.textContent).toBe('// note');
    /* The gutter and the field share the one scrolling box. */
    const scroller = root.querySelector('.files-ed-scroll')!;
    expect(scroller.contains(root.querySelector('.files-ed-gutter'))).toBe(true);
    expect(scroller.contains(screen.getByTestId(FILES.editor))).toBe(true);
    expect(screen.getByTestId(FILES.editor).getAttribute('wrap')).toBe('off');
  });

  it('lights the current line and names it in the status row', () => {
    const { field } = editor();
    field.setSelectionRange(TS.indexOf('return') + 2, TS.indexOf('return') + 2);
    fireEvent.click(field);
    expect(screen.getByTestId('files-ed-caret').textContent).toBe('Ln 4, Col 5');
    expect(screen.getByTestId('files-code-editor').querySelector('.files-ed-gutter .is-cur')?.textContent).toBe('4');
    expect(screen.getByTestId('files-ed-lang').textContent).toBe('TypeScript / JavaScript');
  });

  it('Mod+F opens Find; Enter selects the next match', () => {
    const { field } = editor();
    fireEvent.keyDown(field, { key: 'f', ctrlKey: true });
    const input = screen.getByTestId('files-find-input');
    fireEvent.change(input, { target: { value: 'const' } });
    expect(screen.getByTestId('files-find-count').textContent).toBe('0 of 1');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('files-find-count').textContent).toBe('1 of 1');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(5);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('files-find')).toBeNull();
  });

  it('Mod+S saves when there is something to save, and not otherwise', () => {
    const a = editor({ canSave: true });
    fireEvent.keyDown(a.field, { key: 's', ctrlKey: true });
    expect(a.onSave).toHaveBeenCalledTimes(1);
  });

  it('Mod+S does nothing when the field matches the file', () => {
    const b = editor({ canSave: false });
    fireEvent.keyDown(b.field, { key: 's', metaKey: true });
    expect(b.onSave).not.toHaveBeenCalled();
  });

  it('Tab inserts two spaces instead of leaving the field', () => {
    const { field, onChange } = editor();
    field.setSelectionRange(0, 0);
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith(`  ${TS}`);
  });

  it('says Saved or Unsaved, and Discard is there only with edits', () => {
    editor({ dirty: true });
    expect(screen.getByTestId('files-ed-state').textContent).toBe('Unsaved');
    const discard = screen.getAllByTestId(FILES.action).find((b) => b.getAttribute('data-action') === 'discard')!;
    expect(discard.hasAttribute('disabled')).toBe(false);
  });
});

describe('in the panel (the editor is its own chunk, off the boot path)', () => {
  const props = (over: Partial<FilesPanelProps>): FilesPanelProps => ({
    paths: ['src/a.ts'],
    selected: 'src/a.ts',
    expanded: new Set<string>(),
    query: '',
    view: 'edit',
    content: { state: 'ready', text: TS },
    diff: { state: 'ready', text: '' },
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onQuery: vi.fn(),
    onView: vi.fn(),
    onDraft: vi.fn(),
    actions: [
      { id: 'save', label: 'Save' },
      { id: 'discard', label: 'Discard edits' },
    ],
    ...over,
  });

  it('a dirty file wears the dot on its tab; Mod+S presses the panel’s own Save', async () => {
    const onAction = vi.fn();
    render(<FilesPanel {...props({ draft: `${TS}\n// more`, onAction })} />);
    expect(screen.getByTestId('files-dirty-dot')).toBeTruthy();
    fireEvent.keyDown(await screen.findByTestId(FILES.editor), { key: 's', ctrlKey: true });
    expect(onAction).toHaveBeenCalledWith('save', 'src/a.ts');
  });

  it('a clean file has no dot', async () => {
    render(<FilesPanel {...props({})} />);
    expect(screen.queryByTestId('files-dirty-dot')).toBeNull();
    expect((await screen.findByTestId('files-ed-state')).textContent).toBe('Saved');
  });
});
