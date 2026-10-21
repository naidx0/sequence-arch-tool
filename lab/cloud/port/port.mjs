#!/usr/bin/env node
// Port the cloud lab's patches onto a repo that has moved on since they were cut.
//
//   node port.mjs [--write] [--force] [--partial] [--from N] [--only 3,17] [--root DIR] [--out DIR] PATCH_DIR_OR_FILES...
//
// git apply needs three lines of unchanged context around every change, byte for
// byte (a CRLF checkout on Windows already fails that). This tool finds each hunk
// by what it changes instead:
//   1. already there (the hunk's result is in the file)     -> already
//   2. the hunk's old lines as-is, anywhere in the file      -> exact
//   3. fewer context lines, down to one, still unique        -> trimmed
//   4. the same, ignoring indentation and runs of spaces     -> loose
//   5. a hunk with several changes split into one per change -> split
// Line endings are read per file and kept. A file the patch edits but that has
// moved is found by its name when exactly one file has that name. A hunk that
// matches in more than one place is never guessed: it is reported AMBIGUOUS.
//
// Patches run in order against an in-memory copy, so patch N sees what N-1 did.
// Default is a dry run: nothing is written. --write writes every patch whose
// hunks all landed (a patch is all or nothing unless --partial), and refuses a
// working tree with tracked changes unless --force. Nothing is staged or committed.
// Hunks that did not land are written to OUT/NNNN-name.rej (default OUT: port-out)
// with the file they belong to, for a person or a model to port by hand.
// With --write, OUT/written.txt lists every file written, for staging by name.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------- diff parsing ----------
export function parsePatch(text) {
  const lines = text.split(/\r?\n/);
  const files = [];
  let f = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(l);
      f = { oldPath: m[1], newPath: m[2], isNew: false, isDeleted: false, hunks: [] };
      files.push(f);
      continue;
    }
    if (!f) continue;
    if (l.startsWith('new file mode')) f.isNew = true;
    else if (l.startsWith('deleted file mode')) f.isDeleted = true;
    else if (l.startsWith('rename from ')) f.oldPath = l.slice(12);
    else if (l.startsWith('rename to ')) f.newPath = l.slice(10);
    else if (l.startsWith('--- ')) { if (l === '--- /dev/null') f.isNew = true; }
    else if (l.startsWith('+++ ')) { if (l === '+++ /dev/null') f.isDeleted = true; }
    else if (l.startsWith('GIT binary patch')) throw new Error(`binary patch for ${f.newPath} is not supported`);
    else if (l.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
      const h = { oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newCount: m[4] === undefined ? 1 : +m[4], lines: [], noNlOld: false, noNlNew: false };
      let o = h.oldCount, n = h.newCount;
      while ((o > 0 || n > 0) && i + 1 < lines.length) {
        const b = lines[++i];
        const t = b[0], s = b.slice(1);
        if (t === ' ' || (b === '' && o > 0 && n > 0)) { h.lines.push({ t: ' ', s }); o--; n--; }
        else if (t === '-') { h.lines.push({ t: '-', s }); o--; }
        else if (t === '+') { h.lines.push({ t: '+', s }); n--; }
        else if (t === '\\') { markNoNl(h); }
        else throw new Error(`bad hunk line in ${f.newPath}: ${JSON.stringify(b)}`);
      }
      if (lines[i + 1] && lines[i + 1].startsWith('\\')) { i++; markNoNl(h); }
      f.hunks.push(h);
    }
  }
  return files;
}
function markNoNl(h) {
  const last = h.lines[h.lines.length - 1];
  if (!last) return;
  if (last.t === '-') h.noNlOld = true;
  else if (last.t === '+') h.noNlNew = true;
  else { h.noNlOld = true; h.noNlNew = true; }
}

// ---------- file model ----------
function readModel(text) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const finalNl = text.length === 0 || /\n$/.test(text);
  const body = text.replace(/\r?\n$/, '');
  return { lines: text.length === 0 ? [] : body.split(/\r?\n/), eol, finalNl };
}
function writeModel(m) {
  return m.lines.join(m.eol) + (m.lines.length && m.finalNl ? m.eol : '');
}

// ---------- matching ----------
const norm = {
  exact: (s) => s.replace(/\s+$/, ''),
  loose: (s) => s.trim().replace(/\s+/g, ' '),
};
function findAll(lines, pat, mode) {
  if (pat.length === 0) return [];
  const f = norm[mode];
  const p = pat.map(f);
  const out = [];
  for (let i = 0; i + p.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length; j++) if (f(lines[i + j]) !== p[j]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}
const oldOf = (hl) => hl.filter((x) => x.t !== '+').map((x) => x.s);
const newOf = (hl) => hl.filter((x) => x.t !== '-').map((x) => x.s);
const lead = (s) => /^\s*/.exec(s)[0];

// Replace at index `at` in `lines` the old side of `hl` with its new side.
// Context lines keep the file's own text; added lines are re-indented when the
// file's indentation differs from the patch's (loose matches only).
function splice(lines, at, hl, mode) {
  let shiftFrom = '', shiftTo = '';
  if (mode === 'loose') {
    const k = hl.findIndex((x) => x.t !== '+');
    if (k >= 0) { shiftFrom = lead(hl[k].s); shiftTo = lead(lines[at]); }
  }
  const out = [];
  let p = at;
  for (const x of hl) {
    if (x.t === ' ') out.push(lines[p++]);
    else if (x.t === '-') p++;
    else out.push(shiftFrom !== shiftTo && x.s.startsWith(shiftFrom) ? shiftTo + x.s.slice(shiftFrom.length) : x.s);
  }
  const removed = p - at;
  lines.splice(at, removed, ...out);
  return out.length - removed;
}

// All ways to trim outer context, fewest lines dropped first.
function trims(hl) {
  let a = 0; while (a < hl.length && hl[a].t === ' ') a++;
  let b = 0; while (b < hl.length - a && hl[hl.length - 1 - b].t === ' ') b++;
  const out = [];
  for (let total = 0; total <= a + b; total++)
    for (let x = Math.min(total, a); x >= 0; x--) {
      const y = total - x;
      if (y > b) continue;
      const sub = hl.slice(x, hl.length - y);
      const hasChange = sub.some((l) => l.t !== ' ');
      const anchor = sub.filter((l) => l.t !== '+');
      if (!hasChange) continue;
      if (anchor.length === 0) continue; // a pure addition needs at least one line to stand on
      if (anchor.every((l) => l.s.trim().length < 3)) continue; // "}" alone is no anchor
      out.push({ sub, x, y });
    }
  return out;
}

// Split a hunk into one sub-hunk per run of changes, each with up to 3 lines of context.
function splitHunk(hl) {
  const groups = [];
  let i = 0;
  while (i < hl.length) {
    if (hl[i].t === ' ') { i++; continue; }
    let j = i; while (j < hl.length && hl[j].t !== ' ') j++;
    groups.push([i, j]); i = j;
  }
  if (groups.length < 2) return null;
  return groups.map(([s, e]) => {
    let a = s; while (a > 0 && hl[a - 1].t === ' ' && s - a < 3) a--;
    let b = e; while (b < hl.length && hl[b].t === ' ' && b - e < 3) b++;
    return hl.slice(a, b);
  });
}

function nearest(cands, hint) {
  return cands.reduce((best, c) => (Math.abs(c - hint) < Math.abs(best - hint) ? c : best), cands[0]);
}

// Try one hunk body against the file. Returns {status, at, delta} or {status:'FAILED'|'AMBIGUOUS'}.
function placeHunk(model, hl, hint) {
  const lines = model.lines;
  const oldB = oldOf(hl), newB = newOf(hl);
  const changes = hl.some((x) => x.t !== ' ');
  if (!changes) return { status: 'already', delta: 0 };
  // Already applied: the new side is there and the old side is not.
  for (const mode of ['exact', 'loose']) {
    const hitsNew = findAll(lines, newB, mode);
    const hitsOld = findAll(lines, oldB, mode);
    if (newB.length && hitsNew.length && !hitsOld.length) return { status: 'already', delta: 0, at: hitsNew[0] };
  }
  let ambiguous = null;
  for (const mode of ['exact', 'loose']) {
    for (const { sub, x, y } of trims(hl)) {
      const pat = oldOf(sub);
      const hits = findAll(lines, pat, mode);
      // With less context, the change may already sit here with drifted surroundings.
      const added = sub.filter((l) => l.t === '+').map((l) => l.s.trim()).join('');
      if (x + y > 0 && added.length >= 20 && findAll(lines, newOf(sub), mode).length) return { status: 'already', delta: 0 };
      if (hits.length === 1 || (hits.length > 1 && x === 0 && y === 0 && mode === 'exact' && hits.includes(hint))) {
        const at = hits.length === 1 ? hits[0] : hint;
        const delta = splice(lines, at, sub, mode);
        const status = mode === 'loose' ? 'loose' : x + y > 0 ? 'trimmed' : 'exact';
        return { status, at, delta, trimmed: x + y };
      }
      if (hits.length > 1) { ambiguous = ambiguous || { status: 'AMBIGUOUS', places: hits.map((h) => h + 1).slice(0, 6) }; break; }
    }
  }
  return ambiguous || { status: 'FAILED' };
}

function applyHunk(model, h, offset) {
  const hint = Math.max(0, h.oldStart - 1 + offset);
  const r = placeHunk(model, h.lines, hint);
  if (r.status !== 'FAILED' && r.status !== 'AMBIGUOUS') return r;
  const parts = splitHunk(h.lines);
  if (!parts) return r;
  // Split only counts if every part lands; otherwise undo.
  const saved = model.lines.slice();
  let delta = 0;
  const partResults = [];
  for (const p of parts) {
    const pr = placeHunk(model, p, hint + delta);
    partResults.push(pr.status);
    if (pr.status === 'FAILED' || pr.status === 'AMBIGUOUS') { model.lines = saved; return { ...r, parts: partResults }; }
    delta += pr.delta || 0;
  }
  return { status: 'split', delta, parts: partResults };
}

// ---------- repo access ----------
function walkFiles(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n').filter(Boolean);
  } catch {
    const out = [];
    const skip = new Set(['node_modules', '.git', 'dist', 'build', '.turbo']);
    (function walk(d, rel) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
      }
    })(root, '');
    return out;
  }
}

class Overlay {
  constructor(root) { this.root = root; this.files = new Map(); this._list = null; }
  list() { return (this._list ||= walkFiles(this.root)); }
  exists(p) { const f = this.files.get(p); if (f) return !f.deleted; return fs.existsSync(path.join(this.root, p)); }
  get(p) {
    if (!this.files.has(p)) {
      const full = path.join(this.root, p);
      this.files.set(p, fs.existsSync(full) ? { model: readModel(fs.readFileSync(full, 'utf8')), dirty: false } : { model: null, dirty: false });
    }
    return this.files.get(p);
  }
  locate(p) {
    if (this.exists(p)) return { path: p, moved: false };
    const base = p.split('/').pop();
    const hits = [...new Set([...this.list(), ...[...this.files.keys()].filter((k) => this.exists(k))])].filter((f) => f.split('/').pop() === base);
    if (hits.length === 1) return { path: hits[0], moved: true };
    return { path: null, candidates: hits };
  }
  snapshot() { const m = new Map(); for (const [k, v] of this.files) m.set(k, { ...v, model: v.model && { ...v.model, lines: v.model.lines.slice() } }); return m; }
  restore(s) { this.files = s; }
}

// ---------- one patch ----------
export function portPatch(ov, patchText, { defaultEol = '\n' } = {}) {
  const files = parsePatch(patchText);
  const report = [];
  for (const f of files) {
    const want = f.newPath;
    if (f.isNew) {
      const content = f.hunks.flatMap((h) => h.lines.filter((x) => x.t === '+').map((x) => x.s));
      const noNl = f.hunks.some((h) => h.noNlNew);
      if (!ov.exists(want)) {
        ov.files.set(want, { model: { lines: content, eol: defaultEol, finalNl: !noNl }, dirty: true, created: true });
        report.push({ file: want, kind: 'new', hunks: [{ status: 'created' }] });
      } else {
        const cur = ov.get(want).model;
        const same = cur.lines.length === content.length && cur.lines.every((l, i) => norm.exact(l) === norm.exact(content[i]));
        report.push({ file: want, kind: 'new', hunks: [{ status: same ? 'already' : 'EXISTS', note: same ? undefined : 'a different file already has this path' }] });
      }
      continue;
    }
    if (f.isDeleted) {
      const loc = ov.locate(f.oldPath);
      if (!loc.path) { report.push({ file: f.oldPath, kind: 'delete', hunks: [{ status: 'already' }] }); continue; }
      ov.files.set(loc.path, { model: null, dirty: true, deleted: true });
      report.push({ file: loc.path, kind: 'delete', hunks: [{ status: 'deleted' }] });
      continue;
    }
    const loc = ov.locate(f.oldPath);
    if (!loc.path) {
      report.push({ file: f.oldPath, kind: 'edit', hunks: f.hunks.map(() => ({ status: 'FAILED', note: loc.candidates.length ? `file moved; ${loc.candidates.length} files share its name` : 'file not found' })) });
      continue;
    }
    const entry = ov.get(loc.path);
    const model = entry.model;
    let offset = 0;
    const hr = [];
    for (const h of f.hunks) {
      const r = applyHunk(model, h, offset);
      if (r.at !== undefined) offset = r.at - (h.oldStart - 1);
      offset += r.delta || 0;
      if (h === f.hunks[f.hunks.length - 1] && r.status !== 'FAILED' && r.status !== 'AMBIGUOUS') {
        if (h.noNlNew) model.finalNl = false; else if (h.noNlOld) model.finalNl = true;
      }
      hr.push(r);
    }
    if (hr.some((r) => r.status !== 'already')) entry.dirty = true;
    report.push({ file: loc.path, from: loc.moved ? f.oldPath : undefined, kind: 'edit', hunks: hr, raw: f });
  }
  return report;
}

const BAD = new Set(['FAILED', 'AMBIGUOUS', 'EXISTS']);
export const patchOk = (rep) => rep.every((f) => f.hunks.every((h) => !BAD.has(h.status)));
export function patchKind(rep) {
  if (!patchOk(rep)) return rep.some((f) => f.hunks.some((h) => !BAD.has(h.status))) ? 'PARTIAL' : 'FAILED';
  const st = rep.flatMap((f) => f.hunks.map((h) => h.status));
  if (st.every((s) => s === 'already')) return 'already';
  if (rep.some((f) => f.from)) return 'ported';
  return st.every((s) => s === 'exact' || s === 'created' || s === 'already' || s === 'deleted') ? 'clean' : 'ported';
}

function hunkText(h) {
  return `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n` + h.lines.map((x) => x.t + x.s).join('\n');
}

// ---------- CLI ----------
function main(argv) {
  const opt = { write: false, force: false, partial: false, from: 1, only: null, root: process.cwd(), out: 'port-out', inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') opt.write = true;
    else if (a === '--force') opt.force = true;
    else if (a === '--partial') opt.partial = true;
    else if (a === '--from') opt.from = +argv[++i];
    else if (a === '--only') opt.only = new Set(argv[++i].split(',').map(Number));
    else if (a === '--root') opt.root = path.resolve(argv[++i]);
    else if (a === '--out') opt.out = argv[++i];
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 23).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
    else opt.inputs.push(a);
  }
  if (!opt.inputs.length) { console.error('give a patch directory or patch files (--help)'); return 2; }
  let patches = [];
  for (const inp of opt.inputs) {
    if (fs.statSync(inp).isDirectory()) patches.push(...fs.readdirSync(inp).filter((n) => /^\d+.*\.patch$/.test(n)).sort().map((n) => path.join(inp, n)));
    else patches.push(inp);
  }
  const num = (p) => parseInt(path.basename(p), 10);
  patches = patches.filter((p) => num(p) >= opt.from && (!opt.only || opt.only.has(num(p))));

  if (opt.write && !opt.force) {
    try {
      const dirty = execFileSync('git', ['-C', opt.root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' })
        .split('\n').filter((l) => l && !l.endsWith('.agents/skills/sequence-design/SKILL.md'));
      if (dirty.length) { console.error('refusing --write: tracked changes in the working tree (use a fresh worktree, or --force):\n' + dirty.join('\n')); return 2; }
    } catch { /* not a git repo: allowed */ }
  }

  // Match new files' line endings to the repo's own habit.
  let defaultEol = '\n';
  const probe = ['package.json', 'README.md'].map((p) => path.join(opt.root, p)).find((p) => fs.existsSync(p));
  if (probe && /\r\n/.test(fs.readFileSync(probe, 'utf8'))) defaultEol = '\r\n';

  const ov = new Overlay(opt.root);
  const summary = [];
  const outDir = path.resolve(opt.root, opt.out);
  fs.mkdirSync(outDir, { recursive: true });
  for (const p of patches) {
    const name = path.basename(p);
    const before = ov.snapshot();
    const rep = portPatch(ov, fs.readFileSync(p, 'utf8'), { defaultEol });
    const kind = patchKind(rep);
    const counts = {};
    for (const f of rep) for (const h of f.hunks) counts[h.status] = (counts[h.status] || 0) + 1;
    summary.push({ name, kind, counts, rep });
    if (kind === 'PARTIAL' || kind === 'FAILED') {
      let rej = `# ${name}: hunks that did not land (${kind})\n# Intent: see handoff.md section 1, row ${num(p)}.\n`;
      for (const f of rep) f.hunks.forEach((h, i) => {
        if (!BAD.has(h.status)) return;
        rej += `\n## ${f.file}  hunk ${i + 1}: ${h.status}${h.note ? ' (' + h.note + ')' : ''}${h.places ? ' at lines ' + h.places.join(', ') : ''}\n`;
        if (f.raw) rej += hunkText(f.raw.hunks[i]) + '\n';
      });
      fs.writeFileSync(path.join(outDir, name.replace(/\.patch$/, '.rej')), rej);
      if (!opt.partial) ov.restore(before);
    }
  }
  if (opt.write) {
    const written = [];
    for (const [p, e] of ov.files) {
      if (!e.dirty) continue;
      const full = path.join(opt.root, p);
      written.push(p);
      if (e.deleted) { if (fs.existsSync(full)) fs.rmSync(full); continue; }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, writeModel(e.model));
    }
    // Stage by name from this list: git add -- $(cat OUT/written.txt)
    fs.writeFileSync(path.join(outDir, 'written.txt'), written.join('\n') + (written.length ? '\n' : ''));
  }
  const lines = [`# Port report (${opt.write ? 'written' : 'dry run'}) at ${opt.root}`, '', '| patch | result | hunks |', '|---|---|---|'];
  for (const s of summary) lines.push(`| ${s.name} | ${s.kind} | ${Object.entries(s.counts).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
  const moved = summary.flatMap((s) => s.rep.filter((f) => f.from).map((f) => `- ${s.name}: ${f.from} -> ${f.file}`));
  if (moved.length) lines.push('', 'Files found under a new path:', ...moved);
  lines.push('', 'clean = landed where the diff said; ported = landed after search (trimmed context, loose whitespace, split hunk or moved file); PARTIAL/FAILED = see the .rej file beside this report.');
  const text = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'report.md'), text);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(summary.map(({ rep, ...s }) => ({ ...s, files: rep.map(({ raw, ...f }) => f) })), null, 2));
  process.stdout.write(text);
  return summary.some((s) => s.kind === 'PARTIAL' || s.kind === 'FAILED') ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('port.mjs')) process.exitCode = main(process.argv.slice(2));
