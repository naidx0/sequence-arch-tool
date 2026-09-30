/* ══════════════════════════════════════════════════════════════════════════
   ONE CLICK TO A LOCAL MODEL
   packages/analyzer/src/server/localSetup.ts

   Owner, 2026-09-19: "also render in a one-click local AI setup like Hermes
   does I think with Magnitude Dev — research and make sure we can do that now."

   ── WHAT MAGNITUDE DOES, AND WHICH HALF OF IT IS HONEST FOR US ────────────

   Magnitude's desktop app profiles the machine, estimates tokens/second for
   every model and quant in its catalogue BEFORE anything is downloaded, ranks
   them, then downloads and tunes the one you pick. The pitch is that Ollama and
   LM Studio run whatever you pick and Magnitude helps you pick.

   WE CANNOT ESTIMATE TOKENS PER SECOND AND WILL NOT PRETEND TO. That number
   comes from a hardware profile plus a measured throughput model, and inventing
   it would be exactly the confident wrong figure this product exists to catch
   in other tools (CLAUDE.md, grounded-not-guessed).

   What we CAN answer, from facts on this machine, is the question that
   actually blocks a new reader:

     · Is there already a model here that will run?     `GET /api/tags`, real
                                                        sizes, no download.
     · If not, which one FITS?                          RAM, and the model's
                                                        own file size.
     · Can the app do the rest without a terminal?      start the server, pull
                                                        the model, write the
                                                        profile.

   So the ranking is by FIT, not by speed, and the UI says "fits in your
   memory" rather than "runs at 40 tok/s". A smaller true claim.

   ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────

   IT DOES NOT INSTALL OLLAMA. Downloading and running an installer on
   somebody's machine is not a button this product gets to own; when Ollama is
   absent the answer is the link and the sentence, and the person decides.
   `localProviders.ts` already draws this line for detection ("the detection is
   an OFFER") and this is the same line one step further along.

   IT ONLY EVER TALKS TO 127.0.0.1:11434, as a literal, for the reason that
   file gives: a list a caller could extend is a server-side request forgery
   with a configuration file in front of it.

   IT NEVER CHOOSES SILENTLY. Every function here REPORTS; writing the profile
   is a separate act the route performs when the reader has pressed the button.
   ══════════════════════════════════════════════════════════════════════════ */

import os from 'node:os';

/** The one host this module will speak to, as a literal. */
export const OLLAMA_ORIGIN = 'http://127.0.0.1:11434';

/** A tag listing is small; a pull stream is not, and is read incrementally. */
export const OLLAMA_TAGS_TIMEOUT_MS = 1_500;
export const OLLAMA_TAGS_MAX_BYTES = 1024 * 1024;

/** One model Ollama already has on disk. */
export interface InstalledModel {
  /** The tag, e.g. `qwen3:8b` — what a request must name. */
  name: string;
  /** On-disk size in bytes, as Ollama reported it. Never estimated. */
  bytes: number;
  /** Parameter size as Ollama reported it, e.g. `8.0B`, when it said. */
  parameters?: string;
}

/**
 * Parse `GET /api/tags`.
 *
 * FORGIVING ABOUT SHAPE, STRICT ABOUT INVENTION. Ollama has moved fields
 * between top level and `details` across versions; anything this cannot read
 * is omitted rather than defaulted, because a model listed with a size of 0
 * would sort to the front of a list ranked by fit.
 */
export function installedFrom(body: unknown): InstalledModel[] {
  if (typeof body !== 'object' || body === null) return [];
  const raw = (body as { models?: unknown }).models;
  if (!Array.isArray(raw)) return [];
  const out: InstalledModel[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as { name?: unknown; size?: unknown; details?: unknown };
    if (typeof row.name !== 'string' || row.name === '') continue;
    if (typeof row.size !== 'number' || !Number.isFinite(row.size) || row.size <= 0) continue;
    const details = typeof row.details === 'object' && row.details !== null ? row.details : {};
    const params = (details as { parameter_size?: unknown }).parameter_size;
    out.push({
      name: row.name,
      bytes: row.size,
      ...(typeof params === 'string' && params !== '' ? { parameters: params } : {}),
    });
  }
  return out;
}

/** What this machine has to spend on a model. */
export interface MachineProfile {
  /** Total physical memory, bytes. `os.totalmem()`, never guessed. */
  totalMemoryBytes: number;
  /** Free physical memory at the moment of the reading, bytes. */
  freeMemoryBytes: number;
  /** Logical cores. Reported because it is the other thing that bounds speed. */
  cpus: number;
}

export function machineProfile(): MachineProfile {
  return {
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    cpus: os.cpus().length,
  };
}

/**
 * THE MEMORY A MODEL MAY USE, and the number is a rule rather than a taste.
 *
 * A GGUF's weights must be resident to answer at a usable speed, and the rest
 * of the machine — the OS, this app's own Electron process, the person's
 * editor and browser — does not stop needing memory while it does. Running a
 * model that does not fit does not fail; it SWAPS, which looks to the reader
 * like the product having hung, and is the worst of the three outcomes because
 * it is the one they cannot diagnose.
 *
 * 60% of total is the budget. It is deliberately conservative: the cost of
 * being wrong in one direction is a slightly smaller model, and in the other
 * is a machine that stops responding.
 */
export const MODEL_MEMORY_BUDGET = 0.6;

/** Weights plus the KV cache and runtime overhead: a model needs more than its file. */
export const MODEL_RUNTIME_OVERHEAD = 1.25;

export function memoryBudgetBytes(profile: MachineProfile): number {
  return Math.floor(profile.totalMemoryBytes * MODEL_MEMORY_BUDGET);
}

export function fitsInMemory(model: InstalledModel, profile: MachineProfile): boolean {
  return model.bytes * MODEL_RUNTIME_OVERHEAD <= memoryBudgetBytes(profile);
}

/**
 * The best model already on this machine, or null.
 *
 * BIGGEST THAT FITS. Among models that fit, more weights is more capable at
 * the same architecture, and the reader who already downloaded a 14B did so
 * for a reason. Among models that do NOT fit, none is offered — the honest
 * answer to "everything here is too big" is to say so, not to pick the least
 * bad one and let it swap.
 *
 * TIES BREAK BY NAME so the same machine gets the same answer twice. A
 * recommendation that changes between two identical readings is one nobody can
 * report a bug about.
 */
export function bestInstalled(
  models: readonly InstalledModel[],
  profile: MachineProfile,
): InstalledModel | null {
  const fits = models.filter((m) => fitsInMemory(m, profile));
  if (fits.length === 0) return null;
  return [...fits].sort((a, b) => (b.bytes - a.bytes) || a.name.localeCompare(b.name))[0]!;
}

/**
 * ── THE CATALOGUE, AND WHY IT IS FOUR ROWS ────────────────────────────────
 *
 * Magnitude ranks a whole catalogue because ranking IS its product. Ours is a
 * ladder with one rung per memory tier, because the reader pressing this
 * button has told us they do not want to choose — a list is the thing they
 * are escaping.
 *
 * NO SIZES ARE CLAIMED HERE. A download size written into this file is a
 * number that rots the next time the tag is rebuilt, and the reader would be
 * watching our stale figure while Ollama reported a different one. The PULL
 * reports the real total, and that is the only size the UI ever shows.
 *
 * `requiresBytes` is a floor on the MACHINE, not a claim about the file: it is
 * the total memory below which this rung is not offered.
 */
export interface CatalogueRung {
  /** The Ollama tag, exactly as `ollama pull` would take it. */
  model: string;
  /** Total machine memory at or above which this rung is offered. */
  requiresBytes: number;
  /** One line the UI shows beside it. */
  note: string;
}

const GB = 1024 * 1024 * 1024;

export const LOCAL_CATALOGUE: readonly CatalogueRung[] = [
  { model: 'qwen3:14b', requiresBytes: 32 * GB, note: 'The most capable rung this ladder offers.' },
  { model: 'qwen3:8b', requiresBytes: 16 * GB, note: 'The balance point on most machines.' },
  { model: 'qwen3:4b', requiresBytes: 8 * GB, note: 'Comfortable on a laptop.' },
  { model: 'qwen3:1.7b', requiresBytes: 0, note: 'Small enough for anything that can run this app.' },
];

/** The rung this machine gets. Never null: the last rung has no floor. */
export function recommendedRung(profile: MachineProfile): CatalogueRung {
  return (
    LOCAL_CATALOGUE.find((rung) => profile.totalMemoryBytes >= rung.requiresBytes) ??
    LOCAL_CATALOGUE[LOCAL_CATALOGUE.length - 1]!
  );
}

/** What the setup route answers. Every branch names a next step the reader can take. */
export type LocalSetupPlan =
  | {
      outcome: 'ready';
      /** Already on disk, fits, and is what the profile will be pointed at. */
      model: string;
      bytes: number;
      machine: MachineProfile;
    }
  | {
      outcome: 'needs-model';
      /** Nothing installed fits (or nothing is installed). Pull this. */
      recommended: string;
      note: string;
      /** What IS installed, so the reader can see why none of it was chosen. */
      installed: InstalledModel[];
      machine: MachineProfile;
    }
  | {
      outcome: 'needs-ollama';
      /** Where a person gets it. We do not install it for them. */
      downloadUrl: string;
      machine: MachineProfile;
    };

export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

/**
 * Decide the plan from facts already gathered.
 *
 * PURE, and that is the point: every branch above is reachable in a test
 * without a machine that has or has not got Ollama on it. The route does the
 * fetching; this does the deciding.
 */
export function planFrom(
  running: boolean,
  installed: readonly InstalledModel[],
  profile: MachineProfile,
): LocalSetupPlan {
  if (!running) {
    return { outcome: 'needs-ollama', downloadUrl: OLLAMA_DOWNLOAD_URL, machine: profile };
  }
  const best = bestInstalled(installed, profile);
  if (best) {
    return { outcome: 'ready', model: best.name, bytes: best.bytes, machine: profile };
  }
  const rung = recommendedRung(profile);
  return {
    outcome: 'needs-model',
    recommended: rung.model,
    note: rung.note,
    installed: [...installed],
    machine: profile,
  };
}

/** Ask Ollama what it has. Returns null when it is not there at all. */
export async function listInstalled(
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = OLLAMA_TAGS_TIMEOUT_MS,
): Promise<InstalledModel[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${OLLAMA_ORIGIN}/api/tags`, {
      signal: controller.signal,
      /* Manual, for the reason the probe gives: a followed redirect leaves
         localhost and this function's whole security property is that it does
         not. */
      redirect: 'manual',
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > OLLAMA_TAGS_MAX_BYTES) return null;
    return installedFrom(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Progress of a pull in flight, as the UI reads it. */
export interface PullProgress {
  state: 'pulling' | 'done' | 'error';
  model: string;
  /** Ollama's own status line, e.g. "pulling manifest". */
  status: string;
  /** Bytes fetched and total, when Ollama has said. Never estimated. */
  completed?: number;
  total?: number;
  message?: string;
}

/**
 * Fold one NDJSON line of `POST /api/pull` into the progress a reader sees.
 *
 * PURE so the stream reader stays three lines and every shape Ollama emits is
 * testable: the manifest line with no byte counts, a layer line with both, the
 * terminal `success`, and the `error` that arrives as a 200 with a body.
 */
export function pullProgressFrom(line: unknown, model: string): PullProgress | null {
  if (typeof line !== 'object' || line === null) return null;
  const row = line as { status?: unknown; error?: unknown; completed?: unknown; total?: unknown };
  if (typeof row.error === 'string' && row.error !== '') {
    return { state: 'error', model, status: 'error', message: row.error };
  }
  if (typeof row.status !== 'string') return null;
  const done = row.status === 'success';
  return {
    state: done ? 'done' : 'pulling',
    model,
    status: row.status,
    ...(typeof row.completed === 'number' ? { completed: row.completed } : {}),
    ...(typeof row.total === 'number' ? { total: row.total } : {}),
  };
}
