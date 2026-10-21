import { lazy, Suspense } from 'react';

const Trace = lazy(() => import('./ReasoningTraceView').then((m) => ({ default: m.ReasoningTraceView })));

/** No renderer/parser download until there is provider reasoning to display. */
export function LazyReasoningTrace({ chunks, streaming }: { chunks: readonly string[]; streaming?: boolean }) {
  if (!chunks.some((chunk) => chunk.trim())) return null;
  return <Suspense fallback={null}><Trace chunks={chunks} streaming={streaming} /></Suspense>;
}
