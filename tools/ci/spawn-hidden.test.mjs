/**
 * EVERY CHILD PROCESS STARTS HIDDEN (round 7, A1).
 *
 * Jaden, on the installed app: "Codex... infinitely opening and closing
 * different terminals." The packaged app is a GUI process, and so is the
 * server it starts (Electron run as node). On Windows a console program
 * started from a process with no console gets a NEW, visible console window
 * unless the spawn passes `windowsHide: true`. Every agent turn starts git,
 * codex or claude, so every turn flashed a window. A child started hidden
 * also hands its hidden console to its own children (codex's shells, MCP
 * servers), so the fix belongs at each of our call sites.
 *
 * The subject set is DERIVED: every source file under packages/<pkg>/src that
 * imports node:child_process (or is the acp client, which spawns through an
 * injectable `this.spawn`) is scanned for spawn/exec/fork calls, and each
 * call's argument text must carry `windowsHide`. A call that genuinely cannot
 * open a window says so with `spawn-hidden: exempt (<reason>)` on one of the
 * three lines above it. The positive and negative controls below prove the
 * scanner finds a planted bare call and passes a hidden one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CALLS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'execSync', 'exec', 'fork'];

/** The text from an opening paren to its match, ignoring parens in strings. */
function argText(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** Every child-process call in one file's source: {line, text, exempt}. */
export function spawnCalls(src) {
  const imports = /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(src);
  const injected = /this\.spawn\s*=/.test(src);
  if (!imports && !injected) return [];
  /* Names bound to the module (default/namespace) and names imported from it. */
  const aliases = new Set();
  const named = new Set();
  for (const m of src.matchAll(/import\s+(?:type\s+)?([^;'"]*?)\s+from\s+['"](?:node:)?child_process['"]/g)) {
    if (/^type\s/.test(m[0].slice(6).trim())) continue;
    const spec = m[1];
    const def = /^([A-Za-z_$][\w$]*)/.exec(spec);
    if (def) aliases.add(def[1]);
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(spec);
    if (ns) aliases.add(ns[1]);
    const braces = /\{([^}]*)\}/.exec(spec);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const p = part.trim();
        if (!p || p.startsWith('type ')) continue;
        const [orig, as] = p.split(/\s+as\s+/);
        if (CALLS.includes(orig.trim())) named.add((as ?? orig).trim());
      }
    }
  }
  /* A local that holds the module's spawn (`const spawn = deps.spawn ?? childProcess.spawn`). */
  for (const a of aliases) {
    for (const m of src.matchAll(new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*\b${a}\.(?:${CALLS.join('|')})\b`, 'g'))) named.add(m[1]);
  }
  const out = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const lines = src.split('\n');
  const push = (index, open) => {
    const line = lineOf(index);
    const before = lines.slice(Math.max(0, line - 4), line).join('\n');
    /* Skip calls inside comments: the line starts a comment. */
    const here = lines[line - 1].trim();
    if (here.startsWith('*') || here.startsWith('//') || here.startsWith('/*')) return;
    out.push({ line, text: argText(src, open), exempt: /spawn-hidden: exempt \([^)]+\)/.test(before) });
  };
  const alias = [...aliases].map((a) => a.replace(/\$/g, '\\$')).join('|');
  const patterns = [];
  if (alias) patterns.push(new RegExp(`\\b(?:${alias})\\.(?:${CALLS.join('|')})\\s*\\(`, 'g'));
  if (named.size) patterns.push(new RegExp(`(?<![.\\w$])(?:${[...named].join('|')})\\s*\\(`, 'g'));
  if (injected) patterns.push(/\bthis\.spawn\s*\(/g);
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      /* Not a declaration: `function spawn(` or a method signature. */
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 10), m.index))) continue;
      push(m.index, m.index + m[0].length - 1);
    }
  }
  return out;
}

function sourceFiles() {
  const files = [];
  const pkgs = path.join(ROOT, 'packages');
  for (const pkg of fs.readdirSync(pkgs)) {
    if (pkg === 'web2') continue; // the browser bundle cannot start processes
    const src = path.join(pkgs, pkg, 'src');
    if (!fs.existsSync(src)) continue;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'test' || e.name === 'node_modules' || e.name === 'dist') continue;
          walk(p);
        } else if (/\.(m|c)?[tj]s$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) files.push(p);
      }
    };
    walk(src);
  }
  return files;
}

describe('spawn-hidden scanner controls', () => {
  it('flags a planted bare spawn (positive control)', () => {
    const src = "import { spawn } from 'node:child_process';\nconst c = spawn('git', ['status'], { cwd: '/x' });\n";
    const calls = spawnCalls(src);
    assert.equal(calls.length, 1);
    assert.ok(!/windowsHide/.test(calls[0].text));
  });
  it('passes a hidden call, ignores regex .exec and comments (negative control)', () => {
    const src = [
      "import childProcess from 'node:child_process';",
      "const r = /a(b)/.exec('ab');",
      ' * childProcess.spawn(x) in a comment',
      "childProcess.execFile('git', ['x'], { windowsHide: true, cwd: ')' }, () => {});",
    ].join('\n');
    const calls = spawnCalls(src);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /windowsHide/);
  });
  it('reads the alias from the right import and follows a local spawn variable', () => {
    const src = [
      "import fs from 'node:fs';",
      "import { WebSocket } from 'ws';",
      "import childProcess from 'node:child_process';",
      'const spawn = deps.spawn ?? childProcess.spawn;',
      "childProcess.spawn('sh', [], { cwd });",
      "spawn('git', ['clone'], { env });",
    ].join('\n');
    assert.deepEqual(spawnCalls(src).map((c) => c.line).sort(), [5, 6]);
  });
  it('finds an injected this.spawn call', () => {
    const src = 'class A { constructor(c) { this.spawn = c.spawn; } go() { this.spawn("codex", [], { stdio: "pipe" }); } }';
    assert.equal(spawnCalls(src).length, 1);
  });
});

describe('every child process in packages/*/src starts hidden on Windows', () => {
  const files = sourceFiles();
  const all = files.flatMap((f) => spawnCalls(fs.readFileSync(f, 'utf8')).map((c) => ({ ...c, file: path.relative(ROOT, f).replace(/\\/g, '/') })));

  it('derives a real subject set (agent, git, desktop and probe spawns are in it)', () => {
    const named = new Set(all.map((c) => c.file));
    for (const must of [
      'packages/acp/src/client.ts',
      'packages/acp/src/codexAppServer.ts',
      'packages/analyzer/src/server/providerProbe.ts',
      'packages/analyzer/src/server/gitWorkspace.ts',
      'packages/desktop/src/server-control.ts',
      'packages/desktop/src/tree-kill.ts',
      'packages/analyzer/src/server/terminal.ts',
      'packages/analyzer/src/server/gitClone.ts',
    ]) {
      assert.ok(named.has(must), `${must} was not found by the scan`);
    }
    assert.ok(all.length >= 20, `only ${all.length} call sites found`);
  });

  it('passes windowsHide at every call site (or names why it cannot open a window)', () => {
    const bare = all.filter((c) => !c.exempt && !/windowsHide/.test(c.text));
    assert.deepEqual(
      bare.map((c) => `${c.file}:${c.line}`),
      [],
      'these spawns open a console window from the packaged app; add windowsHide: true',
    );
  });
});
