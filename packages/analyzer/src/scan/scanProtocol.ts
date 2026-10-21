import type { PartSignatures } from '../server/graphCache.js';
import type { FileSnapshot } from '../parse/scanIndex.js';
import type { LabelModel } from '../llm/label.js';

/**
 * What crosses the boundary between the server and the scan worker.
 *
 * Plain data only: no functions, no class instances, no graph objects. The graph
 * comes back as JSON TEXT so the main thread never pays a structured clone of a
 * multi-megabyte object graph.
 */

/** The scan options that can cross a thread boundary (`ScanOptions` minus its callbacks). */
export interface PlainScanOptions {
  cluster?: boolean;
  llm?: boolean;
  maxFiles?: number;
}

export interface ScanWorkerData {
  root: string;
  scan: PlainScanOptions;
  /**
   * The connected model for the labelling pass. It travels ONLY here, in
   * `workerData`: no message in either direction carries it and nothing logs it.
   */
  labelModel?: LabelModel;
  /** The content signature the cache is written under, and the part map it was cut from. */
  signature: string;
  sigs?: PartSignatures;
  /** What the signature walk saw (files and their stats), so the scan does not walk and stat again. */
  files?: FileSnapshot;
  /** Post `progress` ticks (also makes the parse pass yield, as the startup attach does). */
  progress: boolean;
  /** Build and persist the function graph from this scan's own parsed facts afterwards. */
  functions: boolean;
  /** Run this scan and exit (it carries a label model, which must never reach a reused worker). */
  oneShot?: boolean;
  /** Not a scan at all: start up (modules, parser), then wait for `{type:'run'}` messages. */
  standby?: boolean;
  /**
   * Not a scan either: build and persist the function graph for `graph` (from the index's facts), post `functions`, exit.
   * This is how GET /api/functions gets a graph nobody has built yet without building it on the server's loop.
   */
  functionsOnly?: boolean;
  graph?: unknown;
}

export type ScanWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'graph';
      /** the whole graph as one JSON text (a worker that does not split it) */
      text?: string;
      /** the graph's top-level members, each its own JSON text, in key order: the main thread parses one per tick */
      parts?: Array<[string, string]>;
      /** the node detail for this graph (explain/seqdEnrichment), computed here so the main thread need not */
      detail?: string;
      scanMs: number;
      persistMs: number;
      stringifyMs: number;
    }
  | { type: 'functions'; warnings: string[]; ms: number }
  /** Everything for this scan is finished, cache writes included. `retire`: do not send this worker another. */
  | { type: 'done'; retire: boolean }
  | { type: 'error'; name: string; code?: string; message: string; stack?: string };
