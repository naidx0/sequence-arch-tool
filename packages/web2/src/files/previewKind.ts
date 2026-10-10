/* What a file renders as (round 7, B8). Kept apart from FilePreview.tsx so the
   panel can decide its modes at boot while the preview itself (and the prose
   renderer it pulls in) loads the first time a file is previewed. */

import type { RepoPath } from './filesModel';

export type PreviewKind = 'html' | 'markdown' | 'svg' | 'image';

const RASTER = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;

/** What a path renders as, or null when it only has a code view. */
export function previewKind(path: RepoPath | null): PreviewKind | null {
  if (path === null) return null;
  const p = path.toLowerCase();
  if (/\.html?$/.test(p)) return 'html';
  if (/\.(md|markdown|mdx)$/.test(p)) return 'markdown';
  if (p.endsWith('.svg')) return 'svg';
  if (RASTER.test(p)) return 'image';
  return null;
}
