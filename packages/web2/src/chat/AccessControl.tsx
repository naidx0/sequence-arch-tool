/* ══════════════════════════════════════════════════════════════════════════
   INTENT AND ACCESS — inside the agent chip
   packages/web2/src/chat/AccessControl.tsx

   The composer bar keeps exactly three controls (owner, 2026-09-19: "plus,
   agent, send"), so intent and access ride in the AGENT chip: its label says
   the state ("MiniCPM5 · Build · Auto-edit", "MiniCPM5 · Plan"), and its
   popover gains two radio groups above the model list. Shift+Tab in the
   composer walks access through `useAccessSwitch().request`.

   Full access asks ONCE per project ("Agents can run any command without
   asking"), through GET/POST /api/acp/full-access. The question is a Base UI
   AlertDialog that is NOT on the boot path: it loads the first time it is
   needed, and `preloadFullAccessDialog` warms it when a pointer or focus
   reaches the chip.
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

import './access.css';

import type { AccessMode, PermissionMode } from '../state/types';
import {
  ACCESS_MODES,
  FULL_ACCESS_PROMPT,
  accessLabel,
  createFullAccessClient,
  type FullAccessClient,
} from './accessMode';
import { Icon } from './Icon';

export interface AccessSwitch {
  access: AccessMode;
  /** Move to `next`; Full access may first ask, once per project. */
  request: (next: AccessMode) => void;
  /** The pending one-time question, or null. */
  confirm: { prompt: string; error: string | null } | null;
  accept: () => void;
  cancel: () => void;
}

export interface UseAccessSwitchOptions {
  access: AccessMode;
  onAccess: (access: AccessMode) => void;
  /** The attached project (repo root); confirmations are remembered per key. */
  projectKey: string | null;
  client?: FullAccessClient;
}

export function useAccessSwitch({ access, onAccess, projectKey, client }: UseAccessSwitchOptions): AccessSwitch {
  const wire = useRef<FullAccessClient>(client ?? createFullAccessClient());
  if (client) wire.current = client;
  /* What the server said per project this page, so a known answer costs no request. */
  const known = useRef(new Map<string, boolean>());
  const [confirm, setConfirm] = useState<AccessSwitch['confirm']>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const key = projectKey ?? '';

  const request = useCallback(
    (next: AccessMode) => {
      if (next !== 'full') {
        setConfirm(null);
        onAccess(next);
        return;
      }
      if (known.current.get(key) === true) {
        onAccess('full');
        return;
      }
      preloadFullAccessDialog();
      void (async () => {
        const answer = await wire.current.state();
        if (!live.current) return;
        if (answer.ok && answer.confirmed) {
          known.current.set(key, true);
          onAccess('full');
          return;
        }
        setConfirm({ prompt: answer.ok ? answer.prompt : FULL_ACCESS_PROMPT, error: answer.ok ? null : answer.message });
      })();
    },
    [key, onAccess],
  );

  const accept = useCallback(() => {
    void (async () => {
      const answer = await wire.current.confirm();
      if (!live.current) return;
      if (answer.ok && answer.confirmed) {
        known.current.set(key, true);
        setConfirm(null);
        onAccess('full');
        return;
      }
      setConfirm((cur) => ({ prompt: cur?.prompt ?? FULL_ACCESS_PROMPT, error: answer.ok ? 'Not confirmed.' : answer.message }));
    })();
  }, [key, onAccess]);

  const cancel = useCallback(() => setConfirm(null), []);

  /* A remembered Full access is re-checked against the project it is now in:
     consent is per project, so a stored "full" does not carry to another one. */
  useEffect(() => {
    if (access !== 'full' || known.current.get(key) === true) return;
    let gone = false;
    void (async () => {
      const answer = await wire.current.state();
      if (gone || !live.current) return;
      if (answer.ok && answer.confirmed) known.current.set(key, true);
      else onAccess('autoEdit');
    })();
    return () => {
      gone = true;
    };
  }, [access, key, onAccess]);

  return { access, request, confirm, accept, cancel };
}

/** What the agent chip appends to the model name: "Plan", "Teach", or "Build · Auto-edit". */
export function modeChipLabel(intent: PermissionMode, teach: boolean, access: AccessMode): string {
  if (teach) return 'Teach';
  if (intent === 'plan') return 'Plan';
  return `Build, ${accessLabel(access)}`;
}

const INTENTS: { intent: PermissionMode; label: string; description: string }[] = [
  { intent: 'plan', label: 'Plan', description: 'Reads, draws and drafts. Changes come back for your accept.' },
  { intent: 'build', label: 'Build', description: 'Makes the change.' },
];

export interface ModeRowsProps {
  intent: PermissionMode;
  teach: boolean;
  onIntent: (intent: PermissionMode) => void;
  switcher: AccessSwitch;
}

/**
 * The Intent and Access groups, drawn as rows of the agent chip's popover (the
 * same `.v3-mode-pop` rows as the model list below them).
 */
export function ModeRows({ intent, teach, onIntent, switcher }: ModeRowsProps) {
  return (
    <>
      <p className="v3-pop-heading" role="presentation">
        Intent
      </p>
      {INTENTS.map((row) => {
        const on = !teach && intent === row.intent;
        return (
          <button
            key={row.intent}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            className={on ? 'is-selected' : ''}
            data-testid={`v3-intent-${row.intent}`}
            title={row.description}
            onClick={() => onIntent(row.intent)}
          >
            <span className="v3-mode-pop-label">{row.label}</span>
            {on ? <Icon name="check" size={12} /> : null}
          </button>
        );
      })}
      <p className="v3-pop-heading" role="presentation">
        Access
      </p>
      {ACCESS_MODES.map((row) => {
        const on = switcher.access === row.access;
        return (
          <button
            key={row.access}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            className={on ? 'is-selected' : ''}
            data-testid={`v3-access-${row.access}`}
            title={`${row.description} Shift+Tab in the message box changes it.`}
            onClick={() => switcher.request(row.access)}
          >
            <span className="v3-mode-pop-label">{row.label}</span>
            {on ? <Icon name="check" size={12} /> : null}
          </button>
        );
      })}
    </>
  );
}

/* ── the one-time Full access question, loaded on first need ─────────── */

const loadDialog = () => import('./FullAccessDialog');
let dialogModule: Promise<unknown> | null = null;

/** Warm the dialog chunk (pointer or focus on the chip). Safe to call often. */
export function preloadFullAccessDialog(): void {
  if (dialogModule === null) dialogModule = loadDialog().catch(() => (dialogModule = null));
}

const LazyFullAccessDialog = lazy(loadDialog);

/** Mounts the Base UI dialog only while a question is pending. */
export function FullAccessConfirm({ switcher }: { switcher: AccessSwitch }) {
  if (switcher.confirm === null) return null;
  return (
    <Suspense fallback={null}>
      <LazyFullAccessDialog
        prompt={switcher.confirm.prompt}
        error={switcher.confirm.error}
        onAccept={switcher.accept}
        onCancel={switcher.cancel}
      />
    </Suspense>
  );
}
