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

import { MenuSelect, SbIcon, type SbIconName } from './sbParts';
import { setStatusBar, useStatusBar } from '../shell2/statusBarPref';
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Icon } from '../chat/Icon';
import { LocalSetupCard } from './LocalSetupCard';

import type {
  AiParams,
  AiProfileView,
  GetAiConfigResponse,
  GetAutoApproveResponse,
  PostAiConfigTestResponse,
  ProviderKind,
} from '@sequence/api-types';
import { SkillsImport } from './SkillsImport';
import type { AiConfigDraft, HooksView, SettingsClient, SkillsView } from './settingsClient';
import { defaultNickname } from '../chat/modelNames';
import {
  OPENAI_SUBSCRIPTION_NOTE,
  PROVIDER_PRESETS,
  keyFieldVisible,
  presetById,
  presetChipLabel,
  presetForProfile,
  probesForPreset,
  thinksByDefault,
  type PresetId,
  type ProviderPreset,
} from './providerPresets';
import { mergeMcpServerEntry } from './mcpConfigDraft';
import { settingsSections, unbuiltCount, type SettingsFacts } from './settingsSections';
import { AppPane } from './AppPane';
import { ThemeSetting } from './ThemeSetting';
import { AskLedgerSetting } from './AskLedgerSetting';
import { SETTINGS_PANES, resolvePane, tabOf, type SettingsPane, type SettingsSectionId, type SettingsTab } from './settingsPanes';
/* Loaded when Settings > Workspace opens, not in the boot bundle (perf ratchet: bootJsBytes). */
const AgentMapSetting = lazy(() => import('./AgentMapSetting'));
const WorktreeSettings = lazy(() => import('../worktree/WorktreeSettings'));
/* S5: lazy like the map setting; the boot bundle is ratcheted and nobody needs
   this pane at first paint. */
const AttentionSetting = lazy(() => import('./AttentionSetting'));
const WhiteboardSetting = lazy(() => import('./WhiteboardSetting'));
const AgentsPane = lazy(() => import('./AgentsPane'));
import { chooseAccent, readAccent, type Accent } from './accentPreference';
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
import { FailureNote } from '../components/FailureNote';
import { applyContextWindowFromConfig, bumpModelGen, currentModelGen, useStoreIfAny } from '../state/connect';

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
/* One line under each provider in its menu (B's menu row). */
const PROVIDER_DESC: Record<ProviderKind, string> = {
  anthropic: 'api.anthropic.com, with your key',
  'openai-compatible': 'Local or hosted, at the base URL below',
};

/* B's glyph for each pane in the nav. */
const NAV_ICON: Record<SettingsTab, SbIconName> = {
  agents: 'nodes',
  models: 'spark',
  skills: 'bolt',
  app: 'sliders',
  safety: 'shield',
  workspace: 'folder',
};

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
  /** A slider alongside the box, where the range is small and bounded. `rest` is where it sits while the box is blank. */
  slider?: { min: number; max: number; step: number; rest: number };
}[] = [
  { key: 'temperature', label: 'Temperature', hint: '0 is repeatable, 2 is wild', placeholder: 'default', slider: { min: 0, max: 2, step: 0.1, rest: 1 } },
  { key: 'topP', label: 'Top P', hint: 'How much of the likely words to keep', placeholder: 'default', slider: { min: 0, max: 1, step: 0.05, rest: 1 } },
  { key: 'maxTokens', label: 'Max output tokens', hint: '1–1,000,000', placeholder: 'provider default' },
  { key: 'timeoutMs', label: 'Timeout (ms)', hint: '1,000–3,600,000; blank means no deadline', placeholder: 'no deadline' },
  { key: 'maxRetries', label: 'Retries', hint: '0–5; only before the first token', placeholder: '0' },
];

/**
 * The HOST of a base URL, for the one-line card meta.
 *
 * A card that printed the whole URL would spend a line on `/v1` that every row
 * shares. An unparseable string is printed verbatim rather than swallowed —
 * it is what the reader typed, and hiding it hides the typo.
 */
function hostOf(url: string | undefined): string | null {
  const raw = (url ?? '').trim();
  if (raw === '') return null;
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw;
  }
}

/** A profile id that cannot collide with one already saved. */
const CHOICES = [
  { id: 'local', label: 'Local model', sub: 'Ollama, LM Studio' },
  { id: 'key', label: 'API key', sub: 'OpenAI, Anthropic, OpenRouter, Other OpenAI-compatible' },
] as const;

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
  const statusBarOn = useStatusBar();
  /* The pane the caller asked for, honoured. Held locally after that so the
     tabs can move without a round trip through the store - which pane is
     showing is where the reader is looking, not something a reload needs to
     agree about. */
  const [current, setCurrent] = useState<SettingsTab>(() => resolvePane(pane));
  const [skills, setSkills] = useState<SkillsView | null>(null);
  /* The found-local list starts CLOSED — see the disclosure below. */
  const [localOpen, setLocalOpen] = useState(false);

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
   * ── WHERE THE MODEL RUNS ──────────────────────────────────────────────
   *
   * Which preset card is chosen, or null for "editing by hand". The form
   * used to ask for a WIRE (`openai-compatible`) and a base URL, and the
   * reader has a PRODUCT: knowing that OpenRouter is spelled
   * `openai-compatible` at `https://openrouter.ai/api/v1`, and that
   * Anthropic's base must NOT carry `/v1` because `resolveEndpoint` appends
   * `/v1/messages` itself, were four facts nobody put on screen.
   *
   * NULL IS NOT "NONE CHOSEN YET", it is "no card is speaking for this
   * form" — which is exactly the state a reader is in when they open the
   * panel on a model that was already saved. The key box and the local list
   * both read this, and both keep their old behaviour on null.
   */
  const [presetId, setPresetId] = useState<PresetId | null>(null);
  /* O3: which one-line choice (Local model, API key) is open. Null: both folded. */
  const [openChoice, setOpenChoice] = useState<'local' | 'key' | null>(null);

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
  /* True once the reader presses Edit on a saved model. The form following the ACTIVE model on load
     (editingId) does not count: that is not a request to see the form. */
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [knobs, setKnobs] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PostAiConfigTestResponse | null>(null);
  /* The sentence, and the server's own words behind Details (UX audit R11 #28). */
  const [testFailure, setTestFailure] = useState<{ say: string; detail: string } | null>(null);
  /*
   * ── THE CARD'S OWN CONTROLS ───────────────────────────────────────────
   *
   * Ported from ml-harness `Settings.tsx:ConnectionCard`, which the owner named
   * as the surface that already does this well. Three pieces of state, and each
   * one is scoped to a SINGLE card on purpose: a rename open on one row and a
   * forget confirmed on another are two different questions, and one shared
   * flag would answer them both at once.
   *
   * The rename follows ml-harness `ConnectModel.tsx:Nickname` exactly — Enter
   * and blur save, Escape abandons, an empty name is a no-op, and a save the
   * server refused KEEPS THE BOX OPEN WITH WHAT WAS TYPED.
   */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [confirmForgetId, setConfirmForgetId] = useState<string | null>(null);
  const [cardTest, setCardTest] = useState<{ id: string; text: string; detail?: string } | null>(null);
  const [cardTesting, setCardTesting] = useState<string | null>(null);
  /** A re-read of the machine inventory is in flight (the "Check again" door). */
  const [rechecking, setRechecking] = useState(false);

  const [hooks, setHooks] = useState<HooksView | null>(null);
  /*
   * P3 autonomy opt-in — Build stays off until the user flips this.
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
   * Build above is a user PREFERENCE and persists. This one is a
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
    /* EITHER switch turns Build on: Build is what Auto-edit and Full were two
       halves of, so reading only one would demote somebody who had opted into
       Full alone. */
    const enabled: PermissionMode[] = ['plan'];
    if (nextAuto || nextFull) enabled.push('build');
    onAutonomyChange?.(enabled);
  };
  /*
   * THE APPEARANCE EXPERIMENT (GRAPHITE-DECISIONS.md Decision 29).
   *
   * Read from storage rather than initialised to the default, for the reason
   * the notification switch above records: a control that forgets is a control
   * that does not work. The attribute is already on the element by the time
   * this renders — index.html sets it pre-paint and main.tsx re-asserts it —
   * so this state is the control's own reading of the same fact, never the
   * source of it.
   */
  const [accent, setAccentState] = useState<Accent>(() => readAccent());
  const pickAccent = useCallback((next: Accent) => {
    setAccentState(next);
    chooseAccent(next);
  }, []);

  const live = useRef(true);

  /* The composer follows the server's active model whenever a Settings write or switch changes it, so the
     chip, the status bar and the next send read the model Settings just chose. No provider, no composer. */
  const appStore = useStoreIfAny();
  /* `startedGen` is given by the first read only (it may describe the model from before a switch made since);
     every other adopt is the answer to this panel's own write, which IS a switch. */
  const adopt = useCallback((body: GetAiConfigResponse, startedGen?: number) => {
    const gen = startedGen ?? bumpModelGen();
    if (appStore) applyContextWindowFromConfig(appStore, body, undefined, gen);
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
  }, [appStore]);

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    const readGen = currentModelGen();
    void (async () => {
      const answer = await client.read(controller.signal);
      if (!live.current) return;
      if (answer.outcome === 'ok') adopt(answer.body, readGen);
      else if (answer.message !== 'cancelled') setFailure(answer.message);
    })();
    /* Read alongside the config: this GET reads a DECLARATION and runs nothing,
       so it is safe on any repo — the consent is the PUT. */
    void (async () => {
      const answer = await client.hooks(controller.signal);
      if (live.current && answer.outcome === 'ok') setHooks(answer.body);
    })();
    /* Same shape and the same reason: a READ of files the agent already
       loads, so it is safe on any repository and answers the question
       "is it reading mine". */
    void (async () => {
      const answer = await client.skills(controller.signal);
      if (!live.current || answer.outcome !== 'ok') return;
      /*
       * NARROWED, NOT TRUSTED. A panel that reads a wire payload straight
       * into JSX puts the whole of Settings behind that payload's shape:
       * one older server, one proxy answering the wrong route, and every
       * section on this pane — permissions, MCP, autonomy — renders
       * nothing, because the throw is in the same component. The other
       * reads here are objects with optional fields; this one indexes
       * arrays, so it is the one that has to check.
       */
      const raw = answer.body as Partial<SkillsView> | null;
      if (!raw || !Array.isArray(raw.skills)) return;
      setSkills({
        dir: typeof raw.dir === 'string' ? raw.dir : '.sequence/skills',
        skills: raw.skills.filter((sk) => sk && typeof sk.slug === 'string'),
        warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
        trusted: raw.trusted === true,
        instructions:
          raw.instructions && typeof raw.instructions.file === 'string'
            ? {
                file: raw.instructions.file,
                bytes: Number(raw.instructions.bytes) || 0,
                truncated: raw.instructions.truncated === true,
              }
            : null,
      });
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
        setPermFailure('Open a project to edit its tool permissions.');
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
        setMcpFailure('Open a project to edit its MCP servers.');
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

  /**
   * Rename ONE saved model, in place, at the moment the reader noticed two rows
   * read the same. Every other profile goes back UNCHANGED and with its mask
   * stripped, which is the same rule the Save button has always followed: a
   * mask is not a key, and this panel has never held a real one.
   *
   * A REFUSED SAVE KEEPS THE BOX OPEN. Discarding somebody's words because a
   * request failed is the one thing this control must not do.
   */
  async function renameProfile(id: string) {
    if (renameBusy) return;
    const pr = profiles.find((entry) => entry.id === id);
    if (pr === undefined) {
      setRenamingId(null);
      return;
    }
    const wanted = renameDraft.trim();
    /* EMPTY IS A NO-OP, and so is the name it already has. Neither is a change
       and neither is worth a round trip. */
    if (wanted === '' || wanted === pr.name) {
      setRenameDraft(pr.name);
      setRenamingId(null);
      return;
    }
    setRenameBusy(true);
    setFailure(null);
    const answer = await client.write({
      profiles: profiles.map((entry) =>
        entry.id === id
          ? { ...withoutMaskedKey(entry), name: wanted }
          : withoutMaskedKey(entry),
      ),
      defaultProfileId: activeProfileId ?? profiles[0]!.id,
    });
    if (!live.current) return;
    setRenameBusy(false);
    if (answer.outcome === 'ok') {
      adopt(answer.body);
      setRenamingId(null);
    } else {
      setFailure(answer.message);
    }
  }

  /** Probe ONE saved model, named on its own card rather than in the form. */
  async function testProfile(id: string) {
    setCardTesting(id);
    setCardTest(null);
    const answer = await client.testModel(id);
    if (!live.current) return;
    setCardTesting(null);
    if (answer.outcome === 'error') {
      setCardTest({ id, text: 'The model did not answer.', detail: answer.message });
      return;
    }
    const body = answer.body;
    setCardTest({
      id,
      /* The provider's OWN words when it refused. An invented "failed" would
         hide the one sentence that says what to change. */
      text: body.ok
        ? `Answered in ${body.ms} ms${body.sample ? ` — ${body.sample}` : ''}`
        : 'Did not answer.',
      detail: body.ok ? undefined : body.error,
    });
  }

  /**
   * ONE CLICK CONNECTS A MODEL THAT IS ALREADY RUNNING HERE.
   *
   * CORRECTION, 2026-09-12 (Max: "adapt the same chat-like settings and setups
   * from ML Harness regarding model selection, nicknames and selection"). This
   * used to FILL THE FORM and wait for Save, on the reasoning that "a surface
   * that configured itself because it found something would be choosing for
   * them". The reasoning is sound and it is not what this changes: the click IS
   * the reader choosing. What it removes is the SECOND act — filling a form and
   * then pressing Save were two gestures for one decision, and the owner's own
   * phrase for what this should cost is "one click".
   *
   * Three calls in one order, the way ml-harness `connectLocal` does it: save
   * the profile, make it the one that answers, then probe the real wire and say
   * what came back. The probe is last because it reports on what was stored —
   * running it first would be testing a model nobody had chosen yet.
   */
  async function connectLocal(baseUrl: string, model: string) {
    setSaving(true);
    setFailure(null);
    setSaved(false);
    setCardTest(null);
    const id = freshProfileId(profiles.map((pr) => pr.id));
    const entry: AiProfileView = {
      id,
      /* NAMED AFTER THE MODEL, never the endpoint — the endpoint is localhost
         for every one of them, which is how ml-harness ended up with seven
         connections and six of them reading `Ollama`. */
      name: defaultNickname(model),
      provider: 'openai-compatible',
      model,
      baseUrl,
    };
    const wrote = await client.write({
      profiles: [...profiles.map(withoutMaskedKey), entry],
      defaultProfileId: id,
    });
    if (!live.current) return;
    if (wrote.outcome !== 'ok') {
      setSaving(false);
      setFailure(wrote.message);
      return;
    }
    adopt(wrote.body);
    const chosen = await client.selectProfile(id);
    if (!live.current) return;
    setSaving(false);
    if (chosen.outcome !== 'ok') {
      setFailure(chosen.message);
      return;
    }
    adopt(chosen.body);
    setSaved(true);
    await testProfile(id);
  }

  /** Start a new saved model. Nothing is written until Save. */
  function newProfile() {
    setEditingId(null);
    setEditOpen(false);
    setPresetId(null);
    setOpenChoice('key');
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
   * PICK WHERE THE MODEL RUNS, AND THE ADDRESS FILLS ITSELF.
   *
   * A PREFILL, NEVER A LOCK: every field it touches stays editable and the
   * server remains the authority on what it will accept. What this removes is
   * the four facts a reader previously had to already know — the wire name, the
   * base URL, whether a key is needed, and what a model id looks like there.
   *
   * It starts a NEW model rather than re-pointing the one being edited.
   * Changing "where it runs" changes the model id, the credential and the
   * address at once; applying that to a saved row would be editing something
   * the reader did not ask to touch. Nothing is written until Save (or, for a
   * local model, until they click one of its rows).
   */
  function choosePreset(id: PresetId) {
    const preset = presetById(id);
    if (preset === undefined) return;
    setPresetId(id);
    setOpenChoice(null);
    setEditingId(null);
    setEditOpen(false);
    setProvider(preset.provider);
    setBaseUrl(preset.baseUrl);
    setModel('');
    setName('');
    setApiKey('');
    setKnobs({});
    setSaved(false);
    setFailure(null);
    setTestResult(null);
    setTestFailure(null);
  }

  /**
   * ASK THE MACHINE AGAIN.
   *
   * The daemon list arrives on `GET /api/ai-config` — the probe already ran
   * before this pane drew, which is why a reader with Ollama sees their models
   * without touching anything. But the most likely thing they do after reading
   * "LM Studio is not answering" is START IT, and without this the only way
   * back was reloading the app. The server caches the inventory for ten
   * seconds, so a leaning-on-it reader costs it nothing.
   *
   * `setConfig` AND NOT `adopt`: adopting re-seeds the form from the active
   * profile, so a reader who had typed half a model id into the preset form and
   * then pressed this would watch their own words disappear. This asks what is
   * running; it is not a reason to rewrite what they are writing.
   */
  async function recheckLocal() {
    setRechecking(true);
    const answer = await client.read();
    if (!live.current) return;
    setRechecking(false);
    if (answer.outcome === 'ok') setConfig(answer.body);
    else if (answer.message !== 'cancelled') setFailure(answer.message);
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
    else setTestFailure({ say: 'The model did not answer.', detail: answer.message });
  }

  /*
   * ── WHAT THE CHOSEN CARD CHANGES ──────────────────────────────────────
   *
   * Three derivations and no fourth. A card decides whether the key box is
   * drawn, which running daemons are worth listing, and what the placeholders
   * say — and nothing else, because everything else is the server's business.
   */
  const chosenPreset: ProviderPreset | undefined = presetById(presetId);
  const showKeyField = keyFieldVisible(chosenPreset);
  /* A new model next to saved ones is not the stored config: its key box and hint say nothing about it. */
  const freshForm = editingId === null && profiles.length > 0;
  /* The add-a-model form (Name, Provider, Model, Base URL, key, Save) belongs to the API key choice. */
  const apiKeyFormOpen =
    editOpen ||
    openChoice === 'key' ||
    (openChoice === null && chosenPreset !== undefined && !chosenPreset.local);
  /*
   * WHICH DAEMONS THE READER IS ASKING ABOUT.
   *
   * No card chosen ⇒ all of them, which is the first-run offer and the
   * behaviour this list has always had. A LOCAL card ⇒ only that one, so
   * picking "LM Studio" stops answering with Ollama's models. A REMOTE card ⇒
   * none: a person typing an OpenAI key is not being told what is running on
   * their laptop, and a list that ignored the question they are answering is
   * noise on the one screen that must not have any.
   */
  const localList =
    chosenPreset === undefined
      ? localProviders
      : chosenPreset.local
        ? probesForPreset(chosenPreset, localProviders)
        : [];

  /** How many models the found local servers actually have loaded. */
  const localModelCount = localList.reduce((n, l) => n + l.models.length, 0);

  const directConfig = config && config.configured && !('mode' in config) ? config : null;
  const storedSuffix = directConfig?.apiKey ?? null;
  const keylessLocal =
    directConfig?.provider === 'openai-compatible' && directConfig.apiKey === undefined;
  const defaultMode = config && config.configured && 'mode' in config;

  /** This repository declares hooks, so the pane has something to draw. */
  const hasHooks = hooks !== null && Object.keys(hooks.declared).length > 0;
  const visiblePanes = SETTINGS_PANES;
  /*
   * A caller may still ASK for the hooks pane (`overlay: { pane: 'hooks' }`),
   * and the answer must not be a body with no tab selected. Reading the
   * fallback here rather than pushing state keeps this a pure consequence of
   * what the repository has, with no effect to get wrong.
   */
  const shown: SettingsTab = current;
  /* One scrolling body is shared by every pane: a pane opens at its top, not where the last one was left. */
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [shown]);
  /* Round 7 (A9): a section draws on the tab that holds it (settingsPanes.ts). */
  const showing = (section: SettingsSectionId): boolean => tabOf(section) === shown;

  return (
    <div className="settings-scope" data-testid="settings-panel">
      <header className="sb-hd">
        <span className="sb-hd-ic" aria-hidden="true">
          <SbIcon name="sliders" />
        </span>
        <h2 className="sb-title">Settings</h2>
      </header>

      {/*
        * SIDEBAR NAV + ONE SCROLLING BODY.
        *
        * Owner seat 2026-08-27: settings are a left vertical nav, not a top tab
        * bar. One bordered box scrolls; panes swap content inside it without
        * reshaping the frame. WORDED labels — sheet 09 rule 3 forbids borrowing
        * a glyph the vocabulary lacks, and there is none for "hooks".
        */}
      <div className="sb-shell">
        <nav
          className="sb-nav"
          role="tablist"
          aria-label="Settings sections"
          data-testid="settings-nav"
        >
          {/*
            ── A TAB WITH NOTHING BEHIND IT IS NOT A TAB (owner, 2026-09-19) ──

            "Hooks is an empty thing in settings… we don't really need it,
            there's no reason to just shove it in for empty space."

            The Hooks pane draws only when `.sequence/hooks.json` declares
            something, so on every repository that declares nothing — most of
            them — the nav offered a fourth destination that led to blank
            space. The FEATURE stays: a repository with hooks still needs to
            see and trust them. What goes is the promise of content that is
            not there. Still loading (`hooks === null`) also hides it, because
            a tab that appears a moment after the panel opens is a worse
            surprise than one that never appeared.
          */}
          {visiblePanes.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="sb-nav-it"
              data-testid={`settings-nav-${tab.id}`}
              data-selected={shown === tab.id ? 'true' : undefined}
              aria-selected={shown === tab.id}
              title={tab.title}
              onClick={() => setCurrent(tab.id)}
            >
              <SbIcon name={NAV_ICON[tab.id]} />
              <span className="sb-nav-t">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div
          className="sb-body"
          ref={bodyRef}
          role="tabpanel"
          data-testid="settings-body"
          aria-label={SETTINGS_PANES.find((p) => p.id === current)?.title}
        >
      {!showing('provider') ? null : (
      <section className="sb-group">
        <h3 className="sb-lab">Your models</h3>
        <div className="sb-card">

        {/*
          THE LOCAL PATH COMES FIRST, AND IT IS ONE BUTTON.

          Owner, 2026-09-19: "render in a one-click local AI setup like
          Magnitude Dev does." CLAUDE.md s second non-negotiable is that the
          app delivers its core with no network and no key; the form below
          used to be the only way to reach that, and its local branch printed
          a terminal command and asked the reader to go and run it.

          ABOVE the key form on purpose: the first thing a new reader meets
          should be the path that costs them nothing, not the one that asks
          for a credential.
        */}
        {/* `configured` so the card does not open on a problem he does not
            have — see its own header. */}
        <LocalSetupCard
          onDone={() => void recheckLocal()}
          configured={config?.configured === true}
          savedModels={profiles.map((pr) => pr.model)}
        />

        {config === null ? (
          <p className="sb-note" data-testid="settings-loading">
            Reading your configuration…
          </p>
        ) : defaultMode ? (
          /* Default mode = free-tier path. When the gateway is not funded/live,
             say "not live yet" (same honesty as FREE_TIER_NOT_LIVE_MSG) — do not
             imply infra exists and is merely unreachable. */
          <p className="sb-note" data-testid="settings-default-mode">
            {(config as { gatewayLive: boolean }).gatewayLive
              ? `Using the built-in free default (${(config as { model: string }).model}). The gateway is live.`
              : `Free-tier assistant is not live yet (${(config as { model: string }).model}) — add your own API key below to chat.`}
          </p>
        ) : config.configured ? (
          <p className="sb-note" data-testid="settings-current">
            Using {profiles.find((pr) => pr.id === activeProfileId)?.name ?? (config as { model: string }).model}
          </p>
        ) : (
          <p className="sb-note" data-testid="settings-unconfigured">
            Chat needs a model. Scanning and diagrams do not.
          </p>
        )}

        {/* ── SAVED MODELS ────────────────────────────────────────────────
            The owner's question, verbatim: "can we save different models to
            switch between? can you set a default model?" The answer used to be
            no on both counts — there was ONE model on disk and changing your
            mind meant retyping the provider, the model id, the base URL and the
            whole API key. Use is one click; the marked row is the default. */}
        {profiles.length > 0 ? (
          <div className="sb-profiles" data-testid="settings-profiles">
            {profiles.length > 1 ? (
              <p className="sb-hint">{profiles.length} saved models. Default answers next.</p>
            ) : null}
            {profiles.map((pr) => {
              const host = hostOf(pr.baseUrl);
              const active = pr.id === activeProfileId;
              return (
                <div
                  key={pr.id}
                  className="sb-row sb-profile"
                  data-testid="settings-profile"
                  data-profile={pr.id}
                  data-active={active ? 'true' : 'false'}
                >
                  <div className="sb-profile-hd">
                    {renamingId === pr.id ? (
                      <input
                        className="sb-input sb-profile-rename"
                        data-testid="settings-profile-rename-input"
                        data-profile={pr.id}
                        value={renameDraft}
                        autoFocus
                        disabled={renameBusy}
                        spellCheck={false}
                        aria-label={'Name for ' + pr.model}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => void renameProfile(pr.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void renameProfile(pr.id);
                          }
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setRenameDraft(pr.name);
                            setRenamingId(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="sb-profile-name"
                        data-testid="settings-profile-rename"
                        data-profile={pr.id}
                        title="Rename this model"
                        onClick={() => {
                          setRenameDraft(pr.name);
                          setRenamingId(pr.id);
                          setFailure(null);
                        }}
                      >
                        {pr.name}
                      </button>
                    )}
                    <span className="mono sb-profile-model">{pr.model}</span>
                    {/* WHOSE WIRE THIS IS, as a word rather than as a URL the
                        reader has to parse. `openai-compatible` names a
                        protocol and four of the six things it can be; the chip
                        names the one it actually is. A READING of the stored
                        address, never a claim about how the row was made — a
                        profile typed by hand before presets existed still reads
                        OpenRouter when it points at OpenRouter. */}
                    <span
                      className="sb-chip"
                      data-testid="settings-profile-chip"
                      data-profile={pr.id}
                      data-preset={presetForProfile(pr.provider, pr.baseUrl)}
                    >
                      {presetChipLabel(pr.provider, pr.baseUrl)}
                    </span>
                    {active ? (
                      /* A WORD, not a colour. Sheet 12.5. */
                      <span className="sb-mark" data-testid="settings-profile-default">
                        Default
                      </span>
                    ) : null}
                  </div>

                  {/* WHAT IT ACTUALLY IS, in one line: who serves it, where,
                      and whether a credential is stored for it. The key is
                      named as present or absent and never shown — this panel
                      has only ever held a mask. */}
                  <p className="sb-meta" data-testid="settings-profile-meta">
                    {pr.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
                    {host !== null ? `, ${host}` : ''}
                    {`, ${pr.apiKey !== undefined ? 'key saved' : 'no key needed'}`}
                  </p>

                  <div className="sb-profile-acts">
                    <button
                      type="button"
                      className="sb-pill"
                      data-testid="settings-profile-use"
                      data-profile={pr.id}
                      disabled={saving || active}
                      onClick={() => void useProfile(pr.id)}
                    >
                      {active ? 'In use' : 'Use this one'}
                    </button>
                    <button
                      type="button"
                      className="sb-pill"
                      data-testid="settings-profile-test"
                      data-profile={pr.id}
                      disabled={cardTesting !== null}
                      onClick={() => void testProfile(pr.id)}
                    >
                      {cardTesting === pr.id ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      type="button"
                      className="sb-pill"
                      data-testid="settings-profile-edit"
                      data-profile={pr.id}
                      onClick={() => {
                        setEditingId(pr.id);
                        setEditOpen(true);
                        /* THE FORM FOLLOWS THE ROW, including which card this
                           row belongs to — so a local model opens without a key
                           box it does not need, and the placeholders show what a
                           model id looks like where it actually lives. */
                        setOpenChoice(null);
                        setPresetId(presetForProfile(pr.provider, pr.baseUrl));
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
                    {confirmForgetId === pr.id ? (
                      /* INLINE, never a browser dialog: the question belongs
                         beside the row it is about, and `window.confirm` names
                         the page rather than the model. */
                      <span className="sb-profile-confirm" data-testid="settings-profile-confirm">
                        <span className="sb-meta">Remove {pr.name}?</span>
                        <button
                          type="button"
                          className="sb-pill"
                          data-testid="settings-profile-forget-yes"
                          data-profile={pr.id}
                          disabled={saving}
                          onClick={() => {
                            setConfirmForgetId(null);
                            void forgetProfile(pr.id);
                          }}
                        >
                          Remove it
                        </button>
                        <button
                          type="button"
                          className="sb-pill"
                          data-testid="settings-profile-forget-no"
                          onClick={() => setConfirmForgetId(null)}
                        >
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="sb-pill"
                        data-testid="settings-profile-forget"
                        data-profile={pr.id}
                        /* The last one cannot go: a list with nothing in it has
                           no answer to "which model", and silently falling back
                           to an unconfigured state is not what "forget this
                           one" said. */
                        disabled={saving || profiles.length <= 1}
                        title={profiles.length <= 1 ? 'The last saved model cannot be removed' : undefined}
                        onClick={() => setConfirmForgetId(pr.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {cardTest !== null && cardTest.id === pr.id ? (
                    cardTest.detail ? (
                      <FailureNote
                        className="failure-note sb-meta"
                        testid="settings-profile-test-result"
                        message={cardTest.text}
                        detail={cardTest.detail}
                      />
                    ) : (
                      <p
                        className="sb-meta"
                        data-testid="settings-profile-test-result"
                        data-profile={pr.id}
                      >
                        {cardTest.text}
                      </p>
                    )
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              className="sb-pill sb-pill-solid"
              data-testid="settings-profile-new"
              onClick={newProfile}
            >
              Add another model
            </button>
          </div>
        ) : null}

        {/* ── ADD A MODEL ────────────────────────────────────────────────
            Max, 2026-09-18: "easy to set up new models with API keys."

            The form below asks for a WIRE and the reader has a PRODUCT. To add
            OpenRouter you had to already know it is spelled `openai-compatible`
            at `https://openrouter.ai/api/v1`; to add Anthropic, that its base
            must NOT carry `/v1` because the server appends `/v1/messages`
            itself. Four facts, none of them on screen, each one worth an HTTP
            404 several screens later.

            SIX CARDS OVER TWO WIRES. `anthropic` and `openai-compatible` are
            all the analyzer accepts — these are six ADDRESSES a reader
            recognises, not six providers, and `providerPresets.ts` types them
            against `ProviderKind` so a seventh card for a service nobody wired
            is a compile error rather than a save that always fails. */}
        <div className="sb-presets" data-testid="settings-presets">
          {/* ROUND 13 (O3): two one-line choices, each expands to its providers.
              Local model: Ollama, LM Studio (one click to use one that is
              running). API key: OpenAI, Anthropic, OpenRouter, Other
              OpenAI-compatible. */}
          <div className="sb-choices" role="group" aria-label="Where the model runs" data-settings-draft="true">
            {CHOICES.map((c) => {
              const open = openChoice === c.id || (chosenPreset !== undefined && chosenPreset.local === (c.id === 'local') && openChoice === null);
              return (
                <div key={c.id} className="sb-choice" data-testid="settings-choice" data-choice={c.id} data-open={open ? 'true' : 'false'}>
                  <button
                    type="button"
                    className="sb-choice-hd"
                    data-testid="settings-choice-toggle"
                    aria-expanded={open}
                    onClick={() => {
                      if (open) {
                        setOpenChoice(null);
                        setPresetId(null);
                        setEditOpen(false);
                      } else if (c.id === 'key') {
                        /* A NEW model: the form never starts out holding the active (maybe local) one, whose
                           Save would overwrite it. Edit on a saved row is the only way to edit one. */
                        newProfile();
                      } else {
                        setOpenChoice(c.id);
                      }
                    }}
                  >
                    <Icon name={open ? 'chevdown' : 'chevright'} size={12} />
                    <span className="sb-choice-t">{c.label}</span>
                    <span className="sb-choice-sub">{c.sub}</span>
                  </button>
                  {open ? (
                    <div className="sb-tiles" role="group" aria-label={c.label}>
                      {PROVIDER_PRESETS.filter((p) => p.local === (c.id === 'local')).map((p) => {
                        const found = p.local ? probesForPreset(p, localProviders).find((d) => d.models.length > 0) : undefined;
                        /* Offered once: not again when that model is already saved. */
                        const running = found && !profiles.some((pr) => pr.model === found.models[0]) ? found : undefined;
                        return (
                          <div key={p.id} className="sb-tile-cell">
                            <button
                              type="button"
                              className="sb-tile"
                              data-testid="settings-preset"
                              data-preset={p.id}
                              data-selected={presetId === p.id ? 'true' : undefined}
                              aria-pressed={presetId === p.id}
                              onClick={() => choosePreset(p.id)}
                            >
                              <span className="sb-tile-t">{p.label}</span>
                              <span className="sb-tile-sub">{found ? 'running' : p.local ? 'on this machine' : p.needsKey ? 'API key' : 'you choose'}</span>
                            </button>
                            {running ? (
                              <button
                                type="button"
                                className="sb-pill sb-pill-solid"
                                data-testid="settings-preset-use"
                                data-preset={p.id}
                                disabled={saving}
                                onClick={() => void connectLocal(running.baseUrl, running.models[0]!)}
                              >
                                Use it
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* ── THE CHATGPT QUESTION, ANSWERED BEFORE IT IS ASKED ──────────
              Max asked whether people "can open or add their OpenAI
              subscription". They cannot, and the honest thing is to say so on
              the screen where they would otherwise spend ten minutes looking
              for a sign-in button.

              There is NO public API for a ChatGPT Plus/Pro account. The sign-in
              Codex CLI performs is OpenAI's own first-party client flow and is
              not something a third party may implement — so the alternatives
              here were one muted sentence or a button that lies. It is always
              on screen rather than behind the card, because the reader looking
              for it has not clicked anything yet. */}
          {chosenPreset?.id === 'openai' ? (
            <p className="sb-hint" data-testid="settings-openai-subscription">
              {OPENAI_SUBSCRIPTION_NOTE}
            </p>
          ) : null}

          {chosenPreset !== undefined ? (
            <p
              className="sb-hint"
              data-testid="settings-preset-note"
              data-preset={chosenPreset.id}
            >
              {/* The OpenAI card's sentence is said above, so it is not said twice. */}
              {chosenPreset.id === 'openai' ? null : chosenPreset.note}
              {chosenPreset.keyUrl !== undefined ? (
                <>
                  {' '}
                  <a
                    className="sb-link"
                    data-testid="settings-preset-key-link"
                    href={chosenPreset.keyUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Where to get a key
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          {/* NOT ANSWERING IS A DIFFERENT THING TO FIX FROM NOT INSTALLED, and
              the likeliest next act is STARTING IT — which used to need an app
              reload to be noticed. */}
          {chosenPreset !== undefined && chosenPreset.local && localList.length === 0 ? (
            <div className="sb-row sb-tile-absent" data-testid="settings-preset-absent">
              <p className="sb-meta">
                {chosenPreset.label} is not answering on {hostOf(chosenPreset.baseUrl) ?? chosenPreset.baseUrl}.
                {chosenPreset.id === 'ollama' ? (
                  <>
                    {' '}Start it with <code>ollama serve</code>, then check again.
                  </>
                ) : (
                  <> Start its local server, then check again.</>
                )}
              </p>
              <div className="sb-profile-acts">
                <button
                  type="button"
                  className="sb-pill"
                  data-testid="settings-preset-recheck"
                  disabled={rechecking}
                  onClick={() => void recheckLocal()}
                >
                  {rechecking ? 'Checking…' : 'Check again'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── SOMETHING IS ALREADY RUNNING HERE ─────────────────────────────
            The local-first non-negotiable is that the app delivers its core
            with no network and no key, and the ENGINE honours it — a full
            grounded answer runs against a local OpenAI-compatible model with
            neither. The PRODUCT never said so, and the first failure a new
            reader met was this form asking for an API key.

            Offered, never applied. Which model answers is the reader's
            decision; a surface that configured itself because it found
            something would be choosing for them. */}
        {localList.length > 0 ? (
          <div className="sb-local" data-testid="settings-local">
            {/*
              ── FOUND IS NOT THE SAME AS OFFERED IN FULL (owner, 2026-09-19) ─

              "Local models installed… this shouldn't be automatically put
              out, it should be expandable, so that way you can basically
              just write everything down instead of just having stuff in your
              face."

              A developer machine has a dozen models pulled. Each drew a full
              row — nickname, wire id, host, key note, a button — so picking a
              provider unrolled a screen and a half of rows the reader had not
              asked to read, between them and the form below. The list is
              worth having; it is not worth having open.

              The count is in the summary, so the disclosure still says what
              is behind it: "13 models" is information, "Show more" is not.
            */}
            {localModelCount > 0 ? (
              <button
                type="button"
                className="sb-disclosure"
                data-testid="settings-local-toggle"
                aria-expanded={localOpen}
                aria-controls="settings-local-models"
                onClick={() => setLocalOpen((v) => !v)}
              >
                <Icon name={localOpen ? 'chevdown' : 'chevright'} size={12} />
                {localOpen ? 'Hide' : 'Show'} the {localModelCount} model
                {localModelCount === 1 ? '' : 's'} already installed
              </button>
            ) : null}
            <div id="settings-local-models" hidden={localModelCount > 0 && !localOpen}>
            {localList.map((local) =>
              local.models.length === 0 ? (
                /* PRESENT WITH NOTHING LOADED is a different thing to fix from
                   absent, and it is the one a reader can fix in thirty seconds.
                   Saying "no models" beats saying nothing. */
                <p
                  key={local.baseUrl}
                  className="sb-note"
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
                  <div
                    key={`${local.baseUrl}:${model}`}
                    className="sb-row sb-local-row"
                    data-testid="settings-local-row"
                  >
                    <div className="sb-profile-hd">
                      <span className="sb-profile-name">{defaultNickname(model)}</span>
                      <span className="mono sb-profile-model">{model}</span>
                    </div>
                    <p className="sb-meta">
                      {local.name}, {hostOf(local.baseUrl) ?? local.baseUrl}, no key needed
                      {/* SAID BEFORE IT HAPPENS, not discovered as a slow first
                          question. This family reasons unless told not to, and
                          the analyzer retries such a turn once with reasoning
                          off — so it works, it just costs two round trips the
                          first time. A reader who is not told that concludes
                          the model is broken. */}
                      {thinksByDefault(model) ? ', thinks by default' : ''}
                    </p>
                    <div className="sb-profile-acts">
                      <button
                        type="button"
                        className="sb-pill"
                        data-testid="settings-local-use"
                        data-model={model}
                        disabled={saving}
                        onClick={() => void connectLocal(local.baseUrl, model)}
                      >
                        Use this one
                      </button>
                    </div>
                  </div>
                ))
              ),
            )}
            </div>
          </div>
        ) : null}

        {/* A2.9 — design sketching latency: recommend a faster model. Sequence
            still does not switch FOR you — but switching is now two clicks in
            the list above, or one in the composer's model chip, instead of
            retyping the whole form. */}
        <p className="sb-hint" data-testid="settings-design-model-hint">
          A faster model suits quick sketches, a stronger one repo edits. Sequence does not switch
          models for you.
        </p>

        {/* THE FORM IS THE API KEY CHOICE'S, NOT THE PANE'S (owner: name, provider, model and base URL
            "show right away even if they didn't select API key; we don't need that"). It opens when the
            API key door is open, or a saved model is being edited. */}
        {apiKeyFormOpen ? (
        <>
        {/* WHAT THE READER CALLS IT. A list of `granite4-hermes:latest` and
            `claude-sonnet-4-5` is a list of wire ids; a list of "Claude Sonnet"
            and "Qwen 3" is a list of models. */}
        <label className="sb-field">
          <span className="sb-field-lab">Name</span>
          <input
            className="sb-input"
            data-testid="settings-name" data-settings-draft="true"
            value={name}
            placeholder={model.trim() || 'claude-sonnet-4-5'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="sb-field">
          <span className="sb-field-lab">Provider</span>
          <MenuSelect
            testid="settings-provider"
            ariaLabel="Provider"
            value={provider}
            options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p], desc: PROVIDER_DESC[p] }))}
            onChange={setProvider}
          />
        </label>

        <label className="sb-field">
          <span className="sb-field-lab">Model</span>
          <input
            className="sb-input"
            data-testid="settings-model" data-settings-draft="true"
            value={model}
            /* WHAT A MODEL ID LOOKS LIKE WHERE IT LIVES. `claude-sonnet-4-5` on
               an OpenRouter form is a 404: that service wants `vendor/model`.
               The placeholder follows the chosen card. */
            placeholder={chosenPreset?.modelPlaceholder ?? 'claude-sonnet-4-5'}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>

        <label className="sb-field">
          <span className="sb-field-lab">Base URL</span>
          <input
            className="sb-input"
            data-testid="settings-baseurl" data-settings-draft="true"
            value={baseUrl}
            placeholder={provider === 'anthropic' ? 'https://api.anthropic.com' : 'http://127.0.0.1:11434/v1 (openai-compatible)'}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>

        {/* ── THE KEY BOX, AND WHEN IT IS NOT THERE ──────────────────────
            A key field on a form for a model running on 127.0.0.1 is a box a
            reader will try to fill, and there is nothing to put in it. The
            server agrees: `parseDirectAiFields` accepts a keyless config ONLY
            for an `openai-compatible` baseUrl on loopback, and refuses one
            anywhere else — so the box is hidden exactly where a key is
            provably not needed, and kept everywhere else including when no
            card is chosen. Removing a control on a state this pane does not
            understand would be worse than an extra box. */}
        {showKeyField ? (
          <>
            <label className="sb-field">
              <span className="sb-field-lab">API key</span>
              <input
                className="sb-input"
                data-testid="settings-apikey" data-settings-draft="true"
                type="password"
                value={apiKey}
                placeholder={storedSuffix && !freshForm ? `stored — ends ${storedSuffix.slice(-4)}` : 'sk-…'}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
            {/* Said out loud, because "why is this box empty" is the first question
                anyone opening this panel has. */}
            <p className="sb-hint" data-testid="settings-key-hint">
              {storedSuffix && !freshForm
                ? 'A key is stored and never sent back here. Leave empty to keep it.'
                : keylessLocal && !freshForm
                  ? 'This local model needs no key.'
                : /* "this screen", matching the branch above it. Sequence is
                     downloaded and run locally, where "the browser" names nothing
                     the reader can see - and the two branches of one sentence
                     should not disagree about what they are describing. */
                  'Saved on this machine only.'}
            </p>
          </>
        ) : (
          <p className="sb-hint" data-testid="settings-key-not-needed">
            {chosenPreset?.label ?? 'This model'} runs here. No key needed.
          </p>
        )}

        {/* ── ADVANCED ────────────────────────────────────────────────────
            Zero sampling or runtime knobs were exposed anywhere, and the whole
            request body was `{model, messages}`. The one that actually hurt was
            the missing deadline: there was NO timeout on a provider call at all
            — the only abort signal fired when the browser tab closed — so a
            stalled local generation hung forever. Blank means absent, and an
            absent knob is not sent at all. */}
        <button
          type="button"
          className="sb-pill sb-pill-quiet"
          data-testid="settings-advanced-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? 'Hide advanced' : 'Advanced — sampling, limits, timeout'}
        </button>
        {advanced ? (
          <div data-testid="settings-advanced">
            <p className="sb-hint" data-testid="settings-advanced-hint">
              Blank means the provider&rsquo;s own default. Nothing is sent for an empty box.
            </p>
            {KNOBS.map((k) => (
              <div className="sb-row sb-row-knob" key={k.key}>
                <span className="sb-row-txt">
                  <span className="sb-row-t">{k.label}</span>
                  <span className="sb-row-sub">{k.hint}</span>
                </span>
                {k.slider ? (
                  /* A real slider, like ChatGPT's and Codex's: it writes the same string the box does. */
                  <input
                    type="range"
                    className="sb-slider"
                    data-testid={`settings-knob-${k.key}-slider`}
                    aria-label={k.label}
                    min={k.slider.min}
                    max={k.slider.max}
                    step={k.slider.step}
                    value={Number.isFinite(Number(knobs[k.key])) && (knobs[k.key] ?? '').trim() !== '' ? Number(knobs[k.key]) : k.slider.rest}
                    onChange={(e) => setKnobs((prev) => ({ ...prev, [k.key]: e.target.value }))}
                  />
                ) : null}
                <input
                  className="sb-input sb-input-num"
                  data-testid={`settings-knob-${k.key}`}
                  aria-label={`${k.label} value`}
                  inputMode="decimal"
                  value={knobs[k.key] ?? ''}
                  placeholder={k.placeholder}
                  onChange={(e) => setKnobs((prev) => ({ ...prev, [k.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="sb-acts">
          <button
            type="button"
            className="sb-pill sb-pill-solid"
            data-testid="settings-save"
            disabled={saving || model.trim() === ''}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="sb-pill"
            data-testid="settings-test"
            disabled={testing || !(config !== null && config.configured)}
            onClick={() => void testModel()}
          >
            {testing ? 'Testing…' : 'Test this model'}
          </button>
          {saved ? (
            <span className="sb-ok" data-testid="settings-saved">
              Saved
            </span>
          ) : null}
        </div>
        {/* SAYS WHAT IT TESTED. The probe reads the STORED configuration, so a
            form with unsaved edits would otherwise report on a model the reader
            is no longer looking at. */}
        <p className="sb-hint" data-testid="settings-test-hint">
          Sends one short prompt to what is stored. Save first if you just edited.
        </p>
        {testFailure !== null ? (
          <FailureNote
            className="failure-note sb-note"
            testid="settings-test-failure"
            message={testFailure.say}
            detail={testFailure.detail}
            onRetry={() => void testModel()}
          />
        ) : null}
        {testResult !== null ? (
          <p className="sb-note" data-testid="settings-test-result" data-ok={testResult.ok ? 'true' : 'false'}>
            {testResult.ok
              ? `${testResult.model} answered in ${testResult.ms} ms: “${testResult.sample ?? ''}”`
              : `${testResult.model} did not answer (${testResult.ms} ms): ${testResult.error ?? 'no reason given'}`}
          </p>
        ) : null}
        </>
        ) : null}
        </div>
      </section>
      )}

      {showing('agents') ? (
        <Suspense>
          <AgentsPane />
        </Suspense>
      ) : null}

      {showing('agents') ? <AskLedgerSetting /> : null}

      {showing('notifications') ? (
        <Suspense>
          <AttentionSetting />
        </Suspense>
      ) : null}

      {/* ── HOOKS ─────────────────────────────────────────────────────────
          Shown only when this repo declares any. A consent control for a
          feature nothing is using is a question about a thing that is not
          happening. */}
      {showing('hooks') && hasHooks ? (
        <section className="sb-group" data-testid="settings-hooks">
          <h3 className="sb-lab">This project&rsquo;s hooks</h3>
          <div className="sb-card">
          {/* WHICH OF THE ADVERTISED EVENTS CANNOT FIRE. Six are declared and
              two have a call site; a user who writes a `pre-tool` hook gets
              silence and debugs their own script. Said here, where they are
              looking at the hook they just wrote. */}
          {hooks?.unfired ? (
            <p className="sb-note" data-testid="settings-hooks-unfired" role="status">
              {hooks.unfired}
            </p>
          ) : null}
          <p className="sb-note">
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
          <p className="sb-hint" data-testid="settings-hooks-hint">
            {/* Live hooks only — dead events stay listed but do not run even when trusted. */}
            Only live hooks ({(hooks.live ?? ['pre-write', 'pre-commit']).join(', ')}) run on your
            machine when enabled. Commands are committed in the project. Only enable them for a
            project you trust.
          </p>
          <div className="sb-acts">
            <button
              type="button"
              className="sb-pill sb-pill-solid"
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
            <span className="sb-ok" data-testid="settings-hooks-state">
              {hooks.trusted ? 'Enabled for this project.' : 'Not running.'}
            </span>
          </div>
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
      {showing('workspace') ? (
        <>
          <Suspense>
            <AgentMapSetting />
          </Suspense>
          {/* S7: chat worktrees (the limit, the setup command shown and never run); its own chunk, so the map setting never waits on it. */}
          <Suspense>
            <WorktreeSettings />
          </Suspense>
        </>
      ) : null}

      {showing('autonomy') ? (
        <section className="sb-group" data-testid="settings-autonomy">
          <h3 className="sb-lab">Autonomy</h3>
          <div className="sb-card">
          {/*
            ONE SWITCH, BECAUSE THERE IS ONE MODE BEHIND IT.

            Owner, 2026-09-13: "teach mode, plan mode, build mode … it should be
            pretty simple." Two checkboxes here — Auto-edit and Full access —
            were the settings half of the four-rung ladder, and they outlived it
            by exactly one commit: the composer offered Plan and Build while this
            page still asked which of two retired modes to turn on.

            BOTH PREFERENCES ARE STILL WRITTEN, and that is not tidiness. They
            are what is already on disk from earlier builds, and `App.tsx`
            hydrates Build when EITHER is set — so somebody who had opted into
            Full alone is not silently demoted by this rename. One control, two
            keys, and the keys agree.
          */}
          <label className="sb-row sb-row-switch" data-testid="settings-autonomy-build">
            <input
              type="checkbox"
              role="switch"
              className="sb-switch"
              checked={autoEditOn || fullOn}
              onChange={(e) => {
                const next = e.target.checked;
                setAutoEditOn(next);
                setFullOn(next);
                writeAutoEditEnabled(next);
                writeFullAccessEnabled(next);
                publishAutonomy(next, next);
              }}
            />
            <span className="sb-row-txt">
              <span className="sb-row-t">Full auto by default</span>
              <span className="sb-row-sub">Writes files without Accept and runs allowed commands</span>
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
            <label className="sb-row sb-row-switch" data-testid="settings-autonomy-autoapprove">
              <input
                type="checkbox"
                role="switch"
                className="sb-switch"
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
              <span className="sb-row-txt">
                <span className="sb-row-t">Run unattended</span>
                <span className="sb-row-sub">
                  {autoApproveState.trusted
                    ? 'Skip approval prompts for this session. Denied rules still refuse.'
                    : 'Trust this project first. Unattended runs execute its own code.'}
                </span>
              </span>
            </label>
          ) : null}
          {/* THE CONSENT THE BOX WAITS FOR, one press away from it (owner,
              2026-09-22: "the check mark isn't letting me tick it"). The box was
              disabled until the repository is trusted and nothing in the V3
              shell could trust one. The grant is re-read from the server after,
              so the box enables on the server's word, not on ours. */}
          {autoApproveState !== null && !autoApproveState.trusted && client.setRepoTrust ? (
            <div className="sb-acts">
              <button
                type="button"
                className="sb-pill sb-pill-solid"
                data-testid="settings-trust-repo"
                onClick={() => {
                  void (async () => {
                    const trust = await client.setRepoTrust!(true);
                    if (!live.current) return;
                    if (trust.outcome !== 'ok') {
                      setAutoApproveFailure(trust.message);
                      return;
                    }
                    const again = await client.autoApprove();
                    if (!live.current) return;
                    if (again.outcome === 'ok') {
                      setAutoApproveState(again.body);
                      setAutoApproveFailure(null);
                    }
                  })();
                }}
              >
                Trust this project
              </button>
            </div>
          ) : null}
          {autoApproveFailure !== null ? (
            <p
              className="sb-note"
              data-testid="settings-autonomy-autoapprove-failure"
              role="alert"
            >
              {autoApproveFailure}
            </p>
          ) : null}
          {/* B5.2 — one matrix: Plan / Propose / Auto-edit / Full. Not a second
              settings tree — the ladder the composer Permission menu already
              names, drawn once so opt-in rows are not a mystery. */}
          <details className="sb-more">
          <summary className="sb-more-sum">Compare what each mode can do</summary>
          <div className="sb-matrix-wrap" data-testid="settings-autonomy-matrix">
            <table className="sb-matrix" aria-label="Autonomy mode matrix">
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
                      <span className="sb-matrix-mode">{row.label}</span>
                      <span className="sb-matrix-sub">{row.summary}</span>
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
          </details>
          </div>
        </section>
      ) : null}

      {/*
        ── WHAT STEERS THIS AGENT, IN ONE PLACE (owner, 2026-09-19) ──────────

        "Add a kind of skill dump in Workspace where you can add your personal
        skills, and any agents files, which is going to talk directly to the
        harness so that it reads correctly, and then when people want to
        actually use anything, they refer to that."

        BOTH MECHANISMS ALREADY WORKED AND NEITHER WAS VISIBLE. Every ask
        carries a summary bullet for each skill under `.sequence/skills/`, and
        the full body of the one that matches the question; every trusted
        repository's instruction file is read. From inside the product there
        was no way to answer "is it reading my AGENTS.md" — which is the
        question a person asks precisely when they have written one and it
        does not seem to have taken.

        READ-ONLY ON PURPOSE. These are files in the repository and the editor
        for them is the repository. What was missing was the disclosure, and a
        panel that offered to write them would be a second writer of files the
        agent itself distills into.
      */}
      {showing('skills') ? (
        <section className="sb-group" data-testid="settings-skills">
          <h3 className="sb-lab">Skills and instructions</h3>
          <div className="sb-card">
          <p className="sb-hint">
            Read before every answer. Skills live in <code>{skills?.dir ?? '.sequence/skills'}</code>.
          </p>
          <SkillsImport
            onImported={() => {
              void client.skills().then((answer) => {
                const raw = answer.outcome === 'ok' ? (answer.body as Partial<SkillsView> | null) : null;
                if (!raw || !Array.isArray(raw.skills)) return;
                setSkills((prev) => ({
                  dir: typeof raw.dir === 'string' ? raw.dir : '.sequence/skills',
                  skills: raw.skills!.filter((sk) => sk && typeof sk.slug === 'string'),
                  warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
                  trusted: raw.trusted === true,
                  instructions: prev?.instructions ?? null,
                }));
              });
            }}
          />

          {skills === null ? (
            <p className="sb-note" data-testid="settings-skills-loading">
              Reading the workspace…
            </p>
          ) : (
            <>
              {skills.skills.length === 0 ? (
                <p className="sb-note" data-testid="settings-skills-empty">
                  No skills yet. Add <code>{skills.dir}/&lt;slug&gt;/SKILL.md</code> with a name and
                  description.
                </p>
              ) : (
                <ul className="sb-list" data-testid="settings-skills-list">
                  {skills.skills.map((sk) => (
                    <li key={sk.slug} className="sb-row" data-testid="settings-skill-row">
                      <span className="sb-row-hd">
                        <span className="sb-row-t">{sk.name}</span>
                        <span className="mono sb-profile-model">{sk.slug}</span>
                      </span>
                      <p className="sb-meta">{sk.description}</p>
                    </li>
                  ))}
                </ul>
              )}

              {/* A SKILL THAT DID NOT PARSE IS THE ONE WORTH SAYING OUT LOUD:
                  it is on disk, the author believes it is live, and it is not. */}
              {skills.warnings.length > 0 ? (
                <p className="sb-note" data-testid="settings-skills-warnings">
                  Not loaded: {skills.warnings.join('; ')}
                </p>
              ) : null}

              <p className="sb-note" data-testid="settings-skills-instructions">
                {skills.instructions === null
                  ? 'No instruction file (AGENTS.md, CLAUDE.md or .sequence/instructions.md).'
                  : `Instructions: ${skills.instructions.file} (${skills.instructions.bytes.toLocaleString()} bytes${skills.instructions.truncated ? ', read up to the cap' : ''}) is read on every turn.`}
                {skills.instructions !== null && !skills.trusted
                  ? ' It is NOT being sent, because this project is not trusted yet.'
                  : ''}
              </p>
            </>
          )}
          </div>
        </section>
      ) : null}

      {showing('permissions') ? (
        <section className="sb-group" data-testid="settings-permissions">
          <h3 className="sb-lab">Tool permissions</h3>
          <div className="sb-card">
          {permLoading && permExists === null && permFailure === null ? (
            <p className="sb-note" data-testid="settings-permissions-loading">
              Loading `.sequence/permissions.json`…
            </p>
          ) : null}
          {permFailure !== null && permExists === null ? (
            <p className="sb-note" data-testid="settings-permissions-failure" role="alert">
              {permFailure}
            </p>
          ) : null}
          {permExists !== null ? (
            <>
              <p className="sb-hint">
                {permExists
                  ? 'Editing `.sequence/permissions.json` for this project — the same file the agent loads.'
                  : 'No `.sequence/permissions.json` yet. Saving creates one with the text below.'}
              </p>
              <p className="sb-hint" data-testid="settings-permissions-deny-streak-hint">
                `denyStreak` (default 3) stops the ask loop after that many consecutive tool
                denials — Codex-style circuit breaker, not a silent retry loop.
              </p>
              <textarea
                className="sb-input sb-area mono"
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
                <ul className="sb-note" data-testid="settings-permissions-warnings">
                  {permWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {permFailure !== null ? (
                <p className="sb-note" data-testid="settings-permissions-failure" role="alert">
                  {permFailure}
                </p>
              ) : null}
              {permSaved ? (
                <p className="sb-ok" data-testid="settings-permissions-saved">
                  Saved to `.sequence/permissions.json`.
                </p>
              ) : null}
              <button
                type="button"
                className="sb-pill sb-pill-solid"
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
          </div>
        </section>
      ) : null}

      {showing('mcp') ? (
        <section className="sb-group" data-testid="settings-mcp">
          <h3 className="sb-lab">MCP servers</h3>
          <div className="sb-card">
          {mcpLoading && mcpExists === null && mcpFailure === null ? (
            <p className="sb-note" data-testid="settings-mcp-loading">
              Loading `.sequence/mcp.json`…
            </p>
          ) : null}
          {mcpFailure !== null && mcpExists === null ? (
            <p className="sb-note" data-testid="settings-mcp-failure" role="alert">
              {mcpFailure}
            </p>
          ) : null}
          {mcpExists !== null ? (
            <>
              <p className="sb-hint">
                {mcpExists
                  ? 'Editing `.sequence/mcp.json` for this project — the same file `call_mcp` loads.'
                  : 'No `.sequence/mcp.json` yet. Saving creates one with the text below.'}
              </p>
              <div className="sb-mcp-add" data-testid="settings-mcp-add" data-settings-draft="true">
                <p className="sb-hint">Add a stdio server (merges into the JSON below).</p>
                <label className="sb-row">
                  <span className="sb-row-txt">
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
                <label className="sb-row">
                  <span className="sb-row-txt">
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
                <label className="sb-row">
                  <span className="sb-row-txt">
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
                  className="sb-pill"
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
                className="sb-input sb-area mono"
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
                <ul className="sb-note" data-testid="settings-mcp-warnings">
                  {mcpWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {mcpFailure !== null ? (
                <p className="sb-note" data-testid="settings-mcp-failure" role="alert">
                  {mcpFailure}
                </p>
              ) : null}
              {mcpSaved ? (
                <p className="sb-ok" data-testid="settings-mcp-saved">
                  Saved to `.sequence/mcp.json`.
                </p>
              ) : null}
              <button
                type="button"
                className="sb-pill sb-pill-solid"
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
          </div>
        </section>
      ) : null}

      {showing('workspace') && facts ? (
        <section className="sb-group" data-testid="settings-workspace-actions">
          <h3 className="sb-lab">Workspace</h3>
          <div className="sb-card">
          <div className="sb-acts sb-acts-row">
            {facts.repoName ? (
              <button
                type="button"
                className="sb-pill"
                data-testid="settings-open-folder"
                onClick={onOpenFolder}
              >
                Switch folder — {facts.repoName}
              </button>
            ) : (
              <button
                type="button"
                className="sb-pill"
                data-testid="settings-open-folder"
                onClick={onOpenFolder}
              >
                Open a folder…
              </button>
            )}
            <button
              type="button"
              className="sb-pill"
              data-testid="settings-default-workspace"
              disabled={facts.repoName === null || !onLeaveRepo}
              onClick={onLeaveRepo}
            >
              Default workspace
            </button>
          </div>
          <p className="sb-hint">
            Default workspace shows every session and project. Open a folder to attach or switch
            projects.
          </p>
          </div>
        </section>
      ) : null}

      {showing('workspace') && facts ? (
        <section className="sb-group" data-testid="settings-sections">
          <h3 className="sb-lab">This workspace</h3>
          <div className="sb-card">
          {unbuiltCount(settingsSections(facts)) > 0 ? (
            /* Said once, at the top, rather than discovered one disappointment
               at a time. */
            <p className="sb-note" data-testid="settings-unbuilt-count">
              {unbuiltCount(settingsSections(facts))} of these is not built yet, and says so below.
            </p>
          ) : null}
          <ul className="sb-list">
            {settingsSections(facts).map((section) => (
              <li key={section.id} className="sb-row" data-testid={`settings-row-${section.id}`}>
                <span className="sb-row-hd">
                  <span className="sb-row-t">{section.title}</span>
                  {/* The state is a WORD, never a colour alone — sheet 12.5's
                      rule, and this control spends no hue at all. */}
                  <span className="sb-badge" data-state={section.state.kind}>
                    {STATE_WORD[section.state.kind]}
                  </span>
                </span>
                <span className="sb-row-sub">{section.purpose}</span>
                <span className="sb-row-sub2">{section.state.detail}</span>
                {section.id === 'leave-repo' &&
                facts.repoName !== null &&
                onLeaveRepo &&
                section.state.kind === 'ready' ? (
                  <span className="sb-acts">
                    <button
                      type="button"
                      className="sb-pill"
                      data-testid="settings-leave-repo"
                      onClick={onLeaveRepo}
                    >
                      Close project
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          </div>
        </section>
      ) : null}

      {/* ── APPLICATION ───────────────────────────────────────────────────
          The whole of the removed native menu, in its own file. Kept to one
          line here on purpose: another builder owns the provider sections
          above, and a pane that inlined itself into this component would put
          two owners in one edit. */}
      {/* ── APPEARANCE ────────────────────────────────────────────────────
          WHICH ONE IS THE REAL ONE, SAID ON THE CONTROL.

          Owner, 2026-09-18, on seeing the two side by side: "I like the white a
          lot more, it looks a lot more professional… easier on the eyes… let's
          set white as our main thing." (Decision 30.)

          The experiment ENDED, so the labels say so: white is the default and
          gold is named "Gold (previous)". Nothing was deleted — Decision 30
          keeps gold reachable precisely so the comparison can be repeated
          rather than remembered, and a person who switched to gold yesterday
          still opens into gold today.

          The word in the label rather than only a highlight, for the same
          reason it was there before: the question this control exists to answer
          is "which one is the real one", and a selection ring cannot answer it
          for somebody who chose the other one weeks ago.

          In the Application pane because it is the WINDOW's appearance, not the
          repository's. Reuses the preset-card row wholesale — a second row of
          cards that looked slightly different would be a new component's worth
          of CSS to say the same thing. */}
      {!showing('app') ? null : (
        <section className="sb-group" data-testid="settings-appearance">
          <h3 className="sb-lab">Appearance</h3>
          <div className="sb-card">
          <ThemeSetting />
          {/* THE STATUS BAR (Jaden, 2026-10-06: "toggleable in Settings, on/off,
              default on, persisted"). The shell's preference module owns the
              key and re-renders the bar the moment this flips. */}
          <label className="sb-row sb-row-switch" data-testid="settings-status-bar">
            <input
              type="checkbox"
              role="switch"
              className="sb-switch"
              data-testid="settings-status-bar-switch"
              checked={statusBarOn}
              onChange={(e) => setStatusBar(e.target.checked)}
            />
            <span className="sb-row-txt">
              <span className="sb-row-t">Status bar</span>
              <span className="sb-row-sub">Agent, model, context and branch along the bottom</span>
            </span>
          </label>
          <div className="sb-row sb-row-choice">
            <span className="sb-row-txt">
              <span className="sb-row-t">Accent</span>
              <span className="sb-row-sub">Colour of buttons and highlights</span>
            </span>
            <div className="sb-swatches" role="group" aria-label="Accent">
              {(
                [
                  { id: 'blue', label: 'Blue' },
                  { id: 'violet', label: 'Violet' },
                  { id: 'green', label: 'Green' },
                  { id: 'rose', label: 'Rose' },
                  { id: 'graphite', label: 'Graphite' },
                  { id: 'white', label: 'White glass' },
                  { id: 'gold', label: 'Gold' },
                ] as const
              ).map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="sb-swatch"
                  data-testid="settings-accent"
                  data-accent-choice={choice.id}
                  data-selected={accent === choice.id ? 'true' : undefined}
                  aria-pressed={accent === choice.id}
                  aria-label={choice.label}
                  title={choice.label}
                  onClick={() => pickAccent(choice.id)}
                >
                  <span className="sb-swatch-dot" aria-hidden="true" />
                  <span className="sb-swatch-t">{choice.label}</span>
                </button>
              ))}
            </div>
          </div>
          </div>
        </section>
      )}

      {showing('app') ? (
        <Suspense>
          <WhiteboardSetting />
        </Suspense>
      ) : null}

      {!showing('app') ? null : <AppPane repoName={facts?.repoName ?? null} />}

      <section className="sb-group">
        {failure === null ? null : (
          /* The SERVER's words. A panel that rewrote them would hide the one
             sentence that says what to fix. */
          <p className="sb-fail" data-testid="settings-failure" role="alert">
            {failure}
          </p>
        )}
      </section>
        </div>
      </div>
    </div>
  );
}
