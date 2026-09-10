import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowPlayback } from '../state/types';

import { IndexRail, type IndexRailProps } from './IndexRail';
import {
  coverageMissingBeta,
  emptyGraph,
  twoPackageFunctions,
  twoPackages,
} from './fixtures';
import { buildFunctionIndex } from './railModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE THREE LOCKS — item 4.1–4.5
   packages/web2/src/rail/IndexRail.test.tsx

   THE LOCKS, IN THE WAVE'S OWN WORDS: "a function click produces a flow list;
   an uncovered subtree renders its badge; the empty case renders that exact
   sentence."

   EVERY ONE OF THEM IS DRIVEN BY A CLICK ON A REAL ROW, and that is the whole
   design of this file rather than a stylistic preference. CANON records the
   defect twice: "This project has twice shipped a test asserting that a
   dispatch landed while the button opened nothing." So nothing below asserts
   that a handler was called as its PRIMARY claim — it asserts that the DOM the
   user would be looking at changed. `fireEvent.click` goes through the real
   element, the real handler and the real state, and the assertion that follows
   reads the rendered result.

   WHAT THIS TIER STILL CANNOT SEE, said out loud so nobody mistakes it for
   coverage: jsdom has no layout. A row collapsed to 0px, an accent that
   vanished into its ground, a 12px glyph on an 11px line — none of it is
   visible here. `railRendered.test.ts` opens the same components in a real
   browser over the real token sheet for exactly those questions.
   ══════════════════════════════════════════════════════════════════════════ */

const NO_EVIDENCE = 'shape unknown — no evidence on this hop';

function mount(overrides: Partial<IndexRailProps> = {}) {
  const props: IndexRailProps = {
    graph: twoPackages(),
    functions: buildFunctionIndex(twoPackageFunctions()),
    coverage: null,
    playback: null,
    onPlay: vi.fn(),
    onPlaybackChange: vi.fn(),
    onClearFlow: vi.fn(),
    onFocusNode: vi.fn(),
    onOpenScope: vi.fn(),
    ...overrides,
  };
  const view = render(<IndexRail {...props} />);
  return { ...view, props };
}

/** The row a user would click, found the way a user finds it — by its text. */
function row(label: string): HTMLElement {
  const found = screen
    .getAllByTestId('rail-row')
    .find((el) => within(el).queryByText(label) !== null);
  if (!found) throw new Error(`no rail row reads "${label}"`);
  return found;
}

/** Open a file so its functions are on screen, as the reader must. */
function openFile(label: string): void {
  fireEvent.click(row(label));
}

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 4.1 — THE RAIL IS AN INDEX OF FILES AND FUNCTIONS
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 4.1 — files, then functions with :line', () => {
  it('carries the word Index, and does not carry it TWICE (sheet 11.1)', () => {
    mount();
    /*
     * "The header carries the word, not a glyph." That header is the shell's
     * `.pane-hd` — `Shell.tsx` draws the literal word `Index` on the 44px line
     * and `Shell.test.tsx` asserts it at every breakpoint. So the word reaches
     * the reader through the region's accessible name here, and a second
     * rendered "Index" inside the pane body would be two headers on one column.
     * The obvious instinct on opening this file is to add a title; this is the
     * assertion that says why not.
     */
    expect(screen.getByTestId('rail').getAttribute('aria-label')).toBe('Index');
    expect(screen.queryAllByText('Index')).toHaveLength(0);
  });

  it('draws a card for each thing the board draws, and its files under it', () => {
    mount();
    const rungs = screen.getAllByTestId('rail-row').map((el) => el.dataset.rung);
    expect(rungs.filter((r) => r === 'card')).toHaveLength(3);
    expect(rungs.filter((r) => r === 'file')).toHaveLength(3);
  });

  it('keeps functions closed until the file is opened', () => {
    mount();
    expect(screen.queryByText('openGate')).toBeNull();
    openFile('one.ts');
    expect(screen.getByText('openGate')).toBeTruthy();
  });

  it('carries the line on the function row — the rail is functions-first', () => {
    mount();
    openFile('one.ts');
    expect(within(row('openGate')).getByTestId('rail-line').textContent).toBe(':12');
  });

  it('says what a card with no file has, rather than drawing an empty card', () => {
    mount();
    expect(screen.getByTestId('rail-card-empty').textContent).toBe('Nothing the scan could name.');
  });

  it('invites rather than apologises when nothing has been read (sheet 11.7)', () => {
    mount({ graph: null, functions: null });
    expect(screen.getByTestId('rail-empty').textContent).toBe(
      'Open a repository and the index fills as the board draws.',
    );
  });

  it('says a filter matched nothing in the filter’s own words', () => {
    mount();
    fireEvent.change(screen.getByTestId('rail-filter'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('rail-empty').textContent).toBe(
      'Nothing in this repository is named “zzzz”.',
    );
  });

  it('counts hits and not the rows revealed to show them (sheet 11.5)', () => {
    mount();
    fireEvent.change(screen.getByTestId('rail-filter'), { target: { value: 'openGate' } });
    /* Three rows on screen — card, file, function — and exactly one hit. */
    expect(screen.getAllByTestId('rail-row')).toHaveLength(3);
    expect(screen.getByTestId('rail-matches').textContent).toBe('1 match');
  });

  it('shows a hit that lives inside a CLOSED file — never hidden behind a parent', () => {
    mount();
    expect(screen.queryByText('openGate')).toBeNull();
    fireEvent.change(screen.getByTestId('rail-filter'), { target: { value: 'openGate' } });
    expect(screen.getByText('openGate')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LOCK 1 — A FUNCTION CLICK PRODUCES A FLOW LIST
   ══════════════════════════════════════════════════════════════════════════ */

describe('LOCK 1 — item 4.2: a function click produces a flow list', () => {
  it('renders one hop row per proven hop, each with its evidence ref', () => {
    mount();
    openFile('one.ts');
    fireEvent.click(row('openGate'));

    const hops = screen.getAllByTestId('rail-hop');
    expect(hops).toHaveLength(2);
    expect(hops.map((h) => within(h).getByTestId('rail-hop-ref').textContent)).toEqual([
      'packages/alpha/src/one.ts:3',
      'packages/alpha/src/one.ts:4',
    ]);
  });

  it('names both ends of every hop with the label the board uses', () => {
    mount();
    openFile('one.ts');
    fireEvent.click(row('openGate'));
    const first = screen.getAllByTestId('rail-hop')[0];
    expect(within(first).getByTestId('rail-hop-from').textContent).toBe('one.ts');
    expect(within(first).getByTestId('rail-hop-to').textContent).toBe('two.ts');
  });

  it('asks the canvas to play what it just listed, and nothing else', () => {
    const { props } = mount();
    openFile('one.ts');
    fireEvent.click(row('openGate'));

    expect(props.onPlay).toHaveBeenCalledTimes(1);
    const playback = (props.onPlay as ReturnType<typeof vi.fn>).mock.calls[0][0] as FlowPlayback;
    expect(playback.functionId).toBe('fn:one');
    expect(playback.hops).toHaveLength(2);
    expect(playback.cursor).toBe(0);
    expect(playback.playing).toBe(true);
  });

  it('clears the flow, and the strip goes with it', () => {
    const { props, rerender } = mount();
    openFile('one.ts');
    fireEvent.click(row('openGate'));
    expect(screen.queryByTestId('rail-flow')).toBeTruthy();

    fireEvent.click(screen.getByTestId('rail-clear'));
    expect(props.onClearFlow).toHaveBeenCalledTimes(1);
    rerender(
      <IndexRail
        {...props}
        playback={null}
      />,
    );
    expect(screen.queryByTestId('rail-flow')).toBeNull();
  });

  it('does NOT play a function whose calls never leave its file — it says so', () => {
    const { props } = mount();
    openFile('one.ts');
    fireEvent.click(row('helper'));

    expect(props.onPlay).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rail-flow')).toBeNull();
    /* Sheet 11.6: "it selects its card instead, and says so… a word, not a
       dead row. The only badge this rail is allowed to draw, and it is grey." */
    expect(screen.getByTestId('rail-nottraced').textContent).toBe('Not traced');
    expect(props.onFocusNode).toHaveBeenCalledWith('svc:alpha');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LOCK 2 — AN UNCOVERED SUBTREE RENDERS ITS BADGE
   ══════════════════════════════════════════════════════════════════════════ */

describe('LOCK 2 — item 4.4: coverage badges', () => {
  it('marks the component the last answer never read', () => {
    mount({ coverage: coverageMissingBeta() });
    const badge = screen.getByTestId('rail-badge');
    expect(badge.dataset.path).toBe('packages/beta');
    expect(badge.textContent).toBe('packages/beta · 1 edge · not in the last answer');
  });

  it('leaves the component that WAS read unmarked', () => {
    mount({ coverage: coverageMissingBeta() });
    expect(screen.getAllByTestId('rail-badge')).toHaveLength(1);
    expect(within(row('alpha')).queryByTestId('rail-badge')).toBeNull();
  });

  it('badges nothing at all before an answer exists — absent, never zeroed', () => {
    mount({ coverage: null });
    expect(screen.queryAllByTestId('rail-badge')).toHaveLength(0);
  });

  it('carries the warning as a glyph beside the words, never a typed character', () => {
    mount({ coverage: coverageMissingBeta() });
    const badge = screen.getByTestId('rail-badge');
    expect(badge.querySelector('svg')).not.toBeNull();
    /* Sheet 11.3 forbids a typed character standing in for a mark. */
    expect(badge.textContent).not.toContain('⚠');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   LOCK 3 — THE HONEST EMPTY CASE, VERBATIM
   ══════════════════════════════════════════════════════════════════════════ */

describe('LOCK 3 — item 4.2: a hop with no proof says so', () => {
  /*
   * The condition is built by removing the arch edges, which is the state a
   * scan reaches whenever a call crosses a file without an import the scanner
   * could read — a dynamic import, a barrel re-export, a Go package-scope
   * call. `state/types.ts` types `FlowHop.evidence` as `Evidence | null` for
   * this exact reason: "a hop without proof is impossible to skip past
   * silently: every consumer must handle it."
   */
  function graphWithNoEdges() {
    const graph = twoPackages();
    graph.edges = [];
    return graph;
  }

  it('renders the sentence, character for character, on the hop row', () => {
    mount({ graph: graphWithNoEdges() });
    openFile('one.ts');
    fireEvent.click(row('openGate'));

    const refs = screen
      .getAllByTestId('rail-hop')
      .map((h) => within(h).getByTestId('rail-hop-ref').textContent);
    expect(refs).toEqual([NO_EVIDENCE, NO_EVIDENCE]);
  });

  it('renders it on the playing hop in the strip too', () => {
    const graph = graphWithNoEdges();
    const functions = buildFunctionIndex(twoPackageFunctions());
    const { props } = mount({ graph, functions });
    openFile('one.ts');
    fireEvent.click(row('openGate'));

    const playback = (props.onPlay as ReturnType<typeof vi.fn>).mock.calls[0][0] as FlowPlayback;
    render(
      <IndexRail
        {...props}
        graph={graph}
        functions={functions}
        playback={{ ...playback, cursor: 1, playing: false }}
      />,
    );
    const strips = screen.getAllByTestId('rail-strip-ref');
    expect(strips[strips.length - 1].textContent).toBe(NO_EVIDENCE);
  });

  it('never softens it to "no evidence" or an empty string', () => {
    mount({ graph: graphWithNoEdges() });
    openFile('one.ts');
    fireEvent.click(row('openGate'));
    const ref = within(screen.getAllByTestId('rail-hop')[0]).getByTestId('rail-hop-ref');
    expect(ref.textContent?.trim()).not.toBe('');
    expect(ref.textContent).not.toBe('no evidence');
    expect(ref.textContent).toBe(NO_EVIDENCE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 4.3 — NODE DETAIL   ·   ITEM 4.5 — THE STRIP IS THREE CONTROLS
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 4.3 — node detail', () => {
  it('opens on a card click and shows what it is, its parts and its files', () => {
    mount();
    fireEvent.click(row('alpha'));
    const detail = screen.getByTestId('rail-detail');
    expect(within(detail).getByTestId('rail-detail-title').textContent).toBe('Alpha');
    expect(within(detail).getAllByTestId('rail-detail-part').map((p) => p.textContent)).toEqual([
      'packages/alpha/src',
    ]);
    expect(within(detail).getAllByTestId('rail-detail-file')).toHaveLength(2);
  });

  it('says the scanner produced no description rather than showing an empty heading', () => {
    mount();
    fireEvent.click(row('beta'));
    expect(screen.getByTestId('rail-detail-none').textContent).toBe(
      'The scan read this node and could not describe it.',
    );
  });

  it('drills into the scope, which is the canvas’s move and not the rail’s', () => {
    const { props } = mount();
    fireEvent.click(row('alpha'));
    fireEvent.click(screen.getByTestId('rail-detail-scope'));
    expect(props.onOpenScope).toHaveBeenCalledWith('svc:alpha');
  });
});

describe('item 4.5 — playback reduced to three things', () => {
  function playing(): FlowPlayback {
    const graph = twoPackages();
    const functions = buildFunctionIndex(twoPackageFunctions());
    const { props } = mount({ graph, functions });
    openFile('one.ts');
    fireEvent.click(row('openGate'));
    return (props.onPlay as ReturnType<typeof vi.fn>).mock.calls[0][0] as FlowPlayback;
  }

  it('draws play/pause, a scrub and the current hop’s ref — and no fourth control', () => {
    const playback = playing();
    render(
      <IndexRail
        graph={twoPackages()}
        functions={buildFunctionIndex(twoPackageFunctions())}
        coverage={null}
        playback={playback}
        onPlay={vi.fn()}
        onPlaybackChange={vi.fn()}
        onClearFlow={vi.fn()}
        onFocusNode={vi.fn()}
        onOpenScope={vi.fn()}
      />,
    );
    const strip = screen.getAllByTestId('rail-strip').at(-1) as HTMLElement;
    expect(within(strip).getAllByRole('button')).toHaveLength(1);
    expect(within(strip).getByTestId('rail-strip-play')).toBeTruthy();
    expect(within(strip).getByTestId('rail-scrub')).toBeTruthy();
    expect(within(strip).getByTestId('rail-strip-ref')).toBeTruthy();
  });

  it('pauses through the canvas, which owns the playback', () => {
    const playback = playing();
    const onPlaybackChange = vi.fn();
    render(
      <IndexRail
        graph={twoPackages()}
        functions={buildFunctionIndex(twoPackageFunctions())}
        coverage={null}
        playback={{ ...playback, playing: true }}
        onPlay={vi.fn()}
        onPlaybackChange={onPlaybackChange}
        onClearFlow={vi.fn()}
        onFocusNode={vi.fn()}
        onOpenScope={vi.fn()}
      />,
    );
    const strip = screen.getAllByTestId('rail-strip').at(-1) as HTMLElement;
    fireEvent.click(within(strip).getByTestId('rail-strip-play'));
    expect(onPlaybackChange).toHaveBeenCalledWith(expect.objectContaining({ playing: false }));
  });

  it('scrubs to a hop by index', () => {
    const playback = playing();
    const onPlaybackChange = vi.fn();
    render(
      <IndexRail
        graph={twoPackages()}
        functions={buildFunctionIndex(twoPackageFunctions())}
        coverage={null}
        playback={playback}
        onPlay={vi.fn()}
        onPlaybackChange={onPlaybackChange}
        onClearFlow={vi.fn()}
        onFocusNode={vi.fn()}
        onOpenScope={vi.fn()}
      />,
    );
    const strip = screen.getAllByTestId('rail-strip').at(-1) as HTMLElement;
    fireEvent.change(within(strip).getByTestId('rail-scrub'), { target: { value: '1' } });
    expect(onPlaybackChange).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 1, playing: false }),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SHEET 11.7 — READING, AND A REFRESH THAT FAILED
   ══════════════════════════════════════════════════════════════════════════ */

describe('sheet 11.7 — the rail while the world moves', () => {
  it('draws no skeleton while a scan runs — a marked placeholder and a word', () => {
    mount({ graph: null, functions: null, status: 'reading', repoName: 'sequence' });
    expect(screen.getByTestId('rail-status').textContent).toBe('Reading sequence');
    expect(screen.queryAllByTestId('rail-skeleton')).toHaveLength(0);
  });

  it('shows honest scan progress copy when the wiring supplies it', () => {
    mount({
      graph: null,
      functions: null,
      status: 'reading',
      repoName: 'sequence',
      readingStatus: 'Rescanning sequence · Analyzing · 33% · 12s',
    });
    expect(screen.getByTestId('rail-status').textContent).toBe(
      'Rescanning sequence · Analyzing · 33% · 12s',
    );
  });

  it('keeps the rows it has and says they stopped tracking, with the retry beside it', () => {
    const onRetry = vi.fn();
    mount({ status: 'stale', onRetry });
    expect(screen.getByTestId('rail-status').textContent).toContain('Not tracking');
    expect(screen.getAllByTestId('rail-row').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('rail-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an attached repository with no nodes at all as a fact, not a spinner', () => {
    mount({ graph: emptyGraph(), functions: null });
    expect(screen.getByTestId('rail-empty').textContent).toBe(
      'The scan read this repository and could not name anything in it.',
    );
  });
});

/**
 * A COUNT IS A CLAIM ABOUT A SCAN.
 *
 * Found by the Waves 4/5 gate, in the shipped bundle, behind a proxy that 404s only
 * `/api/functions`: **526 file rows and 10 card rows every one printing `0`**, and an
 * expanded file saying "The scan read this file and could not name a function in it"
 * — a claim about a scan nobody ran. `functionCount` is derived FROM the index, so an
 * absent index makes it 0 everywhere, and 0 reads as "this file has none" rather than
 * "nobody looked".
 *
 * The component already carried an honest branch for it, and that branch was DEAD
 * CODE: its guard was `row.functionCount > 0 && ... && functions === null`, a
 * contradiction, because the count is 0 whenever the index is null.
 *
 * No existing test could see any of this — every one of them is handed a real index
 * by `mount()`. That is the gap this file closes: `docs/CANON.md` §1 makes
 * grounded-not-guessed the first non-negotiable, and a fabricated count is exactly
 * the "asserts a false fact with a citation" failure it names.
 */
describe('an unread function index', () => {
  it('prints no count at all, rather than zero', () => {
    mount({ functions: null });
    // Em dash = "not known". A `0` here would be the product asserting a scan result
    // it does not have.
    expect(screen.queryAllByText('0')).toHaveLength(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('never claims the scan read a file it did not', () => {
    mount({ functions: null });
    expect(screen.queryByTestId('rail-file-empty')).toBeNull();
  });

  it('says plainly that the index has not been read', () => {
    const { props } = mount({ functions: null });
    void props;
    // The honest branch must be REACHABLE, which the contradictory guard made
    // impossible. Expanding a file is what surfaces it.
    const target = screen.getAllByRole('button').find((b) => /\.ts/.test(b.textContent ?? ''));
    expect(target, 'a file row to expand').toBeTruthy();
    fireEvent.click(target as HTMLElement);
    expect(screen.getAllByTestId('rail-file-unread').length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE RAIL DID NOT READ — owner walk 2026-08-22, item A7.

   "Index is cool. It shows the files. Missing a couple, actually,
   unfortunately, but so be it."

   Measured: 56 tracked source files absent from the graph, none of them parse
   failures — all outside every discovered service, because the scan walks
   service directories and nothing else. `unfollowed` reported `[]` the whole
   time, which its own contract defines as "looked, and everything was
   readable". The graph asserted coverage over files it had never opened.

   "So be it" is the reader concluding the tool is a bit lossy. The product's
   own first claim is the opposite of lossy — it is that coverage is knowable —
   so the rail has to say this rather than let absence look like completeness.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the rail says what was not read', () => {
  function withUnscanned(regions: unknown) {
    const g = twoPackages() as unknown as Record<string, unknown>;
    return { ...g, unscanned: regions } as never;
  }

  it('names the regions the scan never entered, and counts them', () => {
    mount({
      graph: withUnscanned([
        { dir: 'tools', files: 52, extensions: ['.mjs'] },
        { dir: 'examples', files: 3, extensions: ['.py', '.ts'] },
      ]),
    });
    const note = screen.getByTestId('rail-unscanned');
    /* The COUNT is what tells a reader whether it matters. "Some files were
       not read" is a shrug; 55 is a fact they can act on. */
    expect(note.textContent).toMatch(/55/);
    expect(note.textContent).toMatch(/tools/);
  });

  it('says NOTHING when every source file was covered', () => {
    /* An empty coverage box, rendered to make a point about completeness, is
       noise on a rail whose whole job is signal. */
    mount({ graph: withUnscanned([]) });
    expect(screen.queryByTestId('rail-unscanned')).toBeNull();
  });

  it('says nothing when the scan did not record the field at all', () => {
    /*
     * ABSENT AND EMPTY ARE DIFFERENT and the graph contract says so: absent is
     * "not recorded", empty is "looked, and there were none". An older
     * persisted graph predates this field, and claiming full coverage on its
     * behalf would be inventing the very assurance this note exists to stop
     * being invented.
     */
    mount({ graph: twoPackages() });
    expect(screen.queryByTestId('rail-unscanned')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE KEYBOARD REACHES THE RAIL.

   `railKey` decides and is tested on its own; these assert the decision is
   actually WIRED — a keyboard model nothing calls is the same "built but not
   reached" failure as everything else on this list.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the rail moves under the keyboard', () => {
  function rowsList(): HTMLElement {
    return screen.getAllByTestId('rail-row')[0]!.closest('ul')!;
  }

  it('Down moves focus onto the first row', () => {
    mount();
    fireEvent.keyDown(rowsList(), { key: 'ArrowDown' });
    const first = screen.getAllByTestId('rail-row')[0]!;
    expect(document.activeElement).toBe(first);
  });

  it('EXPANDS A FILE WITHOUT A MOUSE', () => {
    mount();
    const fileRow = screen
      .getAllByTestId('rail-row')
      .find((r) => r.getAttribute('data-rung') === 'file')!;
    const before = fileRow.getAttribute('aria-expanded');

    /* Walk down to that row, then Right to open it. */
    const list = rowsList();
    const index = screen.getAllByTestId('rail-row').indexOf(fileRow);
    for (let i = 0; i <= index; i++) fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowRight' });

    const after = screen
      .getAllByTestId('rail-row')
      .find((r) => r.getAttribute('data-row-id') === fileRow.getAttribute('data-row-id'))!;
    expect(after.getAttribute('aria-expanded')).not.toBe(before);
  });

  it('LEAVES ORDINARY TYPING ALONE', () => {
    /* The filter field is the one control the rail exists to make fast. A
       navigation handler that swallowed letters would break it. */
    mount();
    const list = rowsList();
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    list.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

/**
 * THE BOARD DRIVES THE RAIL — the direction that never arrived.
 *
 * `rail/reveal` has a reducer arm writing `rail.selectedPath`, and NO COMPONENT
 * READ IT. So clicking a card on the board moved nothing here: the two panes
 * that are meant to drive each other only ever talked one way, while the item
 * was marked shipped with five tests covering the half that worked.
 */
describe('a path revealed from the board', () => {
  const REVEALED = 'packages/alpha/src/one.ts';

  it('SELECTS the matching row', () => {
    mount({ revealPath: REVEALED });
    const selected = document.querySelector('[data-rail-path="' + REVEALED + '"][data-selected="true"]');
    expect(selected).toBeTruthy();
  });

  it('EXPANDS it, so its functions are on screen rather than one click away', () => {
    mount({ revealPath: REVEALED });
    const el = document.querySelector('[data-rail-path="' + REVEALED + '"]');
    expect(el?.getAttribute('aria-expanded')).toBe('true');
  });

  it('selects nothing when the board has revealed nothing', () => {
    /* Null is the ordinary state - nothing on the board is open - and it must
       not highlight a row at random. */
    mount({ revealPath: null });
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
  });

  it('a path the rail does not have selects nothing rather than guessing', () => {
    mount({ revealPath: 'packages/nowhere/ghost.ts' });
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
  });

  it('following a second reveal moves the selection', () => {
    const { rerender, props } = mount({ revealPath: REVEALED });
    const second = 'packages/beta/src/gate.ts';
    rerender(<IndexRail {...props} revealPath={second} />);
    expect(document.querySelector('[data-rail-path="' + second + '"][data-selected="true"]')).toBeTruthy();
  });
});

/**
 * WHY IS THIS NODE HERE — the question a person clicks a card to ask.
 *
 * `NodeDetailPanel` answers it: what the node is, and where each of its edges
 * was traced from, file and line. It was built, tested, and reachable ONLY by
 * clicking the same node a second time over in the rail — clicking a card on
 * the board selected it and grounded the composer on it and nothing else.
 *
 * `RailSlice.detail` was declared for exactly this and written by no reducer
 * arm; it is now `selectedNodeId`, because the ID is the state and
 * `nodeDetailViewFor` derives the panel from the graph the store already has.
 */
describe('a node the board asked about', () => {
  it('OPENS THE EXPLANATION for it', () => {
    const graph = twoPackages();
    const nodeId = graph.nodes.find((n) => n.kind === 'service')!.id;
    mount({ explainNodeId: nodeId });
    expect(screen.getByTestId('rail-detail')).toBeTruthy();
  });

  it('C4.3 SELECTS the matching card row (board → rail highlight)', () => {
    const graph = twoPackages();
    const nodeId = graph.nodes.find((n) => n.kind === 'service')!.id;
    mount({ explainNodeId: nodeId });
    const selected = document.querySelector(
      `[data-testid="rail-row"][data-rung="card"][data-row-id="${nodeId}"][data-selected="true"]`,
    );
    expect(selected).toBeTruthy();
  });

  it('explains nothing when the board has asked about nothing', () => {
    mount({ explainNodeId: null });
    expect(screen.queryByTestId('rail-detail')).toBeNull();
  });

  it('a node the graph does not have explains nothing rather than guessing', () => {
    mount({ explainNodeId: 'svc:does-not-exist' as never });
    expect(screen.queryByTestId('rail-detail')).toBeNull();
  });

  it('the board’s request wins over the rail’s own older click', () => {
    /* A reader who clicks a card on the board is asking about THAT card, not
       about whatever they last opened over here. */
    const graph = twoPackages();
    const services = graph.nodes.filter((n) => n.kind === 'service');
    const { rerender, props } = mount({ explainNodeId: services[0]!.id });
    expect(screen.getByTestId('rail-detail')).toBeTruthy();
    expect(
      document.querySelector(
        `[data-testid="rail-row"][data-rung="card"][data-row-id="${services[0]!.id}"][data-selected="true"]`,
      ),
    ).toBeTruthy();

    const nextId = services[1]?.id ?? services[0]!.id;
    rerender(<IndexRail {...props} explainNodeId={nextId} />);
    expect(screen.getByTestId('rail-detail')).toBeTruthy();
    expect(
      document.querySelector(
        `[data-testid="rail-row"][data-rung="card"][data-row-id="${nextId}"][data-selected="true"]`,
      ),
    ).toBeTruthy();
  });
});
