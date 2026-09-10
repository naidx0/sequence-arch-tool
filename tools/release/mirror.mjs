#!/usr/bin/env node
/**
 * BUILD THE PUBLIC MIRROR — one squashed commit, no working history, no private
 * material, and a refusal rather than a leak.
 *
 *   node tools/release/mirror.mjs            # dry run into tools/release/out
 *   node tools/release/mirror.mjs --push     # push to the `public` remote
 *
 * The working repository is not the thing to share. It carries the night's
 * research notes, the owner's plans, agent instructions, judge runs, and enough
 * absolute paths to name a person's machine. This builds a separate tree from
 * `main`, checks it, and commits it once — so what goes out is a decision rather
 * than a leftover.
 *
 * ── DOCS ARE DENY-BY-DEFAULT, AND THAT IS THE POINT ───────────────────────
 *
 * Code is copied unless excluded. **`docs/` is the other way round: nothing
 * ships unless it is named in DOC_ALLOW.** An exclusion list only protects you
 * from the private files you thought of; a doc tree that grows a new
 * `OWNER-PLAN-...` next week would ship it by default, and the failure would be
 * silent and permanent. Deny-by-default means a new internal note is invisible
 * to the mirror until somebody decides otherwise, and the cost is the reverse
 * mistake — a public doc missing for one release — which is fixable.
 *
 * ── WHAT THE REFUSAL GREP IS, AND WHAT IT DELIBERATELY IS NOT ─────────────
 *
 * It refuses on personal identifiers and on VAULT PATHS. It does NOT refuse on
 * the bare word "Obsidian": in this repository that word appears as
 * *"an Obsidian-style file/functions rail"* — a UI comparison that `docs/CANON.md`
 * uses to describe the product itself. Refusing on it would block the release on
 * a public design analogy while doing nothing about privacy. What is private is
 * a home directory, a note-vault path, a machine path — so those are the patterns,
 * plus "Obsidian" when it sits next to "vault".
 *
 * The check runs over the STAGED TREE, after copying, not over the source. A
 * check that runs on the input tells you what you excluded; a check that runs on
 * the output tells you what you are about to publish.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { decide, stripAgentsSections } from './policy.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const STAGE = path.join(OUT, 'tree');
const BARE = path.join(OUT, 'mirror.git');
const PUSH = process.argv.includes('--push');

const git = (args, cwd = REPO, quiet = false) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    /* `git describe` with no tags prints a line beginning "fatal:" to stderr even
       though the caller catches the throw and handles the no-tag case. A release
       tool that prints that word during a healthy run teaches its reader to
       ignore the word, so the expected case is silenced and only the unexpected
       ones speak. */
    ...(quiet ? { stdio: ['ignore', 'pipe', 'ignore'] } : {}),
  }).trim();

/* What ships is decided in policy.mjs, on its own, so it can be tested. */

/**
 * THE PERSONAL IDENTIFIERS, loaded rather than hardcoded.
 *
 * They used to be literals in this file, and this file then failed its own scan:
 * a scanner that names the usernames it hunts for cannot be published, so either
 * the release tool stays private -- and the README's claim that the mirror is
 * built by it becomes uncheckable -- or the names move out. A denylist of a
 * person's usernames and vault directories IS the private data it protects.
 *
 * `identifiers.json` is excluded from the mirror. Everything else in FORBIDDEN
 * is SHAPE -- a home directory, a key-shaped token -- and names nobody, so it
 * ships with the tool and a reader can see what the check actually does.
 */
function loadIdentifiers() {
  const file = path.join(HERE, 'identifiers.json');
  if (!fs.existsSync(file)) {
    /* Loud, because running fewer checks than you think you are running is the
       failure this whole script exists to prevent. */
    console.error(`WARNING: no ${path.basename(file)} — identifier checks are NOT active, only shape checks.`);
    return [];
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  /* `has`, not `re`: these are plain words, and building a regex from them means
     escaping user-supplied text, which is a bug waiting to happen for no gain. A
     case-insensitive substring is exactly the check intended. */
  return [
    ...(cfg.identifiers ?? []).map((t) => ({ has: t.toLowerCase(), label: 'a personal identifier' })),
    ...(cfg.paths ?? []).map((t) => ({ has: t.toLowerCase(), label: 'a private directory path' })),
  ];
}

const FORBIDDEN = [
  ...loadIdentifiers(),
  /*
   * A REAL home directory, not an illustrative one. The first version refused on
   * any `C:\Users\<name>` and fired on `C:\Users\First Last` in a comment about
   * Windows paths containing spaces, and on the literal elision `C:\Users\...`
   * in a rail-width test. A check that cries wolf on documentation gets widened
   * until it stops working, so the placeholders are named.
   */
  {
    re: /C:\\Users\\(?!dev\b|alex\b|you\b|user\b|username\b|First\b|test\b|example\b|\.\.\.)[A-Za-z0-9_.-]+/i,
    label: 'a real Windows home directory',
  },
  {
    re: /\/Users\/(?!dev\b|alex\b|you\b|user\b|example\b)[A-Za-z0-9_.-]+\/(Documents|Projects)/i,
    label: 'a real macOS home directory',
  },
  /* The label deliberately does NOT repeat the phrase it matches: this file is
     itself scanned, and a rule that spells out its own trigger fails its own
     check — which is how the identifier list ended up in identifiers.json. */
  { re: /obsidian[\s-]*vault|vault[\s-]*obsidian/i, label: 'a personal note vault' },
  /*
   * KEY MATERIAL, not the WORD "key". Refusing on `openrouter-key` fired on
   * `~/.sequence/openrouter-key` — the product's own documented config path,
   * named in a security comment about the leak it prevents — and on thirty test
   * files whose fixtures are deliberately fake keys (`sk-ant-test-SUPERSECRET`)
   * asserting that a key does NOT reach the model. Publishing those is the
   * opposite of a leak. So the pattern is length: a real token is long, and the
   * longest fake in this tree is 27 characters after its prefix.
   */
  { re: /\b(sk|ghp|gho|github_pat|xox[baprs])-[A-Za-z0-9_-]*[A-Za-z0-9]{20,}/, label: 'something shaped like a live API token' },
];

/* ── build ────────────────────────────────────────────────────────────────── */

const files = git(['ls-files']).split('\n').filter(Boolean);
const kept = [];
const dropped = [];
for (const f of files) {
  const d = decide(f);
  (d.keep ? kept : dropped).push(d.keep ? f : { file: f, why: d.why });
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
let bytes = 0;
for (const f of kept) {
  const src = path.join(REPO, f);
  const dst = path.join(STAGE, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (f === 'AGENTS.md') {
    fs.writeFileSync(dst, stripAgentsSections(fs.readFileSync(src, 'utf8')));
  } else {
    fs.copyFileSync(src, dst);
  }
  bytes += fs.statSync(dst).size;
}

/* README swap: the public tree carries the public README. */
const publicReadme = path.join(REPO, 'docs/PUBLIC-README.md');
let readmeSwapped = false;
if (fs.existsSync(publicReadme)) {
  fs.copyFileSync(publicReadme, path.join(STAGE, 'README.md'));
  fs.rmSync(path.join(STAGE, 'docs/PUBLIC-README.md'), { force: true });
  readmeSwapped = true;
}

/* ── the refusal ──────────────────────────────────────────────────────────── */

/** Text files only: a .png whose compressed bytes happen to spell an identifier is noise. */
const TEXT = /\.(m?[jt]sx?|json|md|ya?ml|txt|css|html|sh|ps1|cmd|toml|py|tsv|svg)$/i;
const hits = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
      continue;
    }
    if (!TEXT.test(e.name)) continue;
    const rel = path.relative(STAGE, p).split(path.sep).join('/');
    const text = fs.readFileSync(p, 'utf8');
    const lower = text.toLowerCase();
    for (const { re, has, label } of FORBIDDEN) {
      if (has !== undefined) {
        const at = lower.indexOf(has);
        if (at >= 0) hits.push({ file: rel, label, sample: text.slice(at, at + 40) });
        continue;
      }
      const m = re.exec(text);
      if (m) hits.push({ file: rel, label, sample: m[0].slice(0, 60) });
    }

    /*
     * A CLONE URL THE MIRROR'S READER CANNOT OPEN.
     *
     * `DOC_ALLOW` decides which FILES ship; it cannot decide what is inside one.
     * The build guide is meant to be public and its first instruction named the
     * private working repository — so a reader reached step one and stopped. A
     * path allow-list cannot catch a URL, and this is the content rule that can.
     *
     * NARROW ON PURPOSE: only `git clone` of a concrete github URL. The staged
     * tree carries github links in 26 files — dependencies, references,
     * documentation — and refusing those would be a check that gets widened
     * until it stops working, which is the failure written into the home
     * directory rule above.
     *
     * The permitted URL is the mirror's OWN destination, read from the `public`
     * remote. With none configured the mirror does not know where it is going,
     * so it cannot verify any clone URL and refuses them all — that is the
     * honest reading, and it is the state this fault was found in.
     */
    for (const m of text.matchAll(/git clone\s+(?:--\S+\s+)*(https?:\/\/github\.com\/\S+)/gi)) {
      const target = m[1].replace(/[.,)]+$/, '');
      /*
       * IT IS A SELF-REFERENCE THAT IS THE FAULT, NOT AN UNVERIFIABLE URL.
       *
       * The first version of this rule refused any concrete github clone URL the
       * mirror could not verify against a configured destination, and it fired
       * immediately on `tools/bench/claw/README.md` cloning a third-party public
       * benchmark — a URL a reader can follow perfectly well. That is the
       * over-broad shape the home directory rule above was written to avoid, and
       * I wrote it anyway while quoting that comment.
       *
       * The fault is narrow: a clone URL naming THIS repository, which is
       * private, published to readers who cannot open it. `origin` says which
       * that is at run time, so nothing here spells an owner or a repo name —
       * this file is itself scanned, and a rule that names its own trigger fails
       * its own check.
       *
       * A self-reference is fine when it names the mirror's OWN destination,
       * because that is a door the reader is standing at.
       */
      if (!sameRepo(target, WORKING_REPO)) continue;
      if (MIRROR_DESTINATION !== null && sameRepo(target, MIRROR_DESTINATION)) continue;
      hits.push({
        file: rel,
        label: 'a clone URL naming the private working repository, not this mirror',
        sample: target.slice(0, 60),
      });
    }
  }
};

/**
 * Where this mirror is published, or null when nothing says.
 *
 * Read rather than assumed: `--push` already resolves the `public` remote, and
 * a guide's clone URL is only checkable against a destination somebody has
 * actually configured.
 */
/** The private working repository this mirror is made FROM. Read, never spelled. */
const WORKING_REPO = (() => {
  try {
    return git(['remote', 'get-url', 'origin'], REPO, true).trim() || null;
  } catch {
    return null;
  }
})();

const MIRROR_DESTINATION = (() => {
  try {
    const remotes = git(['remote'], REPO, true)
      .split(/\r?\n/)
      .map((r) => r.trim());
    if (!remotes.includes('public')) return null;
    return git(['remote', 'get-url', 'public'], REPO, true).trim() || null;
  } catch {
    return null;
  }
})();

/** owner/repo equality, ignoring scheme, `.git`, and a trailing slash. */
const sameRepo = (a, b) => {
  const key = (u) =>
    String(u)
      .replace(/^git@github\.com:/i, 'https://github.com/')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
      .split('github.com/')[1] ?? null;
  const ka = key(a);
  return ka !== null && ka === key(b);
};

walk(STAGE);

console.log(`tracked files       ${files.length}`);
console.log(`  shipped           ${kept.length}`);
console.log(`  excluded          ${dropped.length}`);
console.log(`tree size           ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`README swapped      ${readmeSwapped}`);

const byReason = dropped.reduce((a, d) => ({ ...a, [d.why]: (a[d.why] ?? 0) + 1 }), {});
console.log('\nexcluded by reason:');
for (const [why, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${why}`);
}

console.log('\nrefusal grep over the STAGED tree:');
if (hits.length > 0) {
  for (const h of hits.slice(0, 40)) console.log(`  ${h.file} — ${h.label}: ${JSON.stringify(h.sample)}`);
  if (hits.length > 40) console.log(`  ... and ${hits.length - 40} more`);
  console.error(`\nREFUSED: ${hits.length} private reference(s) would have been published.`);
  process.exitCode = 2;
} else {
  console.log('  clean — 0 hits across ' + FORBIDDEN.length + ' patterns');

  /* ── the squashed commit ───────────────────────────────────────────────── */

  const head = git(['rev-parse', 'HEAD']);
  const headShort = git(['rev-parse', '--short', 'HEAD']);
  const date = git(['log', '-1', '--format=%cI', head]).slice(0, 10);
  let range = null;
  try {
    range = `${git(['describe', '--tags', '--abbrev=0', '--match', 'v*'], REPO, true)}..HEAD`;
  } catch {
    /* No release tag yet: the changelog is the whole history, which is the
       honest thing for a first release rather than an empty list. */
  }
  const subjects = git(['log', ...(range ? [range] : []), '--format=%s']).split('\n').filter(Boolean);

  /*
   * ── HOW THE CHANGELOG IS CUT, AND WHY THE FIRST RELEASE IS DIFFERENT ────
   *
   * Grouping by a `word:` subject prefix is the usual move and it does nothing
   * here: this repository writes subjects as sentences, so the first version put
   * 1,528 of 2,133 commits into one bucket called "changes" and produced a
   * 2,420-line file that nobody can read. A changelog that lists everything is
   * the same as no changelog.
   *
   * So: a tagged release lists everything since the tag, grouped where the
   * prefixes exist. The FIRST release does not — 2,133 commits of private
   * development history is not a public changelog — and lists the most recent
   * RECENT_CAP with the remainder STATED. Silent truncation would read as "this
   * is all of it", which is the one thing a release note must never imply.
   */
  const RECENT_CAP = 60;
  const first = subjects.slice(0, RECENT_CAP);
  const oldestDate = git(['log', '--reverse', '--format=%cI']).split('\n')[0].slice(0, 10);

  let body;
  if (range) {
    const groups = new Map();
    for (const s of subjects) {
      const m = /^([a-z0-9-]+):\s*(.*)$/i.exec(s);
      const key = m ? m[1].toLowerCase() : 'changes';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m ? m[2] : s);
    }
    body = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, v]) => `### ${k} (${v.length})\n` + v.map((s) => `- ${s}`).join('\n'))
      .join('\n\n');
  } else {
    body =
      `### the most recent ${first.length} changes\n` +
      first.map((s) => `- ${s}`).join('\n') +
      `\n\n### and ${subjects.length - first.length} earlier commits, not listed\n\n` +
      `Development ran from ${oldestDate} to ${date}. This mirror carries no development\n` +
      `history by design — it is one squashed commit per release — so the ${subjects.length - first.length} commits\n` +
      `before the list above are summarised by this line rather than reproduced.\n`;
  }

  const changelog =
    `## ${date}\n\nBuilt from \`${headShort}\`` +
    (range ? ` (since ${range.split('..')[0]})` : ' — first public release') +
    `, ${subjects.length} commits.\n\n` +
    body +
    '\n';
  fs.writeFileSync(path.join(STAGE, 'CHANGELOG.md'), changelog);
  const changelogLines = changelog.trim().split(String.fromCharCode(10)).length;

  const message =
    `Sequence ${date}\n\n` +
    `Squashed public release built from ${headShort} on ${date}.\n` +
    `${kept.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB, ${subjects.length} upstream commits.\n\n` +
    `This mirror carries no development history by design: it is rebuilt as one\n` +
    `commit per release by tools/release/mirror.mjs, which refuses to build if any\n` +
    `private path or identifier survives into the tree.\n`;

  fs.rmSync(path.join(STAGE, '.git'), { recursive: true, force: true });
  git(['init', '-q', '-b', 'main'], STAGE);
  git(['add', '-A'], STAGE);
  git(['-c', 'user.name=Sequence Release', '-c', 'user.email=release@localhost', 'commit', '-q', '-m', message], STAGE);
  const mirrorSha = git(['rev-parse', '--short', 'HEAD'], STAGE);

  let target = null;
  if (PUSH) {
    const remotes = git(['remote']).split('\n');
    if (!remotes.includes('public')) {
      console.error('\nno remote named `public` is configured — nothing was pushed.');
      process.exitCode = 3;
    } else {
      target = git(['remote', 'get-url', 'public']);
      git(['push', '--force', target, 'main'], STAGE);
    }
  } else {
    /* The dry run pushes into a local bare repository, so the push path itself
       is exercised rather than assumed. */
    if (!fs.existsSync(BARE)) git(['init', '--bare', '-q', '-b', 'main', BARE]);
    git(['push', '--force', '-q', BARE, 'main'], STAGE);
    target = BARE;
  }

  console.log(`
changelog           ${subjects.length} commits, ${changelogLines} lines`);
  console.log(`release commit      ${mirrorSha}  "Sequence ${date}"  from ${headShort}`);
  console.log(`pushed to           ${target ?? '(nothing)'}`);
  if (!PUSH) console.log('\nDRY RUN — local bare repository only. Nothing left this machine.');
}
