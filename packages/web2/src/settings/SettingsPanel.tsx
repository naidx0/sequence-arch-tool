/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS — connect a provider without leaving the app
   packages/web2/src/settings/SettingsPanel.tsx

   `Ctrl-K → Settings` said "Built in a later wave." The register recorded why
   that mattered more than a missing panel usually does: the free-tier message
   tells a user to add their own key, and there was no way to add one. The whole
   path out of "the free default is unavailable" ended in a dead end, so a real
   user's first blocked question was also their last.

   THE KEY IS WRITE-ONLY, and the panel is built around that.
   `GET /api/ai-config` answers with `••••` plus the last four characters, so
   the field NEVER shows a key and never pretends to. An empty field means
   "leave the stored key alone", not "clear it" — a panel that wiped the key
   because someone opened it and pressed Save would be the worst possible
   default here. The stored suffix is shown beside the field so a user can tell
   which key is in there without the key being on screen.

   TWO MODES AND THEY ARE DIFFERENT SENTENCES. `default` is the funded gateway
   and needs nothing from the user; `api-key` is theirs. The panel names which
   is live rather than showing a form whose meaning depends on a radio button
   the reader has to interpret.

   IT REPORTS WHAT THE SERVER SAID. A save that failed says so with the server's
   own message; a save that succeeded re-renders from the RESPONSE rather than
   from the draft, so what is on screen is what is stored — the PUT answers with
   the view a GET would give, `gatewayLive` stamp included.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AiParams,
  AiProfileView,
  GetAiConfigResponse,
  GetAutoApproveResponse,
  PostAiConfigTestResponse,
  ProviderKind,
} from '@sequence/api-types';
import type { AiConfigDraft, HooksView, SettingsClient } from './settingsClient';
import { mergeMcpServerEntry } from './mcpConfigDraft';
import { notifyControl, type NotifyPermission } from './notifyModel';
import { isDesktop } from '../boot/desktopBridge';
import { settingsSections, unbuiltCount, type SettingsFacts } from './settingsSections';
import { SETTINGS_PANES, resolvePane, type SettingsPane } from './settingsPanes';
import { readNotifyEnabled, writeNotifyEnabled } from './notifyPreference';
import {
  readAutoEditEnabled,
  writeAutoEditEnabled,
  readFullAccessEnabled,
  writeFullAccessEnabled,
} from './autonomyPreference';
import {
  AUTONOMY_MATRIX,
  AUTONOMY_MATRIX_COLUMNS,
  autonomyCellMark,
} from './autonomyMatrix';
import type { PermissionMode } from '../state/types';

export interface SettingsPanelProps {
  client: SettingsClient;
  /**
   * What the app knows, for the owner's nine sections.
   *
   * Optional: the panel renders and works without it, because the provider
   * form is the part that must never be blocked on the rest of the app having
   * answered. When absent the sections simply are not drawn — which is
   * different from drawing them empty, and that difference is the whole rule
   * `settingsSections` exists to enforce.
   */
  facts?: SettingsFacts;
  /**
   * Which pane to open on.
   *
   * `ShellOverlay` has carried this from the beginning and every caller passes
   * one; the panel never read it. Opening the provider pane from the failure
   * strip's "Open Settings" is now the single most likely reason anyone opens
   * this at all, and landing them at the top of a long scroll instead was the
   * request being made and answered by nobody.
   */
  pane?: SettingsPane;
  /**
   * P3 — when Auto-edit / Full toggles change, the host updates
   * `composer.permission.enabled`. Absent ⇒ toggles still persist locally.
   */
  onAutonomyChange?: (enabled: PermissionMode[]) => void;
  /** Detach the current repository (Settings → Default workspace). */
  onLeaveRepo?: () => void;
  /** Open the attach / folder picker (Settings → Open a folder). */
  onOpenFolder?: () => void;
}

type Loaded = GetAiConfigResponse | null;

/*
 * ONLY WHAT THE SERVER ACCEPTS.
 *
 * This list used to read `['anthropic', 'openai', 'openai-compatible',
 * 'google', 'ollama']`. Three of those five were guaranteed 400s: the server's
 * `validateAiConfig` (analyzer/src/server/provider.ts) accepts `anthropic` and
 * `openai-compatible` and nothing else, so a local-first reader who saw
 * `ollama` — the one option that named the thing already running on their
 * machine — picked it, pressed Save, and got "provider must be 'anthropic' or
 * 'openai-compatible'". Offering a choice that always fails is the dishonesty.
 *
 * THE TYPE IS THE LOCK. `ProviderKind` is the shared wire contract
 * (`@sequence/api-types`), mirrored from the analyzer's own union. Re-adding a
 * dead id here is a COMPILE ERROR in `pnpm --filter @sequence/web2 build`, not
 * a runtime 400 a user discovers for us.
 */
const PROVIDERS: readonly ProviderKind[] = ['anthropic', 'openai-compatible'];

/** What the reader is actually choosing between. The raw ids named a wire, not
 *  a product: `openai-compatible` is the door for Ollama / LM Studio / vLLM /
 *  OpenRouter / DeepSeek, and nothing said so. */
const PROVIDER_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Anthropic (Claude)',
  'openai-compatible': 'OpenAI-compatible — Ollama, LM Studio, vLLM, OpenRouter, DeepSeek',
};

/*
 * THE KNOBS, AND THE NUMBERS THE SERVER WILL ACTUALLY ACCEPT.
 *
 * Mirrors `AI_PARAM_BOUNDS` in analyzer/src/server/provider.ts, which is what
 * refuses out-of-range values. Stated to the reader rather than discovered by
 * being refused — but the SERVER is still the authority: this pane sends what
 * was typed and reports the server's own message when it says no, so a drift
 * between the two surfaces as an honest error and never as a silent clamp.
 */
const KNOBS: readonly {
  key: keyof AiParams;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  { key: 'temperature', label: 'Temperature', hint: '0–2 · 0 is repeatable', placeholder: 'provider default' },
  { key: 'topP', label: 'Top P', hint: '0–1', placeholder: 'provider default' },
  { key: 'maxTokens', label: 'Max output tokens', hint: '1–1,000,000', placeholder: 'provider default' },
  { key: 'timeoutMs', label: 'Timeout (ms)', hint: '1,000–3,600,000 · blank means no deadline', placeholder: 'no deadline' },
  { key: 'maxRetries', label: 'Retries', hint: '0–5 · only before the first token', placeholder: '0' },
];

/** A profile id that cannot collide with one already saved. */
function freshProfileId(taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const id = `saved-${n}`;
    if (!taken.includes(id)) return id;
  }
}

/** The state as a WORD. Sheet 12.5: no state in this product is communicated
 *  by colour alone, and this section spends no colour at all. */
const STATE_WORD: Record<'ready' | 'waiting' | 'unbuilt', string> = {
  ready: 'Ready',
  waiting: 'Waiting',
  unbuilt: 'Not built',
};

export function SettingsPanel({ client, facts, pane, onAutonomyChange, onLeaveRepo, onOpenFolder }: SettingsPanelProps) {
  /* The pane the caller asked for, honoured. Held locally after that so the
     tabs can move without a round trip through the store - which pane is
     showing is where the reader is looking, not something a reload needs to
     agree about. */
  const [current, setCurrent] = useState<SettingsPane>(() => resolvePane(pane));

  const [config, setConfig] = useState<Loaded>(null);

  /* What answered on this machine. Read alongside the config, because the
     moment it matters is the moment a reader asks what is configured. */
  const localProviders =
    config !== null && 'localProviders' in config
      ? ((config as { localProviders?: { name: string; baseUrl: string; models: string[] }[] })
          .localProviders ?? [])
      : [];
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [provider, setProvider] = useState<string>('anthropic');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  /*
   * ── THE SAVED MODELS ──────────────────────────────────────────────────
   *
   * There used to be exactly one. Changing your mind meant retyping the
   * provider, the model id, the base URL and the whole API key. `editingId` is
   * WHICH saved model this form is editing — null while composing a new one —
   * and it is the only piece of picker state the panel owns; everything else is
   * read back from the server's answer, so what is on screen is what is stored.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [knobs, setKnobs] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PostAiConfigTestResponse | null>(null);
  const [testFailure, setTestFailure] = useState<string | null>(null);

  const [hooks, setHooks] = useState<HooksView | null>(null);
  /*
   * NOTIFICATIONS ARE ASKED FOR, NEVER SPRUNG. `App.tsx` deferred this to a
   * RULING — "a prompt the user must be asked for, at a moment CHOSEN BY US" —
   * and this design has no such moment: the browser prompt is raised only from
   * the click below, on a control that says what it will do.
   *
   * A denial persists past the session and the prompt is one-shot, so springing
   * it during a long run spends a permission we cannot ask for twice, at the
   * moment the reader is least willing to grant it.
   */
  const [permission, setPermission] = useState<NotifyPermission>('unsupported');
  /*
   * P3 autonomy opt-in — Auto-edit / Full stay off until the user flips these.
   * Preference survives reload; the composer reads enabled modes from the store.
   */
  const [autoEditOn, setAutoEditOn] = useState(() => readAutoEditEnabled());
  const [fullOn, setFullOn] = useState(() => readFullAccessEnabled());
  const [permText, setPermText] = useState('');
  /** null = still loading (or never fetched); never hide the Workspace section on this. */
  const [permExists, setPermExists] = useState<boolean | null>(null);
  const [permWarnings, setPermWarnings] = useState<string[]>([]);
  const [permSaving, setPermSaving] = useState(false);
  const [permSaved, setPermSaved] = useState(false);
  const [permFailure, setPermFailure] = useState<string | null>(null);
  const [permLoading, setPermLoading] = useState(true);
  const [mcpText, setMcpText] = useState('');
  const [mcpExists, setMcpExists] = useState<boolean | null>(null);
  const [mcpWarnings, setMcpWarnings] = useState<string[]>([]);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpSaved, setMcpSaved] = useState(false);
  const [mcpFailure, setMcpFailure] = useState<string | null>(null);
  const [mcpLoading, setMcpLoading] = useState(true);
  /*
   * AUTO-APPROVE — SERVER STATE, NEVER localStorage.
   *
   * Auto-edit and Full above are user PREFERENCES and persist. This one is a
   * session grant living in the server's memory (analyzer
   * `server/autoApprove.ts`): it dies with the process, and it is refused
   * outright on a repository the user has not trusted. Mirroring it into
   * localStorage would give the switch a memory the engine does not have, and
   * the panel would show "on" across a restart while every turn still asked.
   */
  const [autoApproveState, setAutoApproveState] = useState<GetAutoApproveResponse | null>(null);
  const [autoApproveFailure, setAutoApproveFailure] = useState<string | null>(null);
  const [mcpAddName, setMcpAddName] = useState('');
  const [mcpAddCommand, setMcpAddCommand] = useState('');
  const [mcpAddArgs, setMcpAddArgs] = useState('');

  const publishAutonomy = (nextAuto: boolean, nextFull: boolean) => {
    const enabled: PermissionMode[] = ['plan', 'propose'];
    if (nextAuto) enabled.push('autoEdit');
    if (nextFull) enabled.push('full');
    onAutonomyChange?.(enabled);
  };
  /*
   * READ FROM STORAGE, NOT FROM NOTHING.
   *
   * This was `useState(false)`, so the switch reset on every reload and on
   * every close of this overlay. A person could grant the browser permission,
   * turn the switch on, come back, and find it off — and a switch that forgets
   * is a switch that does not work.
   */
  const [notifyOn, setNotifyOnState] = useState(() => readNotifyEnabled());

  /*
   * THE CONTROL, ASKED WITH THE HOST IT IS BEING READ IN.
   *
   * Sequence is downloaded and run locally, and every sentence this control
   * can say used to name a BROWSER - "blocked by your browser", "your
   * browser's site settings", "this tab". In an Electron window none of those
   * exist, so the instruction was one the reader could not carry out.
   *
   * `isDesktop()` has been in `boot/desktopBridge` the whole time and nothing
   * asked it. Read on render rather than captured, for the reason
   * `AttachDialog` gives for the same call: the bridge is installed by the
   * preload and a value captured at module load can predate it.
   */
  const notify = notifyControl({ permission, enabled: notifyOn }, { desktop: isDesktop() });
  const setNotifyOn = useCallback((next: boolean) => {
    setNotifyOnState(next);
    writeNotifyEnabled(next);
  }, []);
  const live = useRef(true);

  const adopt = useCallback((body: GetAiConfigResponse) => {
    setConfig(body);
    if (body.configured && !('mode' in body)) {
      setProvider(body.provider);
      setModel(body.model);
      setBaseUrl(body.baseUrl ?? '');
      /* The form follows the ACTIVE model, because that is the one the reader
         just changed or just switched to. A list whose form showed a different
         entry than the one marked Default would be two answers to "which model
         is this". */
      const list = body.profiles ?? [];
      const active = list.find((pr) => pr.id === body.defaultProfileId) ?? list[0];
      setEditingId(active?.id ?? null);
      setName(active?.name ?? body.model);
      const params = (active?.params ?? body.params ?? {}) as Record<string, number>;
      const asText: Record<string, string> = {};
      for (const k of Object.keys(params)) {
        if (typeof params[k] === 'number') asText[k] = String(params[k]);
      }
      setKnobs(asText);
    }
    setTestResult(null);
    setTestFailure(null);
    /* The key field is NEVER seeded. There is nothing to seed it with — the
       wire carries a mask — and a masked value in an editable field would be
       submitted verbatim by the next Save. */
    setApiKey('');
  }, []);

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void (async () => {
      const answer = await client.read(controller.signal);
      if (!live.current) return;
      if (answer.outcome === 'ok') adopt(answer.body);
      else if (answer.message !== 'cancelled') setFailure(answer.message);
    })();
    /* Read alongside the config: this GET reads a DECLARATION and runs nothing,
       so it is safe on any repo — the consent is the PUT. */
    void (async () => {
      const answer = await client.hooks(controller.signal);
      if (live.current && answer.outcome === 'ok') setHooks(answer.body);
    })();
    void (async () => {
      setPermLoading(true);
      const answer = await client.permissions(controller.signal);
      if (!live.current) return;
      setPermLoading(false);
      if (answer.outcome === 'ok') {
        setPermText(answer.body.text);
        setPermExists(answer.body.exists);
        setPermWarnings(answer.body.warnings);
        setPermFailure(null);
      } else if (answer.message === 'cancelled') {
        /* Strict-mode / remount abort — keep loading until a live fetch finishes.
           Hiding the whole Tool permissions section on cancelled left Workspace
           blank until a full page reload (Seat Gate 2). */
        setPermLoading(true);
      } else if (answer.status === 409) {
        setPermExists(null);
        setPermFailure('Attach a repository to edit its tool permissions.');
      } else {
        setPermFailure(answer.message);
      }
    })();
    void (async () => {
      setMcpLoading(true);
      const answer = await client.mcpConfig(controller.signal);
      if (!live.current) return;
      setMcpLoading(false);
      if (answer.outcome === 'ok') {
        setMcpText(answer.body.text);
        setMcpExists(answer.body.exists);
        setMcpWarnings(answer.body.warnings);
        setMcpFailure(null);
      } else if (answer.message === 'cancelled') {
        setMcpLoading(true);
      } else if (answer.status === 409) {
        setMcpExists(null);
        setMcpFailure('Attach a repository to edit MCP servers.');
      } else {
        setMcpFailure(answer.message);
      }
    })();
    /* The unattended mode, read from the server every time this panel opens.
       A GET grants nothing — the consent is the PUT — and it is the only way to
       know whether trust has been revoked since the switch was flipped. */
    void (async () => {
      const answer = await client.autoApprove(controller.signal);
      if (!live.current) return;
      if (answer.outcome === 'ok') {
        setAutoApproveState(answer.body);
        setAutoApproveFailure(null);
      } else if (answer.message !== 'cancelled' && answer.status !== 409) {
        setAutoApproveFailure(answer.message);
      }
    })();
    /* READ, never requested. Reading the current permission raises no prompt;
       only `requestPermission()` does, and that is behind the click. */
    if (typeof Notification === 'undefined') setPermission('unsupported');
    else setPermission(Notification.permission as NotifyPermission);

    return () => {
      live.current = false;
      controller.abort();
    };
  }, [client, adopt]);

  /**
   * The Advanced fields as numbers, or the FIRST thing wrong with them.
   *
   * Refused here as well as on the server, because a round trip to be told
   * "temperature must be a finite number" is a round trip the reader can be
   * spared. The server is still the authority on the RANGES — this only checks
   * that what was typed is a number at all, so the two can never disagree about
   * a bound.
   */
  function readKnobs(): { params?: AiParams; error?: string } {
    const out: Record<string, number> = {};
    for (const k of KNOBS) {
      const raw = (knobs[k.key] ?? '').trim();
      if (raw === '') continue; // blank is ABSENT, which is a different fact from 0
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `${k.label} must be a number (${k.hint}).` };
      out[k.key] = n;
    }
    return Object.keys(out).length > 0 ? { params: out as AiParams } : {};
  }

  /** Every saved model, as the server last described them. */
  const profiles: AiProfileView[] =
    config !== null && config.configured && !('mode' in config) ? (config.profiles ?? []) : [];
  const activeProfileId =
    config !== null && config.configured && !('mode' in config)
      ? (config.defaultProfileId ?? null)
      : null;

  /**
   * A profile as it may be SENT.
   *
   * `apiKey` is dropped from every entry the reader did not just retype. This
   * panel only ever holds a MASK (`••••9f3a`), and sending a mask back would
   * store the literal bullets as someone's credential. Absent means "keep the
   * key already stored under this id", which is the same rule the key box has
   * always followed, applied to a list.
   */
  function withoutMaskedKey(pr: AiProfileView): AiProfileView {
    const { apiKey: _mask, ...rest } = pr;
    return rest;
  }

  async function writeProfiles(next: AiProfileView[], defaultProfileId: string) {
    const answer = await client.write({ profiles: next, defaultProfileId });
    if (!live.current) return;
    setSaving(false);
    if (answer.outcome === 'ok') {
      adopt(answer.body);
      setSaved(true);
    } else {
      setFailure(answer.message);
    }
  }

  async function save() {
    setSaving(true);
    setFailure(null);
    setSaved(false);
    setTestResult(null);
    const parsedKnobs = readKnobs();
    if (parsedKnobs.error) {
      setSaving(false);
      setFailure(parsedKnobs.error);
      return;
    }
    if (profiles.length > 0 || editingId !== null) {
      /* THE LIST IS THE FILE'S MEANING. Saving edits the model being edited and
         makes it the one that answers — the form says which model this is, so
         pressing Save on it cannot mean "change a model that is not on screen". */
      const id = editingId ?? freshProfileId(profiles.map((pr) => pr.id));
      const entry: AiProfileView = {
        id,
        /* An unnamed model is named by its model id — the only name the reader
           has actually given it. Nothing is invented. */
        name: name.trim() || model.trim(),
        provider: provider as ProviderKind,
        model: model.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(parsedKnobs.params ? { params: parsedKnobs.params } : {}),
      };
      const next = profiles.some((pr) => pr.id === id)
        ? profiles.map((pr) => (pr.id === id ? entry : withoutMaskedKey(pr)))
        : [...profiles.map(withoutMaskedKey), entry];
      await writeProfiles(next, id);
      return;
    }
    /* COMPATIBILITY, not a second design: a server that does not serve a profile
       list is one that predates them, and the single-config PUT it does
       understand is exactly the request this panel has always sent. */
    const draft: AiConfigDraft = {
      mode: 'api-key',
      provider,
      model: model.trim(),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      /* OMITTED when empty — "leave the stored key alone". Sending `''` would
         ask the server to store an empty key, which is how a working setup gets
         wiped by someone who opened the panel to read the model name. */
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(parsedKnobs.params ? { params: parsedKnobs.params } : {}),
    };
    const answer = await client.write(draft);
    if (!live.current) return;
    setSaving(false);
    if (answer.outcome === 'ok') {
      /* Re-render from the RESPONSE, not the draft: what is on screen is then
         what is stored, `gatewayLive` stamp and all. */
      adopt(answer.body);
      setSaved(true);
    } else {
      setFailure(answer.message);
    }
  }

  /** Switch which saved model answers. ONE field on the wire; no key moves. */
  async function useProfile(id: string) {
    setSaving(true);
    setFailure(null);
    setSaved(false);
    const answer = await client.selectProfile(id);
    if (!live.current) return;
    setSaving(false);
    if (answer.outcome === 'ok') adopt(answer.body);
    else setFailure(answer.message);
  }

  /** Forget a saved model. Never the last one — an empty list has no answer. */
  async function forgetProfile(id: string) {
    if (profiles.length <= 1) return;
    setSaving(true);
    setFailure(null);
    setSaved(false);
    const next = profiles.filter((pr) => pr.id !== id).map(withoutMaskedKey);
    const nextDefault = activeProfileId === id ? next[0]!.id : (activeProfileId ?? next[0]!.id);
    await writeProfiles(next, nextDefault);
  }

  /** Start a new saved model. Nothing is written until Save. */
  function newProfile() {
    setEditingId(null);
    setName('');
    setModel('');
    setBaseUrl('');
    setApiKey('');
    setKnobs({});
    setProvider('anthropic');
    setSaved(false);
    setTestResult(null);
    setTestFailure(null);
  }

  /**
   * Does the STORED model actually answer?
   *
   * The first evidence that a model id was misspelled or a local server was down
   * used to be a failed chat turn — after the reader had written their question.
   * This probes the real wire and reports what came back, including the
   * provider's own refusal.
   */
  async function testModel() {
    setTesting(true);
    setTestResult(null);
    setTestFailure(null);
    const answer = await client.testModel(editingId ?? undefined);
    if (!live.current) return;
    setTesting(false);
    if (answer.outcome === 'ok') setTestResult(answer.body);
    else setTestFailure(answer.message);
  }

  const directConfig = config && config.configured && !('mode' in config) ? config : null;
  const storedSuffix = directConfig?.apiKey ?? null;
  const keylessLocal =
    directConfig?.provider === 'openai-compatible' && directConfig.apiKey === undefined;
  const defaultMode = config && config.configured && 'mode' in config;

  return (
    <div className="settings-scope settingspanel" data-testid="settings-panel">
      <h2 className="settings-title">Settings</h2>

      {/*
        * SIDEBAR NAV + ONE SCROLLING BODY.
        *
        * Owner seat 2026-08-27: settings are a left vertical nav, not a top tab
        * bar. One bordered box scrolls; panes swap content inside it without
        * reshaping the frame. WORDED labels — sheet 09 rule 3 forbids borrowing
        * a glyph the vocabulary lacks, and there is none for "hooks".
        */}
      <div className="settings-shell">
        <nav
          className="settings-nav"
          role="tablist"
          aria-label="Settings sections"
          data-testid="settings-nav"
        >
          {SETTINGS_PANES.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="settings-nav-item"
              data-testid={`settings-nav-${tab.id}`}
              data-selected={current === tab.id ? 'true' : undefined}
              aria-selected={current === tab.id}
              title={tab.title}
              onClick={() => setCurrent(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div
          className="settings-body"
          role="tabpanel"
          data-testid="settings-body"
          aria-label={SETTINGS_PANES.find((p) => p.id === current)?.title}
        >
      {current !== 'provider' ? null : (
      <section className="settings-section">
        <h3 className="settings-h">Reasoning provider</h3>

        {config === null ? (
          <p className="settings-note" data-testid="settings-loading">
            Reading your configuration…
          </p>
        ) : defaultMode ? (
          /* Default mode = free-tier path. When the gateway is not funded/live,
             say "not live yet" (same honesty as FREE_TIER_NOT_LIVE_MSG) — do not
             imply infra exists and is merely unreachable. */
          <p className="settings-note" data-testid="settings-default-mode">
            {(config as { gatewayLive: boolean }).gatewayLive
              ? `Using the built-in free default (${(config as { model: string }).model}). The gateway is live.`
              : `Free-tier assistant is not live yet (${(config as { model: string }).model}) — add your own API key below to chat.`}
          </p>
        ) : config.configured ? (
          <p className="settings-note" data-testid="settings-current">
            Connected to {(config as { provider: string }).provider} · {(config as { model: string }).model}
          </p>
        ) : (
          <p className="settings-note" data-testid="settings-unconfigured">
            Scanning and diagrams do not need a model. Chat needs either a model running on this
            machine or an API key.
          </p>
        )}

        {/* ── SAVED MODELS ────────────────────────────────────────────────
            The owner's question, verbatim: "can we save different models to
            switch between? can you set a default model?" The answer used to be
            no on both counts — there was ONE model on disk and changing your
            mind meant retyping the provider, the model id, the base URL and the
            whole API key. Use is one click; the marked row is the default. */}
        {profiles.length > 0 ? (
          <div className="settings-local" data-testid="settings-profiles">
            <p className="settings-note">
              {profiles.length === 1
                ? 'One saved model. Add another to switch between them without retyping.'
                : `${profiles.length} saved models. The one marked Default answers your next question.`}
            </p>
            {profiles.map((pr) => (
              <div
                key={pr.id}
                className="settings-profile"
                data-testid="settings-profile"
                data-profile={pr.id}
                data-active={pr.id === activeProfileId ? 'true' : 'false'}
              >
                <span className="settings-profile-name">
                  {pr.name}
                  {pr.id === activeProfileId ? (
                    /* A WORD, not a colour. Sheet 12.5. */
                    <span className="settings-profile-mark" data-testid="settings-profile-default">
                      {' '}
                      · Default
                    </span>
                  ) : null}
                </span>
                <span className="mono settings-profile-model">
                  {pr.model} · {pr.provider}
                </span>
                <button
                  type="button"
                  className="settings-btn"
                  data-testid="settings-profile-use"
                  data-profile={pr.id}
                  disabled={saving || pr.id === activeProfileId}
                  onClick={() => void useProfile(pr.id)}
                >
                  {pr.id === activeProfileId ? 'In use' : `Use ${pr.name}`}
                </button>
                <button
                  type="button"
                  className="settings-btn"
                  data-testid="settings-profile-edit"
                  data-profile={pr.id}
                  onClick={() => {
                    setEditingId(pr.id);
                    setName(pr.name);
                    setProvider(pr.provider);
                    setModel(pr.model);
                    setBaseUrl(pr.baseUrl ?? '');
                    setApiKey('');
                    const params = (pr.params ?? {}) as Record<string, number>;
                    const asText: Record<string, string> = {};
                    for (const k of Object.keys(params)) {
                      if (typeof params[k] === 'number') asText[k] = String(params[k]);
                    }
                    setKnobs(asText);
                    setSaved(false);
                    setTestResult(null);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="settings-btn"
                  data-testid="settings-profile-forget"
                  data-profile={pr.id}
                  /* The last one cannot go: a list with nothing in it has no
                     answer to "which model", and silently falling back to an
                     unconfigured state is not what "forget this one" said. */
                  disabled={saving || profiles.length <= 1}
                  title={profiles.length <= 1 ? 'The last saved model cannot be forgotten' : undefined}
                  onClick={() => void forgetProfile(pr.id)}
                >
                  Forget
                </button>
              </div>
            ))}
            <button
              type="button"
              className="settings-btn"
              data-testid="settings-profile-new"
              onClick={newProfile}
            >
              Add another model
            </button>
          </div>
        ) : null}

        {/* A2.9 — design sketching latency: recommend a faster model. Sequence
            still does not switch FOR you — but switching is now two clicks in
            the list above, or one in the composer's model chip, instead of
            retyping the whole form. */}
        <p className="settings-hint" data-testid="settings-design-model-hint">
          For blank-workspace design draws (&ldquo;sketch / draw on the board&rdquo;), prefer a
          faster model — fewer rounds, lower wall time. Keep a stronger model for grounded
          explore/edit when a repo is attached. Sequence does not switch models for you: save both
          and switch from the composer&rsquo;s model chip.
        </p>

        {/* ── SOMETHING IS ALREADY RUNNING HERE ─────────────────────────────
            The local-first non-negotiable is that the app delivers its core
            with no network and no key, and the ENGINE honours it — a full
            grounded answer runs against a local OpenAI-compatible model with
            neither. The PRODUCT never said so, and the first failure a new
            reader met was this form asking for an API key.

            Offered, never applied. Which model answers is the reader's
            decision; a surface that configured itself because it found
            something would be choosing for them. */}
        {localProviders.length > 0 ? (
          <div className="settings-local" data-testid="settings-local">
            <p className="settings-note">
              {localProviders.length === 1
                ? `${localProviders[0]!.name} is running on this machine.`
                : `${localProviders.length} model servers are running on this machine.`}{' '}
              Using one costs nothing and needs no key, and nothing leaves your computer.
            </p>
            {localProviders.map((local) =>
              local.models.length === 0 ? (
                /* PRESENT WITH NOTHING LOADED is a different thing to fix from
                   absent, and it is the one a reader can fix in thirty seconds.
                   Saying "no models" beats saying nothing. */
                <p
                  key={local.baseUrl}
                  className="settings-note"
                  data-testid="settings-local-empty"
                  data-provider={local.name}
                >
                  {local.name} is running with no models loaded.
                  {local.name === 'Ollama' ? (
                    <>
                      {' '}Run <code>{'ollama pull <model-name>'}</code> in a terminal.
                    </>
                  ) : null}
                </p>
              ) : (
                local.models.map((model) => (
                  <button
                    key={`${local.baseUrl}:${model}`}
                    type="button"
                    className="settings-btn"
                    data-testid="settings-local-use"
                    data-model={model}
                    onClick={() => {
                      /* Fills the FORM rather than saving. The reader still
                         presses Save, which is the same act it always was —
                         and they can change their mind having seen it.
                         `editingId: null` is what makes this ADD a model rather
                         than overwrite the one they already had: the detected
                         model is a new entry in the list, not a replacement for
                         the config they came in with. */
                      setEditingId(null);
                      setProvider('openai-compatible');
                      setBaseUrl(local.baseUrl);
                      setModel(model);
                      setName(model);
                      setApiKey('');
                      setKnobs({});
                      setSaved(false);
                      setTestResult(null);
                    }}
                  >
                    Add {model} ({local.name})
                  </button>
                ))
              ),
            )}
          </div>
        ) : null}

        {/* WHAT THE READER CALLS IT. A list of `granite4-hermes:latest` and
            `claude-sonnet-4-5` is a list of wire ids; a list of "Local, cheap"
            and "Claude, for the hard edit" is a list of decisions. */}
        <label className="settings-field">
          <span className="settings-label">Name</span>
          <input
            className="settings-input"
            data-testid="settings-name"
            value={name}
            placeholder={model.trim() || 'Local, cheap'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="settings-field">
          <span className="settings-label">Provider</span>
          <select
            className="settings-input"
            data-testid="settings-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          <span className="settings-label">Reasoning</span>
          <input
            className="settings-input"
            data-testid="settings-model"
            value={model}
            placeholder="claude-sonnet-4-5"
            onChange={(e) => setModel(e.target.value)}
          />
        </label>

        <label className="settings-field">
          <span className="settings-label">Base URL</span>
          <input
            className="settings-input"
            data-testid="settings-baseurl"
            value={baseUrl}
            placeholder="http://127.0.0.1:11434/v1 — required for openai-compatible"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>

        <label className="settings-field">
          <span className="settings-label">API key</span>
          <input
            className="settings-input"
            data-testid="settings-apikey"
            type="password"
            value={apiKey}
            placeholder={storedSuffix ? `stored — ends ${storedSuffix.slice(-4)}` : 'sk-…'}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        {/* Said out loud, because "why is this box empty" is the first question
            anyone opening this panel has. */}
        <p className="settings-hint" data-testid="settings-key-hint">
          {storedSuffix
            ? 'A key is stored. It is never sent back to this screen — leave the box empty to keep it.'
            : keylessLocal
              ? 'This loopback model does not need a key.'
            : /* "this screen", matching the branch above it. Sequence is
                 downloaded and run locally, where "the browser" names nothing
                 the reader can see - and the two branches of one sentence
                 should not disagree about what they are describing. */
              'Your key is written to disk and never returned to this screen.'}
        </p>

        {/* ── ADVANCED ────────────────────────────────────────────────────
            Zero sampling or runtime knobs were exposed anywhere, and the whole
            request body was `{model, messages}`. The one that actually hurt was
            the missing deadline: there was NO timeout on a provider call at all
            — the only abort signal fired when the browser tab closed — so a
            stalled local generation hung forever. Blank means absent, and an
            absent knob is not sent at all. */}
        <button
          type="button"
          className="settings-btn"
          data-testid="settings-advanced-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? 'Hide advanced' : 'Advanced — sampling, limits, timeout'}
        </button>
        {advanced ? (
          <div data-testid="settings-advanced">
            <p className="settings-hint" data-testid="settings-advanced-hint">
              Blank means the provider&rsquo;s own default — an empty box sends no field at
              all, because several local servers refuse a request that carries one they did not
              expect.
            </p>
            {KNOBS.map((k) => (
              <label className="settings-field" key={k.key}>
                <span className="settings-label">{k.label}</span>
                <input
                  className="settings-input"
                  data-testid={`settings-knob-${k.key}`}
                  inputMode="decimal"
                  value={knobs[k.key] ?? ''}
                  placeholder={k.placeholder}
                  onChange={(e) => setKnobs((prev) => ({ ...prev, [k.key]: e.target.value }))}
                />
                <span className="settings-hint">{k.hint}</span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="settings-actions">
          <button
            type="button"
            className="settings-save"
            data-testid="settings-save"
            disabled={saving || model.trim() === ''}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="settings-btn"
            data-testid="settings-test"
            disabled={testing || !(config !== null && config.configured)}
            onClick={() => void testModel()}
          >
            {testing ? 'Testing…' : 'Test this model'}
          </button>
          {saved ? (
            <span className="settings-ok" data-testid="settings-saved">
              Saved
            </span>
          ) : null}
        </div>
        {/* SAYS WHAT IT TESTED. The probe reads the STORED configuration, so a
            form with unsaved edits would otherwise report on a model the reader
            is no longer looking at. */}
        <p className="settings-hint" data-testid="settings-test-hint">
          Test sends one short prompt to the saved model, on the same wire a real question uses.
          It tests what is stored — save first if you have just edited the form.
        </p>
        {testFailure !== null ? (
          <p className="settings-note" data-testid="settings-test-failure">
            {testFailure}
          </p>
        ) : null}
        {testResult !== null ? (
          <p className="settings-note" data-testid="settings-test-result" data-ok={testResult.ok ? 'true' : 'false'}>
            {testResult.ok
              ? `${testResult.model} answered in ${testResult.ms} ms: “${testResult.sample ?? ''}”`
              : `${testResult.model} did not answer (${testResult.ms} ms): ${testResult.error ?? 'no reason given'}`}
          </p>
        ) : null}

      </section>
      )}

      {current !== 'notifications' ? null : (
      <section className="settings-section" data-testid="settings-notify">
        <h3 className="settings-h">Long runs</h3>
        <p className="settings-note" data-testid="settings-notify-detail">
          {notify.detail}
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="settings-save"
            data-testid="settings-notify-toggle"
            disabled={!notify.actionable}
            onClick={() => {
              void (async () => {
                if (permission === 'granted') {
                  setNotifyOn(!notifyOn);
                  return;
                }
                /* THE ONLY PLACE THE PROMPT IS RAISED, and it is one click from
                   a person who just read what it does. */
                const answer = await Notification.requestPermission();
                if (!live.current) return;
                setPermission(answer as NotifyPermission);
                /* Granting is the whole point of the click, so it turns on —
                   asking them to click twice for one intention would be a
                   second question they already answered. */
                setNotifyOn(answer === 'granted');
              })();
            }}
          >
            {notifyControl({ permission, enabled: notifyOn }).label}
          </button>
        </div>
      </section>
      )}

      {/* ── HOOKS ─────────────────────────────────────────────────────────
          Shown only when this repo declares any. A consent control for a
          feature nothing is using is a question about a thing that is not
          happening. */}
      {current === 'hooks' && hooks !== null && Object.keys(hooks.declared).length > 0 ? (
        <section className="settings-section" data-testid="settings-hooks">
          <h3 className="settings-h">This repository&rsquo;s hooks</h3>
          {/* WHICH OF THE ADVERTISED EVENTS CANNOT FIRE. Six are declared and
              two have a call site; a user who writes a `pre-tool` hook gets
              silence and debugs their own script. Said here, where they are
              looking at the hook they just wrote. */}
          {hooks?.unfired ? (
            <p className="settings-note" data-testid="settings-hooks-unfired" role="status">
              {hooks.unfired}
            </p>
          ) : null}
          <p className="settings-note">
            {/* NAMED, not counted. "3 hooks" is a number; the commands are what
                a person is actually being asked to consent to running. */}
            <code>.sequence/hooks.json</code> asks to run commands at{' '}
            {Object.keys(hooks.declared).sort().join(', ')}.
          </p>
          <ul className="sessions-list" data-testid="settings-hooks-list">
            {Object.entries(hooks.declared)
              .sort(([a], [b]) => a.localeCompare(b))
              .flatMap(([event, specs]) =>
                specs.map((spec, i) => (
                  <li key={`${event}:${i}`}>
                    <span className="sessions-row" data-testid="settings-hook-row">
                      <span className="sessions-tag">{event}</span>
                      <span className="sessions-name">{spec.command.join(' ')}</span>
                      {hooks.blocking.includes(event) &&
                      (hooks.live ?? []).includes(event) ? (
                        <span className="sessions-tag">can block</span>
                      ) : null}
                      {!(hooks.live ?? []).includes(event) ? (
                        <span className="sessions-tag" data-testid="settings-hook-unfired-tag">
                          does not fire yet
                        </span>
                      ) : null}
                    </span>
                  </li>
                )),
              )}
          </ul>
          <p className="settings-hint" data-testid="settings-hooks-hint">
            {/* Live hooks only — dead events stay listed but do not run even when trusted. */}
            Only live hooks ({(hooks.live ?? ['pre-write', 'pre-commit']).join(', ')}) run on your
            machine when enabled. Commands are committed in the repository. Only enable them for a
            repository you trust.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-save"
              data-testid="settings-hooks-trust"
              onClick={() => {
                void (async () => {
                  const answer = await client.setHookTrust(!hooks.trusted);
                  if (!live.current) return;
                  if (answer.outcome === 'ok') setHooks({ ...hooks, trusted: answer.body.trusted });
                  else setFailure(answer.message);
                })();
              }}
            >
              {hooks.trusted ? 'Stop running them' : 'Allow them to run'}
            </button>
            <span className="settings-ok" data-testid="settings-hooks-state">
              {hooks.trusted ? 'Enabled for this repository.' : 'Not running.'}
            </span>
          </div>
        </section>
      ) : null}

      {/* ══ THE OWNER'S NINE ══════════════════════════════════════════════

          Owner walk 2026-08-22: "What are the settings? It says it's not ready
          yet, right?" followed by the list this renders.

          EVERY ROW SAYS SOMETHING. A section either shows real state or names
          what is missing, and neither is allowed to be an empty frame — nine
          headings over nothing is nine promises, and a reader who opens two of
          them stops opening the rest. `settingsSections` owns that rule and is
          tested on it; this only draws the answer.

          Drawn only when the app has supplied facts. Absent facts means the
          sections are not drawn AT ALL, which is deliberately different from
          drawing them empty. */}
      {current === 'workspace' ? (
        <section className="settings-section" data-testid="settings-autonomy">
          <h3 className="settings-h">Autonomy</h3>
          <p className="settings-hint">
            Auto-edit writes proposed files without Accept. Full access also runs
            allowlisted commands. Both still obey{' '}
            <code>.sequence/permissions.json</code> when present.
          </p>
          <label className="settings-row" data-testid="settings-autonomy-autoedit">
            <input
              type="checkbox"
              checked={autoEditOn}
              onChange={(e) => {
                const next = e.target.checked;
                setAutoEditOn(next);
                writeAutoEditEnabled(next);
                /* Full implies Auto-edit writes; leaving Full on without Auto-edit
                   is still valid (shell + write). */
                publishAutonomy(next, fullOn);
              }}
            />
            <span className="stack">
              <span>Enable Auto-edit</span>
              <span className="sub">Writes files without asking for Accept</span>
            </span>
          </label>
          <label className="settings-row" data-testid="settings-autonomy-full">
            <input
              type="checkbox"
              checked={fullOn}
              onChange={(e) => {
                const next = e.target.checked;
                setFullOn(next);
                writeFullAccessEnabled(next);
                publishAutonomy(autoEditOn, next);
              }}
            />
            <span className="stack">
              <span>Enable Full access</span>
              <span className="sub">Writes files and runs allowlisted commands</span>
            </span>
          </label>
          {/*
            AUTO-APPROVE — the unattended mode, and the reason it is NOT a
            fourth checkbox beside the two above.

            Those two are preferences: they widen the menu under the composer
            and survive a reload. This one is a SESSION GRANT on ONE trusted
            repository, and it is the server that says whether it is on — so it
            reads and writes the wire and holds no local copy. Owner's ask,
            2026-09-02: "some auto approve bypass permissions mode … so it can
            run like its own agentic workflow fully independent."

            The row is drawn only once the server has answered. A switch drawn
            over `null` would be a switch drawn over a guess, and the answer it
            guesses (off) is the one a reader is least able to detect as wrong.

            HUE BUDGET: ZERO, like the rest of this section. Autonomy is a
            setting, not a verdict (Graphite law 1).
          */}
          {autoApproveState !== null ? (
            <label className="settings-row" data-testid="settings-autonomy-autoapprove">
              <input
                type="checkbox"
                checked={autoApproveState.on}
                /* Refused rather than hidden when the repo is untrusted: a
                   control that vanishes teaches nothing, and the sub-line below
                   names trust, which is the thing the reader can change. */
                disabled={!autoApproveState.trusted}
                onChange={(e) => {
                  const next = e.target.checked;
                  void (async () => {
                    const answer = await client.setAutoApprove(next);
                    if (!live.current) return;
                    if (answer.outcome === 'ok') {
                      setAutoApproveState(answer.body);
                      setAutoApproveFailure(null);
                    } else {
                      /* The server's own sentence, verbatim. Inventing a
                         second wording here would give one rule two
                         explanations that could drift apart. */
                      setAutoApproveFailure(answer.message);
                    }
                  })();
                }}
              />
              <span className="stack">
                <span>Run unattended (auto-approve)</span>
                <span className="sub">
                  {autoApproveState.trusted
                    ? 'Tool calls that would ask for approval run without asking, for this session only. Denied rules still refuse.'
                    : 'Trust this repository first — running tools unattended means running its own code without being asked.'}
                </span>
              </span>
            </label>
          ) : null}
          {autoApproveFailure !== null ? (
            <p
              className="settings-note"
              data-testid="settings-autonomy-autoapprove-failure"
              role="alert"
            >
              {autoApproveFailure}
            </p>
          ) : null}
          {/* B5.2 — one matrix: Plan / Propose / Auto-edit / Full. Not a second
              settings tree — the ladder the composer Permission menu already
              names, drawn once so opt-in rows are not a mystery. */}
          <div className="settings-matrix-wrap" data-testid="settings-autonomy-matrix">
            <table className="settings-matrix" aria-label="Autonomy mode matrix">
              <thead>
                <tr>
                  <th scope="col">Mode</th>
                  {AUTONOMY_MATRIX_COLUMNS.map((col) => (
                    <th key={col.key} scope="col">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AUTONOMY_MATRIX.map((row) => (
                  <tr key={row.mode} data-mode={row.mode}>
                    <th scope="row">
                      <span className="settings-matrix-mode">{row.label}</span>
                      <span className="settings-matrix-summary">{row.summary}</span>
                    </th>
                    {AUTONOMY_MATRIX_COLUMNS.map((col) => {
                      const on = row.capabilities[col.key];
                      return (
                        <td
                          key={col.key}
                          data-on={on ? 'true' : 'false'}
                          data-testid={`settings-autonomy-cell-${row.mode}-${col.key}`}
                        >
                          {autonomyCellMark(on)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {current === 'workspace' ? (
        <section className="settings-section" data-testid="settings-permissions">
          <h3 className="settings-h">Tool permissions</h3>
          {permLoading && permExists === null && permFailure === null ? (
            <p className="settings-note" data-testid="settings-permissions-loading">
              Loading `.sequence/permissions.json`…
            </p>
          ) : null}
          {permFailure !== null && permExists === null ? (
            <p className="settings-note" data-testid="settings-permissions-failure" role="alert">
              {permFailure}
            </p>
          ) : null}
          {permExists !== null ? (
            <>
              <p className="settings-hint">
                {permExists
                  ? 'Editing `.sequence/permissions.json` for this repository — the same file the agent loads.'
                  : 'No `.sequence/permissions.json` yet. Saving creates one with the text below.'}
              </p>
              <p className="settings-hint" data-testid="settings-permissions-deny-streak-hint">
                `denyStreak` (default 3) stops the ask loop after that many consecutive tool
                denials — Codex-style circuit breaker, not a silent retry loop.
              </p>
              <textarea
                className="settings-textarea mono"
                data-testid="settings-permissions-text"
                rows={12}
                value={permText}
                spellCheck={false}
                onChange={(e) => {
                  setPermText(e.target.value);
                  setPermSaved(false);
                  setPermFailure(null);
                }}
              />
              {permWarnings.length > 0 ? (
                <ul className="settings-note" data-testid="settings-permissions-warnings">
                  {permWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {permFailure !== null ? (
                <p className="settings-note" data-testid="settings-permissions-failure" role="alert">
                  {permFailure}
                </p>
              ) : null}
              {permSaved ? (
                <p className="settings-ok" data-testid="settings-permissions-saved">
                  Saved to `.sequence/permissions.json`.
                </p>
              ) : null}
              <button
                type="button"
                className="settings-save"
                data-testid="settings-permissions-save"
                disabled={permSaving}
                onClick={() => {
                  void (async () => {
                    setPermSaving(true);
                    setPermFailure(null);
                    setPermSaved(false);
                    const answer = await client.writePermissions(permText);
                    setPermSaving(false);
                    if (!live.current) return;
                    if (answer.outcome !== 'ok') {
                      setPermFailure(answer.message);
                      return;
                    }
                    setPermText(answer.body.text);
                    setPermExists(true);
                    setPermWarnings(answer.body.warnings);
                    setPermSaved(true);
                  })();
                }}
              >
                {permSaving ? 'Saving…' : 'Save permissions'}
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {current === 'workspace' ? (
        <section className="settings-section" data-testid="settings-mcp">
          <h3 className="settings-h">MCP servers</h3>
          {mcpLoading && mcpExists === null && mcpFailure === null ? (
            <p className="settings-note" data-testid="settings-mcp-loading">
              Loading `.sequence/mcp.json`…
            </p>
          ) : null}
          {mcpFailure !== null && mcpExists === null ? (
            <p className="settings-note" data-testid="settings-mcp-failure" role="alert">
              {mcpFailure}
            </p>
          ) : null}
          {mcpExists !== null ? (
            <>
              <p className="settings-hint">
                {mcpExists
                  ? 'Editing `.sequence/mcp.json` for this repository — the same file `call_mcp` loads.'
                  : 'No `.sequence/mcp.json` yet. Saving creates one with the text below.'}
              </p>
              <div className="settings-mcp-add" data-testid="settings-mcp-add">
                <p className="settings-hint">Add a stdio server (merges into the JSON below).</p>
                <label className="settings-row">
                  <span className="stack">
                    <span>Name</span>
                    <input
                      type="text"
                      data-testid="settings-mcp-add-name"
                      value={mcpAddName}
                      onChange={(e) => setMcpAddName(e.target.value)}
                      placeholder="github"
                    />
                  </span>
                </label>
                <label className="settings-row">
                  <span className="stack">
                    <span>Command</span>
                    <input
                      type="text"
                      data-testid="settings-mcp-add-command"
                      value={mcpAddCommand}
                      onChange={(e) => setMcpAddCommand(e.target.value)}
                      placeholder="npx"
                    />
                  </span>
                </label>
                <label className="settings-row">
                  <span className="stack">
                    <span>Args (space-separated)</span>
                    <input
                      type="text"
                      data-testid="settings-mcp-add-args"
                      value={mcpAddArgs}
                      onChange={(e) => setMcpAddArgs(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-github"
                    />
                  </span>
                </label>
                <button
                  type="button"
                  className="settings-save"
                  data-testid="settings-mcp-add-btn"
                  onClick={() => {
                    const args = mcpAddArgs.trim() ? mcpAddArgs.trim().split(/\s+/) : [];
                    const next = mergeMcpServerEntry(mcpText, mcpAddName, mcpAddCommand, args);
                    setMcpText(next);
                    setMcpSaved(false);
                    setMcpFailure(null);
                  }}
                >
                  Add to JSON
                </button>
              </div>
              <textarea
                className="settings-textarea mono"
                data-testid="settings-mcp-text"
                rows={10}
                value={mcpText}
                spellCheck={false}
                onChange={(e) => {
                  setMcpText(e.target.value);
                  setMcpSaved(false);
                  setMcpFailure(null);
                }}
              />
              {mcpWarnings.length > 0 ? (
                <ul className="settings-note" data-testid="settings-mcp-warnings">
                  {mcpWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {mcpFailure !== null ? (
                <p className="settings-note" data-testid="settings-mcp-failure" role="alert">
                  {mcpFailure}
                </p>
              ) : null}
              {mcpSaved ? (
                <p className="settings-ok" data-testid="settings-mcp-saved">
                  Saved to `.sequence/mcp.json`.
                </p>
              ) : null}
              <button
                type="button"
                className="settings-save"
                data-testid="settings-mcp-save"
                disabled={mcpSaving}
                onClick={() => {
                  void (async () => {
                    setMcpSaving(true);
                    setMcpFailure(null);
                    setMcpSaved(false);
                    const answer = await client.writeMcpConfig(mcpText);
                    setMcpSaving(false);
                    if (!live.current) return;
                    if (answer.outcome !== 'ok') {
                      setMcpFailure(answer.message);
                      return;
                    }
                    setMcpText(answer.body.text);
                    setMcpExists(true);
                    setMcpWarnings(answer.body.warnings);
                    setMcpSaved(true);
                  })();
                }}
              >
                {mcpSaving ? 'Saving…' : 'Save MCP servers'}
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {current === 'workspace' && facts ? (
        <section className="settings-section" data-testid="settings-workspace-actions">
          <h3 className="settings-h">Workspace</h3>
          <div className="settings-actions settings-actions-row">
            {facts.repoName ? (
              <button
                type="button"
                className="settings-save"
                data-testid="settings-open-folder"
                onClick={onOpenFolder}
              >
                Switch folder — {facts.repoName}
              </button>
            ) : (
              <button
                type="button"
                className="settings-save"
                data-testid="settings-open-folder"
                onClick={onOpenFolder}
              >
                Open a folder…
              </button>
            )}
            <button
              type="button"
              className="settings-save"
              data-testid="settings-default-workspace"
              disabled={facts.repoName === null || !onLeaveRepo}
              onClick={onLeaveRepo}
            >
              Default workspace
            </button>
          </div>
          <p className="settings-hint">
            Default workspace shows every session and project. Open a folder to attach or switch
            repositories.
          </p>
        </section>
      ) : null}

      {current === 'workspace' && facts ? (
        <section className="settings-section" data-testid="settings-sections">
          <h3 className="settings-h">This workspace</h3>
          {unbuiltCount(settingsSections(facts)) > 0 ? (
            /* Said once, at the top, rather than discovered one disappointment
               at a time. */
            <p className="settings-note" data-testid="settings-unbuilt-count">
              {unbuiltCount(settingsSections(facts))} of these is not built yet, and says so below.
            </p>
          ) : null}
          <ul className="settings-list">
            {settingsSections(facts).map((section) => (
              <li key={section.id} className="settings-row" data-testid={`settings-row-${section.id}`}>
                <span className="settings-row-hd">
                  <span className="settings-row-title">{section.title}</span>
                  {/* The state is a WORD, never a colour alone — sheet 12.5's
                      rule, and this control spends no hue at all. */}
                  <span className="settings-row-state" data-state={section.state.kind}>
                    {STATE_WORD[section.state.kind]}
                  </span>
                </span>
                <span className="settings-row-purpose">{section.purpose}</span>
                <span className="settings-row-detail">{section.state.detail}</span>
                {section.id === 'leave-repo' &&
                facts.repoName !== null &&
                onLeaveRepo &&
                section.state.kind === 'ready' ? (
                  <span className="settings-actions">
                    <button
                      type="button"
                      className="settings-save"
                      data-testid="settings-leave-repo"
                      onClick={onLeaveRepo}
                    >
                      Leave this repository
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="settings-section">
        {failure === null ? null : (
          /* The SERVER's words. A panel that rewrote them would hide the one
             sentence that says what to fix. */
          <p className="settings-failure" data-testid="settings-failure" role="alert">
            {failure}
          </p>
        )}
      </section>
        </div>
      </div>
    </div>
  );
}
