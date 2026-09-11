/**
 * Nightly ops snapshot — mechanical facts for an on-demand chat pass.
 *
 * Report-only. Does not merge, delete remotes, or open PRs.
 * Not a cron: Max runs `pnpm nightly:health` or asks in chat.
 *
 * Usage:
 *   node tools/ci/nightly-health.mjs
 *   node tools/ci/nightly-health.mjs --json
 *   node tools/ci/nightly-health.mjs --since 36h
 *
 * Exit 0 = healthy (warnings allowed). Exit 1 = stale remotes, catalog holes,
 * or an open PR that mixes packages/site with HANDOFF/AGENTS/CLAUDE.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogDiff } from './lib/docs-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PROGRAM_STATE = new Set([
  'docs/HANDOFF-AGENT-RESTART.md',
  'AGENTS.md',
  'CLAUDE.md',
]);

const PROTECTED_HEADS = new Set(['main', 'HEAD']);

export function isProductFile(file) {
  return file.startsWith('packages/') || file.startsWith('site/');
}

export function mixLanes(files) {
  const program = files.filter((f) => PROGRAM_STATE.has(f));
  const product = files.filter(isProductFile);
  if (program.length === 0 || product.length === 0) return null;
  return { program, product };
}

/**
 * Remotes that are not `main` and not an open PR head are clutter.
 * `origin/HEAD` is ignored (it's a symref, not a branch).
 */
export function staleHeads(remoteHeads, openPrHeads) {
  const open = new Set(openPrHeads.map(normalizeHead));
  return remoteHeads
    .map(normalizeHead)
    .filter((h) => h && !PROTECTED_HEADS.has(h) && !open.has(h));
}

export function normalizeHead(ref) {
  return String(ref || '')
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '')
    .trim();
}

export function parseSince(spec, now = Date.now()) {
  const m = String(spec || '24h').match(/^(\d+)(h|d)$/);
  if (!m) throw new Error(`--since must look like 24h or 7d, got ${spec}`);
  const n = Number(m[1]);
  const ms = m[2] === 'd' ? n * 86400000 : n * 3600000;
  return new Date(now - ms);
}

/** Git hashes stamped into living research notes go stale; tip lives in HANDOFF. */
export function shaStamps(text) {
  const hits = [];
  const re = /\b[0-9a-f]{40}\b/gi;
  let m;
  while ((m = re.exec(text))) hits.push(m[0]);
  return hits;
}

export function siteLaneCollision(openPrs) {
  const site = openPrs.filter((pr) => (pr.files || []).some((f) => f.startsWith('site/')));
  if (site.length < 2) return [];
  return site.map((pr) => ({ number: pr.number, title: pr.title, head: pr.head }));
}

export function formatReport(snapshot) {
  const lines = [];
  const when = snapshot.generatedAt || new Date().toISOString();
  lines.push(`# Nightly ops — ${snapshot.repo || 'naidx0/codeforge'}`);
  lines.push('');
  lines.push(`Generated: ${when}`);
  lines.push(`Window: since ${snapshot.since || '(unknown)'}`);
  lines.push(`Status: **${snapshot.ok ? 'OK' : 'NEEDS ATTENTION'}**`);
  lines.push('');

  lines.push('## Merged in the window');
  if (!snapshot.merged?.length) {
    lines.push('_None._');
  } else {
    for (const pr of snapshot.merged) {
      lines.push(`- #${pr.number} ${pr.title} (\`${pr.head || '?'}\`)`);
    }
  }
  lines.push('');

  lines.push('## Open PRs');
  if (!snapshot.open?.length) {
    lines.push('_None. Remotes should be `main` only._');
  } else {
    for (const pr of snapshot.open) {
      const draft = pr.draft ? ' draft' : '';
      const mix = pr.mix ? ' **MIXES LANES**' : '';
      lines.push(`- #${pr.number}${draft} ${pr.title} (\`${pr.head}\`)${mix}`);
    }
  }
  lines.push('');

  lines.push('## Branch hygiene');
  const remotes = snapshot.remoteHeads || [];
  const stale = snapshot.staleHeads || [];
  lines.push(`Remote heads: ${remotes.length} (${remotes.map((h) => `\`${h}\``).join(', ') || 'none'})`);
  if (stale.length) {
    lines.push(`Stale (no open PR): ${stale.map((h) => `\`${h}\``).join(', ')}`);
  } else {
    lines.push('Stale: none. Remotes are `main` + open PR heads.');
  }
  if (snapshot.siteCollisions?.length) {
    lines.push(
      `Site-lane collision: ${snapshot.siteCollisions.map((p) => `#${p.number}`).join(', ')} — sequence, do not parallelize.`,
    );
  }
  lines.push('');

  lines.push('## Docs catalog');
  for (const row of snapshot.catalog || []) {
    if (row.ok) {
      lines.push(`- ${row.label}: indexed`);
    } else {
      if (row.missing?.length) lines.push(`- ${row.label}: **missing from index** — ${row.missing.join(', ')}`);
      if (row.extra?.length) lines.push(`- ${row.label}: **index points at missing files** — ${row.extra.join(', ')}`);
    }
  }
  if (snapshot.shaStamps?.length) {
    lines.push('Git hashes in living research notes (tip belongs in HANDOFF only):');
    for (const hit of snapshot.shaStamps) {
      lines.push(`- \`${hit.file}\``);
    }
  }
  lines.push('');

  lines.push('## Watchlist');
  if (!snapshot.findings?.length) {
    lines.push('_Everything okay._');
  } else {
    for (const f of snapshot.findings) {
      lines.push(`- **${f.level}:** ${f.message}`);
    }
  }
  lines.push('');
  lines.push('_Do not merge. Do not open a hygiene PR unless catalog/lanes are red and Max asked._');
  return lines.join('\n');
}

function git(args, opts = {}) {
  return execSync(`git ${args}`, {
    encoding: 'utf8',
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function tryGhJson(args) {
  try {
    const out = execSync(`gh ${args}`, {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function tryGhText(args) {
  try {
    return execSync(`gh ${args}`, {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    }).trim();
  } catch {
    return null;
  }
}

function listRemoteHeads() {
  const out = git('ls-remote --heads origin');
  if (!out) return [];
  const heads = [];
  for (const line of out.split('\n')) {
    const m = line.match(/\s+refs\/heads\/(\S+)$/);
    if (m) heads.push(m[1]);
  }
  return heads.sort();
}

function prFiles(number) {
  const text = tryGhText(`pr diff ${number} --name-only`);
  if (!text) return [];
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function livingResearchShaStamps() {
  const dir = path.join(ROOT, 'docs/research');
  if (!fs.existsSync(dir)) return [];
  const hits = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const file = path.join('docs/research', name);
    const stamps = shaStamps(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    if (stamps.length) hits.push({ file, count: stamps.length });
  }
  return hits;
}

export function buildFindings(snapshot) {
  const findings = [];
  if (snapshot.staleHeads?.length) {
    findings.push({
      level: 'fail',
      message: `Stale remote branches with no open PR: ${snapshot.staleHeads.join(', ')}. Delete them; remotes should be main + open heads.`,
    });
  }
  for (const row of snapshot.catalog || []) {
    if (!row.ok) {
      findings.push({
        level: 'fail',
        message: `${row.label} catalog is broken (missing=${(row.missing || []).join(', ') || '—'}, extra=${(row.extra || []).join(', ') || '—'}).`,
      });
    }
  }
  for (const pr of snapshot.open || []) {
    if (pr.mix) {
      findings.push({
        level: 'fail',
        message: `#${pr.number} mixes program-state (${pr.mix.program.join(', ')}) with product code. Land packages/site first; tip-bump HANDOFF separately.`,
      });
    }
  }
  if (snapshot.siteCollisions?.length) {
    findings.push({
      level: 'warn',
      message: `Two or more open PRs touch site/: ${snapshot.siteCollisions.map((p) => `#${p.number}`).join(', ')}. Sequence them.`,
    });
  }
  if (snapshot.shaStamps?.length) {
    findings.push({
      level: 'warn',
      message: `Living research notes stamp git hashes: ${snapshot.shaStamps.map((h) => h.file).join(', ')}. Tip lives in HANDOFF only.`,
    });
  }
  if (snapshot.gh === false) {
    findings.push({
      level: 'warn',
      message: 'gh CLI unavailable — PR lists skipped. Run where GitHub auth exists.',
    });
  }
  return findings;
}

export function collectSnapshot({ sinceSpec = '24h', now = Date.now() } = {}) {
  const since = parseSince(sinceSpec, now);
  const sinceIso = since.toISOString();
  const catalog = [
    {
      label: 'docs root',
      ...catalogDiff(path.join(ROOT, 'docs/README.md'), path.join(ROOT, 'docs')),
    },
    {
      label: 'docs/research',
      ...catalogDiff(path.join(ROOT, 'docs/research/README.md'), path.join(ROOT, 'docs/research')),
    },
  ];

  const remoteHeads = listRemoteHeads();
  const openRaw = tryGhJson(
    'pr list --state open --limit 50 --json number,title,headRefName,isDraft,updatedAt,url',
  );
  const ghOk = Array.isArray(openRaw);

  let open = [];
  let merged = [];
  if (ghOk) {
    open = openRaw.map((pr) => {
      const files = prFiles(pr.number);
      return {
        number: pr.number,
        title: pr.title,
        head: pr.headRefName,
        draft: Boolean(pr.isDraft),
        url: pr.url,
        files,
        mix: mixLanes(files),
      };
    });
    const mergedRaw =
      tryGhJson(
        `pr list --state merged --limit 50 --search "merged:>=${sinceIso.slice(0, 10)}" --json number,title,headRefName,mergedAt,url`,
      ) || [];
    merged = mergedRaw
      .filter((pr) => pr.mergedAt && new Date(pr.mergedAt) >= since)
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        head: pr.headRefName,
        mergedAt: pr.mergedAt,
        url: pr.url,
      }));
  }

  // Without GitHub, we cannot tell open heads from clutter — warn, don't fail.
  const stale = ghOk ? staleHeads(remoteHeads, open.map((pr) => pr.head)) : [];
  const siteCollisions = siteLaneCollision(open);
  const stamps = livingResearchShaStamps();
  const repo = tryGhText('repo view --json nameWithOwner -q .nameWithOwner') || 'naidx0/codeforge';

  const snapshot = {
    repo,
    generatedAt: new Date(now).toISOString(),
    since: sinceIso,
    gh: ghOk,
    remoteHeads,
    staleHeads: stale,
    open,
    merged,
    catalog,
    siteCollisions,
    shaStamps: stamps,
  };
  snapshot.findings = buildFindings(snapshot);
  snapshot.ok = !snapshot.findings.some((f) => f.level === 'fail');
  return snapshot;
}

function parseArgs(argv) {
  const opts = { json: false, since: '24h', outDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    if (argv[i] === '--since') opts.since = argv[++i];
    if (argv[i] === '--out-dir') opts.outDir = argv[++i];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const snapshot = collectSnapshot({ sinceSpec: opts.since });
  const md = formatReport(snapshot);
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (opts.outDir) {
    fs.mkdirSync(opts.outDir, { recursive: true });
    fs.writeFileSync(path.join(opts.outDir, 'report.md'), `${md}\n`);
    fs.writeFileSync(path.join(opts.outDir, 'report.json'), json);
  }
  if (opts.json) {
    process.stdout.write(json);
  } else {
    process.stdout.write(`${md}\n`);
  }
  process.exitCode = snapshot.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
