/* ══════════════════════════════════════════════════════════════════════════
   RUN-NODE TURNS FEED THE AGENTS TREE
   packages/analyzer/src/server/runNodeAgentEvents.ts

   A turn Sequence runs itself (POST /api/acp/run-node, Claude over ACP or
   codex over its app-server) produces no hooks, so without this its tools
   never reach the Agents tree. The turn's ACP updates are folded into the
   same agent-event store the hooks fill, as normalised AgentEvents whose
   sessionId is the CHAT id: a chat bound to a worktree then groups its runs
   under that worktree (web2 groupRunsByWorktree). Paths are made relative to
   the turn's own checkout, so a worktree's files land on the same board.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentEvent, AgentEventUsage, AgentToolKind } from './agentEventTypes.js';

type Published = Omit<AgentEvent, 'id' | 'at' | 'board'>;

export interface AgentEventSink {
  publish(e: Published, where?: { root?: string | null; cwd?: string | null }): unknown;
}

const TOOL_KINDS = new Set<AgentToolKind>(['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch', 'think', 'other']);
/** A tool name for the tree's tool column, from the ACP tool kind. */
const TOOL_NAME: Record<AgentToolKind, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Bash',
  fetch: 'Fetch',
  think: 'Think',
  other: 'Tool',
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The text a tool_call_update carries (ACP content blocks, else a string rawOutput), or null. */
export function outputTextOf(u: Obj): string | null {
  const parts: string[] = [];
  if (Array.isArray(u.content)) {
    for (const c of u.content) {
      const inner = obj(obj(c)?.content);
      const t = str(inner?.text);
      if (t) parts.push(t);
    }
  }
  if (!parts.length) {
    const raw = u.rawOutput;
    if (typeof raw === 'string' && raw.trim()) parts.push(raw);
    else {
      const o = obj(raw);
      const t = str(o?.stderr) ?? str(o?.error) ?? str(o?.output) ?? str(o?.stdout);
      if (t) parts.push(t);
    }
  }
  return parts.length ? parts.join('\n') : null;
}

/** The first non-empty line, cut to `max`. */
const firstLine = (text: string, max: number): string => {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export interface RunNodeFeedOptions {
  sink: AgentEventSink;
  /** The chat the turn belongs to: the event's sessionId. */
  sessionId: string;
  source: 'acp' | 'codex';
  /** The turn's checkout (the chat's worktree when it has one). */
  root: string | null;
  cwd?: string | null;
  /** The prompt, shortened, as the session's title. */
  title?: string;
  now?: () => number;
}

/**
 * One turn's feed: `start()` when the turn starts, `update(n)` for every ACP
 * session/update notification, `end(ok)` when it ends. A tool still open at
 * the end is closed with the turn. Never throws: the tree is a view, and a
 * turn must not fail for it.
 */
export class RunNodeEventFeed {
  private readonly open = new Map<string, { tool: string; toolKind: AgentToolKind; paths: string[]; title?: string; startedAt: number }>();
  private readonly said = new Map<string, string>();
  private ended = false;
  private startedAt = 0;
  private now(): number { return (this.o.now ?? Date.now)(); }

  constructor(private readonly o: RunNodeFeedOptions) {}

  private emit(e: Omit<Published, 'source' | 'sessionId'>): void {
    try {
      this.o.sink.publish({ source: this.o.source, sessionId: this.o.sessionId, ...e }, { root: this.o.root, cwd: this.o.cwd ?? null });
    } catch {
      /* best effort, see above */
    }
  }

  start(): void {
    this.startedAt = this.now();
    const title = this.o.title?.trim().slice(0, 120);
    this.emit({ kind: 'session_start', paths: [], status: 'running', startedAt: this.startedAt, ...(title ? { title } : {}) });
  }

  update(n: unknown): void {
    if (this.ended) return;
    const u = obj(obj(n)?.update);
    const kind = str(u?.sessionUpdate);
    const id = str(u?.toolCallId);
    if (!u || !id || (kind !== 'tool_call' && kind !== 'tool_call_update')) return;
    const locs = Array.isArray(u.locations) ? u.locations.map((l) => str(obj(l)?.path)).filter((p): p is string => p !== null) : null;
    const status = str(u.status);
    const prior = this.open.get(id);
    if (kind === 'tool_call' || !prior) {
      const k = str(u.kind) as AgentToolKind | null;
      const toolKind = k && TOOL_KINDS.has(k) ? k : (prior?.toolKind ?? 'other');
      const rec = { tool: TOOL_NAME[toolKind], toolKind, paths: locs ?? prior?.paths ?? [], startedAt: prior?.startedAt ?? this.now(), ...(str(u.title) ? { title: str(u.title)! } : prior?.title ? { title: prior.title } : {}) };
      this.open.set(id, rec);
      this.emit({ kind: 'tool_start', tool: rec.tool, toolKind: rec.toolKind, paths: rec.paths, status: 'running', toolUseId: id, startedAt: rec.startedAt, ...(rec.title ? { title: rec.title } : {}) });
    } else if (locs || str(u.title)) {
      this.open.set(id, { ...prior, ...(locs ? { paths: locs } : {}), ...(str(u.title) ? { title: str(u.title)! } : {}) });
    }
    const said = outputTextOf(u);
    if (said) this.said.set(id, said);
    if (status === 'completed' || status === 'failed' || status === 'cancelled') this.close(id, status === 'completed' ? 'done' : 'failed');
  }

  private close(id: string, status: 'done' | 'failed', why?: string): void {
    const rec = this.open.get(id);
    if (!rec) return;
    this.open.delete(id);
    const said = this.said.get(id);
    this.said.delete(id);
    const words = status === 'failed' ? (said ? firstLine(said, 300) : why) : said ? firstLine(said, 160) : undefined;
    const endedAt = this.now();
    this.emit({
      kind: 'tool_end',
      tool: rec.tool,
      toolKind: rec.toolKind,
      paths: rec.paths,
      status,
      toolUseId: id,
      startedAt: rec.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - rec.startedAt),
      ...(rec.title ? { title: rec.title } : {}),
      ...(words ? (status === 'failed' ? { error: words } : { result: words }) : {}),
    });
  }

  /**
   * The turn is over. `usage` is what the agent reported spending on it
   * (rides on the stop event, with `tokens` as its total); `error` is the
   * turn's failure in words, shown on the turn and on any step it cut short.
   */
  end(ok: boolean, usage?: AgentEventUsage | null, error?: string | null): void {
    if (this.ended) return;
    const why = ok ? undefined : (error?.trim() ? firstLine(error, 300) : 'The turn ended before this step finished.');
    for (const id of [...this.open.keys()]) this.close(id, ok ? 'done' : 'failed', why);
    this.ended = true;
    const endedAt = this.now();
    this.emit({
      kind: 'stop',
      paths: [],
      status: ok ? 'done' : 'failed',
      startedAt: this.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - this.startedAt),
      ...(usage ? { usage, tokens: usage.total } : {}),
      ...(!ok && why ? { error: why } : {}),
    });
  }
}
