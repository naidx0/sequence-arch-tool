/**
 * A2.1 — scripted design-draw baseline harness.
 *
 * Runs N canned (or optional live) design-draw asks across blank-design and
 * shopfront workspaces, collecting askMetrics + board-open signals.
 *
 * HONESTY: canned-provider wallMs is NOT M1 dogfood. Live keys only fill M1.
 * This harness always measures M2 (rounds) and M4 proxy (topology/canvas events).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import {
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
} from '../server/askPipeline.js';
import { resolveInRepo } from '../server/jail.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

/** Default scripted count from mega-plan A2.1. */
export const DESIGN_DRAW_BASELINE_N = 20;

export interface CannedProviderRound {
  text: string;
  usage?: { inputTokens: number; outputTokens: number; estimated: boolean };
  toolRequests?: ReadonlyArray<{
    id: string;
    name: string;
    args?: Record<string, unknown>;
    evidence?: string;
  }>;
}

export type DesignDrawWorkspace = 'blank-design' | 'shopfront';

export interface DesignDrawScenario {
  id: string;
  workspace: DesignDrawWorkspace;
  question: string;
  /** When absent, a one-round successful propose_topology script is used. */
  script?: CannedProviderRound[];
}

export interface DesignDrawRow {
  id: string;
  workspace: DesignDrawWorkspace;
  question: string;
  wallMs?: number;
  rounds?: number;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
  designMode: boolean;
  intent?: string;
  /** True when topology:proposal or canvas:block fired (M4 proxy). */
  boardOpened: boolean;
  providerCalls: number;
  providerKind: 'canned' | 'live';
}

export interface DesignDrawBaselineReport {
  version: 1;
  measuredAt: string;
  tipSha?: string;
  n: number;
  providerKind: 'canned' | 'live';
  rows: DesignDrawRow[];
  summary: {
    wallMs: { min: number; max: number; mean: number; p50: number; p95: number } | null;
    rounds: {
      mean: number;
      max: number;
      le2Count: number;
      le2Rate: number;
    };
    /** M4 proxy — draw rows that emitted topology/canvas. */
    boardOpenRate: number;
    boardOpenCount: number;
  };
  /** Binding reminder — do not invent scorecard greens from canned wallMs. */
  honestyNote: string;
}

const TOPO_NODE = { id: 'proposal:svc-a', label: 'Service A', kind: 'service' };
const TOPO_EDGE = {
  id: 'proposal:e1',
  from: 'proposal:svc-a',
  to: 'proposal:svc-b',
  family: 'http' as const,
};
const TOPO_NODE_B = { id: 'proposal:svc-b', label: 'Service B', kind: 'service' };

function defaultTopoScript(id: string): CannedProviderRound[] {
  return [
    {
      text: 'Here is the diagram.',
      usage: { inputTokens: 400, outputTokens: 80, estimated: true },
      toolRequests: [
        {
          id: `topo-${id}`,
          name: 'propose_topology',
          args: {
            title: `Draw ${id}`,
            nodes: [TOPO_NODE, TOPO_NODE_B],
            edges: [TOPO_EDGE],
          },
        },
      ],
    },
  ];
}

function twoRoundTopoScript(id: string): CannedProviderRound[] {
  return [
    {
      text: 'reading first',
      usage: { inputTokens: 300, outputTokens: 40, estimated: true },
      toolRequests: [
        {
          id: `read-${id}`,
          name: 'read_file',
          args: { path: 'docker-compose.yml' },
        },
      ],
    },
    {
      text: 'Board updated.',
      usage: { inputTokens: 500, outputTokens: 90, estimated: true },
      toolRequests: [
        {
          id: `topo-${id}`,
          name: 'propose_topology',
          args: {
            title: `Draw ${id}`,
            nodes: [TOPO_NODE, TOPO_NODE_B],
            edges: [TOPO_EDGE],
          },
        },
      ],
    },
  ];
}

/** Build the fixed A2.1 scenario list (10 blank + 10 shopfront). */
export function buildDesignDrawScenarios(n = DESIGN_DRAW_BASELINE_N): DesignDrawScenario[] {
  const half = Math.floor(n / 2);
  const scenarios: DesignDrawScenario[] = [];
  const blankQs = [
    'Draw me a travel insurer architecture on the board',
    'Draw a checkout flow on the board',
    'Sketch a payments + ledger topology',
    'Draw an auth gateway with two backends',
    'Draw a simple CRUD API map on the board',
    'Draw inventory → shipping → notify',
    'Draw a design for a multi-tenant SaaS on the board',
    'Draw Architecture: edge, api, db only',
    'Draw a CQRS read/write split',
    'Draw an event bus between orders and invoices on the board',
  ];
  const shopQs = [
    'Draw the shopfront gateway and orders path on the board',
    'Draw Architecture for orders → payments on the board',
    'Sketch shopfront services on the board',
    'Draw how gateway routes to orders',
    'Draw inventory and shipping on the Architecture board',
    'Draw notifications from orders on the board',
    'Draw postgres edges from orders',
    'Diagram the shopfront compose topology on the board',
    'Draw a map of edge + gateway on the board',
    'Draw invoices calling payments on the board',
  ];
  for (let i = 0; i < half; i++) {
    const id = `blank-${i + 1}`;
    scenarios.push({
      id,
      workspace: 'blank-design',
      question: blankQs[i % blankQs.length]!,
      script: i % 5 === 4 ? twoRoundTopoScript(id) : defaultTopoScript(id),
    });
  }
  for (let i = 0; i < n - half; i++) {
    const id = `shop-${i + 1}`;
    scenarios.push({
      id,
      workspace: 'shopfront',
      question: shopQs[i % shopQs.length]!,
      script: i % 5 === 4 ? twoRoundTopoScript(id) : defaultTopoScript(id),
    });
  }
  return scenarios;
}

function makeProviderScript(scripts: CannedProviderRound[]): {
  calls: string[];
  callProvider: AskPipelineInput['callProvider'];
} {
  const calls: string[] = [];
  let i = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    calls.push(prompt);
    const canned = scripts[Math.min(i, scripts.length - 1)]!;
    i += 1;
    return {
      text: canned.text,
      ...(canned.usage ? { usage: canned.usage } : {}),
      ...(canned.toolRequests ? { toolRequests: canned.toolRequests } : {}),
    };
  };
  return { calls, callProvider };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function copyShopfront(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-design-draw-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return repo;
}

function boardOpenedFromEvents(events: AskStreamEvent[]): boolean {
  return events.some((e) => e.type === 'topology:proposal' || e.type === 'canvas:block');
}

export interface RunDesignDrawBaselineOpts {
  n?: number;
  scenarios?: DesignDrawScenario[];
  /** Reserved for live provider wiring; canned is the default path. */
  providerKind?: 'canned' | 'live';
  tipSha?: string;
}

/**
 * Run the A2.1 baseline. Always uses an in-process canned provider unless
 * `providerKind: 'live'` is requested (then still falls back to canned until
 * a live caller is wired — never invents live wallMs).
 */
export async function runDesignDrawBaseline(
  opts: RunDesignDrawBaselineOpts = {},
): Promise<DesignDrawBaselineReport> {
  /* Live provider path is reserved; this harness ships canned-only (honest M2/M4). */
  const providerKind: 'canned' | 'live' = 'canned';
  void opts.providerKind;
  const scenarios = opts.scenarios ?? buildDesignDrawScenarios(opts.n ?? DESIGN_DRAW_BASELINE_N);

  let shopRoot: string | null = null;
  let shopGraph: Awaited<ReturnType<typeof scanRepo>> | null = null;
  let shopDigest: ReturnType<typeof buildDigest> | undefined;

  const rows: DesignDrawRow[] = [];

  for (const sc of scenarios) {
    const script = sc.script ?? defaultTopoScript(sc.id);
    const { calls, callProvider } = makeProviderScript(script);

    let input: AskPipelineInput;
    if (sc.workspace === 'blank-design') {
      input = {
        question: sc.question,
        intents: [],
        scopeLines: [],
        surface: undefined,
        deictic: false,
        design: { title: 'Baseline', outline: sc.question },
        designMode: true,
        askMode: 'research',
        graph: null,
        digest: undefined,
        cfg: { provider: 'anthropic', model: 'claude-baseline-canned', apiKey: 'sk-test' },
        resolveReadable: () => null,
        repoRoot: null,
        callProvider,
      };
    } else {
      if (!shopRoot) {
        shopRoot = fs.realpathSync(copyShopfront());
        shopGraph = await scanRepo(shopRoot, { cluster: true });
        shopDigest = buildDigest(shopGraph);
      }
      const root = shopRoot;
      input = {
        question: sc.question,
        intents: [],
        scopeLines: [],
        surface: undefined,
        deictic: false,
        design: undefined,
        designMode: false,
        askMode: 'research',
        graph: shopGraph!,
        digest: shopDigest,
        cfg: { provider: 'anthropic', model: 'claude-baseline-canned', apiKey: 'sk-test' },
        resolveReadable: (p) => resolveInRepo(root, p),
        repoRoot: root,
        callProvider,
      };
    }

    const events: AskStreamEvent[] = [];
    const result = await runAskPipeline(input, (e) => events.push(e));
    const m = result.metrics;

    rows.push({
      id: sc.id,
      workspace: sc.workspace,
      question: sc.question,
      wallMs: m?.wallMs,
      rounds: m?.rounds,
      inputTokens: m?.inputTokens,
      outputTokens: m?.outputTokens,
      stopReason: m?.stopReason,
      designMode: sc.workspace === 'blank-design',
      intent: m?.intent,
      boardOpened: boardOpenedFromEvents(events),
      providerCalls: calls.length,
      providerKind,
    });
  }

  const walls = rows
    .map((r) => r.wallMs)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);
  const rounds = rows.map((r) => r.rounds ?? 0);
  const le2Count = rounds.filter((r) => r <= 2).length;
  const boardOpenCount = rows.filter((r) => r.boardOpened).length;

  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    tipSha: opts.tipSha,
    n: rows.length,
    providerKind,
    rows,
    summary: {
      wallMs:
        walls.length === 0
          ? null
          : {
              min: walls[0]!,
              max: walls[walls.length - 1]!,
              mean: walls.reduce((a, b) => a + b, 0) / walls.length,
              p50: percentile(walls, 50),
              p95: percentile(walls, 95),
            },
      rounds: {
        mean: rounds.reduce((a, b) => a + b, 0) / Math.max(1, rounds.length),
        max: rounds.length === 0 ? 0 : Math.max(...rounds),
        le2Count,
        le2Rate: le2Count / Math.max(1, rounds.length),
      },
      boardOpenRate: boardOpenCount / Math.max(1, rows.length),
      boardOpenCount,
    },
    honestyNote:
      'providerKind=canned: wallMs is in-process only — do NOT copy into scorecard M1 as live latency. ' +
      'Copy rounds (M2) and boardOpenRate (M4 proxy) only when labeled as harness. Owner live dogfood fills M1.',
  };
}

/** Format a markdown table of measured rows (no invented targets). */
export function formatDesignDrawBaselineMarkdown(report: DesignDrawBaselineReport): string {
  const lines: string[] = [
    '# Phase A design-draw baseline (A2.1 harness)',
    '',
    `**Measured at:** ${report.measuredAt}`,
    `**N:** ${report.n} · **Provider:** ${report.providerKind}`,
    report.tipSha ? `**Tip:** \`${report.tipSha}\`` : '',
    '',
    report.honestyNote,
    '',
    '## Summary (measured)',
    '',
    `| Field | Value |`,
    `|---|---|`,
    `| rounds mean | ${report.summary.rounds.mean.toFixed(2)} |`,
    `| rounds max | ${report.summary.rounds.max} |`,
    `| rounds ≤2 rate | ${(report.summary.rounds.le2Rate * 100).toFixed(1)}% (${report.summary.rounds.le2Count}/${report.n}) |`,
    `| board open rate (M4 proxy) | ${(report.summary.boardOpenRate * 100).toFixed(1)}% (${report.summary.boardOpenCount}/${report.n}) |`,
  ];
  if (report.summary.wallMs) {
    const w = report.summary.wallMs;
    lines.push(
      `| wallMs p50 (canned — not M1) | ${w.p50.toFixed(0)} |`,
      `| wallMs p95 (canned — not M1) | ${w.p95.toFixed(0)} |`,
    );
  }
  lines.push('', '## Rows', '', '| id | workspace | rounds | wallMs | boardOpened | stopReason | intent |', '|---|---|---|---|---|---|---|');
  for (const r of report.rows) {
    lines.push(
      `| ${r.id} | ${r.workspace} | ${r.rounds ?? ''} | ${r.wallMs ?? ''} | ${r.boardOpened} | ${r.stopReason ?? ''} | ${r.intent ?? ''} |`,
    );
  }
  lines.push('');
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n');
}
