import { useRef, useState } from 'react';
import { Icon } from '../chat/Icon';
import { readTheme, writeTheme, type Theme } from './themePreference';

/* Light / Dark / System as one segmented control: equal widths, one font, an icon and a label each.
   Same look as the shell's .s2-seg (a rounded track, the chosen segment lifted), restyled for Settings in
   settings.css as .sb-seg. */
const CHOICES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

function Monitor() {
  return (
    <svg className="i i-14" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="monitor" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="12" rx="2.4" />
      <path d="M9 20h6M12 16.5V20" />
    </svg>
  );
}

export function ThemeSetting() {
  const [theme, setTheme] = useState(readTheme);
  const pick = (next: Theme) => {
    setTheme(next);
    writeTheme(next);
  };
  const group = useRef<HTMLDivElement>(null);
  /* Radio-group keys: arrows move AND select, wrapping; only the checked radio is a tab stop. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = CHOICES.findIndex((c) => c.id === theme);
    const next = CHOICES[(at + step + CHOICES.length) % CHOICES.length]!;
    pick(next.id);
    group.current?.querySelector<HTMLButtonElement>(`[data-theme-choice="${next.id}"]`)?.focus();
  };
  return <div className="sb-row sb-theme" data-testid="settings-theme">
    <span className="sb-row-txt"><span className="sb-row-t">Theme</span><span className="sb-row-sub">System follows your device appearance.</span></span>
    <div className="sb-seg" role="radiogroup" aria-label="Theme" ref={group} onKeyDown={onKeyDown}>
      {CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={theme === c.id}
          tabIndex={theme === c.id ? 0 : -1}
          data-theme-choice={c.id}
          className={theme === c.id ? 'is-on' : undefined}
          onClick={() => pick(c.id)}
        >
          {c.id === 'light' ? <Icon name="sun" size={14} /> : c.id === 'dark' ? <Icon name="moon" size={14} /> : <Monitor />}
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  </div>;
}
