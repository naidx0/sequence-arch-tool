/* The two ways out of "Export as Remotion": the clipboard and a downloaded .tsx (the same Blob + anchor path as the
   canvas HTML export, app/canvasExportHtml.ts). The text itself is scene.ts `remotionSource`. */

import { remotionSource } from './sceneRemotion';
import type { WbItem, WbScene } from './whiteboardModel';

export function sceneRemotionSource(scene: WbScene, items: readonly WbItem[]): string {
  return remotionSource({ scene, items: items.filter((i) => i.kind !== 'scene' && i.kind !== 'artifact') });
}

export function sceneFilename(scene: WbScene): string {
  const stem = (scene.title ?? scene.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
  return `${stem}.remotion.tsx`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
