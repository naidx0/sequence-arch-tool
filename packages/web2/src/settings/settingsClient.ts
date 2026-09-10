/* ══════════════════════════════════════════════════════════════════════════
   THE SETTINGS WIRE — /api/ai-config
   packages/web2/src/settings/settingsClient.ts

   THE KEY GOES ONE WAY ONLY. `GET /api/ai-config` answers with
   `redactAiConfig`'s view — the provider, the model, and `••••` plus the last
   four characters — and the full key is written by `PUT` and never read back.
   That asymmetry is the whole security posture of this panel: there is no
   request this client can make that returns a usable key, so there is nothing
   for a screenshot, a bug report or a console log to leak.

   IT FOLLOWS `reviewClient`'s SHAPE rather than inventing one: a narrow
   interface, a `WireResult` union, and `fetch` injected so a test drives it
   without a server. Two client shapes in one package is two places to get the
   error handling wrong.
   ══════════════════════════════════════════════════════════════════════════ */

import type {
  AiParams,
  AiProfileView,
  GetAiConfigResponse,
  PostAiConfigTestResponse,
  PutAiConfigResponse,
  GetPermissionsResponse,
  PutPermissionsResponse,
  GetMcpConfigResponse,
  PutMcpConfigResponse,
  GetAutoApproveResponse,
  PutAutoApproveResponse,
} from '@sequence/api-types';

/** What the user can send. `apiKey` is present only when they typed a new one. */
export interface AiConfigDraft {
  mode?: 'default' | 'api-key';
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  params?: AiParams;
  /**
   * The whole saved-model list, when the panel is editing one.
   *
   * A profile sent with NO `apiKey` keeps the key already stored under that id —
   * the same rule the single-config key box has always followed, and the only
   * one available here: this client can never read a real key back.
   */
  profiles?: AiProfileView[];
  defaultProfileId?: string;
}

export type WireResult<T> =
  | { outcome: 'ok'; body: T }
  | { outcome: 'error'; status: number; message: string };

/** What `.sequence/hooks.json` declares, and whether it may run. */
export interface HooksView {
  /**
   * Which of the advertised events cannot fire, as one sentence, or null.
   *
   * Six lifecycle events are declared and two have a call site. A user who
   * writes a `pre-tool` hook gets silence, and the likeliest conclusion is
   * that their own script is broken.
   */
  unfired?: string | null;
  /** The events that actually fire today. */
  live?: string[];
  events: string[];
  blocking: string[];
  declared: Record<string, { command: string[] }[]>;
  trusted: boolean;
}

export interface SettingsClient {
  read(signal?: AbortSignal): Promise<WireResult<GetAiConfigResponse>>;
  write(draft: AiConfigDraft): Promise<WireResult<PutAiConfigResponse>>;
  /**
   * PUT `{ selectProfileId }` — switch which saved model answers, and NOTHING
   * else. Sending the list back to change one field would write masks over real
   * keys, so the switch is its own one-field request.
   */
  selectProfile(id: string): Promise<WireResult<PutAiConfigResponse>>;
  /** POST `{ test: true }` — probe the real wire and report what came back. */
  testModel(profileId?: string): Promise<WireResult<PostAiConfigTestResponse>>;
  /** GET /api/hooks — reads a DECLARATION; it runs nothing. */
  hooks(signal?: AbortSignal): Promise<WireResult<HooksView>>;
  /** PUT /api/hooks — the consent itself, written user-level. */
  setHookTrust(trusted: boolean): Promise<WireResult<{ trusted: boolean }>>;
  /** GET /api/permissions — project permissions.json (or empty default). */
  permissions(signal?: AbortSignal): Promise<WireResult<GetPermissionsResponse>>;
  /** PUT /api/permissions — write the file text. */
  writePermissions(text: string): Promise<WireResult<PutPermissionsResponse>>;
  /** GET /api/mcp — repo `.sequence/mcp.json` (file only). */
  mcpConfig(signal?: AbortSignal): Promise<WireResult<GetMcpConfigResponse>>;
  /** PUT /api/mcp — write mcp.json text. */
  writeMcpConfig(text: string): Promise<WireResult<PutMcpConfigResponse>>;
  /**
   * GET /api/auto-approve — the unattended autonomy mode for this session.
   *
   * ALWAYS RE-READ, NEVER CACHED PAST A RENDER. The server turns the mode off
   * by itself the moment repo trust is revoked, so a remembered `on` would be
   * this panel claiming an autonomy the engine has already dropped.
   */
  autoApprove(signal?: AbortSignal): Promise<WireResult<GetAutoApproveResponse>>;
  /**
   * PUT /api/auto-approve — the one explicit action.
   *
   * Enabling on an untrusted repository answers 403 WITH THE REASON, which this
   * client surfaces as `message`. The panel prints it rather than leaving a
   * switch that silently refuses to move.
   */
  setAutoApprove(on: boolean): Promise<WireResult<PutAutoApproveResponse>>;
}

export const AI_CONFIG_ROUTE = '/api/ai-config';
export const HOOKS_ROUTE = '/api/hooks';
export const PERMISSIONS_ROUTE = '/api/permissions';
export const MCP_CONFIG_ROUTE = '/api/mcp';
export const AUTO_APPROVE_ROUTE = '/api/auto-approve';

async function parse<T>(res: Response): Promise<WireResult<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* A non-JSON body from this route means something upstream answered — a
       proxy, a dev-server fallback — and reporting the status is more honest
       than reporting a parse error the user cannot act on. */
    return { outcome: 'error', status: res.status, message: `the server did not answer with JSON (${res.status})` };
  }
  if (!res.ok) {
    const message =
      typeof (body as { error?: unknown } | null)?.error === 'string'
        ? (body as { error: string }).error
        : `request failed (${res.status})`;
    return { outcome: 'error', status: res.status, message };
  }
  return { outcome: 'ok', body: body as T };
}

export function createSettingsClient(fetchImpl: typeof fetch = fetch): SettingsClient {
  return {
    async read(signal) {
      try {
        return await parse<GetAiConfigResponse>(
          await fetchImpl(AI_CONFIG_ROUTE, { signal, headers: { accept: 'application/json' } }),
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return { outcome: 'error', status: 0, message: 'cancelled' };
        }
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async hooks(signal) {
      try {
        return await parse<HooksView>(
          await fetchImpl(HOOKS_ROUTE, { signal, headers: { accept: 'application/json' } }),
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return { outcome: 'error', status: 0, message: 'cancelled' };
        }
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async setHookTrust(trusted) {
      try {
        return await parse<{ trusted: boolean }>(
          await fetchImpl(HOOKS_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ trusted }),
          }),
        );
      } catch (e) {
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async permissions(signal) {
      try {
        return await parse<GetPermissionsResponse>(
          await fetchImpl(PERMISSIONS_ROUTE, { signal, headers: { accept: 'application/json' } }),
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return { outcome: 'error', status: 0, message: 'cancelled' };
        }
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async writePermissions(text) {
      try {
        return await parse<PutPermissionsResponse>(
          await fetchImpl(PERMISSIONS_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          }),
        );
      } catch (e) {
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async mcpConfig(signal) {
      try {
        return await parse<GetMcpConfigResponse>(
          await fetchImpl(MCP_CONFIG_ROUTE, { signal, headers: { accept: 'application/json' } }),
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return { outcome: 'error', status: 0, message: 'cancelled' };
        }
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async writeMcpConfig(text) {
      try {
        return await parse<PutMcpConfigResponse>(
          await fetchImpl(MCP_CONFIG_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          }),
        );
      } catch (e) {
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async autoApprove(signal) {
      try {
        return await parse<GetAutoApproveResponse>(
          await fetchImpl(AUTO_APPROVE_ROUTE, { signal, headers: { accept: 'application/json' } }),
        );
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return { outcome: 'error', status: 0, message: 'cancelled' };
        }
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async setAutoApprove(on) {
      try {
        return await parse<PutAutoApproveResponse>(
          await fetchImpl(AUTO_APPROVE_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ on }),
          }),
        );
      } catch (e) {
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async write(draft) {
      try {
        return await parse<PutAiConfigResponse>(
          await fetchImpl(AI_CONFIG_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          }),
        );
      } catch (e) {
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async selectProfile(id) {
      try {
        return await parse<PutAiConfigResponse>(
          await fetchImpl(AI_CONFIG_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ selectProfileId: id }),
          }),
        );
      } catch (e) {
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
    async testModel(profileId) {
      try {
        return await parse<PostAiConfigTestResponse>(
          await fetchImpl(AI_CONFIG_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(profileId ? { test: true, profileId } : { test: true }),
          }),
        );
      } catch (e) {
        return { outcome: 'error', status: 0, message: (e as Error).message };
      }
    },
  };
}
