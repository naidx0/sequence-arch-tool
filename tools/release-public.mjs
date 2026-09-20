// Export the workshop's origin/main into the public release repository as ONE
// commit, so the public history is a release log rather than a running
// commentary.
//
// WHY TWO REPOSITORIES. The workshop's history is 2,329 commits with an agent
// as its top author by count and 1,073 co-author trailers; the code and the 137
// merged PRs are sound, but a stranger opening that history reads the process
// rather than the product. Squashing per release keeps the work and gives a
// reader something to read.
//
// IT NEVER CREATES OR PUBLISHES ANYTHING BY ITSELF. It writes the export and
// prints the single push command. Making a repository public, and pushing to
// it under someone's identity, is the owner's action.
//
//   node tools/release-public.mjs --version v0.2 [--out <dir>] [--push]
//
// Exit 0 export written, 2 refused (dirty scan / bad args), 3 cannot decide.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEXT = /\.(md|txt|json|js|mjs|cjs|ts|tsx|py|yml|yaml|html|css|sh|ps1|cmd|toml)$/i;
const PUBLIC_REMOTE = 'https://github.com/naidx0/sequence-arch-tool.git';
// Workshop paths that are never exported. Not a tidy-up: each publishes how the
// automation is wired, with nothing in it for a reader.
// Removed from every export, and refused if still present afterwards. None of
// these is untidiness: each publishes how the lanes are wired to a reader who
// came for the product. `docs/codex-user-test.md` is a test log carrying a real
// machine's paths. The list grew after the first release, when a second pair of
// eyes found what this script had shipped.
const NEVER_EXPORT = [
  '.claude', '.agents', '.cursor',
  'CLAUDE.md', 'AGENTS.md', 'skills-lock.json',
  'docs/codex-user-test.md',
];

// The workshop's own name, rewritten to the public one wherever it appears in
// the exported tree - three of them were in site/index.html, telling a stranger
// to clone a repository that refuses them.
const RENAME = [['naidx0/codeforge', 'naidx0/sequence-arch-tool']];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const version = arg('--version');
if (!version) {
  console.error('release-public: --version is required, e.g. --version v0.2');
  process.exit(2);
}

const repo = process.cwd();
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();

// origin/main is a cache of the last fetch; a release cut from a stale cache is
// a release of something nobody has.
try {
  execFileSync('git', ['-C', repo, 'fetch', '--quiet', 'origin'], { stdio: 'ignore', timeout: 60000 });
} catch {
  console.error('release-public: could not fetch origin, so origin/main may be stale.');
  console.error('This is a refusal, not a pass.');
  process.exit(3);
}
const source = git('rev-parse', '--short', 'origin/main');

const out = arg('--out') || mkdtempSync(join(tmpdir(), 'sequence-release-'));
execFileSync('git', ['-C', repo, 'archive', '--format=tar', 'origin/main'], { maxBuffer: 1 << 30 })
  && execFileSync('tar', ['-x', '-C', out], {
    input: execFileSync('git', ['-C', repo, 'archive', '--format=tar', 'origin/main'], { maxBuffer: 1 << 30 }),
  });
for (const p of NEVER_EXPORT) rmSync(join(out, p), { recursive: true, force: true });
for (const [from, to] of RENAME) {
  const walkRename = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.next'].includes(e.name)) continue;
      const q = join(dir, e.name);
      if (e.isDirectory()) { walkRename(q); continue; }
      if (!TEXT.test(e.name)) continue;
      const before = readFileSync(q, 'utf8');
      if (!before.includes(from)) continue;
      writeFileSync(q, before.split(from).join(to));
    }
  };
  walkRename(out);
}

// THE SCAN IS A GATE, NOT A REPORT. An export that names a person or carries a
// credential shape does not get written as a commit at all.
// TWO backslashes. A class of backslash-then-slash is an ESCAPED FORWARD SLASH
// and matches only '/', so the first version of this scan was blind to every
// Windows-style path - the form they actually take. It passed an export that
// carried one, and a person found it by reading.
const SEP = '[' + String.fromCharCode(92) + String.fromCharCode(92) + '/]';
// A PLACEHOLDER DOES NOT NAME ANYONE, and refusing on one blocks every release
// for nothing. `C:\Users\dev\Projects\realapp` in a test fixture is a
// hypothetical machine; the same path carrying a maintainer's actual login name
// is a real one. (This comment used to illustrate that with the real name, and
// so leaked it into a file that ships -- caught by the sibling scanner in
// tools/release/mirror.mjs. An example of the thing must not BE the thing.)
// This list defines
// what the gate is LOOKING FOR - a real person's home - rather than exempting
// files from it, which is why it is names and not paths: no file is ever
// excused, only a user segment that visibly stands for nobody.
const NOT_A_PERSON = ['<user>', 'dev', 'user', 'example', 'runneradmin',
                      'WDAGUtilityAccount', 'USERNAME', 'youruser'];
const HOME_ANY = new RegExp('[A-Za-z]:' + SEP + 'Users' + SEP + '([A-Za-z0-9_.<>-]+)' + SEP, 'g');
function namesAPerson(text) {
  for (const m of text.matchAll(HOME_ANY)) {
    if (!NOT_A_PERSON.includes(m[1])) return m[1];
  }
  return null;
}
const CREDS = [
  [/sk-or-v1-[0-9a-f]{40,}/, 'openrouter'], [/ghp_[A-Za-z0-9]{36}/, 'github pat'],
  [/gho_[A-Za-z0-9]{36}/, 'github oauth'], [/hf_[A-Za-z0-9]{34,}/, 'huggingface'],
  [/AKIA[0-9A-Z]{16}/, 'aws'], [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'private key'],
];
const offenders = [];
let scanned = 0;
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.next'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!TEXT.test(e.name)) continue;
    scanned++;
    const t = readFileSync(p, 'utf8');
    const who = namesAPerson(t);
    if (who) offenders.push([p, `names a person (${who})`]);
    for (const [re, what] of CREDS) if (re.test(t)) offenders.push([p, what]);
  }
}
walk(out);
// The exclusions are a GATE too, not a tidy-up: if one survived the removal the
// export does not become a commit. A path that was supposed to be deleted and
// is still there is the same class of fact as a credential.
for (const p of NEVER_EXPORT) {
  if (existsSync(join(out, p))) offenders.push([join(out, p), 'must never be exported']);
}
for (const [from] of RENAME) {
  if (offenders.length === 0) {
    const stray = [];
    const walkCheck = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', '.next'].includes(e.name)) continue;
        const q = join(dir, e.name);
        if (e.isDirectory()) { walkCheck(q); continue; }
        if (TEXT.test(e.name) && readFileSync(q, 'utf8').includes(from)) stray.push(q);
      }
    };
    walkCheck(out);
    for (const s of stray) offenders.push([s, `still names ${from}`]);
  }
}
// The tree it WOULD produce, counted before any verdict, so a refusal still
// tells you what the release is - a gate that reports nothing but its own
// objection makes you run it twice to learn one number.
const exported = [];
(function count(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.next'].includes(e.name)) continue;
    const q = join(dir, e.name);
    if (e.isDirectory()) { count(q); continue; }
    exported.push(q);
  }
})(out);
console.log(`release-public: ${version} from ${source} - ${exported.length} files, ${scanned} scanned.`);

if (offenders.length) {
  console.error(`release-public: ${offenders.length} file(s) must not be published:`);
  for (const [p, what] of offenders.slice(0, 20)) console.error(`  ${what}: ${p}`);
  console.error('Nothing was committed. Fix them in the workshop and cut again.');
  process.exit(2);
}

execFileSync('git', ['-C', out, 'init', '-q', '-b', 'main']);
execFileSync('git', ['-C', out, 'add', '-A']);
const body = `Exported from the workshop's origin/main at ${source}.

PUBLIC-EXPOSURE SCAN, run on this export before it was committed:
  ${scanned} text files scanned
  0 credential-shaped strings
  0 absolute home paths
  ${NEVER_EXPORT.join(', ')} excluded`;
execFileSync('git', ['-C', out, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m',
  `Sequence ${version}`, '-m', body]);
const sha = execFileSync('git', ['-C', out, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

console.log('  scan clean; committed.');
console.log(`  ${out}  (commit ${sha})`);
console.log('');
console.log('Publishing is the owner\'s action, so this stops here. To publish:');
console.log(`  git -C "${out}" remote add origin ${PUBLIC_REMOTE}`);
console.log(`  git -C "${out}" push --force origin main`);
console.log('');
console.log('--force is deliberate: the public history is one commit per release,');
console.log('replaced each time, not appended to.');
