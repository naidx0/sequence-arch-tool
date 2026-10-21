import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardTabs } from '../canvas/boards/BoardTabs';
import { ARCH_BOARD_ID, boardLabel, nextBoardName, type BoardsIndex } from '../canvas/boards/boardsModel';
import { Whiteboard } from '../whiteboard/Whiteboard';
import { WB_COLOR_LABEL, WB_COLORS } from '../whiteboard/palette';

/*
 * 0.1.8.1 C9 (audit P2-10, P2-11, P2-12). Every colour swatch has an accessible name; the sidebar's secondary text is
 * >= 4.5:1 in every theme, through the theme tokens; a cut-short sidebar row shows its full name on hover; the
 * surface is "Spaces" and what is in it is a "Board", in every UI string.
 */

afterEach(cleanup);

const SRC = path.join(__dirname, '..');

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe('every colour swatch has a name (P2-10)', () => {
  it('the trigger and each row of the colour menu are named by the colour', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    expect(screen.getByTestId('wb-color-trigger').getAttribute('aria-label')).toBe(`Colour: ${WB_COLOR_LABEL.ink}`);
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
    const swatches = [...document.querySelectorAll('.wb-swatch')];
    expect(swatches.length).toBeGreaterThanOrEqual(WB_COLORS.length);
    for (const sw of swatches) {
      const host = sw.closest('button')!;
      const name = host.getAttribute('aria-label') ?? '';
      expect(name.length, sw.outerHTML).toBeGreaterThan(0);
      expect(host.getAttribute('title')).toBeTruthy();
    }
    for (const c of WB_COLORS) expect(screen.getByTestId(`wb-color-${c}`).getAttribute('aria-label')).toBe(WB_COLOR_LABEL[c]);
  });
});

/* ── contrast, from the tokens ─────────────────────────────────────────── */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('the sidebar secondary text reads at 4.5:1 or better (P2-11)', () => {
  it('every theme: the sidebar secondary ink on the sidebar ground', () => {
    const tokens = readFileSync(path.join(SRC, 'tokens/graphite.css'), 'utf8');
    /* Each theme block that sets both the ground and the third ink. */
    const themes = [...tokens.matchAll(/--bg-base:\s*(#[0-9A-Fa-f]{6})[\s\S]*?--ink-3:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => ({ bg: m[1]!, ink3: m[2]! }));
    expect(themes.length).toBeGreaterThanOrEqual(3);
    for (const t of themes) expect(ratio(t.ink3, t.bg), JSON.stringify(t)).toBeGreaterThanOrEqual(4.5);
  });
  it('the sidebar sheet draws its secondary text with that ink, never a fainter one', () => {
    const css = readFileSync(path.join(SRC, 'shell2/shell2.css'), 'utf8');
    expect(css).toMatch(/--b-ink3:\s*var\(--ink-3\)/);
    expect(css).toMatch(/\.s2-meta \{[^}]*color: var\(--b-ink3\)/);
    expect(css).not.toMatch(/color:\s*var\(--(?:b-ink4|ink-4|ink-5)\)/);
  });
  it('a cut-short row carries its full name on hover', () => {
    const src = readFileSync(path.join(SRC, 'shell2/SessionPanel.tsx'), 'utf8');
    /* The chat row's title is its whole name even when no project tag rides on it. */
    expect(src).toMatch(/: wt \? branchLabel\(wt\.branch\) : sessionTitle\(entry\)\}/);
    /* The project row's title is its name and its path. */
    expect(src).toMatch(/title=\{`\$\{p\.name\} \(\$\{p\.path \?\? 'Local workspace'\}\)`\}/);
  });
});

/* ── naming ────────────────────────────────────────────────────────────── */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$|specimen|Gallery|gallery|preview/i.test(name)) out.push(p);
  }
  return out;
}
/** The words a reader sees in a .tsx: JSX text, and the string values of the attributes that are read out or shown. */
function uiStrings(text: string): string[] {
  const out: string[] = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /* JSX text, with any {expression} inside it read as a gap (review N2: "This space could not be saved: {error}"). */
  for (const m of code.matchAll(/>((?:[^<>{};=]|\{[^{}]*\})*)</g)) {
    const text = m[1]!.replace(/\{[^{}]*\}/g, ' ').trim();
    if (/[A-Za-z]/.test(text)) out.push(text);
  }
  for (const m of code.matchAll(/\b(?:aria-label|title|placeholder|label|confirmLabel|caption)=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of code.matchAll(/\b(?:text|label|title|caption):\s*'([^']*)'/g)) out.push(m[1]!);
  /* Review: string literals inside JSX expressions are read too: {cond ? '...' : null}, {cond && '...'}, {a ?? '...'}, {'...'}. */
  for (const m of code.matchAll(/(?:\?|:|&&|\|\||\?\?|\{)\s*(['"`])((?:(?!\1)[^\n\\])*)\1/g)) {
    if (/[A-Za-z]/.test(m[2]!) && !m[2]!.includes('${')) out.push(m[2]!);
  }
  return out.filter(Boolean);
}
/* "Boards" stays: the architecture board's strip lists boards (review S7). A board is never "a space". */
const OLD_NAMES = /\bWhiteboards?\b|\b(?:a|A|the|The|this|This|new|New|no|No|earlier|Earlier|loading|Loading|load|your|Your) [Ss]paces?\b(?! is)/;

describe('"Spaces" holds boards, everywhere a reader sees it (P2-12)', () => {
  it('the scan finds a planted old name (positive control)', () => {
    expect(uiStrings('<span>Open the Whiteboard</span>').some((s) => OLD_NAMES.test(s))).toBe(true);
    expect(uiStrings('<button aria-label="New space" />').some((s) => OLD_NAMES.test(s))).toBe(true);
    expect(uiStrings('<p>This space could not be saved: {board.error}</p>').some((s) => OLD_NAMES.test(s))).toBe(true);
    /* Review: a literal inside a JSX expression, and the plural the old pattern let through. */
    expect(uiStrings("<p>{pick === 'failed' ? 'Could not load spaces.' : 'Loading spaces…'}</p>").some((s) => OLD_NAMES.test(s))).toBe(true);
    expect(uiStrings("<p>{makeFailed ? 'A Space could not be made. Press + to try again.' : null}</p>").some((s) => OLD_NAMES.test(s))).toBe(true);
    expect(uiStrings('<span className="k">Earlier spaces</span>').some((s) => OLD_NAMES.test(s))).toBe(true);
    expect(uiStrings("<p>{ok ? 'Earlier boards' : 'Loading boards…'}</p>").some((s) => OLD_NAMES.test(s))).toBe(false);
    expect(uiStrings('<span>Spaces is empty</span>').some((s) => OLD_NAMES.test(s))).toBe(false);
    expect(uiStrings('<span>Boards</span>').some((s) => OLD_NAMES.test(s))).toBe(false);
  });
  it('no UI string in a .tsx says Whiteboard, or a/the/this/new space', () => {
    const hits: string[] = [];
    for (const file of sources(SRC)) {
      for (const s of uiStrings(readFileSync(file, 'utf8'))) if (OLD_NAMES.test(s)) hits.push(`${path.relative(SRC, file)}: ${s}`);
    }
    expect(hits).toEqual([]);
  });
  it('a new board is a Board, and the untouched default shows as Board', () => {
    expect(nextBoardName(null)).toBe('Board');
    expect(boardLabel({ id: 'whiteboard', kind: 'whiteboard', name: 'Whiteboard' })).toBe('Board');
    const arch = { id: ARCH_BOARD_ID, name: 'Architecture', kind: 'architecture', rev: 1, createdAt: '', updatedAt: '' };
    render(<BoardTabs index={{ version: 1, boards: [arch] } as unknown as BoardsIndex} current={ARCH_BOARD_ID} onOpen={() => {}} onCreate={() => {}} onRename={() => {}} onDelete={() => {}} />);
    /* The architecture board's strip lists boards; the Spaces surface captions its own strip "Spaces" (review S7). */
    expect(screen.getByTestId('board-tabs').getAttribute('aria-label')).toBe('Boards');
    expect(screen.getByTestId('board-tab-new').getAttribute('aria-label')).toBe('New board');
  });
});
