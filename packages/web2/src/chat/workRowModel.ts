import type { WorkGroup, WorkRow } from '../state/types';
import type { IconName } from './Icon';

/* ══════════════════════════════════════════════════════════════════════════
   LIVE STATUS — Cursor-mobile vocabulary (owner 2026-08-26)
   Exploring · Planning · Thinking · Working + grounded target when present.
   ══════════════════════════════════════════════════════════════════════════ */

export type LivePhase = 'exploring' | 'planning' | 'thinking' | 'working';

const PHASE_LABEL: Record<LivePhase, string> = {
  exploring: 'Exploring',
  planning: 'Planning',
  thinking: 'Thinking',
  working: 'Working',
};

const TOOL_PHASE: Record<string, LivePhase> = {
  read_file: 'exploring',
  search_files: 'exploring',
  git_status: 'exploring',
  git_diff: 'exploring',
  propose_topology: 'planning',
  propose_files: 'working',
  'canvas.write_markdown': 'planning',
  'canvas.write_mermaid': 'planning',
  'canvas.write_html': 'working',
  'canvas.write_react': 'working',
  'canvas.write_svg': 'planning',
  run_command: 'working',
  call_mcp: 'working',
  call_plugin: 'working',
  fetch_url: 'working',
};

export function livePhaseFor(row: Pick<WorkRow, 'from' | 'verb'>): LivePhase {
  switch (row.from) {
    case 'file:read':
      return 'exploring';
    case 'topology:proposal':
    case 'canvas:block':
    case 'edit:proposal':
      return row.from === 'topology:proposal' || row.from === 'canvas:block' ? 'planning' : 'working';
    case 'command:log':
      return 'working';
    case 'provider:start':
    case 'intent:start':
    case 'step:start':
      return 'thinking';
    case 'tool:start': {
      const called = /^Called (\S+)$/.exec(row.verb);
      if (called) return TOOL_PHASE[called[1]] ?? 'working';
      return 'working';
    }
    default:
      return 'working';
  }
}

/** Pipeline step ids from askPipeline — machine slugs, not human targets. */
const PIPELINE_STEP_LIVE: Record<string, string> = {
  intents: 'Planning…',
  'file-research': 'Exploring…',
  provider: 'Reasoning…',
  advisor: 'Reviewing…',
};

export function liveLabelFor(
  row: Pick<WorkRow, 'from' | 'verb' | 'identifier' | 'status'>,
  reasoningProvider?: string | null,
): string {
  /* Canvas / board writers — name the surface so the audience sees tool work. */
  const called = /^Called (\S+)$/.exec(row.verb)?.[1];
  if (called?.startsWith('canvas.write_') || row.from === 'canvas:block') {
    return 'Drawing on AI Canvas…';
  }
  if (called === 'propose_topology' || row.from === 'topology:proposal') {
    return 'Drawing on Architecture…';
  }

  /* step:start id "provider" used to render as "Thinking provider…" — the slug
     leaked into the live line. Map bookkeeping steps to plain phase copy. */
  if (row.from === 'step:start' && row.identifier !== null) {
    const mapped = PIPELINE_STEP_LIVE[row.identifier];
    if (mapped) return mapped;
  }

  const phase = livePhaseFor(row);
  let action = PHASE_LABEL[phase];

  if (phase === 'thinking' && row.from === 'provider:start') {
    const who = reasoningProvider?.trim();
    action = who ? `Reasoning with ${who}` : 'Reasoning';
  }

  const target = row.identifier === null ? '' : ` ${row.identifier}`;
  return `${action}${target}…`;
}

export function glyphFor(row: Pick<WorkRow, 'from' | 'group'>): IconName {
  switch (row.from) {
    case 'file:read':
    case 'file:done':
      return 'file';
    case 'command:log':
      return 'terminal';
    case 'edit:proposal':
      return 'code';
    case 'topology:proposal':
      return 'board';
    case 'canvas:block':
      return 'spark';
    case 'advisor':
    case 'error':
      return 'alert';
    case 'trajectory:start':
      return 'run';
    case 'intent:start':
    case 'intent:done':
      return 'flow';
    case 'step:start':
    case 'step:done':
    case 'provider:start':
    case 'provider:done':
      return 'clock';
    default:
      return groupGlyph(row.group);
  }
}

function groupGlyph(group: WorkGroup): IconName {
  switch (group) {
    case 'read':
      return 'search';
    case 'reason':
      return 'clock';
    case 'change':
      return 'code';
    case 'run':
      return 'terminal';
  }
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}m ${String(whole % 60).padStart(2, '0')}s`;
}
