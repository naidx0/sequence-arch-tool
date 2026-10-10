/* ══════════════════════════════════════════════════════════════════════════
   WHITEBOARD: TIDY-UP AND THE LOCAL EDIT LOG
   packages/web2/src/settings/WhiteboardSetting.tsx

   Two rows. "Tidy drawn shapes" chooses what happens after you draw a rough
   box, ellipse, diamond or arrow: Suggest (the default; a small offer, Enter
   takes it), Auto (done for you; Ctrl+Z gives the raw stroke back) or Off.
   Handwriting is never tidied. "Keep a local edit log" is the opt-out switch for
   the file of moves, renames and tidy-ups in the project's .sequence folder,
   which never leaves the machine (analyzer boardEditLog.ts).
   ══════════════════════════════════════════════════════════════════════════ */

import { useRef, useState } from 'react';

import {
  readEditLogEnabled,
  readSnapMode,
  writeEditLogEnabled,
  writeSnapMode,
  type SnapMode,
} from '../whiteboard/snapPreference';

const HINTS: Record<SnapMode, string> = {
  suggest: 'After you draw a shape, a small offer appears. Enter takes it.',
  auto: 'Shapes are tidied as soon as you stop drawing. Ctrl+Z gives your stroke back.',
  off: 'Every stroke stays exactly as drawn.',
};

const CHOICES: { id: SnapMode; label: string }[] = [
  { id: 'suggest', label: 'Suggest' },
  { id: 'auto', label: 'Auto' },
  { id: 'off', label: 'Off' },
];

/* One segmented control, the Theme row's (.sb-seg): radio keys, arrows move and choose. */
export function WhiteboardSetting() {
  const [mode, setMode] = useState<SnapMode>(readSnapMode);
  const group = useRef<HTMLDivElement>(null);
  const pick = (next: SnapMode) => {
    setMode(next);
    writeSnapMode(next);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = CHOICES.findIndex((c) => c.id === mode);
    const next = CHOICES[(at + step + CHOICES.length) % CHOICES.length]!;
    pick(next.id);
    group.current?.querySelector<HTMLButtonElement>(`[data-snap-choice="${next.id}"]`)?.focus();
  };
  const [log, setLog] = useState(readEditLogEnabled);
  return (
    <section className="sb-group" data-testid="settings-whiteboard">
      <h3 className="sb-lab">Whiteboard</h3>
      <div className="sb-card">
        <div className="sb-row sb-theme" data-testid="settings-snap">
          <span className="sb-row-txt">
            <span className="sb-row-t">Tidy drawn shapes</span>
            <span className="sb-row-sub" data-testid="settings-snap-hint">{HINTS[mode]}</span>
          </span>
          <div className="sb-seg" role="radiogroup" aria-label="Tidy drawn shapes" ref={group} onKeyDown={onKeyDown}>
            {CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={mode === c.id}
                tabIndex={mode === c.id ? 0 : -1}
                data-snap-choice={c.id}
                className={mode === c.id ? 'is-on' : undefined}
                onClick={() => pick(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <label className="sb-row sb-row-switch" data-testid="settings-editlog">
          <input
            type="checkbox"
            role="switch"
            className="sb-switch"
            data-testid="settings-editlog-switch"
            checked={log}
            onChange={(e) => {
              setLog(e.target.checked);
              writeEditLogEnabled(e.target.checked);
            }}
          />
          <span className="sb-row-txt">
            <span className="sb-row-t">Keep a local edit log</span>
            <span className="sb-row-sub">Moves, renames and tidy-ups, saved in this project’s .sequence folder. Never sent anywhere.</span>
          </span>
        </label>
      </div>
    </section>
  );
}

export default WhiteboardSetting;
