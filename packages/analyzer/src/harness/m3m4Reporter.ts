/**
 * A3.6 — M3/M4 metrics reporter (fixtures + harness rows).
 *
 * M3: % of corpus turns where residual prose still looks like raw tool/seqd JSON
 *     after salvage (owner dump fixtures + clean controls).
 * M4: board-open rate from design-draw baseline rows (`boardOpened`).
 *
 * Never invents scorecard greens — reports measured rates only.
 */

import {
  loadAskHonestyFixture,
  wrapFencedSeqd,
  wrapProse,
  type AskHonestyFixtureId,
} from '../test/ask-honesty-corpus.js';
import {
  salvageBareSeqdProposals,
  salvageBareToolRequests,
} from '../server/askTools.js';
import type { DesignDrawRow } from './designDrawBaseline.js';

const HONESTY_IDS: AskHonestyFixtureId[] = [
  'process-sequence-bare',
  'fenced-seqd',
  'propose-topology-bare',
  'bare-nodes',
];

/** Residual dump heuristics — mirrors web2 `looksLikeTopologyDump` lightly. */
export function residualLooksLikeRawToolOrSeqd(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/"name"\s*:\s*"(propose_topology|propose_files|canvas\.write_\w+)"/.test(t)) {
    return true;
  }
  if (t.includes('{') && /"nodes"\s*:\s*\[/.test(t) && /"kind"\s*:\s*"/.test(t)) {
    return true;
  }
  if (/"kind"\s*:\s*"process-sequence"/.test(t)) return true;
  /* Large fenced json block still present */
  if (/```(?:json|sequence)?\s*\n\s*\{/.test(t) && /"nodes"\s*:\s*\[/.test(t)) {
    return true;
  }
  return false;
}

/** Apply analyzer salvage belt; tools first so nested seqd does not hollow envelopes. */
export function salvageResidualProse(text: string): string {
  const tools = salvageBareToolRequests(text);
  const seqd = salvageBareSeqdProposals(tools.stripped);
  return seqd.stripped.trim();
}

export interface M3CaseRow {
  id: string;
  kind: 'dump' | 'clean';
  rawVisibleAfterSalvage: boolean;
  residualChars: number;
}

export interface M3Report {
  version: 1;
  measuredAt: string;
  n: number;
  rawVisibleCount: number;
  /** Measured M3 — fraction of cases with residual raw dump. */
  rawVisibleRate: number;
  cases: M3CaseRow[];
  honestyNote: string;
}

export interface M4Report {
  version: 1;
  measuredAt: string;
  n: number;
  boardOpenCount: number;
  boardOpenRate: number;
  honestyNote: string;
}

export interface M3M4CombinedReport {
  version: 1;
  measuredAt: string;
  m3: M3Report;
  m4: M4Report;
}

function dumpCaseText(id: AskHonestyFixtureId): string {
  const body = loadAskHonestyFixture(id);
  if (id === 'fenced-seqd') return wrapFencedSeqd(body);
  return wrapProse(body);
}

/**
 * M3 reporter over the A3 honesty corpus + clean controls.
 * Dump cases SHOULD salvage to non-raw; clean cases must stay non-raw.
 */
export function reportM3Honesty(): M3Report {
  const cases: M3CaseRow[] = [];

  for (const id of HONESTY_IDS) {
    const text = dumpCaseText(id);
    const residual = salvageResidualProse(text);
    cases.push({
      id: `dump:${id}`,
      kind: 'dump',
      rawVisibleAfterSalvage: residualLooksLikeRawToolOrSeqd(residual),
      residualChars: residual.length,
    });
  }

  const cleans = [
    { id: 'clean:plain', text: 'Two services talk over HTTP. Gateway fronts orders.' },
    { id: 'clean:short', text: 'Here is the diagram on the board.' },
    {
      id: 'clean:bullets',
      text: 'Services:\n- gateway\n- orders\n- payments\nEdges are http between them.',
    },
  ];
  for (const c of cleans) {
    const residual = salvageResidualProse(c.text);
    cases.push({
      id: c.id,
      kind: 'clean',
      rawVisibleAfterSalvage: residualLooksLikeRawToolOrSeqd(residual),
      residualChars: residual.length,
    });
  }

  const rawVisibleCount = cases.filter((c) => c.rawVisibleAfterSalvage).length;
  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    n: cases.length,
    rawVisibleCount,
    rawVisibleRate: rawVisibleCount / Math.max(1, cases.length),
    cases,
    honestyNote:
      'M3 harness rate is residual raw JSON after analyzer salvage on fixtures — not live chat seat %. ' +
      'Copy into scorecard only when labeled harness; owner dogfood fills live M3.',
  };
}

/** M4 from design-draw baseline rows (topology/canvas event proxy). */
export function reportM4BoardOpen(rows: ReadonlyArray<DesignDrawRow>): M4Report {
  const n = rows.length;
  const boardOpenCount = rows.filter((r) => r.boardOpened).length;
  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    n,
    boardOpenCount,
    boardOpenRate: boardOpenCount / Math.max(1, n),
    honestyNote:
      'M4 proxy = topology:proposal|canvas:block in ask stream (matches web2 auto-open lock). ' +
      'Not a click-through seat study.',
  };
}

export function reportM3M4(rows: ReadonlyArray<DesignDrawRow>): M3M4CombinedReport {
  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    m3: reportM3Honesty(),
    m4: reportM4BoardOpen(rows),
  };
}

export function formatM3M4Markdown(report: M3M4CombinedReport): string {
  const { m3, m4 } = report;
  const lines = [
    '# Phase A M3/M4 reporter (A3.6)',
    '',
    `**Measured at:** ${report.measuredAt}`,
    '',
    '## M3 — residual raw tool/seqd after salvage',
    '',
    m3.honestyNote,
    '',
    `| rawVisibleRate | ${(m3.rawVisibleRate * 100).toFixed(1)}% (${m3.rawVisibleCount}/${m3.n}) |`,
    '',
    '| id | kind | rawVisible | residualChars |',
    '|---|---|---|---|',
  ];
  for (const c of m3.cases) {
    lines.push(`| ${c.id} | ${c.kind} | ${c.rawVisibleAfterSalvage} | ${c.residualChars} |`);
  }
  lines.push(
    '',
    '## M4 — board open proxy',
    '',
    m4.honestyNote,
    '',
    `| boardOpenRate | ${(m4.boardOpenRate * 100).toFixed(1)}% (${m4.boardOpenCount}/${m4.n}) |`,
    '',
  );
  return lines.join('\n');
}
