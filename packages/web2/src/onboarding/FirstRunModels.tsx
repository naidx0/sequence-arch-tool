/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN: LOCAL MODEL and API KEY
   packages/web2/src/onboarding/FirstRunModels.tsx

   Local model: Ollama and LM Studio, each one line; when the server found one
   running, "Use it" saves its first model with one click. API key: OpenAI,
   Anthropic, OpenRouter or any OpenAI-compatible server, a key and a model id.
   Both end in the same place as an agent: Start chatting.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { PROVIDER_PRESETS, presetById, type PresetId } from '../settings/providerPresets';
import type { SettingsClient } from '../settings/settingsClient';
import { keyVaultHint, useKeyVault } from '../settings/keyVaultState';
import { detectLocal, saveKeyModel, saveLocalModel, type DetectedLocal } from './modelConnect';

export interface ModelPanelProps {
  settings: SettingsClient;
  /** The model is saved and selected: the person may start chatting. */
  onReady: (label: string) => void;
}

const LOCAL = PROVIDER_PRESETS.filter((p) => p.local);
const REMOTE = PROVIDER_PRESETS.filter((p) => !p.local);

export function LocalPanel({ settings, onReady, preferred }: ModelPanelProps & { preferred?: string }) {
  const [found, setFound] = useState<DetectedLocal[] | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const look = useCallback(async () => {
    setFound(undefined);
    const f = await detectLocal(settings);
    if (live.current) setFound(f);
  }, [settings]);
  useEffect(() => {
    void look();
  }, [look]);

  const use = async (d: DetectedLocal, model: string) => {
    setBusy(d.name);
    setError(null);
    const err = await saveLocalModel(settings, d.baseUrl, model);
    if (!live.current) return;
    setBusy(null);
    if (err) setError(err);
    else onReady(model);
  };

  return (
    <ul className="fr-lines" data-testid="first-run-local">
      {LOCAL.map((p) => {
        const d = (found ?? []).find((x) => x.name === p.probeName && x.models.length > 0);
        const model = d ? (pick[d.name] ?? (p.probeName === 'Ollama' && preferred && d.models.includes(preferred) ? preferred : d.models[0]!)) : '';
        return (
          <li key={p.id} className="fr-line" data-testid="first-run-local-row" data-preset={p.id} data-found={d ? 'true' : 'false'}>
            <span className="fr-line-name">{p.label}</span>
            <span className="fr-line-sub">
              {found === undefined ? 'Looking...' : d ? `Running, ${d.models.length} model${d.models.length === 1 ? '' : 's'}` : 'Not running'}
            </span>
            {d && d.models.length > 1 ? (
              <select className="fr-select" aria-label={`${p.label} model`} value={model} onChange={(e) => setPick((cur) => ({ ...cur, [d.name]: e.target.value }))}>
                {d.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : d ? (
              <span className="fr-line-model">{model}</span>
            ) : null}
            {d ? (
              <button type="button" className="fr-btn fr-primary" data-testid="first-run-local-use" disabled={busy !== null} onClick={() => void use(d, model)}>
                {busy === d.name ? <><AsciiSpinner /> Saving</> : 'Use it'}
              </button>
            ) : null}
          </li>
        );
      })}
      <li className="fr-line fr-line-foot">
        <span className="fr-sub">
          {(found ?? []).some((d) => d.models.length > 0)
            ? 'Free, no key, and nothing leaves this computer.'
            : 'Start Ollama or LM Studio, then check again.'}
        </span>
        <button type="button" className="fr-btn" data-testid="first-run-local-recheck" onClick={() => void look()}>
          Check again
        </button>
      </li>
      {error ? (
        <li className="fr-note fr-row-error" role="alert" data-testid="first-run-model-error">
          {error}
        </li>
      ) : null}
    </ul>
  );
}

export function KeyPanel({ settings, onReady }: ModelPanelProps) {
  const [preset, setPreset] = useState<PresetId>('openai');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const chosen = presetById(preset)!;
  /* APP-11: where the key goes (system keychain, or unencrypted file and its path), said before Save. */
  const keyVault = useKeyVault();

  const save = async () => {
    setBusy(true);
    setError(null);
    const err = await saveKeyModel(settings, { preset: chosen, model, apiKey: key, baseUrl: url });
    if (!live.current) return;
    setBusy(false);
    if (err) setError(err);
    else onReady(model.trim());
  };

  return (
    <form
      className="fr-key"
      data-testid="first-run-key"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="fr-segs" role="group" aria-label="Provider">
        {REMOTE.map((p) => (
          <button
            key={p.id}
            type="button"
            className="fr-seg"
            data-testid="first-run-key-preset"
            data-preset={p.id}
            aria-pressed={preset === p.id}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {chosen.baseUrl === '' ? (
        <label className="fr-field">
          <span className="fr-field-l">Server address</span>
          <input className="fr-input" data-testid="first-run-key-url" value={url} placeholder="https://your-server/v1" onChange={(e) => setUrl(e.target.value)} />
        </label>
      ) : null}
      <label className="fr-field">
        <span className="fr-field-l">API key</span>
        <input className="fr-input" data-testid="first-run-key-key" type="password" autoComplete="off" value={key} placeholder="sk-..." onChange={(e) => setKey(e.target.value)} />
      </label>
      <label className="fr-field">
        <span className="fr-field-l">Model</span>
        <input className="fr-input" data-testid="first-run-key-model" value={model} placeholder={chosen.modelPlaceholder} onChange={(e) => setModel(e.target.value)} />
      </label>
      <p className="fr-sub" data-testid="first-run-key-hint">{keyVault === null ? '' : keyVaultHint(keyVault)}</p>
      {error ? (
        <p className="fr-note fr-row-error" role="alert" data-testid="first-run-model-error">
          {error}
        </p>
      ) : null}
      <div className="fr-key-acts">
        <button type="submit" className="fr-btn fr-primary" data-testid="first-run-key-save" disabled={busy || key.trim() === '' || model.trim() === ''}>
          {busy ? <><AsciiSpinner /> Saving</> : 'Save and continue'}
        </button>
      </div>
    </form>
  );
}
