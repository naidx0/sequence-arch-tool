/**
 * The tiny repo behind the LTR golden fixture (test/fixtures/ltr-golden.json).
 *
 * Built the same way by the test and by tools/bench/ltr-golden.mjs, which runs
 * the Python reference (search3/ltr ltrlib + model.txt) on it to write the
 * fixture. Designed so a one-line break in the port shows up:
 * - a --no-ff merge with side-branch commits (first-parent history);
 * - 25 commits with the same subject touching different files (kNN tie-break at
 *   the top-20 cut);
 * - a 31-file sweep (the "more than 30 files" rule);
 * - more commits than HIST_N, so the oldest files fall back to since_last's default;
 * - JS/TS (relative, package-name and `@/` imports), Python (relative and
 *   absolute imports) and Rust (`mod`, `use crate::`) import edges;
 * - 90 generated files, so every arm is cut at 50 and the arms disagree;
 * - y.ts whose BM25F score is exactly half the best file's for "zeta theta",
 *   imported by w.ts (nbr_cnt's `> 0.5`).
 * Commit dates are fixed, so the history order is deterministic.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** History commits the fixture reads (the reference's `hist_n`), fewer than the repo has. */
export const LTR_GOLDEN_HIST_N = 34;

export const LTR_GOLDEN_QUESTIONS = [
  'token refresh race in `refreshToken`',
  'zeta theta',
  'parse_config fails on an empty file',
  'chore: bump deps',
  'button theme color is wrong',
  'net util in the crate',
  'SessionStore keeps a stale session after logout',
  'format the feature flag',
];

export function buildLtrGoldenRepo(dir: string): void {
  let t = 1_700_000_000;
  const env = { ...process.env, GIT_AUTHOR_NAME: 'g', GIT_AUTHOR_EMAIL: 'g@g', GIT_COMMITTER_NAME: 'g', GIT_COMMITTER_EMAIL: 'g@g' };
  const git = (...a: string[]) => {
    t += 60;
    const d = `@${t} +0000`;
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  };
  const w = (p: string, s: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), s);
  };
  const commit = (subject: string, files: Record<string, string>) => {
    for (const [p, s] of Object.entries(files)) w(p, s);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', subject);
  };
  git('init', '-q', '-b', 'main');

  /* The oldest commits: these files are never touched again, so with HIST_N they leave the history window. */
  commit('init: legacy modules', {
    'legacy/old_a.py': 'def legacy_alpha():\n    return 1\n',
    'legacy/old_b.ts': 'export function legacyBeta() { return 2; }\n',
    'README.md': '# golden\n',
  });
  commit('add package manifest', {
    'package.json': JSON.stringify({ name: 'golden-app', version: '1.0.0' }, null, 2) + '\n',
  });
  commit('feat(auth): session store and token refresh', {
    'src/auth/session.ts': "import { save } from './store';\nexport class SessionStore { private s = new Map(); }\nexport function refreshToken(token) { return save(token); }\n",
    'src/auth/store.ts': 'export function save(v) { return v; }\nexport const STORE_VERSION = 1;\n',
  });
  commit('feat(ui): button and theme', {
    'src/ui/button.tsx': "import './theme.css';\nexport const Button = ({ color }) => color;\n",
    'src/ui/theme.css': '.button { color: red; }\n',
    'src/util/strings.ts': 'export const pad = (s) => s;\n',
    'src/index.ts': "import { refreshToken } from './auth/session';\nimport { pad } from 'golden-app/src/util/strings';\nimport { Button } from '@/ui/button';\nexport { refreshToken, pad, Button };\n",
  });
  /* x.ts matches both words; y.ts and z.ts one each, same token length: y's BM25F is exactly half of x's. */
  commit('feat(util): zeta helpers', {
    'src/util/x.ts': 'zeta theta\n',
    'src/util/y.ts': 'zeta kappa\n',
    'src/util/z.ts': 'theta kappa\n',
    'src/util/w.ts': "import { y } from './y';\nexport const wuser = y;\n",
  });
  commit('feat(py): config parsing', {
    'pkg/__init__.py': '',
    'pkg/core.py': 'def parse_config(text):\n    if not text:\n        raise ValueError("empty")\n    return text\n',
    'pkg/cli.py': 'from .core import parse_config\nfrom . import util\n\ndef main(path):\n    return parse_config(open(path).read())\n',
    'pkg/util.py': 'def read_file(p):\n    return open(p).read()\n',
    'tests/test_core.py': 'import pkg.core\n\ndef test_empty():\n    pass\n',
  });
  commit('feat(rust): net crate', {
    'crates/net/src/lib.rs': 'mod net;\nmod util;\npub fn start() {}\n',
    'crates/net/src/net.rs': 'use crate::util::helper;\npub fn connect() { helper(); }\n',
    'crates/net/src/util.rs': 'pub fn helper() {}\n',
  });
  /*
   * 90 generated files whose paths and contents mix the question words in
   * different amounts: every arm has more than ASK_LTR_CANDIDATES_PER_ARM hits and the
   * arms disagree, so the union's order (and each arm's cut) shows in the candidates.
   */
  const WORDS = ['token', 'refresh', 'theme', 'color', 'config', 'session', 'flag', 'format', 'net', 'util', 'button', 'parse'];
  const gen: Record<string, string> = {};
  for (let i = 0; i < 90; i++) {
    const a = WORDS[i % WORDS.length]!;
    const b = WORDS[(i * 7 + 3) % WORDS.length]!;
    const c = WORDS[(i * 5 + 1) % WORDS.length]!;
    const body = Array.from({ length: 1 + (i % 4) }, () => a).concat(Array.from({ length: 1 + ((i * 3) % 5) }, () => c), ['pad'.repeat(1 + (i % 3))]);
    gen[`src/gen/${b}_${String(i).padStart(2, '0')}.ts`] = `// ${body.join(' ')}\nexport const g${i} = ${i};\n`;
  }
  commit('chore: generated fixtures', gen);
  for (let i = 0; i < 31; i++) w(`src/mods/m${String(i).padStart(2, '0')}.ts`, `export const m${i} = ${i};\n`);
  commit('style: format all modules', {});
  /* 25 commits with one subject, each on a different file: a kNN tie at the top-20 cut. */
  for (let i = 0; i < 25; i++) commit('chore: bump deps', { [`src/mods/m${String(i).padStart(2, '0')}.ts`]: `export const m${i} = ${i + 100};\n` });
  /* A side branch merged with --no-ff: its commits are off the first-parent chain. */
  git('checkout', '-q', '-b', 'feature');
  commit('feat(flag): feature flag format', { 'src/flags/flag.ts': 'export function formatFlag(f) { return `${f}`; }\n' });
  commit('fix(flag): flag format edge case', { 'src/flags/flag.ts': 'export function formatFlag(f) { return String(f ?? ""); }\n' });
  git('checkout', '-q', 'main');
  commit('fix(auth): token refresh race on reconnect', { 'src/auth/session.ts': "import { save } from './store';\nexport class SessionStore { private s = new Map(); }\nexport function refreshToken(token) { return save(token ?? null); }\n" });
  git('merge', '-q', '--no-ff', '-m', 'Merge branch feature', 'feature');
  /* Recent activity: co-changes with the last five commits. */
  commit('fix(ui): button color', { 'src/ui/button.tsx': "import './theme.css';\nexport const Button = ({ color }) => color ?? 'blue';\n", 'src/ui/theme.css': '.button { color: blue; }\n' });
  commit('fix(auth): stale session after logout', { 'src/auth/session.ts': "import { save } from './store';\nexport class SessionStore { private s = new Map(); clear() { this.s.clear(); } }\nexport function refreshToken(token) { return save(token ?? null); }\n", 'src/auth/store.ts': 'export function save(v) { return v; }\nexport const STORE_VERSION = 2;\n' });
  commit('fix(py): empty config file', { 'pkg/core.py': 'def parse_config(text):\n    if not text or not text.strip():\n        raise ValueError("empty")\n    return text\n', 'tests/test_core.py': 'import pkg.core\n\ndef test_empty():\n    assert True\n' });
  commit('chore(ui): theme tweak', { 'src/ui/theme.css': '.button { color: navy; }\n' });
  commit('refactor(util): w re-export', { 'src/util/w.ts': "import { y } from './y';\nexport const wuser = y;\nexport default wuser;\n" });
  commit('fix(rust): net helper', { 'crates/net/src/util.rs': 'pub fn helper() { let _ = 1; }\n' });
}
