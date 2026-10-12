/* ══════════════════════════════════════════════════════════════════════════
   REPLAY FIXTURES: one recorded agent session as frames with timing
   packages/acp/src/replay/fixture.ts

   A fixture is JSON Lines. The first line is the header; every other line is
   one frame, a JSON-RPC message as it crossed the agent's stdio:

     { "kind": "header", "provider": "codex-app-server", "scenario": "...",
       "live": true, "source": "...", "placeholders": { "<CWD>": "..." }, ... }
     { "t": 0,    "dir": "c2s", "msg": { "id": 1, "method": "initialize", ... } }
     { "t": 41,   "dir": "s2c", "msg": { "id": 1, "result": { ... } } }

   `t` is milliseconds since the session started. `c2s` is client to server
   (Sequence to the agent), `s2c` the other way. Machine-specific strings (the
   working directory, the home directory, the user name) are replaced with
   placeholders when the fixture is written, and put back when it is replayed.

   `live: false` marks a fixture that was NOT recorded from a running agent
   (the Claude fixtures, built from the ACP schema). Its header says so in
   `notRunLive`, and every test that uses one says so in its name.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';

export type Json = Record<string, unknown>;

export interface FixtureHeader {
  kind: 'header';
  /** Which wire this is: codex app-server JSON-RPC, or ACP JSON-RPC. */
  provider: 'codex-app-server' | 'acp';
  /** Short name, also the file's name. */
  scenario: string;
  /** What the session covers, in one sentence. */
  covers: string;
  /** True only when recorded from a real agent process. */
  live: boolean;
  /** Present on fixtures that were not recorded live, and says how they were made. */
  notRunLive?: string;
  /** On a not-live fixture built around frames recorded live: which frames, from which run. */
  liveRecorded?: string;
  /** Where the frames came from: the agent, its version, or the schema. */
  source: string;
  recordedAt?: string;
  /** The access mode the session ran in (planMode.ts AgentMode). */
  accessMode?: string;
  /** The prompt the session was given. */
  prompt?: string;
  /** How each approval was answered, in order. */
  answers?: ('allow' | 'deny' | 'always')[];
  /** Extra `-c key=value` overrides codex ran with. */
  codexConfig?: string[];
  /** Placeholder -> what it stood for (described, never the real value). */
  placeholders: Record<string, string>;
}

export interface Frame {
  /** Milliseconds since the session started. */
  t: number;
  dir: 'c2s' | 's2c';
  msg: Json;
}

export interface Fixture {
  header: FixtureHeader;
  frames: Frame[];
}

export function parseFixture(text: string): Fixture {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('empty fixture');
  const header = JSON.parse(lines[0]!) as FixtureHeader;
  if (header.kind !== 'header') throw new Error('a fixture starts with its header line');
  const frames = lines.slice(1).map((l, i) => {
    const f = JSON.parse(l) as Frame;
    if ((f.dir !== 'c2s' && f.dir !== 's2c') || typeof f.t !== 'number' || !f.msg || typeof f.msg !== 'object') {
      throw new Error(`frame ${i + 1} is not { t, dir, msg }`);
    }
    return f;
  });
  return { header, frames };
}

export function readFixture(file: string): Fixture {
  return parseFixture(fs.readFileSync(file, 'utf8'));
}

export function formatFixture(f: Fixture): string {
  return [JSON.stringify(f.header), ...f.frames.map((fr) => JSON.stringify(fr))].join('\n') + '\n';
}

/** Every spelling of a path a JSON message may carry it in: as given, with / and with \. */
function spellings(value: string): string[] {
  /* Also doubled backslashes: a tool's own output (a Node stack, a JSON dump)
     can carry a Windows path escaped once more. */
  const out = new Set([value, value.replace(/\\/g, '/'), value.replace(/\//g, '\\'), value.replace(/[\\/]/g, '\\\\')]);
  return [...out].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
}

interface Rule {
  re: RegExp;
  to: string;
}

function rulesFor(pairs: readonly (readonly [string, string])[]): Rule[] {
  return pairs.flatMap(([from, to]) =>
    spellings(from).map((s) => {
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = /^[a-z]:[\\/]/i.test(s) ? 'gi' : 'g';
      /* A path replacing a path keeps the matched spelling's separators; a
         path put back for a placeholder goes in as given. */
      const isPath = /[\\/]/.test(s);
      const slash = s.includes('\\') ? '\\' : '/';
      return { re: new RegExp(esc, flags), to: isPath ? to.replace(/[\\/]/g, slash) : to };
    }),
  );
}

/**
 * Replace strings inside any JSON value. `pairs` is [from, to]; each `from` is
 * matched in its slash spellings, case-blind on a Windows drive path.
 */
export function substitute<T>(value: T, pairs: readonly (readonly [string, string])[]): T {
  const rules = rulesFor(pairs);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return rules.reduce((s, r) => s.replace(r.re, () => r.to), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Json = {};
      for (const [k, x] of Object.entries(v as Json)) o[walk(k) as string] = walk(x);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * `substitute` across streamed text: a path the model wrote can be split over
 * several `item/agentMessage/delta` frames, where no single frame holds it.
 * The deltas of each message are joined, replaced as one string, and given
 * back to the same frames (a replaced span goes to the frame it started in),
 * so the frame count and order do not change.
 */
export function substituteDeltas(frames: Frame[], pairs: readonly (readonly [string, string])[]): Frame[] {
  const rules = rulesFor(pairs);
  const byItem = new Map<string, number[]>();
  frames.forEach((f, i) => {
    if (f.dir === 's2c' && f.msg.method === 'item/agentMessage/delta') {
      const id = String((f.msg.params as Json | undefined)?.itemId ?? '');
      byItem.set(id, [...(byItem.get(id) ?? []), i]);
    }
  });
  const out = frames.slice();
  for (const indexes of byItem.values()) {
    const chunks = indexes.map((i) => String(((frames[i]!.msg.params as Json).delta as string | undefined) ?? ''));
    /* Characters with the chunk each one belongs to. */
    let text = chunks.join('');
    let owner: number[] = chunks.flatMap((c, k) => Array.from({ length: c.length }, () => k));
    let changed = false;
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      let next = '';
      const nextOwner: number[] = [];
      let at = 0;
      for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
        next += text.slice(at, m.index);
        nextOwner.push(...owner.slice(at, m.index));
        next += rule.to;
        nextOwner.push(...Array.from({ length: rule.to.length }, () => owner[m!.index] ?? 0));
        at = m.index + m[0].length;
        changed = true;
        if (m[0].length === 0) rule.re.lastIndex += 1;
      }
      next += text.slice(at);
      nextOwner.push(...owner.slice(at));
      text = next;
      owner = nextOwner;
    }
    if (!changed) continue;
    const rebuilt = chunks.map(() => '');
    for (let j = 0; j < text.length; j++) rebuilt[owner[j]!] += text[j];
    indexes.forEach((i, k) => {
      const f = frames[i]!;
      out[i] = { ...f, msg: { ...f.msg, params: { ...(f.msg.params as Json), delta: rebuilt[k] } } };
    });
  }
  return out;
}

/** Frames of one method, server to client, in order. */
export function framesOf(f: Fixture, method: string, dir: Frame['dir'] = 's2c'): Frame[] {
  return f.frames.filter((fr) => fr.dir === dir && fr.msg.method === method);
}
