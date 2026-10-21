/* ══════════════════════════════════════════════════════════════════════════
   OPEN A DRAWN BLOCK LARGE, WITH THE ROUND-8 PREVIEW AND EDITOR
   packages/web2/src/chat/VisualOpenDialog.tsx

   A scratch viewer (an svg is previewed inline in the framed page so it follows the theme): the Files panel's own framed preview (FilePreview: scripts
   off until asked, network refused either way) beside its CodeEditor. Edits
   change the preview and nothing else; nothing is written to the repository.
   Loaded the first time Open is pressed (perf ratchet).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import CodeEditor from '../files/CodeEditor';
import FilePreview from '../files/FilePreview';
import { stripEmojiHtml } from './drawingEmoji';
import { fittedSvg } from './svgFit';
import type { RepoPath } from '../files/filesModel';

export default function VisualOpenDialog({ kind, source, onClose }: { kind: 'svg' | 'html'; source: string; onClose: () => void }) {
  const [text, setText] = useState(source);
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const path = (kind === 'svg' ? 'drawing.svg' : 'page.html') as RepoPath;
  /* The preview shows the drawing as the chat does: text fitted to its boxes. The editor keeps the source as written. */
  const shown = stripEmojiHtml(kind === 'svg' ? fittedSvg(text) : text); // no emoji in the drawn copy; the editor keeps the source
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="s2 s2-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="s2-dlg dgm-open-card" role="dialog" aria-modal="true" aria-label="Preview and editor" data-testid="chat-visual-dialog">
        <div className="dgm-open-bar">
          <span className="dgm-label">{kind === 'svg' ? 'Drawing' : 'Page'}: a scratch copy, not saved to your files</span>
          <button type="button" className="s2-btn s2-btn-sm" data-testid="chat-visual-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dgm-open-body">
          <div className="dgm-open-pane files-scope">
            <FilePreview kind="html" path={'preview.html' as RepoPath} text={shown} center={kind === 'svg'} drawing />
          </div>
          <div className="dgm-open-pane files-scope">
            <div className="files-edit">
              <CodeEditor path={path} value={text} onChange={setText} dirty={text !== source} onDiscard={() => setText(source)} />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
