/**
 * Client-side strip of tool JSON the model streamed into chat prose.
 * Mirrors analyzer `parseAllToolRequests` / salvage enough to hide board/canvas
 * dumps while work rows / tool cards carry the human story.
 *
 * Owner seat (2026-08-27): mid-stream incomplete dumps (screenshot of bare
 * `propose_topology` JSON in a code card) must become a tool-call card too —
 * not wait for a closing brace that lands after the board already drew.
 */

export interface StrippedTool {
  id: string;
  name: string;
}

export interface StripToolProseResult {
  stripped: string;
  tools: StrippedTool[];
}

const TOOL_NAME_HIT =
  /"name"\s*:\s*"(propose_topology|propose_files|read_file|search_files|run_command|git_status|git_diff|call_mcp|call_plugin|fetch_url|canvas\.write_\w+|canvas\.set_story_route)"/;

const ALLOWED_TOOL =
  /^(propose_topology|propose_files|read_file|search_files|run_command|git_status|git_diff|call_mcp|call_plugin|fetch_url|canvas\.write_\w+|canvas\.set_story_route)$/;

/** Any fence that might hold a tool dump — not only ```sequence-tool. */
const FENCED_ANY_RE = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)(?:\n```|$)/g;

function extractBalancedObject(text: string, open: number): string | null {
  if (text[open] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function toolNameFromPartial(raw: string): string | null {
  const m = TOOL_NAME_HIT.exec(raw);
  return m?.[1] ?? null;
}

/**
 * SeqDiagram-shaped dump the model printed without a tool envelope
 * (`kind:"process-sequence"`, `nodes` with `proposal:` ids) — still a board
 * ask, not chat prose.
 */
export function looksLikeTopologyDump(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !/"nodes"\s*:\s*\[/.test(trimmed)) return false;
  /* Other allowlisted tools also carry JSON — leave those to TOOL_NAME_HIT. */
  const named = /"name"\s*:\s*"([^"]+)"/.exec(trimmed);
  if (named && ALLOWED_TOOL.test(named[1]!) && named[1] !== 'propose_topology') {
    return false;
  }
  if (/"name"\s*:\s*"propose_topology"/.test(trimmed)) return true;
  const kindHit = /"kind"\s*:\s*"([^"]+)"/.exec(trimmed);
  const kindLooks =
    kindHit !== null && /sequence|workflow|flow|map/i.test(kindHit[1]!);
  const hasTitle = /"title"\s*:\s*"/.test(trimmed);
  const proposalIds = /"id"\s*:\s*"(?:proposal|design):/.test(trimmed);
  return kindLooks || (hasTitle && (proposalIds || /"edges"\s*:\s*\[/.test(trimmed))) || proposalIds;
}

function tryParseTool(raw: string): StrippedTool | null {
  try {
    const v = JSON.parse(raw) as { id?: unknown; name?: unknown };
    if (typeof v.name !== 'string' || !ALLOWED_TOOL.test(v.name)) return null;
    const id = typeof v.id === 'string' && v.id.trim() !== '' ? v.id : v.name;
    return { id, name: v.name };
  } catch {
    return null;
  }
}

function asTopologyTool(raw: string): StrippedTool | null {
  if (!looksLikeTopologyDump(raw)) return null;
  const parsed = tryParseTool(raw);
  if (parsed) return parsed;
  return { id: 'propose_topology', name: 'propose_topology' };
}

/** Find the `{` that opens the object containing `nameAt`. */
function findObjectOpen(text: string, nameAt: number): number {
  for (let i = nameAt; i >= 0; i--) {
    if (text[i] !== '{') continue;
    const balanced = extractBalancedObject(text, i);
    if (balanced && nameAt >= i && nameAt < i + balanced.length) return i;
  }
  /* Incomplete stream — nearest `{` before the name is the dump root. */
  for (let i = nameAt; i >= 0; i--) {
    if (text[i] === '{') return i;
  }
  return -1;
}

function salvageBare(text: string): StripToolProseResult {
  const tools: StrippedTool[] = [];
  const nameHit = new RegExp(TOOL_NAME_HIT.source, 'g');
  const removals: { start: number; end: number }[] = [];
  let hit: RegExpExecArray | null;
  while ((hit = nameHit.exec(text)) !== null) {
    const nameAt = hit.index;
    const open = findObjectOpen(text, nameAt);
    if (open < 0) continue;
    const balanced = extractBalancedObject(text, open);
    const raw = balanced ?? text.slice(open);
    const parsed = tryParseTool(raw) ?? {
      id: hit[1]!,
      name: hit[1]!,
    };
    const end = balanced ? open + balanced.length : text.length;
    if (removals.some((r) => !(end <= r.start || open >= r.end))) continue;
    tools.push(parsed);
    removals.push({ start: open, end });
    nameHit.lastIndex = end;
  }
  /* Bare SeqDiagram JSON with no `"name":"propose_topology"` envelope. */
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    if (removals.some((r) => i >= r.start && i < r.end)) continue;
    const balanced = extractBalancedObject(text, i);
    if (!balanced) continue;
    const topo = asTopologyTool(balanced);
    if (!topo) continue;
    const end = i + balanced.length;
    if (removals.some((r) => !(end <= r.start || i >= r.end))) continue;
    /* Skip if this object was already claimed as a named tool. */
    if (tools.some((t) => t.name === 'propose_topology' && removals.some((r) => r.start === i))) {
      i = end - 1;
      continue;
    }
    tools.push(topo);
    removals.push({ start: i, end });
    i = end - 1;
  }
  if (removals.length === 0) return { tools, stripped: text };
  removals.sort((a, b) => b.start - a.start);
  let stripped = text;
  for (const r of removals) {
    stripped = stripped.slice(0, r.start) + stripped.slice(r.end);
  }
  return { tools, stripped: stripped.replace(/\n{3,}/g, '\n\n') };
}

function stripFences(text: string): StripToolProseResult {
  const tools: StrippedTool[] = [];
  const stripped = text.replace(FENCED_ANY_RE, (full, lang: string, body: string) => {
    const trimmed = body.trim();
    const parsed = tryParseTool(trimmed);
    if (parsed) {
      tools.push(parsed);
      return '';
    }
    const topo = asTopologyTool(trimmed);
    if (topo) {
      tools.push(topo);
      return '';
    }
    const partialName = toolNameFromPartial(trimmed);
    if (partialName || lang === 'sequence-tool') {
      tools.push({ id: partialName ?? 'tool', name: partialName ?? 'propose_topology' });
      return '';
    }
    /* Incomplete stream of a topology-shaped fence (no closing brace yet). */
    if (
      looksLikeTopologyDump(trimmed + ']}') ||
      (/"nodes"\s*:\s*\[/.test(trimmed) &&
        (/"kind"\s*:\s*"[^"]*(?:sequence|workflow|flow|map)/i.test(trimmed) ||
          /"id"\s*:\s*"(?:proposal|design):/.test(trimmed)))
    ) {
      tools.push({ id: 'propose_topology', name: 'propose_topology' });
      return '';
    }
    return full;
  });
  return { tools, stripped: stripped.replace(/\n{3,}/g, '\n\n') };
}

/** True when a fenced code block is a tool dump, not user-facing code. */
export function isToolDumpCode(language: string | null, body: string): boolean {
  if (language === 'sequence-tool') return true;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !TOOL_NAME_HIT.test(trimmed)) return false;
  if (tryParseTool(trimmed)) return true;
  if (looksLikeTopologyDump(trimmed)) return true;
  if (
    /"nodes"\s*:\s*\[/.test(trimmed) &&
    (/"kind"\s*:\s*"[^"]*(?:sequence|workflow|flow|map)/i.test(trimmed) ||
      /"id"\s*:\s*"(?:proposal|design):/.test(trimmed) ||
      /"name"\s*:\s*"propose_topology"/.test(trimmed))
  ) {
    return true;
  }
  return toolNameFromPartial(trimmed) !== null;
}

export function toolNameFromDump(body: string): string {
  const parsed = tryParseTool(body.trim());
  if (parsed) return parsed.name;
  if (looksLikeTopologyDump(body) || /"nodes"\s*:\s*\[/.test(body)) {
    if (
      looksLikeTopologyDump(body) ||
      /"name"\s*:\s*"propose_topology"/.test(body) ||
      /"id"\s*:\s*"(?:proposal|design):/.test(body) ||
      /"kind"\s*:\s*"[^"]*(?:sequence|workflow|flow|map)/i.test(body)
    ) {
      return 'propose_topology';
    }
  }
  return toolNameFromPartial(body) ?? 'tool';
}

function salvageOrphans(text: string): StripToolProseResult {
  const tools: StrippedTool[] = [];
  /* Mid-object fragments that lost their opening `{` (owner SVG dump seat). */
  const dangler =
    /(?:^|\n)[^<\n{]{0,80}?"name"\s*:\s*"(propose_topology|propose_files|read_file|search_files|run_command|git_status|git_diff|call_mcp|call_plugin|fetch_url|canvas\.write_\w+|canvas\.set_story_route)"[\s\S]*?(?=\n(?:[A-Z*]|\d+\.|And |Here |The |Copy\b|Execution)|$)/g;
  let stripped = text.replace(dangler, (_full, name: string) => {
    tools.push({ id: name, name });
    return '\n';
  });
  /* Orphan canvas.write args that lost the wrapping tool object (`":{"title":…,"content":"<svg…`). */
  stripped = stripped.replace(
    /(?:^|\n)[^<\n{]{0,40}?":\s*\{\s*"title"\s*:\s*"[^"]*"\s*,\s*"content"\s*:\s*"[\s\S]*?(?=\n(?:[A-Z*]|\d+\.|And |Here |The |Copy\b|Execution)|$)/g,
    () => {
      if (!tools.some((t) => t.name.startsWith('canvas.write_'))) {
        tools.push({ id: 'canvas.write_svg', name: 'canvas.write_svg' });
      }
      return '\n';
    },
  );
  /* Orphan propose_topology args (`":{"title":…,"nodes":[…],"edges":[…]}`). */
  stripped = stripped.replace(
    /(?:^|\n)[^<\n{]{0,40}?":\s*\{\s*"title"\s*:\s*"[^"]*"\s*,\s*"nodes"\s*:\s*\[[\s\S]*?"edges"\s*:\s*\[[\s\S]*?(?=\n(?:[A-Z*]|\d+\.|And |Here |The |Copy\b|Execution)|$)/g,
    () => {
      if (!tools.some((t) => t.name === 'propose_topology')) {
        tools.push({ id: 'propose_topology', name: 'propose_topology' });
      }
      return '\n';
    },
  );
  /* Naked / unclosed SVG payloads that leaked after a canvas.write_* strip. */
  const svgish = /canvas\.write_|xmlns=/i.test(text);
  stripped = stripped.replace(/<svg\b[\s\S]*?(?:<\/svg>|$)/gi, (full) => {
    if (!svgish) return full;
    if (!tools.some((t) => t.name.startsWith('canvas.write_'))) {
      tools.push({ id: 'canvas.write_svg', name: 'canvas.write_svg' });
    }
    return '';
  });
  /* Residual empty content shells after SVG excision. */
  stripped = stripped.replace(
    /(?:^|\n)[^<\n{]{0,40}?":\s*\{\s*"title"\s*:\s*"[^"]*"\s*,\s*"content"\s*:\s*""\s*\}+/g,
    '\n',
  );
  return { tools, stripped: stripped.replace(/\n{3,}/g, '\n\n') };
}

export function stripToolProse(text: string, opts?: { trimEnd?: boolean }): StripToolProseResult {
  const fenced = stripFences(text);
  const bare = salvageBare(fenced.stripped);
  const orphans = salvageOrphans(bare.stripped);
  const byId = new Map<string, StrippedTool>();
  for (const t of fenced.tools) byId.set(t.id, t);
  for (const t of bare.tools) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }
  for (const t of orphans.tools) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }
  const stripped =
    opts?.trimEnd === false
      ? orphans.stripped
      : orphans.stripped.replace(/\n{3,}/g, '\n\n').trimEnd();
  return { stripped, tools: [...byId.values()] };
}

export function toolCardTitle(name: string): string {
  if (name === 'propose_topology') return 'Drawing on Architecture';
  if (name.startsWith('canvas.write_') || name === 'canvas.set_story_route') {
    return 'Drawing on AI Canvas';
  }
  if (name === 'propose_files') return 'Proposing file edits';
  if (name === 'read_file' || name === 'search_files') return 'Exploring files';
  if (name === 'run_command') return 'Running a command';
  return `Calling ${name}`;
}
