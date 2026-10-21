/**
 * The AGENT ARM of tools/bench/agent-context-bench.mjs (claims-audit 2.7, T1).
 *
 * "~3,500 tokens a question, flat" is true for Sequence's own model. This arm measures the other half: a coding
 * agent (Claude Code through the ACP bridge, as Sequence drives it) asked sealed questions in repositories of four
 * sizes, recording the INPUT tokens the agent itself reports for each turn (`turnUsage`, packages/acp). It is a
 * disclosure with no win condition. Nothing here estimates: a turn the agent reported no usage for is `null`.
 *
 * Pure parts (repo generation, questions, scoring, summary) are exported and tested; `runArm` drives a real
 * AcpClient and is exercised in CI only against the dry mock agent (synthetic usage, never a measurement).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const DEFAULT_SIZES = [25, 250, 2500, 10000];
export const QUESTIONS_PER_SIZE = 10;

/** The function name defined by file `i` of a synthetic repo: unique, and not guessable from the question. */
export const fnName = (i) => `handle_${(i * 2654435761 % 4294967296).toString(36)}`;

/**
 * A deterministic repo of `files` small modules in folders of 50. Returns its root. Real git repo (find_files and
 * agents use git), identity set per command, never the user's config.
 */
export function makeRepo(files, parent = os.tmpdir()) {
  const root = fs.mkdtempSync(path.join(parent, `agent-ctx-${files}-`));
  for (let i = 0; i < files; i++) {
    const dir = path.join(root, 'src', `area_${String(Math.floor(i / 50)).padStart(3, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `mod_${i}.js`), `// module ${i}\nexport function ${fnName(i)}(input) {\n  return { module: ${i}, input };\n}\n`);
  }
  fs.writeFileSync(path.join(root, 'README.md'), `# Synthetic repo of ${files} modules\n`);
  const git = (...a) => execFileSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', ...a], { cwd: root, stdio: 'ignore', windowsHide: true });
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'specimen');
  return root;
}

/** The sealed questions for a repo of `files`: ten files spread evenly, asked by the function they define. */
export function sealedQuestions(files, n = QUESTIONS_PER_SIZE) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = Math.min(files - 1, Math.floor(((k + 0.5) * files) / n));
    out.push({
      id: `q${String(k + 1).padStart(2, '0')}`,
      text: `Which file defines the function \`${fnName(i)}\`? Answer with its path relative to the repo root and nothing else.`,
      answer: `src/area_${String(Math.floor(i / 50)).padStart(3, '0')}/mod_${i}.js`,
    });
  }
  return out;
}

export const isCorrect = (answerText, q) => String(answerText ?? '').replace(/\\/g, '/').includes(q.answer);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Per size: how many turns reported usage, the mean/min/max input tokens over those, and how many were right. */
export function summarize(rows) {
  const bySize = new Map();
  for (const r of rows) {
    if (!bySize.has(r.files)) bySize.set(r.files, []);
    bySize.get(r.files).push(r);
  }
  return [...bySize.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([files, rs]) => {
      const inputs = rs.filter((r) => r.usage).map((r) => r.usage.input);
      const withCache = rs.filter((r) => r.usage).map((r) => r.usage.input + r.usage.cacheRead + r.usage.cacheWrite);
      return {
        files,
        questions: rs.length,
        reported: inputs.length,
        meanInput: mean(inputs),
        minInput: inputs.length ? Math.min(...inputs) : null,
        maxInput: inputs.length ? Math.max(...inputs) : null,
        meanInputIncludingCache: mean(withCache),
        correct: rs.filter((r) => r.correct).length,
        errors: rs.filter((r) => r.error).length,
      };
    });
}

/**
 * Run the arm. `launch` = { command, args, env? }. `prefix` (optional text) is put before every question, which is
 * how the lead runs the "with the map" variant. Each question is a FRESH session, so the numbers are per question
 * and do not inherit an earlier turn's context. `clientFactory(launch, cwd)` is the test seam.
 */
export async function runArm({ launch, sizes = DEFAULT_SIZES, perSize = QUESTIONS_PER_SIZE, prefix = '', acp, timeoutMs = 300_000, onRow }) {
  const rows = [];
  for (const files of sizes) {
    const root = makeRepo(files);
    try {
      for (const q of sealedQuestions(files, perSize)) {
        const client = new acp.AcpClient({ command: launch.command, args: launch.args ?? [], cwd: root, ...(launch.env ? { env: launch.env } : {}), killGraceMs: 1000 });
        const row = { files, id: q.id, question: q.text, expected: q.answer, usage: null, answer: '', correct: false, error: null };
        const t0 = Date.now();
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), timeoutMs);
          try {
            await client.start(ctl.signal);
            await client.newSession(root, ctl.signal);
            const res = await client.prompt(prefix ? `${prefix}\n\n${q.text}` : q.text, { signal: ctl.signal });
            row.answer = res.text;
            row.usage = res.usage ?? null;
            row.correct = isCorrect(res.text, q);
          } finally {
            clearTimeout(timer);
          }
        } catch (e) {
          row.error = e instanceof Error ? e.message : String(e);
        } finally {
          row.ms = Date.now() - t0;
          await client.dispose().catch(() => {});
        }
        rows.push(row);
        onRow?.(row);
      }
    } finally {
      /* Windows holds a handle on a git repo's cwd briefly after the last git call; retry the teardown. */
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
  return rows;
}
