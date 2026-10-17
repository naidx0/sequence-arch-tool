/* ══════════════════════════════════════════════════════════════════════════
   "TELL ME WHEN AN AGENT FINISHES OR NEEDS ME" (S5)
   packages/web2/src/settings/AttentionSetting.tsx

   Two switches, on by default (attentionPreference.ts says why). In the
   desktop app the OS draws the notification and they are simply on. In a
   browser they read OFF until the permission is granted, because a switch
   drawn on over a permission nobody gave would be a promise nothing keeps,
   and the FIRST click to enable is the one place the browser prompt is
   raised (notifyModel's ruling: the person picks the moment).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import { isDesktop } from '../boot/desktopBridge';
import { desktopAttention } from '../notify/attention';
import { acknowledgeRunNotify } from './notifyPreference';
import { readAttentionEnabled, writeAttentionEnabled, type AttentionKind } from './attentionPreference';
import type { NotifyPermission } from './notifyModel';

function currentPermission(): NotifyPermission {
  if (isDesktop()) return 'granted';
  return typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as NotifyPermission);
}

const ROWS: { kind: AttentionKind; label: string; sub: string }[] = [
  { kind: 'approvals', label: 'When an agent needs an approval', sub: 'While Sequence is in the background' },
  { kind: 'turns', label: 'When an agent’s turn ends', sub: 'Finished or failed, while Sequence is in the background.' },
];

export function AttentionSetting() {
  const [permission, setPermission] = useState<NotifyPermission>(currentPermission);
  const [prefs, setPrefs] = useState(() => ({ turns: readAttentionEnabled('turns'), approvals: readAttentionEnabled('approvals') }));
  const usable = permission === 'granted';
  /* Windows refused the last toast because its own settings switch them off
     (desktop main reads Electron's 'failed' HRESULT). Said once, quietly; the
     badge and the taskbar flash still work, and we never ask anyone to change
     their system settings. */
  const [osBlocked, setOsBlocked] = useState(false);
  useEffect(() => {
    let live = true;
    void desktopAttention()
      ?.attention({ kind: 'status' })
      .then((st) => {
        if (live) setOsBlocked((st as { notificationsBlocked?: unknown } | null)?.notificationsBlocked === true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const set = (kind: AttentionKind, on: boolean): void => {
    writeAttentionEnabled(kind, on);
    /* Touching the switch is the opt-in that lets workflow runs notify too (notifyPreference). */
    if (kind === 'turns') acknowledgeRunNotify();
    setPrefs((p) => ({ ...p, [kind]: on }));
  };

  const toggle = async (kind: AttentionKind, on: boolean): Promise<void> => {
    if (!on || usable) {
      set(kind, on);
      return;
    }
    if (permission !== 'default') return;
    /* THE ONLY PROMPT, one click from a person who just read what it does. */
    const answer = (await Notification.requestPermission()) as NotifyPermission;
    setPermission(answer);
    if (answer === 'granted') set(kind, true);
  };

  return (
    <section className="sb-group" data-testid="settings-attention">
      <h3 className="sb-lab">Notifications</h3>
      <div className="sb-card">
      {ROWS.map((row) => (
        <label key={row.kind} className="sb-row sb-row-switch" data-testid={`settings-attention-${row.kind}`}>
          <input
            type="checkbox"
            role="switch"
            className="sb-switch"
            checked={usable && prefs[row.kind]}
            disabled={permission === 'denied' || permission === 'unsupported'}
            onChange={(e) => void toggle(row.kind, e.currentTarget.checked)}
          />
          <span className="sb-row-txt">
            <span>{row.label}</span>
            <span className="sb-row-sub">{row.sub}</span>
          </span>
        </label>
      ))}
      {osBlocked ? (
        <p className="sb-note" data-testid="settings-attention-os-blocked" role="status">
          Windows is blocking Sequence notifications
        </p>
      ) : null}
      {permission === 'unsupported' ? (
        <p className="sb-note" data-testid="settings-attention-unsupported">
          Notifications are not available here.
        </p>
      ) : null}
      {permission === 'denied' ? (
        <p className="sb-note" data-testid="settings-attention-denied">
          Notifications are blocked. Allow them in your browser&rsquo;s site settings, then come back.
        </p>
      ) : null}
      {permission === 'default' ? (
        <p className="sb-note" data-testid="settings-attention-ask">
          Your browser asks once, the first time you turn one on.
        </p>
      ) : null}
      </div>
    </section>
  );
}
export default AttentionSetting;
