/* ══════════════════════════════════════════════════════════════════════════
   THE KEYS HELP (Cmd/Ctrl+/) — S5
   packages/web2/src/shell/KeysHelp.tsx

   Every row of shell/shortcuts.ts, grouped, with the chord written for this
   machine. Read from the same table the handlers match against, so a chord
   cannot be advertised here and bound to something else there.

   Lazy: KeysHost imports it only when the key is pressed. It wears the
   overlay host's own scrim and panel, so it looks like every other overlay
   and adds no colour of its own.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef } from 'react';

import './keysHelp.css';
import { isMacLike, shortcutChord, shortcutGroups } from './shortcuts';

export default function KeysHelp({ onClose, mac = isMacLike() }: { onClose: () => void; mac?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    /* Capture, and claim it: a modal on top takes Escape before the surfaces
       behind it (V3OverlayHost's rule). */
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="v3-overlay-scrim" data-kind="keys" role="presentation" onClick={onClose}>
      <div
        className="v3-overlay-panel keys-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keys-help-title"
        data-testid="keys-help"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="keys-help-head">
          <h2 id="keys-help-title" className="keys-help-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="keys-help-close" aria-label="Close keyboard shortcuts" title="Close (Esc)" onClick={onClose}>
            Esc
          </button>
        </div>
        {shortcutGroups().map(({ group, rows }) => (
          <section key={group} className="keys-help-group" aria-label={group}>
            <h3 className="keys-help-group-title">{group}</h3>
            <dl className="keys-help-list">
              {rows.map((s) => (
                <div key={s.id} className="keys-help-row" data-shortcut={s.id}>
                  <dt>
                    <kbd className="keys-help-kbd">{shortcutChord(s, mac)}</kbd>
                  </dt>
                  <dd>
                    {s.label}
                    {s.when ? <span className="keys-help-when"> — {s.when}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
