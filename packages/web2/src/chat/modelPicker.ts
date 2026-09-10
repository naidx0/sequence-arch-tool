/* ══════════════════════════════════════════════════════════════════════════
   THE MODEL CHIP IS A PICKER NOW
   packages/web2/src/chat/modelPicker.ts

   `modelSelection.ts` states, in capitals, why it could not be one:

     "IT IS NOT A PICKER. A menu needs a LIST of models, and no route serves
      one — /api/ai-config returns the ONE configured model as a string."

   That was true when it was written and it is the whole reason the chip opened
   the entire Settings dialog instead of a menu. `composerModel.ts` says the
   same thing about the toolbelt's Reasoning row: "A submenu of alternate models
   has no wire source". The honest answer to a missing list was a door to the
   form.

   THE ROUTE SERVES A LIST NOW. `GET /api/ai-config` answers with `profiles` —
   every saved model, keys masked — and `defaultProfileId`, which one answers.
   So the menu is no longer invented from a single string; every row is a model
   the reader saved, and picking one is a real switch.

   ── WHAT THIS FILE WILL NOT DO ────────────────────────────────────────────

   It never sends a key. `select` PUTs `{ selectProfileId }` and nothing else,
   because the only key material this client has ever held is a MASK, and a
   switch expressed as "send the whole list back" would write `••••9f3a` over a
   working credential.

   It never fabricates a row. A response with no `profiles` yields an EMPTY
   list, and the composer draws the door to Settings rather than a menu of one
   guessed entry — the fabrication `EMPTY_MODEL`'s own comment exists to prevent.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AiProfileView, GetAiConfigResponse } from '@sequence/api-types';

/** One row of the picker. `active` is the model that answers the next question. */
export interface ModelPickerProfile {
  id: string;
  name: string;
  model: string;
  provider: string;
  active: boolean;
}

export type ModelPickerList =
  | { outcome: 'ok'; profiles: ModelPickerProfile[] }
  | { outcome: 'error'; message: string };

export type ModelPickerSwitch =
  | { outcome: 'ok'; model: string }
  | { outcome: 'error'; message: string };

export interface ModelPickerPort {
  list(signal?: AbortSignal): Promise<ModelPickerList>;
  select(id: string): Promise<ModelPickerSwitch>;
}

/**
 * Read the saved models out of an `/api/ai-config` response.
 *
 * ANYTHING UNRECOGNISED IS AN EMPTY LIST, for the same reason `modelFromConfig`
 * returns UNCONFIGURED on a malformed body: a row in this menu is a claim that
 * picking it will change who answers, and a wrong one is worse than none.
 *
 * The free hosted default is not a saved model — there is nothing to switch to
 * and nothing was saved — so a `mode:'default'` config yields no rows.
 */
export function profilesFromConfig(body: unknown): ModelPickerProfile[] {
  if (typeof body !== 'object' || body === null) return [];
  const config = body as Partial<GetAiConfigResponse> & {
    profiles?: unknown;
    defaultProfileId?: unknown;
    mode?: unknown;
  };
  if (config.configured !== true) return [];
  if (config.mode === 'default') return [];
  if (!Array.isArray(config.profiles)) return [];
  const active =
    typeof config.defaultProfileId === 'string' ? config.defaultProfileId : null;
  const out: ModelPickerProfile[] = [];
  for (const raw of config.profiles as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const pr = raw as Partial<AiProfileView>;
    if (typeof pr.id !== 'string' || pr.id === '') continue;
    if (typeof pr.model !== 'string' || pr.model === '') continue;
    out.push({
      id: pr.id,
      /* A profile with no name is named by its model id — the only name the
         reader ever actually gave it. */
      name: typeof pr.name === 'string' && pr.name.trim() !== '' ? pr.name : pr.model,
      model: pr.model,
      provider: typeof pr.provider === 'string' ? pr.provider : '',
      active: active !== null ? pr.id === active : out.length === 0,
    });
  }
  return out;
}

/** The route this picker reads and writes. Shared with the settings client. */
export const AI_CONFIG_ROUTE = '/api/ai-config';

export function createModelPicker(fetchImpl: typeof fetch = fetch): ModelPickerPort {
  return {
    async list(signal) {
      try {
        const res = await fetchImpl(AI_CONFIG_ROUTE, {
          signal,
          headers: { accept: 'application/json' },
        });
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof (body as { error?: unknown } | null)?.error === 'string'
              ? (body as { error: string }).error
              : `could not read your models (${res.status})`;
          return { outcome: 'error', message };
        }
        return { outcome: 'ok', profiles: profilesFromConfig(body) };
      } catch (e) {
        if ((e as Error).name === 'AbortError') return { outcome: 'error', message: 'cancelled' };
        return { outcome: 'error', message: (e as Error).message };
      }
    },
    async select(id) {
      try {
        const res = await fetchImpl(AI_CONFIG_ROUTE, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ selectProfileId: id }),
        });
        const body: unknown = await res.json();
        if (!res.ok) {
          const message =
            typeof (body as { error?: unknown } | null)?.error === 'string'
              ? (body as { error: string }).error
              : `could not switch model (${res.status})`;
          return { outcome: 'error', message };
        }
        const model = (body as { model?: unknown }).model;
        if (typeof model !== 'string' || model === '') {
          /* The switch is only reported as done when the server names the model
             it switched TO. A silent success would leave the chip claiming a
             model nobody confirmed. */
          return { outcome: 'error', message: 'the server did not say which model is now active' };
        }
        return { outcome: 'ok', model };
      } catch (e) {
        return { outcome: 'error', message: (e as Error).message };
      }
    },
  };
}
