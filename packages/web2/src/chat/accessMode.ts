/* ══════════════════════════════════════════════════════════════════════════
   ACCESS — what the agent may do without asking
   packages/web2/src/chat/accessMode.ts

   Two separate questions, two separate values:
     intent  (PermissionMode)  Plan | Build      what this turn is FOR
     access  (AccessMode)      Ask | Auto-edit | Full access
                                                 what it may do without asking

   The ACP agents take the access value whole (packages/acp/src/accessMode.ts
   holds the table: Ask = Claude `default` / Codex on-request + read-only,
   Auto-edit = `acceptEdits` / workspace-write, Full access =
   `bypassPermissions` / danger-full-access). The built-in chat route
   `/api/ask` knows only plan | build, so access is MAPPED there, never
   widened: Ask can never reach `build`, which writes without an accept.

   Full access is confirmed once per project through
   GET/POST /api/acp/full-access; the server stores the consent in the
   project's gitignored .sequence/ and never asks again for it.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AccessMode, PermissionControl, PermissionMode } from '../state/types';

export interface AccessModeSpec {
  access: AccessMode;
  label: string;
  description: string;
}

/** Weakest first: the order Shift+Tab walks and the menu lists. */
export const ACCESS_MODES: readonly AccessModeSpec[] = [
  { access: 'ask', label: 'Ask', description: 'Asks before each edit or command.' },
  { access: 'autoEdit', label: 'Auto-edit', description: 'Edits files without asking. Asks before commands.' },
  { access: 'full', label: 'Full access', description: 'Edits and runs any command without asking.' },
];

/** Where the composer remembers the last access choice (per origin, per viewer). */
export const ACCESS_STORAGE_KEY = 'v3.composer.access';

/** The default when nothing was chosen: Build edits without an accept, as it always has. */
export const DEFAULT_ACCESS: AccessMode = 'autoEdit';

export function isAccessMode(v: unknown): v is AccessMode {
  return v === 'ask' || v === 'autoEdit' || v === 'full';
}

export function accessOf(control: Pick<PermissionControl, 'access'>): AccessMode {
  return isAccessMode(control.access) ? control.access : DEFAULT_ACCESS;
}

export function accessLabel(access: AccessMode): string {
  return ACCESS_MODES.find((m) => m.access === access)?.label ?? 'Auto-edit';
}

/** Shift+Tab: the next mode, wrapping from Full access back to Ask. */
export function nextAccess(access: AccessMode): AccessMode {
  const i = ACCESS_MODES.findIndex((m) => m.access === access);
  return ACCESS_MODES[(i + 1) % ACCESS_MODES.length].access;
}

/**
 * The `permission` sent on `/api/ask`, whose contract is plan | build.
 * Plan stays plan. Build with Ask is sent as plan (changes come back as
 * proposals you accept); Build with Auto-edit or Full access is build.
 */
export function askPermissionFor(intent: PermissionMode, access: AccessMode): PermissionMode {
  if (intent === 'plan') return 'plan';
  return access === 'ask' ? 'plan' : 'build';
}

/** The `permissionMode` an ACP agent run takes (POST /api/acp/run-node). */
export type AcpPermissionMode = 'plan' | 'propose' | 'autoEdit' | 'full';

export function acpPermissionModeFor(intent: PermissionMode, access: AccessMode): AcpPermissionMode {
  if (intent === 'plan') return 'plan';
  if (access === 'ask') return 'propose';
  return access;
}

/* ── the one-time Full access confirm ─────────────────────────────────── */

export const FULL_ACCESS_ROUTE = '/api/acp/full-access';
/** The server's sentence, used until the server's own copy arrives. */
export const FULL_ACCESS_PROMPT = 'Agents can run any command without asking';

export type FullAccessAnswer =
  | { ok: true; confirmed: boolean; prompt: string }
  | { ok: false; message: string };

async function readAnswer(res: Response): Promise<FullAccessAnswer> {
  const body = (await res.json().catch(() => null)) as { confirmed?: unknown; prompt?: unknown; error?: unknown } | null;
  if (!res.ok || body === null) {
    return { ok: false, message: body && typeof body.error === 'string' ? body.error : `request failed (${res.status})` };
  }
  return {
    ok: true,
    confirmed: body.confirmed === true,
    prompt: typeof body.prompt === 'string' && body.prompt !== '' ? body.prompt : FULL_ACCESS_PROMPT,
  };
}

export interface FullAccessClient {
  state(): Promise<FullAccessAnswer>;
  confirm(): Promise<FullAccessAnswer>;
}

export function createFullAccessClient(fetchImpl: typeof fetch = (...a) => fetch(...a)): FullAccessClient {
  const guard = async (run: () => Promise<Response>): Promise<FullAccessAnswer> => {
    try {
      return await readAnswer(await run());
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'the server could not be reached' };
    }
  };
  return {
    state: () => guard(() => fetchImpl(FULL_ACCESS_ROUTE, { headers: { accept: 'application/json' } })),
    confirm: () =>
      guard(() =>
        fetchImpl(FULL_ACCESS_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ confirm: true }),
        }),
      ),
  };
}
