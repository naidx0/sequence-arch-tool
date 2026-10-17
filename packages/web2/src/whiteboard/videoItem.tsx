/* ══════════════════════════════════════════════════════════════════════════
   A VIDEO ON A SPACE: `{kind:'video', at, w, h, src, poster?, label?}`
   packages/web2/src/whiteboard/videoItem.tsx

   `src` is a REPO-RELATIVE .mp4, .webm or .gif (backend-shapes.md "Spaces extras"), served by GET /api/media (Range 206/416, the same jail and session gate as the file route),
   which answers Range requests so the player can seek. Nothing else is accepted: no scheme, no absolute path, no `..`.
   A file that is not there (a 404, a codec the browser cannot play) leaves a quiet placeholder with the name, never a
   broken player and never an error on the board.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';

const VIDEO_EXT = /\.(mp4|webm|gif)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** A repo-relative path to a playable file, or null. */
export function cleanMediaPath(src: unknown, ext: RegExp = VIDEO_EXT): string | null {
  if (typeof src !== 'string' || src === '' || src.length > 500) return null;
  const p = src.replace(/\\/g, '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('/') || p.startsWith('//') || /(^|\/)\.\.(\/|$)/.test(p) || /[\u0000-\u001f?#%]/.test(p)) return null;
  return ext.test(p) ? p : null;
}

/** THE ONE PLACE the media route is named (a video and its poster both go through `mediaUrl`). */
export const MEDIA_ROUTE = "/api/media";
export const mediaUrl = (path: string): string => `${MEDIA_ROUTE}?path=${encodeURIComponent(path)}`;

export function VideoBody({ src, poster, label, w, h }: { src: string; poster?: string | undefined; label?: string | undefined; w: number; h: number }) {
  const [failed, setFailed] = useState(false);
  const path = cleanMediaPath(src);
  const posterPath = poster === undefined ? null : cleanMediaPath(poster, IMAGE_EXT);
  const gone = path === null || failed;
  return (
    <div className="wb-video" data-testid="wb-video" data-state={gone ? 'unavailable' : 'ready'} style={{ width: w, height: h }}>
      {gone ? (
        <div className="wb-video-gone" data-testid="wb-video-gone">
          <span>Video unavailable</span>
          <span className="wb-video-name">{label ?? src}</span>
        </div>
      ) : /\.gif$/i.test(path) ? (
        <img src={mediaUrl(path)} alt={label ?? ''} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <video
          controls
          preload="metadata"
          playsInline
          src={mediaUrl(path)}
          {...(posterPath ? { poster: mediaUrl(posterPath) } : {})}
          aria-label={label ?? 'Video'}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
    </div>
  );
}
