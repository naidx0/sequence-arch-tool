import fs from 'node:fs';
import path from 'node:path';
import { systemWatchdogClock, type WatchdogClock } from '@sequence/acp';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => v && typeof v === 'object' ? v as Json : {};
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
export function usageTokens(raw: unknown, scope: 'turn' | 'thread', threadId?: string): Json | null {
  const u = obj(raw), input = number(u.inputTokens), output = number(u.outputTokens);
  if (input === null || output === null) return null;
  return { inputTokens: input, outputTokens: output, cachedReadTokens: number(u.cachedReadTokens ?? u.cachedInputTokens),
    cachedWriteTokens: number(u.cachedWriteTokens ?? u.cacheWriteInputTokens),
    ...(number(u.totalTokens) !== null ? { totalTokens: u.totalTokens } : {}), scope, ...(threadId ? { threadId } : {}) };
}

/** A bounded, allowlisted metadata ledger. No prompts, output, bodies, paths, IDs from the bridge or stderr text. */
export function writeAgentDiagnostic(dir: string, record: Json): void {
  try {
    const safe: Json = {};
    if (typeof record.at === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(record.at)) safe.at = record.at;
    if (typeof record.turn === 'string' && /^[a-f0-9-]{36}$/.test(record.turn)) safe.turn = record.turn;
    if (['start', 'queued', 'active', 'permissionAsked', 'permissionAnswered', 'toolStart', 'toolEnd', 'waiting', 'ended', 'error', 'cancelled', 'stderr', 'processExit'].includes(String(record.event))) safe.event = record.event;
    for (const key of ['events', 'quietMs', 'bytes', 'exitCode']) if (typeof record[key] === 'number' && Number.isFinite(record[key])) safe[key] = record[key];
    if (record.exitCode === null) safe.exitCode = null;
    if (['queued', 'approval', 'tool', 'quiet'].includes(String(record.reason))) safe.reason = record.reason;
    if (['end_turn', 'cancelled', 'refusal', 'max_tokens', 'max_turn_requests', 'other'].includes(String(record.stopReason))) safe.stopReason = record.stopReason;
    const frames = obj(record.frames);
    safe.frames = Object.fromEntries(FRAME_KINDS.filter(k => typeof frames[k] === 'number').map(k => [k, frames[k]]));
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const file = path.join(dir, 'logs', `agents-${new Date().toISOString().slice(0, 10)}.jsonl`);
    if (fs.existsSync(file) && fs.statSync(file).size >= 1024 * 1024) {
      const old = `${file}.1`;
      if (fs.existsSync(old)) fs.unlinkSync(old);
      fs.renameSync(file, old);
    }
    // The schema is constructed by this module; free-form provider strings never enter it.
    fs.appendFileSync(file, JSON.stringify(safe) + '\n');
    const files = fs.readdirSync(path.join(dir, 'logs')).filter(f => /^agents-\d{4}-\d{2}-\d{2}\.jsonl(?:\.1)?$/.test(f)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 6))) fs.unlinkSync(path.join(dir, 'logs', old));
  } catch { /* Diagnostics must not break a turn. */ }
}

const FRAME_KINDS = ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan', 'usage_update', 'session_info_update', 'current_mode_update', 'config_option_update', 'available_commands_update', 'other'];

export class AgentTurnActivity {
  private timer: unknown;
  private stopped = false;
  private queued = false;
  private approvals = 0;
  private tools = new Map<string, { at: number; kind: string }>();
  private last: number;
  private count = 0;
  private frameKinds: Record<string, number> = {};
  private readonly clock: WatchdogClock;
  private readonly now: () => number;
  constructor(private readonly o: { dir: string; id: string; emit: (e: Json) => void; clock?: WatchdogClock }) {
    this.clock = o.clock ?? systemWatchdogClock;
    const c = this.clock as WatchdogClock & { now?: () => number };
    this.now = () => c.now ? c.now() : Date.now();
    this.last = this.now();
    this.log('start');
    this.arm();
  }
  private log(event: string, extra: Json = {}): void { writeAgentDiagnostic(this.o.dir, { at: new Date().toISOString(), turn: this.o.id, event, events: this.count, frames: this.frameKinds, ...extra }); }
  queue(): void { this.queued = true; this.log('queued'); this.heartbeat(); }
  active(): void { this.queued = false; this.last = this.now(); this.log('active'); }
  diagnostic(e: { event: 'stderr' | 'processExit'; bytes?: number; exitCode?: number | null }): void {
    if (this.stopped) return;
    this.log(e.event, { ...(typeof e.bytes === 'number' ? { bytes: e.bytes } : {}), ...(e.event === 'processExit' ? { exitCode: e.exitCode ?? null } : {}) });
  }
  permission(pending: boolean): void { this.approvals = Math.max(0, this.approvals + (pending ? 1 : -1)); this.last = this.now(); this.log(pending ? 'permissionAsked' : 'permissionAnswered'); }
  update(notification: unknown): void {
    if (this.stopped) return;
    this.last = this.now(); this.count++;
    const u = obj(obj(notification).update), kind = u.sessionUpdate;
    // Only known frame kinds; unknown provider strings may contain user content.
    const frameKind = FRAME_KINDS.includes(String(kind)) ? String(kind) : 'other';
    this.frameKinds[frameKind] = (this.frameKinds[frameKind] ?? 0) + 1;
    if (kind === 'tool_call') this.log('toolStart');
    else if (kind === 'tool_call_update' && (u.status === 'completed' || u.status === 'failed')) this.log('toolEnd');
    if ((kind === 'tool_call' || kind === 'tool_call_update') && typeof u.toolCallId === 'string') {
      if (u.status === 'completed' || u.status === 'failed') this.tools.delete(u.toolCallId);
      else if (!this.tools.has(u.toolCallId)) this.tools.set(u.toolCallId, { at: this.now(), kind: ['read', 'edit', 'execute', 'search', 'fetch', 'think'].includes(String(u.kind)) ? String(u.kind) : 'other' });
    }
  }
  heartbeat(): void {
    if (this.stopped) return;
    const now = this.now(), quietMs = Math.max(0, now - this.last);
    const tool = this.tools.values().next().value;
    const reason = this.queued ? 'queued' : this.approvals ? 'approval' : tool ? 'tool' : 'quiet';
    /* A running tool that sends no frames is a slow command (a 4-minute sleep, a long build), not a silent
       model. Only a quiet turn is stalled; a tool turn stays work and is ended by Stop, not Retry. */
    this.o.emit({ type: 'acp:waiting', reason, lastEventAt: this.last, quietMs, stalled: !this.queued && this.approvals === 0 && reason !== 'tool' && quietMs >= 40_000,
      ...(tool ? { toolKind: tool.kind, toolMs: Math.max(0, now - tool.at) } : {}) });
    this.log('waiting', { reason, quietMs });
  }
  private arm(): void { this.timer = this.clock.setTimeout(() => { this.heartbeat(); if (!this.stopped) this.arm(); }, 10_000); }
  end(state: 'ended' | 'error' | 'cancelled', extra: Json = {}): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clock.clearTimeout(this.timer);
    this.log(state, extra);
  }
}

/** Error prose belongs in the transcript, with common credential formats removed. */
export function safeAgentFailure(error: unknown): string {
  return (error instanceof Error ? error.message : 'The agent failed.')
    .replace(/(?:Bearer\s+|sk-[A-Za-z0-9_-]*|gh[pousr]_[A-Za-z0-9_]*)(?:[A-Za-z0-9_.-]+)?/gi, '[redacted]')
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .slice(0, 800);
}
