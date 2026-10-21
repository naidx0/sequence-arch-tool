/**
 * `rea doctor --json`, said in plain words.
 *
 * Run once after Start (and again on request) with the same sealed environment as the install. REA's doctor reports
 * checks, not capabilities, so this reads the checks it can name: the Windows native controls (the doctor's own
 * message, and the two files on disk) decide whether static JavaScript and Electron analysis can run; Hopper, Ghidra,
 * IDA and JADX are each "installed" only when their own check passes. Those four are never installed by Sequence.
 * The result is cached in the install folder so opening Settings does not run REA again.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProgressEvent, Runner, StepState } from './reaInstall.js';
import { REA_ADDON } from './reaAddon.js';

export const DOCTOR_FILE = 'sequence-doctor.json';

export interface DoctorEngine {
  id: 'hopper' | 'ghidra' | 'ida' | 'jadx';
  name: string;
  installed: boolean;
  /** One line, shown when it is not installed. No action is offered. */
  hint: string;
}

export interface ReaDoctor {
  checkedAt: string;
  /** False when REA could not be run at all or its answer could not be read. */
  ran: boolean;
  exitCode: number | null;
  /** True when REA itself calls the install healthy (it never does without the external engines). */
  healthy: boolean | null;
  windowsNative: 'present' | 'missing' | 'not-needed';
  /** Static JavaScript and Electron analysis: needs no external program, only the native files on Windows. */
  staticAnalysis: boolean;
  engines: DoctorEngine[];
  /** The result in sentences, ready to print. */
  lines: string[];
  error?: string;
}

const ENGINES: { id: DoctorEngine['id']; check: string; name: string; hint: string }[] = [
  { id: 'hopper', check: 'hopper', name: 'Hopper', hint: 'Not installed. Install Hopper yourself if you want it.' },
  { id: 'ghidra', check: 'ghidra', name: 'Ghidra', hint: 'Not installed. Install Ghidra yourself and set GHIDRA_INSTALL_DIR.' },
  { id: 'ida', check: 'ida-registration', name: 'IDA', hint: 'Not installed. Install IDA yourself if you have a licence.' },
  { id: 'jadx', check: 'jadx', name: 'JADX', hint: 'Not installed. Install JADX and Java yourself for Android apps.' },
];

interface RawCheck {
  name?: unknown;
  ok?: unknown;
  detail?: unknown;
}

const NATIVE_MISSING = /native controls are unavailable/i;

function nativeOnDisk(installDir: string): boolean {
  return REA_ADDON.files.every((f) => fs.existsSync(path.join(installDir, ...f.split('/'))));
}

/** Turn the doctor's JSON (or its absence) into the sentences the row shows. Pure. */
export function summariseDoctor(raw: unknown, ctx: { exitCode: number | null; platform: NodeJS.Platform; nativeOnDisk: boolean; now?: Date; error?: string }): ReaDoctor {
  const checkedAt = (ctx.now ?? new Date()).toISOString();
  const doc = raw as { healthy?: unknown; scope_checks?: unknown; checks?: unknown } | null;
  const list = (Array.isArray(doc?.checks) ? doc!.checks : Array.isArray(doc?.scope_checks) ? doc!.scope_checks : null) as RawCheck[] | null;
  const nativeNeeded = ctx.platform === 'win32';
  if (!list) {
    return {
      checkedAt,
      ran: false,
      exitCode: ctx.exitCode,
      healthy: null,
      windowsNative: nativeNeeded ? (ctx.nativeOnDisk ? 'present' : 'missing') : 'not-needed',
      staticAnalysis: false,
      engines: ENGINES.map((e) => ({ id: e.id, name: e.name, installed: false, hint: e.hint })),
      lines: ['REA is installed, but its check did not give an answer Sequence could read, so nothing is claimed about what works.'],
      error: ctx.error ?? 'rea doctor --json gave no readable result',
    };
  }
  const nativeComplaint = list.some((c) => typeof c.detail === 'string' && NATIVE_MISSING.test(c.detail));
  const windowsNative: ReaDoctor['windowsNative'] = !nativeNeeded ? 'not-needed' : ctx.nativeOnDisk && !nativeComplaint ? 'present' : 'missing';
  const staticAnalysis = !nativeComplaint && (!nativeNeeded || ctx.nativeOnDisk);
  const engines: DoctorEngine[] = ENGINES.map((e) => ({ id: e.id, name: e.name, installed: list.some((c) => c.name === e.check && c.ok === true), hint: e.hint }));
  const lines: string[] = [];
  lines.push(
    staticAnalysis
      ? 'Static JavaScript and Electron analysis: available.'
      : nativeNeeded
        ? 'Static JavaScript and Electron analysis: not available, because the Windows native files are missing.'
        : 'Static JavaScript and Electron analysis: not available on this machine.',
  );
  lines.push('Listing what is inside an .asar or archive: available.');
  for (const e of engines) lines.push(e.installed ? `${e.name}: installed.` : `${e.name}: ${e.hint}`);
  return { checkedAt, ran: true, exitCode: ctx.exitCode, healthy: typeof doc?.healthy === 'boolean' ? doc.healthy : null, windowsNative, staticAnalysis, engines, lines };
}

export function readDoctor(installDir: string): ReaDoctor | null {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(installDir, DOCTOR_FILE), 'utf8')) as Partial<ReaDoctor>;
    return d && typeof d.checkedAt === 'string' && Array.isArray(d.lines) && Array.isArray(d.engines) ? (d as ReaDoctor) : null;
  } catch {
    return null;
  }
}

function parseJsonObject(text: string): unknown {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Run `rea doctor --json` in the install, cache the plain-words result, and say so through `emit`. Never throws. */
export async function checkDoctor(opts: {
  installDir: string;
  run: Runner;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  emit?: (step: ProgressEvent['step'], state: StepState, detail?: string) => void;
}): Promise<ReaDoctor> {
  opts.emit?.('doctor', 'running');
  const entry = path.join(opts.installDir, 'scripts', 'rea.mjs');
  /* the doctor exits 1 whenever anything is unhealthy, which is always so without Hopper, Ghidra, IDA and JADX: the JSON is the answer, not the code */
  const r = await opts.run('node', [entry, 'doctor', '--json'], { cwd: opts.installDir, env: opts.env, timeoutMs: 120_000, maxOutputChars: 4_000_000 });
  const raw = parseJsonObject(r.stdout);
  const result = summariseDoctor(raw, {
    exitCode: r.code,
    platform: opts.platform,
    nativeOnDisk: nativeOnDisk(opts.installDir),
    ...(raw === null ? { error: r.code === null ? 'rea doctor did not finish' : `rea doctor --json exited ${r.code} with no JSON: ${(r.stderr || r.stdout).trim().slice(-300)}` } : {}),
  });
  try {
    fs.writeFileSync(path.join(opts.installDir, DOCTOR_FILE), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch {
    /* read-only folder: the answer is still returned */
  }
  opts.emit?.('doctor', result.ran ? 'done' : 'failed', result.error);
  return result;
}
