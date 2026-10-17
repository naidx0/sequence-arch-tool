/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN: THE TWO MODEL ROUTES (Local model, API key)
   packages/web2/src/onboarding/modelConnect.ts

   The same PUT /api/ai-config the Settings > Models form writes, driven from
   the first-run screen. A saved model is named after its model, never after a
   role ("daily", "cheap", "local"). Nothing here launches a binary or reaches
   a network host: a local model is a profile pointing at the daemon the server
   already found, an API key is a profile the person typed.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AiProfileView } from '@sequence/api-types';

import { defaultNickname } from '../chat/modelNames';
import type { SettingsClient } from '../settings/settingsClient';
import type { ProviderPreset } from '../settings/providerPresets';

export interface DetectedLocal {
  name: string;
  baseUrl: string;
  models: string[];
}

/** What the server found running on this machine (Ollama, LM Studio). */
export async function detectLocal(client: SettingsClient): Promise<DetectedLocal[] | null> {
  const a = await client.read();
  if (a.outcome !== 'ok') return null;
  const list = (a.body as { localProviders?: DetectedLocal[] }).localProviders;
  return Array.isArray(list) ? list : [];
}

function freshId(taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const id = `saved-${n}`;
    if (!taken.includes(id)) return id;
  }
}

async function append(client: SettingsClient, entry: Omit<AiProfileView, 'id'>): Promise<string | null> {
  const cur = await client.read();
  const have: AiProfileView[] = cur.outcome === 'ok' ? ((cur.body as { profiles?: AiProfileView[] }).profiles ?? []) : [];
  const id = freshId(have.map((p) => p.id));
  /* A profile sent with no apiKey keeps the key already stored under its id. */
  const kept = have.map(({ apiKey: _mask, ...rest }) => rest as AiProfileView);
  const wrote = await client.write({ profiles: [...kept, { ...entry, id } as AiProfileView], defaultProfileId: id });
  if (wrote.outcome !== 'ok') return null;
  const chosen = await client.selectProfile(id);
  return chosen.outcome === 'ok' ? id : null;
}

/** Use a model a detected daemon serves. Returns an error sentence, or null when saved. */
export async function saveLocalModel(client: SettingsClient, baseUrl: string, model: string): Promise<string | null> {
  const id = await append(client, { name: defaultNickname(model), provider: 'openai-compatible', model, baseUrl });
  return id === null ? 'Could not save that model. Try again.' : null;
}

export interface KeyDraft {
  preset: ProviderPreset;
  model: string;
  apiKey: string;
  baseUrl: string;
}

/** Save an API-key model. Returns an error sentence, or null when saved. */
export async function saveKeyModel(client: SettingsClient, d: KeyDraft): Promise<string | null> {
  const model = d.model.trim();
  const baseUrl = (d.preset.baseUrl || d.baseUrl).trim();
  if (model === '' || d.apiKey.trim() === '') return 'Add a model and a key.';
  if (baseUrl === '') return 'Add the server address.';
  const entry: Omit<AiProfileView, 'id'> = { name: defaultNickname(model), provider: d.preset.provider, model, baseUrl, apiKey: d.apiKey.trim() };
  const id = await append(client, entry);
  return id === null ? 'Could not save that model. Check the key and try again.' : null;
}
