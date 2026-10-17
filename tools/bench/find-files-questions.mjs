#!/usr/bin/env node
/* find_files sealed-set question builder. Same selection rules as the frozen
 * harness-study ftf3 / pick.py: the questions are the subjects of the first-parent
 * commits after S (oldest first), truth = the files the commit modified (status M,
 * existing at S, source files, 1-8 of them). Reads git only; runs no picker.
 *   node find-files-questions.mjs --repo DIR --idx 300 --back 300 --out q.json */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const REPO = path.resolve(arg('--repo', '.')); const IDX = Number(arg('--idx', 300)); const BACK = Number(arg('--back', 300)); const OUT = arg('--out');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const CODE = /\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|dart|c|cc|cpp|h|hpp|vue|svelte|css|html|sh|ps1|toml|ya?ml|json)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|out|\.git|vendor|lab|runs|logs|tmp)\//;
const isSource = (p) => CODE.test(p) && !SKIP.test(p) && !/lock\.(json|ya?ml)$|-lock\.json$/.test(p);
const NOISE = /^(log|handoff|merge|wip|lab)\b|^merge /i;
const chain = git('rev-list', '--first-parent', 'HEAD').split('\n');
const S = chain[IDX];
const after = chain.slice(Math.max(0, IDX - BACK), IDX).reverse();
const atS = new Set(git('ls-tree', '-r', '--name-only', S).split('\n').filter(isSource));
const queries = [];
for (const c of after) {
  const subject = git('log', '-1', '--format=%s', c);
  if (NOISE.test(subject)) continue;
  const date = Number(git('log', '-1', '--format=%ct', c));
  const changed = git('diff-tree', '--no-commit-id', '--name-status', '-r', c).split('\n').filter(Boolean)
    .map((l) => l.split('\t')).filter(([st, p]) => st === 'M' && atS.has(p)).map(([, p]) => p);
  if (changed.length < 1 || changed.length > 8) continue;
  queries.push({ commit: c.slice(0, 8), date, subject, truth: changed });
}
const body = JSON.stringify({ repo: path.basename(REPO), S, queries });
const qsha = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
fs.writeFileSync(OUT, body);
console.log(`${path.basename(REPO)} S=${S.slice(0, 8)} questions=${queries.length} qsha=${qsha}`);
