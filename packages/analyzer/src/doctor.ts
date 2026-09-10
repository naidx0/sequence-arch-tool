import fs from 'node:fs';
import path from 'node:path';
import { scanRepo } from './scan.js';
import { buildPlainTree } from './explain/explain.js';
import { validateAiConfig, type AiConfig } from './server/provider.js';
import { AI_FILE, readUserJson, userStoreDir } from './server/store.js';

/**
 * `sequence doctor` — is this install actually OPERATIONAL, end to end?
 *
 * The owner's question, verbatim: "what's the best way to also test everything
 * end-to-end, like I plug in my OpenRouter key and see if they can all connect
 * properly and work, or what's the best workflow to see if everything is
 * operational?"
 *
 * Before this, the honest answer was "open the app and click around", which is
 * exactly the manual testing they should not have to do. This command answers it
 * in one run, and — this is the part that matters — it distinguishes the two
 * things that were being confused:
 *
 *   LOCAL-FIRST (no key, no network). Scanning, services, edges, clustering,
 *   module descriptions, the plain-English tree. If any of this is wrong, an AI
 *   key will NOT fix it, because none of it calls a model.
 *
 *   AI-ASSISTED (needs a key). The product-sounding NAMES on services and
 *   modules, and the assistant. If these are the only weak part, the scan is
 *   working and what is missing is a model.
 *
 * Each check reports PASS / FAIL / SKIP with the REASON, and a skip is never
 * dressed up as a pass. The exit code is non-zero only when something that
 * should work does not — a missing optional key is a skip, not a failure.
 */

/**
 * The model config the APP would use, read from exactly the same two places the
 * server reads it: the attached repo's `.sequence/ai.json` first, then the
 * user-level `~/.sequence/ai.json`. Reading anywhere else would make `doctor`
 * report on a configuration the app does not use, which is worse than not
 * reporting at all.
 */
export function loadConfiguredModel(
  repoPath?: string,
  configDir?: string,
): AiConfig | undefined {
  if (repoPath) {
    const perRepo = path.join(path.resolve(repoPath), '.sequence', AI_FILE);
    try {
      if (fs.existsSync(perRepo)) {
        const cfg = validateAiConfig(JSON.parse(fs.readFileSync(perRepo, 'utf8'))).config;
        if (cfg) return cfg;
      }
    } catch {
      /* malformed per-repo config falls through to the user-level one */
    }
  }
  return validateAiConfig(readUserJson(configDir ?? userStoreDir(), AI_FILE)).config;
}

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface Check {
  id: string;
  /** Which half of the product this belongs to. */
  layer: 'local-first' | 'ai-assisted';
  title: string;
  status: CheckStatus;
  /** What was actually observed — a number, a name, an error. Never a promise. */
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

export interface DoctorReport {
  repo?: string;
  checks: Check[];
  ok: boolean;
}

const pass = (id: string, layer: Check['layer'], title: string, detail: string): Check => ({
  id, layer, title, status: 'pass', detail,
});
const fail = (
  id: string, layer: Check['layer'], title: string, detail: string, fix?: string,
): Check => ({ id, layer, title, status: 'fail', detail, fix });
const skip = (
  id: string, layer: Check['layer'], title: string, detail: string, fix?: string,
): Check => ({ id, layer, title, status: 'skip', detail, fix });

/**
 * Ask the configured model for one token. This is the ONLY check that spends
 * money, and it spends the least a chat completion can: it is here because
 * "the key is present" and "the key works against this host with this model"
 * are different facts, and only the second one means the assistant will answer.
 */
export async function probeModel(
  cfg: AiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  const isAnthropic = cfg.provider === 'anthropic';
  const base = cfg.baseUrl?.replace(/\/+$/, '') ?? 'https://api.anthropic.com';
  const url = isAnthropic ? `${base}/v1/messages` : `${base}/chat/completions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (isAnthropic) {
    headers['x-api-key'] = cfg.apiKey ?? '';
    headers['anthropic-version'] = '2023-06-01';
  } else if (cfg.apiKey) {
    headers.authorization = `Bearer ${cfg.apiKey}`;
  }
  const body = isAnthropic
    ? { model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }
    : { model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] };

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true, detail: `${cfg.model} answered over ${new URL(url).host}` };
    // The status code is the useful part — 401 means the key, 404 means the
    // model id, 402 means billing. Saying "failed" would hide all three.
    const text = (await res.text().catch(() => '')).slice(0, 180);
    return { ok: false, detail: `HTTP ${res.status} from ${new URL(url).host} — ${text || 'no body'}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run every check. `repoPath` is optional — with no repo the local-first scan
 * checks are skipped rather than invented, and the AI checks still run.
 *
 * `probe` is injectable so the suite can exercise the reporting without
 * spending a real request.
 */
export async function runDoctor(opts: {
  repoPath?: string;
  configDir?: string;
  probe?: (cfg: AiConfig) => Promise<{ ok: boolean; detail: string }>;
}): Promise<DoctorReport> {
  const checks: Check[] = [];
  const probe = opts.probe ?? ((cfg: AiConfig) => probeModel(cfg));

  // ── LOCAL-FIRST ─────────────────────────────────────────────────────────────
  if (!opts.repoPath) {
    checks.push(
      skip('scan', 'local-first', 'Scan a repository', 'no repo given', 'sequence doctor <repo-path>'),
    );
  } else {
    const abs = path.resolve(opts.repoPath);
    if (!fs.existsSync(abs)) {
      checks.push(fail('scan', 'local-first', 'Scan a repository', `${abs} does not exist`));
    } else {
      try {
        const graph = await scanRepo(abs);
        const services = graph.nodes.filter((n) => n.kind === 'service');
        const modules = graph.nodes.filter((n) => n.kind === 'module');
        const files = graph.nodes.filter((n) => n.kind === 'file');

        checks.push(
          services.length > 0
            ? pass('scan', 'local-first', 'Scan a repository',
                `${services.length} services · ${modules.length} modules · ${files.length} files · ${graph.edges.length} edges`)
            : fail('scan', 'local-first', 'Scan a repository',
                'the scan found no services at all',
                'check the repo has a compose file, k8s manifests, or a recognisable app root'),
        );

        // THE SWALLOW CHECK — the defect that took three rounds. A service rooted
        // at the repository itself means one card is about to contain everything.
        const swallowed = services.filter((n) => n.path === '.' || n.path === '');
        checks.push(
          swallowed.length === 0
            ? pass('scope', 'local-first', 'No service swallows the repo',
                'every service is scoped to its own directory')
            : fail('scope', 'local-first', 'No service swallows the repo',
                `${swallowed.map((n) => n.label).join(', ')} rooted at the repo itself`,
                'see the scan warnings below — they name which evidence was missing'),
        );

        // Module descriptions are DETERMINISTIC (r87). If these are missing, the
        // problem is the scan, not a missing model — the distinction the owner
        // was asking about.
        const described = modules.filter(
          (n) => typeof n.meta?.description === 'string' && n.meta.description.trim() !== '',
        );
        checks.push(
          modules.length === 0
            ? skip('descriptions', 'local-first', 'Modules describe themselves',
                'this repo produced no clustered modules')
            : described.length === modules.length
              ? pass('descriptions', 'local-first', 'Modules describe themselves',
                  `${described.length}/${modules.length} carry a counted description (no AI needed)`)
              : fail('descriptions', 'local-first', 'Modules describe themselves',
                  `${described.length}/${modules.length} carry a description`),
        );

        // The plain-English tree — the thing the rail and the board read.
        try {
          // `buildPlainTree` is async and returns { tree, mode, … } — the MODE is
          // the interesting part here, because 'structural' is precisely the
          // no-model path whose generic area names the owner was asking about.
          const result = await buildPlainTree(graph);
          const count = (function walk(n: { children?: unknown[] }): number {
            return 1 + (n.children ?? []).reduce<number>(
              (s, c) => s + walk(c as { children?: unknown[] }),
              0,
            );
          })(result.tree as unknown as { children?: unknown[] });
          checks.push(
            pass('plaintree', 'local-first', 'Plain-English tree builds',
              `${count} nodes · mode "${result.mode}"` +
                (result.mode === 'structural'
                  ? ' (structural = names come from directories, not a model)'
                  : '')),
          );
        } catch (err) {
          checks.push(
            fail('plaintree', 'local-first', 'Plain-English tree builds',
              err instanceof Error ? err.message : String(err)),
          );
        }

        if (graph.warnings.length > 0) {
          checks.push(
            skip('warnings', 'local-first', 'Scan warnings',
              graph.warnings.slice(0, 6).join(' · ') +
                (graph.warnings.length > 6 ? ` (+${graph.warnings.length - 6} more)` : '')),
          );
        }
      } catch (err) {
        checks.push(
          fail('scan', 'local-first', 'Scan a repository',
            err instanceof Error ? err.message : String(err)),
        );
      }
    }
  }

  // ── AI-ASSISTED ─────────────────────────────────────────────────────────────
  const cfg = loadConfiguredModel(opts.repoPath, opts.configDir);
  if (!cfg) {
    checks.push(
      skip('ai-config', 'ai-assisted', 'An AI model is configured',
        'no model configured — everything above still works',
        'Settings → Connect AI, or write .sequence/ai.json. For OpenRouter: ' +
          'provider "openai-compatible", baseUrl "https://openrouter.ai/api/v1", ' +
          'model e.g. "anthropic/claude-3.5-sonnet"'),
    );
    checks.push(
      skip('ai-reach', 'ai-assisted', 'The model answers', 'no model configured'),
    );
  } else {
    // Describe the config WITHOUT ever touching `apiKey` — the doctor prints to
    // a terminal that gets pasted into issues and chats, so the key must not be
    // reachable from anything on this path, redacted or not.
    const where =
      (cfg.mode ?? 'api-key') === 'default'
        ? 'the hosted free-tier gateway'
        : `${cfg.provider}${cfg.baseUrl ? ` · ${cfg.baseUrl}` : ''}`;
    checks.push(
      pass('ai-config', 'ai-assisted', 'An AI model is configured', `${where} · ${cfg.model}`),
    );
    const probed = await probe(cfg);
    checks.push(
      probed.ok
        ? pass('ai-reach', 'ai-assisted', 'The model answers', probed.detail)
        : fail('ai-reach', 'ai-assisted', 'The model answers', probed.detail,
            'a 401 is the key, a 404 is usually the model id, a 402 is billing'),
    );
  }

  // Scan-time LABELLING is a separate path from the assistant, and used to read a
  // different key entirely. Saying so is the point: an owner who plugs in an
  // OpenRouter key and sees "Backend"/"Core" unchanged deserves to know why.
  checks.push(
    cfg
      ? pass('ai-labels', 'ai-assisted', 'Scan labelling uses your configured model',
          'service and module names will use the model above when you scan with --llm')
      : skip('ai-labels', 'ai-assisted', 'Scan labelling uses your configured model',
          'with no model, names come from the repo\'s own directory structure',
          'this is why areas read "Backend"/"Frontend"/"Data" rather than product names'),
  );

  return {
    repo: opts.repoPath ? path.resolve(opts.repoPath) : undefined,
    checks,
    ok: !checks.some((c) => c.status === 'fail'),
  };
}

/** Human-readable report. Grouped by layer, because the layers mean different things. */
export function formatDoctor(report: DoctorReport): string {
  const lines: string[] = [];
  const mark = (s: CheckStatus) => (s === 'pass' ? ' ok ' : s === 'fail' ? 'FAIL' : 'skip');
  if (report.repo) lines.push(`repo: ${report.repo}`, '');

  for (const [layer, heading, note] of [
    ['local-first', 'LOCAL-FIRST — works with no key and no network',
      'If anything here fails, an AI key will not fix it.'],
    ['ai-assisted', 'AI-ASSISTED — needs a model',
      'These only change NAMES and answers. The structure above is already real.'],
  ] as const) {
    const group = report.checks.filter((c) => c.layer === layer);
    if (group.length === 0) continue;
    lines.push(heading, `  ${note}`, '');
    for (const c of group) {
      lines.push(`  [${mark(c.status)}] ${c.title}`);
      lines.push(`         ${c.detail}`);
      if (c.fix) lines.push(`         → ${c.fix}`);
    }
    lines.push('');
  }

  const failed = report.checks.filter((c) => c.status === 'fail').length;
  const skipped = report.checks.filter((c) => c.status === 'skip').length;
  lines.push(
    failed === 0
      ? `Everything that can run, ran.${skipped ? ` ${skipped} skipped (see reasons above).` : ''}`
      : `${failed} check(s) failed.`,
  );
  return lines.join('\n');
}
