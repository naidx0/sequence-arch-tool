/**
 * POST /api/scan → a ScannedRepoDraft the store already knows how to load.
 *
 * The rail's stale strip used to omit Retry because nothing here called the
 * route. A button that opens nothing is worse than no button — so the button
 * stayed off until this client existed.
 *
 * When the server offers SSE (`Accept: text/event-stream`), progress events are
 * forwarded to `onProgress` before the graph lands. JSON-only hosts keep the
 * old single-response path; the UI still shows elapsed time client-side.
 */
import type { GetArchGraphResponse } from '@sequence/api-types';

import { readScannedGraph, summarizeGraph, type ScannedRepoDraft } from '../boot/bootSequence';
import type { ScanProgress } from '../state/types';

export type RescanResult =
  | { outcome: 'ok'; draft: ScannedRepoDraft }
  | { outcome: 'failed'; message: string; status: number | null };

export type ScanProgressHandler = (progress: ScanProgress) => void;

function draftFromBody(body: unknown): ScannedRepoDraft | null {
  const graph = readScannedGraph(body);
  if (graph === null) return null;
  const root =
    typeof (body as { repoRoot?: unknown }).repoRoot === 'string'
      ? (body as { repoRoot: string }).repoRoot
      : typeof (body as { root?: unknown }).root === 'string'
        ? (body as { root: string }).root
        : '';
  const repoName =
    typeof (body as { repoName?: unknown }).repoName === 'string'
      ? (body as { repoName: string }).repoName
      : root.split(/[/\\]/).filter(Boolean).pop() ?? 'repository';
  return {
    root: root || '.',
    repoName,
    graph: graph as GetArchGraphResponse,
    summary: summarizeGraph(graph),
    scannedAt: graph.scannedAt,
  };
}

/** Parse SSE `data:` payloads from a scan stream (exported for tests). */
export function parseScanSseChunk(buffer: string): {
  events: Record<string, unknown>[];
  rest: string;
} {
  const events: Record<string, unknown>[] = [];
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (!clean.startsWith('data: ')) continue;
      try {
        events.push(JSON.parse(clean.slice(6)) as Record<string, unknown>);
      } catch {
        /* ignore partial garbage between chunks */
      }
    }
  }
  return { events, rest };
}

function progressFromEvent(event: Record<string, unknown>): ScanProgress | null {
  if (event.type !== 'scan:progress') return null;
  const done = event.done;
  const total = event.total;
  if (typeof done !== 'number' || typeof total !== 'number') return null;
  const path = typeof event.path === 'string' ? event.path : undefined;
  const phase = typeof event.phase === 'string' ? event.phase : undefined;
  return { done, total, ...(path ? { path } : {}), ...(phase ? { phase } : {}) };
}

async function consumeScanStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: ScanProgressHandler,
): Promise<{ outcome: 'ok'; draft: ScannedRepoDraft } | { outcome: 'failed'; message: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let draft: ScannedRepoDraft | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseScanSseChunk(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      const progress = progressFromEvent(event);
      if (progress) onProgress?.(progress);
      if (event.type === 'scan:result') {
        const graph = (event as { graph?: unknown }).graph ?? event;
        draft = draftFromBody(graph);
      }
      if (event.type === 'scan:error') {
        const message =
          typeof event.error === 'string' ? event.error : 'the rescan stopped part way';
        return { outcome: 'failed', message };
      }
    }
  }

  if (buffer.trim()) {
    const parsed = parseScanSseChunk(`${buffer}\n\n`);
    for (const event of parsed.events) {
      const progress = progressFromEvent(event);
      if (progress) onProgress?.(progress);
      if (event.type === 'scan:result') {
        const graph = (event as { graph?: unknown }).graph ?? event;
        draft = draftFromBody(graph);
      }
      if (event.type === 'scan:error') {
        const message =
          typeof event.error === 'string' ? event.error : 'the rescan stopped part way';
        return { outcome: 'failed', message };
      }
    }
  }

  if (draft === null) {
    return {
      outcome: 'failed',
      message: 'the rescan stream ended without a graph',
    };
  }
  return { outcome: 'ok', draft };
}

export async function rescanRepo(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  onProgress?: ScanProgressHandler,
): Promise<RescanResult> {
  let res: Response;
  try {
    res = await fetchImpl('/api/scan', {
      method: 'POST',
      headers: { Accept: 'text/event-stream, application/json' },
      signal,
    });
  } catch (error) {
    return {
      outcome: 'failed',
      status: null,
      message: (error as Error).message || 'the engine did not answer',
    };
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (res.ok && contentType.includes('text/event-stream') && res.body) {
    const streamed = await consumeScanStream(res.body, onProgress);
    if (streamed.outcome === 'failed') {
      return { outcome: 'failed', status: res.status, message: streamed.message };
    }
    return { outcome: 'ok', draft: streamed.draft };
  }

  if (!res.ok) {
    let message = `rescan refused (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      /* keep status line */
    }
    return { outcome: 'failed', status: res.status, message };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      outcome: 'failed',
      status: res.status,
      message: 'the rescan answered with something that was not JSON',
    };
  }
  const draft = draftFromBody(body);
  if (draft === null) {
    return {
      outcome: 'failed',
      status: res.status,
      message: 'the rescan answered with a body that is not a graph',
    };
  }
  return { outcome: 'ok', draft };
}
