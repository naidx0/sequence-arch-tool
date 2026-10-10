/* ══════════════════════════════════════════════════════════════════════════
   A SMALL TERMINAL SCREEN (packages/web2/src/terminal/terminalScreen.ts)

   Owner, 2026-10-09: "make sure the terminal works and is perfected".

   The pane used to strip every escape sequence and append what was left to one
   string, so Backspace painted a stray control character, the Up arrow's
   history recall glued the old line onto the new one, and `clear` did nothing.
   A shell edits its line by moving a cursor: that needs a cursor.

   This is a character grid with scrollback and the handful of sequences a shell
   prompt uses: CR, LF, BS, TAB, cursor moves (A B C D G d H f), erase in line
   and display (K J X), insert/delete characters (@ P). Colour (m), modes
   (h l), titles (OSC) and the rest are consumed and ignored. Not a full-screen
   terminal (no alternate screen): the pane is a shell log, not vim.

   PURE: no DOM. `write` mutates the screen it is given and returns it.
   ══════════════════════════════════════════════════════════════════════════ */

/** Scrollback kept above the visible rows. Older lines are dropped so a long build does not stutter the pane. */
export const SCROLLBACK_LINES = 5000;

export interface TerminalScreen {
  /** Scrollback then the visible rows, one string per row. */
  lines: string[];
  /** Parallel to `lines`: true when the row continues the one above it by the terminal's own wrap (not a line feed). */
  cont: boolean[];
  /** Index in `lines` of the first visible row. */
  top: number;
  /** Cursor, relative to the visible rows. */
  row: number;
  col: number;
  cols: number;
  rows: number;
  /** An escape sequence cut off at the end of the last chunk, finished by the next one. */
  pending: string;
}

export function createScreen(cols = 80, rows = 24): TerminalScreen {
  return { lines: Array.from({ length: rows }, () => ''), cont: Array.from({ length: rows }, () => false), top: 0, row: 0, col: 0, cols: Math.max(2, cols), rows: Math.max(2, rows), pending: '' };
}

/** The visible rows, padded so the grid always has `rows` of them. */
function ensureRows(s: TerminalScreen): void {
  while (s.lines.length < s.top + s.rows) {
    s.lines.push('');
    s.cont.push(false);
  }
}

export function resizeScreen(s: TerminalScreen, cols: number, rows: number): TerminalScreen {
  s.cols = Math.max(2, cols);
  s.rows = Math.max(2, rows);
  ensureRows(s);
  s.row = Math.min(s.row, s.rows - 1);
  s.col = Math.min(s.col, s.cols - 1);
  return s;
}

/* ── cells ───────────────────────────────────────────────────────────────────
   A column is not a UTF-16 unit: a CJK character or an emoji takes two columns, an astral one two units, a
   combining mark none. A row is edited as an array of cells, a wide character followed by an empty cell. */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b55], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
];
const ZERO: ReadonlyArray<readonly [number, number]> = [[0x0300, 0x036f], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f]];
const within = (t: ReadonlyArray<readonly [number, number]>, cp: number) => t.some(([a, b]) => cp >= a && cp <= b);

/** Columns a code point takes: 0 (combining), 1, or 2 (East Asian Wide, emoji). */
export function charWidth(cp: number): 0 | 1 | 2 {
  if (cp < 0x300) return 1;
  if (within(ZERO, cp)) return 0;
  return within(WIDE, cp) ? 2 : 1;
}

/** Printable ASCII only: columns and string indexes agree, so a row can be sliced. */
const isAscii = (t: string) => /^[ -~]*$/.test(t);

function cellsOf(line: string): string[] {
  const out: string[] = [];
  for (const ch of line) {
    const w = charWidth(ch.codePointAt(0)!);
    if (w === 0 && out.length) {
      let k = out.length - 1;
      if (out[k] === '' && k > 0) k--;
      out[k] += ch;
      continue;
    }
    out.push(ch);
    if (w === 2) out.push('');
  }
  return out;
}

/** Edit row `i` as cells. */
function edit(s: TerminalScreen, i: number, fn: (cells: string[]) => void): void {
  const cells = cellsOf(s.lines[i]!);
  fn(cells);
  s.lines[i] = cells.join('');
}

function lineFeed(s: TerminalScreen, wrapped = false): void {
  if (s.row < s.rows - 1) {
    s.row++;
    ensureRows(s);
    s.cont[s.top + s.row] = wrapped;
    return;
  }
  s.top++;
  s.lines.push('');
  s.cont.push(wrapped);
  const over = s.lines.length - (SCROLLBACK_LINES + s.rows);
  if (over > 0) {
    s.lines.splice(0, over);
    s.cont.splice(0, over);
    s.top -= over;
  }
}

function put(s: TerminalScreen, text: string): void {
  let rest = text;
  while (rest.length) {
    if (s.col >= s.cols) {
      s.col = 0;
      lineFeed(s, true);
    }
    ensureRows(s);
    const i = s.top + s.row;
    const line = s.lines[i]!;
    /* Plain ASCII onto a plain ASCII row: slices. Anything else goes one code point at a time. */
    if (isAscii(line) && isAscii(rest.slice(0, s.cols - s.col))) {
      const run = rest.slice(0, s.cols - s.col);
      rest = rest.slice(run.length);
      const padded = line.length < s.col ? line + ' '.repeat(s.col - line.length) : line;
      s.lines[i] = padded.slice(0, s.col) + run + padded.slice(s.col + run.length);
      s.col += run.length;
      continue;
    }
    /* Never split a surrogate pair. */
    const cp = rest.codePointAt(0)!;
    const ch = String.fromCodePoint(cp);
    rest = rest.slice(ch.length);
    const w = charWidth(cp);
    if (w === 0) {
      edit(s, i, (cells) => {
        let k = Math.min(s.col, cells.length) - 1;
        if (k > 0 && cells[k] === '') k--;
        if (k >= 0) cells[k] += ch;
      });
      continue;
    }
    if (s.col + w > s.cols) {
      /* A wide character that does not fit wraps whole. */
      s.col = 0;
      lineFeed(s, true);
      rest = ch + rest;
      continue;
    }
    edit(s, i, (cells) => {
      while (cells.length < s.col) cells.push(' ');
      if (cells[s.col] === '' && s.col > 0) cells[s.col - 1] = ' ';
      cells[s.col] = ch;
      if (w === 2) cells[s.col + 1] = '';
      const after = s.col + w;
      if (cells[after] === '') cells[after] = ' ';
    });
    s.col += w;
  }
}

const num = (p: string | undefined, d: number): number => {
  const n = parseInt(p ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

function csi(s: TerminalScreen, params: string, final: string): void {
  if (/^[<=>?]/.test(params)) return; /* private modes (cursor shown, bracketed paste ...) */
  const p = params.split(';');
  const i = () => s.top + s.row;
  ensureRows(s);
  /* A cursor waiting at the right edge to wrap is on the last column for every cursor-relative sequence (xterm). */
  if (s.col >= s.cols && 'ABCDGdKJXP@'.includes(final)) s.col = s.cols - 1;
  switch (final) {
    case 'A': s.row = Math.max(0, s.row - num(p[0], 1)); break;
    case 'B': s.row = Math.min(s.rows - 1, s.row + num(p[0], 1)); break;
    case 'C': s.col = Math.min(s.cols - 1, s.col + num(p[0], 1)); break;
    case 'D': s.col = Math.max(0, s.col - num(p[0], 1)); break;
    case 'G': s.col = Math.min(s.cols - 1, num(p[0], 1) - 1); break;
    case 'd': s.row = Math.min(s.rows - 1, num(p[0], 1) - 1); break;
    case 'H':
    case 'f':
      s.row = Math.min(s.rows - 1, num(p[0], 1) - 1);
      s.col = Math.min(s.cols - 1, num(p[1], 1) - 1);
      break;
    case 'K': {
      const mode = parseInt(p[0] || '0', 10);
      if (mode === 2) s.lines[i()] = '';
      else edit(s, i(), (c) => (mode === 1 ? eraseTo(c, s.col) : void c.splice(s.col)));
      break;
    }
    case 'J': {
      const mode = parseInt(p[0] || '0', 10);
      if (mode === 3) {
        s.lines = s.lines.slice(s.top);
        s.cont = s.cont.slice(s.top);
        s.top = 0;
      } else if (mode === 2) {
        for (let r = 0; r < s.rows; r++) {
          s.lines[s.top + r] = '';
          s.cont[s.top + r] = false;
        }
      } else if (mode === 1) {
        for (let r = 0; r < s.row; r++) s.lines[s.top + r] = '';
        edit(s, i(), (c) => eraseTo(c, s.col));
      } else {
        edit(s, i(), (c) => void c.splice(s.col));
        for (let r = s.row + 1; r < s.rows; r++) s.lines[s.top + r] = '';
      }
      break;
    }
    case 'X': {
      const n = num(p[0], 1);
      edit(s, i(), (c) => {
        for (let k = s.col; k < Math.min(c.length, s.col + n); k++) c[k] = ' ';
      });
      break;
    }
    case 'P': edit(s, i(), (c) => void c.splice(s.col, num(p[0], 1))); break;
    case '@': {
      const n = num(p[0], 1);
      edit(s, i(), (c) => {
        while (c.length < s.col) c.push(' ');
        c.splice(s.col, 0, ...Array.from({ length: n }, () => ' '));
        c.length = Math.min(c.length, s.cols);
      });
      break;
    }
    default: /* m (colour), h/l (modes), r, t, n ... */
      break;
  }
}

function eraseTo(c: string[], col: number): void {
  for (let k = 0; k <= col && k < c.length; k++) c[k] = ' ';
}

/** Feed decoded output to the screen. */
export function writeScreen(s: TerminalScreen, chunk: string): TerminalScreen {
  const text = s.pending + chunk;
  s.pending = '';
  let plain = '';
  const flush = () => {
    if (plain) put(s, plain);
    plain = '';
  };
  let k = 0;
  while (k < text.length) {
    const ch = text[k]!;
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      if (ch !== '\u001b') {
        plain += ch;
        k++;
        continue;
      }
    }
    flush();
    if (ch === '\u001b') {
      const next = text[k + 1];
      if (next === undefined) {
        s.pending = text.slice(k);
        return s;
      }
      if (next === '[') {
        const m = /^\u001b\[([0-9;:?<=>]*)([ -/]*)([@-~])/.exec(text.slice(k, k + 64));
        if (!m) {
          if (text.length - k < 64 && /^\u001b\[[0-9;:?<=>]*[ -/]*$/.test(text.slice(k))) {
            s.pending = text.slice(k);
            return s;
          }
          k += 2;
          continue;
        }
        csi(s, m[1]!, m[3]!);
        k += m[0].length;
        continue;
      }
      /* OSC (ESC ]) and the string controls DCS (ESC P), SOS (ESC X), PM (ESC ^), APC (ESC _): all end at BEL or ST. */
      if (next === ']' || next === 'P' || next === 'X' || next === '^' || next === '_') {
        const end = /\u0007|\u001b\\/.exec(text.slice(k + 2));
        if (!end) {
          if (text.length - k < 512) {
            s.pending = text.slice(k);
            return s;
          }
          /* Never terminated: drop only the introducer and carry on with what follows. */
          k += 2;
          continue;
        }
        k += 2 + end.index + end[0].length;
        continue;
      }
      if (next === '(' || next === ')' || next === '*' || next === '+') {
        if (k + 2 >= text.length) {
          s.pending = text.slice(k);
          return s;
        }
        k += 3;
        continue;
      }
      k += 2;
      continue;
    }
    switch (ch) {
      case '\r': s.col = 0; break;
      case '\n':
      case '\u000b':
      case '\u000c': lineFeed(s); break;
      /* From the pending-wrap position (just past the last column) Backspace lands on cols-2, like xterm. */
      case '\b': s.col = Math.max(0, Math.min(s.col, s.cols - 1) - 1); break;
      case '\t': s.col = Math.min(s.cols - 1, (Math.floor(s.col / 8) + 1) * 8); break;
      default: break; /* BEL, DEL and other controls draw nothing */
    }
    k++;
  }
  flush();
  return s;
}

export interface ScreenView {
  /** The lines to draw: rows the terminal wrapped are joined back into one line; leading blank lines dropped,
   *  nothing below the last ink or the cursor. */
  lines: string[];
  /** The cursor within `lines` (col counted along the joined line), or null when it is past what is drawn. */
  cursor: { line: number; col: number } | null;
}

/** What to draw: the first visible line sits at the top of the pane (a shell opens by painting blank rows). */
export function viewScreen(s: TerminalScreen): ScreenView {
  const cur = s.top + s.row;
  let last = s.lines.length - 1;
  while (last > cur && s.lines[last]!.trim() === '') last--;
  let first = 0;
  while (first < cur && first < last && s.lines[first]!.trim() === '') first++;
  const lines: string[] = [];
  let cursor: ScreenView['cursor'] = null;
  for (let i = first; i <= last; ) {
    let text = s.lines[i]!;
    let j = i;
    while (j + 1 <= last && s.cont[j + 1]) {
      j++;
      text += s.lines[j]!;
    }
    if (cur >= i && cur <= j) {
      let before = 0;
      for (let r = i; r < cur; r++) before += s.lines[r]!.length;
      /* The cursor column is in cells; the drawn text is a string: translate along the cursor row. */
      const cells = cellsOf(s.lines[cur]!);
      const inRow = cells.slice(0, s.col).join('').length + Math.max(0, s.col - cells.length);
      cursor = { line: lines.length, col: before + inRow };
    }
    lines.push(text);
    i = j + 1;
  }
  return { lines, cursor };
}
