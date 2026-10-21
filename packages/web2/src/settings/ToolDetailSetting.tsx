/* ══════════════════════════════════════════════════════════════════════════
   FOCUSED OR DETAILED TOOL CALLS, IN SETTINGS > GENERAL
   packages/web2/src/settings/ToolDetailSetting.tsx

   The same preference as the status bar toggle and the Ctrl/Cmd+Shift+D key
   (settings/toolDetailPreference.ts). The control is Theme's own segmented
   picker (.sb-seg), so it reads as a neighbour of that row.
   ══════════════════════════════════════════════════════════════════════════ */

import { shortcutById, shortcutChord } from '../shell/shortcuts';
import { useToolDetail, writeToolDetail, type ToolDetail } from './toolDetailPreference';

const CHOICES: { id: ToolDetail; label: string }[] = [
  { id: 'focused', label: 'Focused' },
  { id: 'detailed', label: 'Detailed' },
];

export function ToolDetailSetting() {
  const mode = useToolDetail();
  return (
    <div className="sb-row sb-theme" data-testid="settings-tool-detail">
      <span className="sb-row-txt">
        <span className="sb-row-t">Tool calls</span>
        <span className="sb-row-sub">Focused folds tool calls and thinking into one line. {shortcutChord(shortcutById('tool-detail'))} switches.</span>
      </span>
      <div className="sb-seg" role="radiogroup" aria-label="Tool calls">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={mode === c.id}
            tabIndex={mode === c.id ? 0 : -1}
            data-detail-choice={c.id}
            className={mode === c.id ? 'is-on' : undefined}
            onClick={() => writeToolDetail(c.id)}
          >
            <span>{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default ToolDetailSetting;
