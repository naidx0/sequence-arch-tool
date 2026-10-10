import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './files.css';

import { FILES } from './anchors';
import { FilesPanel } from './FilesPanel';
import type { FileLoad, FilesPanelProps, FilesView } from './FilesPanel';
import type { FileStatus } from './filesModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL — item 2.1
   packages/web2/src/files/FilesPanel.test.tsx

   The panel is FULLY CONTROLLED, so these assertions are of the form "given
   this state it draws this, and this gesture emits that". There is no internal
   selection to drive and nothing to wait for — which is the point: the same
   code path serves a fixture here and the locked chat in the product, so a
   green render test is evidence about the shipped surface rather than about a
   test-only mode.

   THE THREE THINGS THIS FILE IS ACTUALLY ABOUT:
     - the toggle between the source and the diff is VISIBLE and it works;
     - the header always says which file you are looking at;
     - a control the caller did not enable is not drawn at all, rather than
       drawn and inert.

   jsdom has no layout, so nothing here claims anything about overflow,
   truncation or scrolling. Those belong to the legibility gate against a real
   browser and the real repository.
   ══════════════════════════════════════════════════════════════════════════ */

const PATHS = [
  'packages/analyzer/src/auth.ts',
  'packages/analyzer/src/scan.ts',
  'README.md',
];

const DIFF = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1,1 +1,2 @@',
  ' # Sequence',
  '+Keeps your architecture honest.',
  '',
].join('\n');

const ready = (text: string): FileLoad => ({ state: 'ready', text });

type Overrides = Partial<FilesPanelProps>;

function mount(overrides: Overrides = {}) {
  const spies = {
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    onQuery: vi.fn(),
    onView: vi.fn(),
    onDraft: vi.fn(),
    onAction: vi.fn(),
  };

  const props: FilesPanelProps = {
    paths: PATHS,
    selected: 'README.md',
    expanded: new Set<string>(['packages/analyzer/src']),
    query: '',
    view: 'code',
    content: ready('# Sequence\nKeeps your architecture honest.'),
    diff: ready(DIFF),
    onSelect: spies.onSelect,
    onToggle: spies.onToggle,
    onOpen: spies.onOpen,
    onQuery: spies.onQuery,
    onView: spies.onView,
    ...overrides,
  };

  const view = render(<FilesPanel {...props} />);
  return { ...spies, ...view, props };
}

describe('the two halves', () => {
  it('draws a tree on the left and the file on the right', () => {
    mount();
    expect(screen.getByTestId(FILES.panel)).toBeTruthy();
    expect(screen.getByTestId(FILES.tree)).toBeTruthy();
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
  });

  it('THE HEADER ALWAYS SAYS WHICH FILE YOU ARE LOOKING AT', () => {
    /* Two files called index.ts are told apart by their directories and by
       nothing else, so the name and the whole path are both present. */
    mount({ selected: 'packages/analyzer/src/auth.ts' });
    const header = screen.getByTestId(FILES.header);
    expect(header.textContent).toContain('auth.ts');
    expect(screen.getByTestId(FILES.headerPath).textContent).toBe(
      'packages/analyzer/src/auth.ts',
    );
  });

  it('THE HEADER IS ONE LINE: [tree] [breadcrumb] [modes] [status], the file named at the very top (owner, 2026-10-09)', () => {
    mount({
      selected: 'packages/analyzer/src/auth.ts',
      repoName: 'demo-repo',
      onDraft: vi.fn(),
      status: new Map<string, FileStatus>([['packages/analyzer/src/auth.ts', 'modified']]),
    });
    const header = screen.getByTestId(FILES.header);
    /* One row: the direct children are the toggle, the crumb, the modes and the status word, nothing else. */
    const kids = Array.from(header.children).map((c) => c.getAttribute('data-testid') ?? c.className.split(' ')[0]);
    expect(kids).toEqual([FILES.treeToggle, FILES.headerPath, FILES.view, 'files-hd-status']);
    const crumb = screen.getByTestId(FILES.headerPath);
    expect(crumb.textContent).toBe('demo-repo/packages/analyzer/src/auth.ts');
    expect(crumb.getAttribute('title')).toBe('demo-repo/packages/analyzer/src/auth.ts');
    expect(header.textContent).not.toMatch(/No file/i);
    /* The CSS keeps it one line and elides at the FRONT. */
    const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.files-scope \.files-hd\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.files-scope \.files-hd-path\s*\{[^}]*direction:\s*rtl/);
  });

  it('every mode has a tooltip and an aria-label, so the control can fold to icons', () => {
    mount({ view: 'preview', onDraft: vi.fn() });
    for (const m of screen.getAllByTestId(FILES.viewOption)) {
      expect(m.getAttribute('title')).toBeTruthy();
      expect(m.getAttribute('aria-label')).toBe(m.textContent);
    }
  });

  it('folds by the PANE width: icons only below 560, status word gone below 420, nothing floats in a box', () => {
    const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/@container files-pane \(max-width: 560px\)\s*\{[\s\S]*?\.files-mode-word\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@container files-pane \(max-width: 560px\)\s*\{[\s\S]*?\.files-hd-branch\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@container files-pane \(max-width: 420px\)\s*\{[^}]*\.files-hd-status\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.files-scope \.files-hd\s*\{[^}]*background:\s*transparent/);
    expect(css).toMatch(/\.files-scope \.files-hd\s*\{[^}]*border:\s*0/);
    expect(css).toMatch(/\.files-scope \.files-btn:active/);
    expect(css).toMatch(/prefers-reduced-motion[^{]*\{[^}]*\.files-btn \{ transition: none/);
  });

  it('the markdown rhythm is not zeroed by the block rules, the narrow grid places the file, a mid pane keeps a tree column', () => {
    const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    /* A block rule with a margin shorthand beats the rhythm rule (3 classes against 2) and made 0px gaps. */
    for (const sel of ['prose-list', 'r9-code', 'dgm']) {
      const rule = css.match(new RegExp(String.raw`\.files-scope \.files-md \.${sel}\s*\{([^}]*)\}`));
      expect(rule, sel).toBeTruthy();
      expect(rule![1]).not.toMatch(/\bmargin\s*:/);
    }
    expect(css).toMatch(/\.files-scope \.files-md > \* \+ \.prose-h\s*\{\s*margin-top:\s*var\(--sp-24\)/);
    /* The drawer is out of flow: the file is placed in the 1fr track by hand. */
    expect(css).toMatch(/\.files-scope\.is-narrow\s*\{[^}]*grid-template-columns:\s*0 0 minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.files-scope\.is-narrow \.files-main\s*\{\s*grid-column:\s*3/);
    /* 441 to 560: a compact 176px tree column, not a drawer. */
    expect(css).toMatch(/@container files-pane \(max-width: 560px\)\s*\{\s*\.files-scope\.is-tree-rail\s*\{\s*grid-template-columns:\s*minmax\(0, 176px\)/);
    expect(readFileSync(join(__dirname, 'FilesPanel.tsx'), 'utf8')).toMatch(/const NARROW_PANE_PX = 440;/);
    /* A diagram is drawn at a multiple of its own size, not stretched to the column. */
    expect(css).toMatch(/\.dgm-art svg\s*\{[^}]*calc\(var\(--dgm-w\) \* 1\.15px\)/);
  });

  it('the markdown preview is a centred reading column of about 72 characters', () => {
    const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.files-scope \.files-md\s*\{[^}]*max-width:\s*72ch/);
    expect(css).toMatch(/\.files-scope \.files-md\s*\{[^}]*margin-inline:\s*auto/);
    expect(css).toMatch(/\.files-md \.r9-code-hd\s*\{[^}]*position:\s*absolute/);
    expect(css).toMatch(/\.files-md \.r9-code \.prose-code code\s*\{[^}]*white-space:\s*pre/);
    expect(css).toMatch(/\.files-md \.dgm-art[^{]*\{[^}]*justify-content:\s*center/);
    /* A diagram scales up to the column, capped at 1.15x, and never below its own
       natural size (round 3: it used to shrink to 226x41 in a 308px pane; it now scrolls
       sideways in its block). mermaid's inline px size is overridden. Tables have cells. */
    expect(css).toMatch(/\.files-md \.dgm\[data-kind='mermaid'\] \.dgm-art svg\s*\{[^}]*width:\s*max\(min\(100%, calc\(var\(--dgm-w\) \* 1\.15px\)\), calc\(var\(--dgm-w\) \* 1px\)\) !important/);
    expect(css).toMatch(/\.files-md \.prose-table td[\s\S]*?\{[^}]*padding:/);
  });

  it('says what to do when nothing is selected, rather than showing a blank', () => {
    mount({ selected: null });
    expect(screen.getByTestId(FILES.note).textContent).toContain('Pick a file');
    expect(screen.queryByTestId(FILES.code)).toBeNull();
  });
});

describe('the visible toggle between the source and the diff', () => {
  it('draws both modes, and marks the one in force', () => {
    mount({ view: 'code' });
    /* README.md has a rendered form, so Preview leads (round 7, B8). */
    const modes = screen.getAllByTestId(FILES.viewOption);
    expect(modes.map((m) => m.getAttribute('data-mode'))).toEqual(['preview', 'edit', 'diff']);
    expect(modes.map((m) => m.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('the read-only source button has a read-only tooltip, not the editable one', () => {
    mount({ view: 'edit' });
    const btn = screen.getAllByTestId(FILES.viewOption).find((m) => m.getAttribute('data-mode') === 'edit')!;
    expect(btn.textContent).toBe('Code');
    expect(btn.getAttribute('title')).toContain('read-only');
    expect(btn.getAttribute('title')).not.toContain('editable');
  });

  it('no file open: the header is the repo name alone and draws no mode control (owner, 2026-10-09)', () => {
    mount({ selected: null, view: 'edit', onDraft: vi.fn(), repoName: 'demo-repo' });
    expect(screen.queryAllByTestId(FILES.viewOption)).toHaveLength(0);
    expect(screen.queryByTestId(FILES.view)).toBeNull();
    const header = screen.getByTestId(FILES.header);
    expect(header.textContent).toBe('demo-repo');
    expect(header.textContent).not.toMatch(/No file/i);
  });

  it('ONE SOURCE MODE: there is no separate Code button next to Edit (owner, 2026-10-09)', () => {
    const { rerender, props } = mount({ view: 'edit', onDraft: vi.fn() });
    const ids = () => screen.getAllByTestId(FILES.viewOption).map((m) => m.getAttribute('data-mode'));
    expect(ids()).toEqual(['preview', 'edit', 'diff']);
    expect(ids()).not.toContain('code');
    /* The retired 'code' view still resolves, to Edit. */
    rerender(<FilesPanel {...props} view="code" />);
    expect(screen.getAllByTestId(FILES.viewOption).find((m) => m.getAttribute('aria-pressed') === 'true')!.getAttribute('data-mode')).toBe('edit');
  });

  it('the view control is a labelled segmented control: every mode draws its word, with a 28px-rung hit area', () => {
    mount({ view: 'preview', onDraft: vi.fn() });
    const words = screen.getAllByTestId(FILES.viewOption).map((m) => m.textContent);
    expect(words).toEqual(['Preview', 'Edit', 'Diff']);
    const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.files-scope \.files-mode\s*\{[^}]*height:\s*var\(--row-h\)/);
    expect(css).not.toMatch(/\.files-mode:not\(\[aria-pressed='true'\]\)\s*\{[^}]*width:/);
  });

  it('asks the caller to change the mode, and never changes it itself', () => {
    /* Wave 3 puts a LOCKED CHAT in charge of what each surface is showing. A
       panel that owned this would be a second authority for one fact, and
       whichever rendered second would win. */
    const { onView } = mount({ view: 'code' });
    fireEvent.click(screen.getAllByTestId(FILES.viewOption).find((m) => m.getAttribute('data-mode') === 'diff')!);
    expect(onView).toHaveBeenCalledWith('diff');
    /* Still the source, because the prop did not move. */
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
  });

  it('shows the diff when the mode says diff', () => {
    mount({ view: 'diff' });
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('ready');
    expect(screen.getAllByTestId(FILES.line)).toHaveLength(2);
    expect(screen.queryByTestId(FILES.code)).toBeNull();
  });

  it('A FILE WITH NO DIFF STILL SAYS WHY, INSTEAD OF SHOWING NOTHING', () => {
    /* An EMPTY diff body is a valid, expected answer from the route — the
       wiring must pass it as `ready` and this must render the sentence. */
    mount({ view: 'diff', diff: ready('') });
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('empty');
    expect(screen.getByTestId(FILES.diffNote).textContent).toContain('README.md');
  });
});

describe('the source view', () => {
  it('numbers every line, because evidence here is file:line', () => {
    /* A viewer without a gutter makes the reader count, which is exactly the
       work the citation was supposed to save. */
    mount();
    const lines = screen.getAllByTestId(FILES.codeLine);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toMatch(/^1/);
    expect(lines[1]!.textContent).toMatch(/^2/);
  });

  it('PASSES THE SERVER’S OWN SENTENCE THROUGH UNCHANGED', () => {
    /* /api/file answers differently for "too large", "outside the repo" and
       "unreadable"; each is a different fix, and a panel that rewrote all three
       as "could not load" would delete the one line the reader can act on. */
    mount({ content: { state: 'failed', message: 'file is larger than MAX_FILE_BYTES' } });
    const note = screen.getByTestId(FILES.note);
    expect(note.getAttribute('role')).toBe('alert');
    expect(note.textContent).toBe('file is larger than MAX_FILE_BYTES');
  });

  it('says it is reading, and names the file it is reading', () => {
    mount({ content: { state: 'loading' } });
    expect(screen.getByTestId(FILES.note).textContent).toContain('Reading README.md');
  });

  it('TELLS NOTHING-ASKED-FOR APART FROM STILL-LOADING', () => {
    /* "A dead engine and a rejected folder looked the same on screen" is the
       defect the boot ladder records by name; absence must never be the only
       signal a surface has. */
    mount({ content: { state: 'idle' } });
    expect(screen.getByTestId(FILES.note).textContent).toContain('Nothing loaded');
  });
});

describe('editing', () => {
  it('THERE IS NO EDITOR UNTIL A CALLER CAN ACCEPT AN EDIT: the one source mode reads as Code and is read-only', () => {
    /* Passing `onDraft` is what makes the panel writable. A caller with no
       write endpoint gets a read-only panel rather than a tab that silently
       discards typing. */
    mount({ view: 'edit' });
    expect(screen.queryByTestId(FILES.editor)).toBeNull();
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
    expect(screen.getAllByTestId(FILES.viewOption).map((m) => m.textContent)).toContain('Code');
  });

  it('offers the field once one can, and hands every keystroke back', async () => {
    const onDraft = vi.fn();
    mount({ view: 'edit', onDraft });
    const field = (await screen.findByTestId(FILES.editor)) as HTMLTextAreaElement;
    /* A null draft means the reader has not typed yet, so the field shows the
       FILE — not an empty box that would look like a file with no content. */
    expect(field.value).toBe('# Sequence\nKeeps your architecture honest.');

    fireEvent.change(field, { target: { value: '# Sequence\nedited' } });
    expect(onDraft).toHaveBeenCalledWith('# Sequence\nedited');
  });

  it('once there is a draft it is the truth, and the header says it is unsaved', async () => {
    mount({ view: 'edit', onDraft: vi.fn(), draft: 'typed over it' });
    expect(((await screen.findByTestId(FILES.editor)) as HTMLTextAreaElement).value).toBe('typed over it');
    expect(screen.getByTestId(FILES.header).textContent).toContain('unsaved');
  });

  it('FALLS BACK TO THE SOURCE RATHER THAN DRAWING NOTHING', () => {
    /* A caller that drops `onDraft` while the mode is still 'edit' shows the
       file. An unavailable mode cannot be the mode. */
    mount({ view: 'edit' });
    expect(screen.queryByTestId(FILES.editor)).toBeNull();
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
  });
});

describe('the filter', () => {
  it('hands the query back and counts HITS, not scaffolding', () => {
    const { onQuery } = mount({ query: 'auth' });
    /* One file is named auth.ts; two directory rows are drawn to reach it. The
       count is 1 — sheet 11.5, and the "6 matches for two files" defect. */
    expect(screen.getByTestId(FILES.matches).textContent).toBe('1 match');

    fireEvent.change(screen.getByTestId(FILES.filter), { target: { value: 'scan' } });
    expect(onQuery).toHaveBeenCalledWith('scan');
  });

  it('a filtered tree comes up open, so the hits are on screen', () => {
    mount({ query: 'auth', expanded: new Set() });
    const paths = screen
      .getAllByTestId(FILES.row)
      .map((r) => r.getAttribute('data-path'));
    expect(paths).toContain('packages/analyzer/src/auth.ts');
    expect(paths).not.toContain('packages/analyzer/src/scan.ts');
  });

  it('says so when nothing matches, in the reader’s own words', () => {
    mount({ query: 'zzzz' });
    expect(screen.getByTestId(FILES.matches).textContent).toBe('0 matches');
    expect(screen.getByTestId(FILES.empty).textContent).toContain('zzzz');
  });

  it('names the branch when there is no query, because a diff is against something', () => {
    mount({ branch: 'main' });
    /* A quiet chip at the end of the header row, not its own line above the tree. */
    expect(screen.getByTestId(FILES.branch).textContent).toBe('main');
    expect(screen.getByTestId(FILES.header).contains(screen.getByTestId(FILES.branch))).toBe(true);
    expect(screen.queryByTestId(FILES.matches)).toBeNull();
  });
});

describe('the tree drives the panel', () => {
  it('a click selects and opens, and both leave as callbacks', () => {
    const { onSelect, onOpen } = mount({ selected: null });
    const target = screen
      .getAllByTestId(FILES.row)
      .find((r) => r.getAttribute('data-path') === 'README.md')!;
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith('README.md');
    expect(onOpen).toHaveBeenCalledWith('README.md');
  });

  it('shows the git mark for a changed file', () => {
    const status = new Map<string, FileStatus>([['README.md', 'modified']]);
    mount({ status });
    const target = screen
      .getAllByTestId(FILES.row)
      .find((r) => r.getAttribute('data-path') === 'README.md')!;
    expect(target.getAttribute('data-dirty')).toBe('true');
    /* And the header repeats it in the WORD, because the letter is a glyph. */
    expect(screen.getByTestId(FILES.header).textContent).toContain('modified');
  });
});

describe('the action row — "multiple editing options"', () => {
  it('DRAWS ONLY WHAT THE CALLER PASSED, and never invents a control', () => {
    /* A surface that draws a control it cannot make good on is lying about the
       product, and the reader finds out by pressing it. */
    mount();
    expect(screen.queryAllByTestId(FILES.action)).toHaveLength(0);
  });

  it('runs an action against the selected path', () => {
    const onAction = vi.fn();
    mount({
      actions: [{ id: 'save', label: 'Save' }],
      onAction,
    });
    fireEvent.click(screen.getByTestId(FILES.action));
    expect(onAction).toHaveBeenCalledWith('save', 'README.md');
  });

  it('A REFUSAL CARRIES ITS REASON, never a bare grey button', () => {
    /* The defect `reviewScopes` records by name: a disabled Revert behind a
       tooltip that had stopped being true. */
    mount({
      actions: [
        { id: 'save', label: 'Save' },
        { id: 'revert', label: 'Revert', disabled: true, note: 'no route discards this yet' },
      ],
      onAction: vi.fn(),
    });
    const button = screen.getAllByTestId(FILES.action).find((b) => b.getAttribute('data-action') === 'revert') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('no route discards this yet');
  });

  it('the row is not drawn while every action is disabled (Save / Discard with nothing to save were clutter)', () => {
    mount({ actions: [{ id: 'save', label: 'Save', disabled: true }], onAction: vi.fn() });
    expect(screen.queryAllByTestId(FILES.action)).toHaveLength(0);
  });

  it('cannot act when there is nothing selected to act on', () => {
    mount({ selected: null, actions: [{ id: 'save', label: 'Save' }], onAction: vi.fn() });
    expect((screen.getByTestId(FILES.action) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the modes are exactly the modes', () => {
  it('every mode in the control renders something', () => {
    /* A control with a dead option is worse than a missing option: the reader
       presses it once, sees nothing, and stops trusting the rest of the row. */
    const modes: FilesView[] = ['code', 'diff', 'edit'];
    for (const view of modes) {
      const { unmount } = render(
        <FilesPanel
          paths={PATHS}
          selected="README.md"
          expanded={new Set()}
          query=""
          view={view}
          content={ready('one\ntwo')}
          diff={ready(DIFF)}
          onSelect={vi.fn()}
          onToggle={vi.fn()}
          onQuery={vi.fn()}
          onView={vi.fn()}
          onDraft={vi.fn()}
        />,
      );
      const body = screen.getByTestId(FILES.panel).querySelector('.files-body');
      expect(body?.children.length).toBeGreaterThan(0);
      unmount();
    }
  });
});

/*
 * OWNER PHOTO, 2026-09-22: a highlighted folder with "path is a directory"
 * under it, names cut to "…opilot" / "resear…", and the view pair lying over
 * the file's name in a narrow pane. Measured in the running app: the drag seam
 * was 0px wide below 420px, and the header pair ran past the header's edge.
 */
describe('the Files rail, after the 2026-09-22 photo', () => {
  it('a folder click opens the folder and never asks the reader to load it', () => {
    const { onSelect, onToggle } = mount({ selected: null });
    const folder = screen.getAllByRole('treeitem').find((r) => r.classList.contains('files-row-dir'))!;
    fireEvent.click(folder);
    expect(onToggle).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a folder that is the selection is not read as a file', () => {
    mount({ selected: 'packages' as never, content: { state: 'failed', message: 'path is a directory' } });
    expect(screen.queryByText('path is a directory')).toBeNull();
    expect(screen.getByTestId(FILES.note).textContent).toMatch(/Pick a file from the tree/);
  });

  it('dragging the seam marks the width as the reader’s, at any pane size', () => {
    mount();
    const panel = screen.getByTestId(FILES.panel);
    expect(panel.className).toContain('is-tree-rail');
    fireEvent.pointerDown(screen.getByTestId(FILES.resizer), { clientX: 100, pointerId: 1 });
    expect(panel.className).toContain('is-tree-wide');
    expect(panel.className).not.toContain('is-tree-rail');
  });
});
