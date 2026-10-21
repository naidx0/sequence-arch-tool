/* ══════════════════════════════════════════════════════════════════════════
   READY IN ONE CLICK
   packages/web2/src/onboarding/ReadyInOneClick.tsx

   The top of the welcome screen. Before this, a person with Codex signed in,
   Cursor and Hermes installed and a model key in their environment still
   connected each one by hand. This reads what is already on the machine and
   lists it in words, then "Set up everything" does all of it at once:

     - every agent that is ready to work (signed in: Claude Code, Codex; or
       installed: Cursor, Hermes, OpenCode, ...) is connected;
     - when no model is set up yet, the first provider whose key is already in
       the environment is saved as a model that READS that key by name (the key
       is never copied; analyzer providerCatalog.ts).

   Only what is ready. An agent that needs a sign-in or an install is named with
   what it needs and left to its own row below; nothing is installed, nothing
   signs in, and nothing is written outside Sequence's own settings. Each step
   says how it went. An offer, never a choice: nothing happens until the click.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { ProviderIcon, brandOf } from '../shell2/brandIcons';
import { S2Icon } from '../shell2/icons';
import type { ProviderStatus } from './onboardingClient';
import { CONNECT_ROUTE, rememberFirstAgent } from './loneAgent';
import { defaultModel, PROVIDER_CATALOG_ROUTE, type CatalogModel, type CatalogProvider, type DetectedProvider } from '../settings/ProviderCatalogCard';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface CatalogRowLite {
  id: string;
  name: string;
  state: string;
}

/** One thing found on this machine, and what the click will do with it. */
export interface Found {
  key: string;
  label: string;
  /** In words, under the label. */
  detail: string;
  /** Set up by the click; false = named only (needs a sign-in or an install first). */
  ready: boolean;
  kind: 'agent' | 'catalog' | 'model';
  /** The catalog or provider id behind the key, for the mark and for the host's own list. */
  id: string;
}

/**
 * The model that will answer, picked for being familiar over the catalog's newest entry (a provider's first
 * model is often an experiment nobody has heard of). First family that matches wins, else defaultModel.
 */
export function familiarModel(p: CatalogProvider): CatalogModel {
  for (const re of [/claude|sonnet/i, /gpt-[\d.]+$/i, /deepseek/i, /llama/i, /qwen/i, /gemini|gemma/i, /glm/i]) {
    const hit = p.models.find((m) => re.test(m.id));
    if (hit) return hit;
  }
  return defaultModel(p);
}

type StepState = 'waiting' | 'running' | 'done' | 'failed';

export interface ReadyInOneClickProps {
  /** The first-run probe's answer (Claude Code and Codex): null while it runs. */
  providers: ProviderStatus[] | null;
  /** Everything ran; `connected` are the agent ids now registered. */
  onDone: (connected: string[]) => void;
  /** How many things the click would set up (0 or 1: the card is not drawn; the single "Use ..." button below covers one). */
  onCount?: (n: number) => void;
  /** The setup is running: the host disables its other ways in until it ends. */
  onRunning?: (running: boolean) => void;
  fetchImpl?: Fetch;
  /**
   * What the host already read (first run reads the agent catalog once for More agents and for this card, and
   * /api/ai-config once): null = that read is under way or failed to give a list. Absent = this card reads it itself.
   */
  catalogRows?: CatalogRowLite[] | null;
  /** From the host's /api/ai-config read: true/false = a model is/is not set up; null = unknown. */
  modelSetUp?: boolean | null;
  /** The catalog agent ids this card lists (empty while it is not drawn), so the host leaves them out of its own list. */
  onListed?: (catalogIds: string[]) => void;
}

const pageFetch: Fetch = (i, init) => fetch(i, init);
const post = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function getJson<T>(f: Fetch, url: string): Promise<T | null> {
  try {
    const r = await f(url, { headers: { accept: 'application/json' } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** What the probe, the agent catalog and the provider catalog say, as rows a person reads. Pure. */
export function foundOnMachine(
  providers: readonly ProviderStatus[],
  catalog: readonly CatalogRowLite[],
  detected: readonly DetectedProvider[],
  modelConfigured: boolean,
  catalogProviders: readonly CatalogProvider[] = [],
): Found[] {
  const out: Found[] = [];
  for (const p of providers) {
    if (p.state === 'ready') out.push({ key: `agent:${p.id}`, label: p.label, detail: p.plan ? `Signed in, ${p.plan}` : 'Signed in', ready: true, kind: 'agent', id: p.id });
    else if (p.state === 'signIn') out.push({ key: `agent:${p.id}`, label: p.label, detail: 'Installed, needs sign-in (below)', ready: false, kind: 'agent', id: p.id });
  }
  for (const c of catalog) {
    if (c.state === 'ready') out.push({ key: `catalog:${c.id}`, label: c.name, detail: 'Installed', ready: true, kind: 'catalog', id: c.id });
  }
  if (!modelConfigured && detected.length > 0) {
    const d = detected[0]!;
    const p = catalogProviders.find((x) => x.id === d.id);
    /* Name the model that will answer before the click: it becomes the default. Its own line, not an agent. */
    const m = p ? familiarModel(p) : null;
    out.push({ key: `model:${d.id}`, label: `Chat model: ${d.name}${m ? `, ${m.name}` : ''}`, detail: `Uses your ${d.keyEnv}`, ready: true, kind: 'model', id: d.id });
  }
  return out;
}

/** The agent's real mark where Sequence has one; the first letter on a tile where it does not (yet). */
function markOf(f: Found): JSX.Element {
  /* The vetted marks, then the packaged registry and models.dev marks (settings/logos): the one lookup every surface uses. */
  const k = brandOf(f.id, f.label);
  if (k !== 'other') return <ProviderIcon provider={k} />;
  return <S2Icon name="cpu" small />;
}

export function ReadyInOneClick({ providers, onDone, onCount, onRunning, fetchImpl = pageFetch, catalogRows, modelSetUp, onListed }: ReadyInOneClickProps) {
  const ownCatalog = catalogRows === undefined;
  const ownAi = modelSetUp === undefined;
  const [catalog, setCatalog] = useState<CatalogRowLite[] | null>(null);
  const [provCatalog, setProvCatalog] = useState<{ providers: CatalogProvider[]; detected: DetectedProvider[] } | null>(null);
  const [modelConfigured, setModelConfigured] = useState<boolean | null>(null);
  const [steps, setSteps] = useState<Record<string, { state: StepState; why?: string }>>({});
  const [running, setRunning] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    void (async () => {
      const [c, pc, ai] = await Promise.all([
        ownCatalog ? getJson<{ agents?: CatalogRowLite[] }>(fetchImpl, '/api/acp/catalog') : null,
        getJson<{ providers?: CatalogProvider[]; detected?: DetectedProvider[] }>(fetchImpl, PROVIDER_CATALOG_ROUTE),
        ownAi ? getJson<{ configured?: unknown }>(fetchImpl, '/api/ai-config') : null,
      ]);
      if (!live.current) return;
      if (ownCatalog) setCatalog(Array.isArray(c?.agents) ? c!.agents! : []);
      setProvCatalog(pc && Array.isArray(pc.providers) ? { providers: pc.providers, detected: Array.isArray(pc.detected) ? pc.detected : [] } : { providers: [], detected: [] });
      /* Only an explicit "configured: false" from a good answer means no model is set up. A failed read
         (500, network, refused) is NOT "none": offering the model then would PUT a one-item list over
         every saved model (round-five review). Unknown counts as configured. */
      if (ownAi) setModelConfigured(ai !== null && ai.configured === false ? false : true);
    })();
    return () => {
      live.current = false;
      /* Gone: the host's single Use button comes back at once instead of waiting on a new read. */
      onCount?.(0);
      onRunning?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchImpl]);

  /* A host's read wins over this card's own; null from the host is "not read yet" (unknown counts as configured, as below). */
  const catalogNow = ownCatalog ? catalog : (catalogRows ?? null);
  const configuredNow = ownAi ? modelConfigured : modelSetUp;
  const loaded = providers !== null && catalogNow !== null && provCatalog !== null && configuredNow !== null;
  const found = loaded ? foundOnMachine(providers, catalogNow, provCatalog.detected, configuredNow, provCatalog.providers) : [];
  const todo = found.filter((f) => f.ready);
  const shown = todo.length >= 2;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (loaded) onCount?.(shown ? todo.length : 0);
  }, [loaded, shown, todo.length, onCount]);
  const listedKey = shown ? found.filter((f) => f.kind === 'catalog').map((f) => f.id).join(',') : '';
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (loaded) onListed?.(listedKey ? listedKey.split(',') : []);
  }, [loaded, listedKey, onListed]);
  /* One thing (or none): the welcome screen's own "Use ..." button and the four options cover it. */
  if (!loaded || !shown || provCatalog === null) return null;

  const mark = (key: string, state: StepState, why?: string): void => setSteps((s) => ({ ...s, [key]: { state, ...(why ? { why } : {}) } }));

  const run = async (): Promise<void> => {
    setRunning(true);
    onRunning?.(true);
    const connected: string[] = [];
    let succeeded = 0;
    for (const f of todo) {
      /* The card left (an option was picked, the dialog closed): nothing more is written. */
      if (!live.current) return;
      mark(f.key, 'running');
      try {
        if (f.kind === 'agent' || f.kind === 'catalog') {
          const id = f.key.slice(f.key.indexOf(':') + 1);
          const r = await fetchImpl(f.kind === 'agent' ? CONNECT_ROUTE : '/api/acp/catalog/connect', post(f.kind === 'agent' ? { provider: id } : { id }));
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          if (!r.ok) throw new Error(body.error ?? `the server answered ${r.status}`);
          connected.push(id);
        } else {
          const d = provCatalog.detected.find((x) => `model:${x.id}` === f.key)!;
          const p = provCatalog.providers.find((x) => x.id === d.id);
          if (!p) throw new Error('the provider is not in the catalog');
          const m = familiarModel(p);
          const id = `env-${p.id}-${Date.now().toString(36)}`.slice(0, 64);
          const r = await fetchImpl('/api/ai-config', post({ profiles: [{ id, name: `${p.name} ${m.name}`.slice(0, 80), provider: p.wire, baseUrl: p.api, model: m.id, apiKeyEnv: d.keyEnv }], defaultProfileId: id }, 'PUT'));
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          if (!r.ok) throw new Error(body.error ?? `the server answered ${r.status}`);
        }
        succeeded += 1;
        if (live.current) mark(f.key, 'done');
      } catch (e) {
        if (live.current) mark(f.key, 'failed', e instanceof Error ? e.message : 'it did not finish');
      }
    }
    if (!live.current) return;
    setRunning(false);
    /* The chat answers with one agent: the signed-in one first (what the single Use button did), else the first connected. */
    const first = connected.find((id) => todo.some((t) => t.kind === 'agent' && t.key === `agent:${id}`)) ?? connected[0];
    if (first) rememberFirstAgent(first);
    /* Nothing worked: stay here, where each row says why, instead of moving on as if it had. */
    onRunning?.(false);
    if (succeeded === 0) return;
    onDone(connected);
  };

  const word = (f: Found): string => {
    const s = steps[f.key];
    /* Honest words: a signed-in agent is Ready; one found only by its program on this computer, or a model that reads a key, Will connect. */
    if (!s) return !f.ready ? 'Later' : f.kind === 'agent' ? 'Ready' : 'Will connect';
    return s.state === 'running' ? 'Setting up…' : s.state === 'done' ? 'Done' : s.state === 'failed' ? 'Did not work' : 'Ready';
  };

  return (
    <div className="fr-ready" data-testid="ready-in-one-click">
      <h2 className="fr-h" id="fr-ready-h">
        Found on this machine
      </h2>
      <ul className="fr-ready-list" aria-labelledby="fr-ready-h">
        {found.map((f) => (
          <li key={f.key} className="fr-ready-row" data-testid="ready-found" data-key={f.key} data-kind={f.kind} data-ready={f.ready ? 'true' : 'false'}>
            <span className="fr-ready-ic" aria-hidden="true">
              {markOf(f)}
            </span>
            <span className="fr-ready-txt">
              <span className="fr-ready-name">{f.label}</span>
              <span className="fr-ready-detail">{steps[f.key]?.why ? `${f.detail}. ${steps[f.key]!.why}` : f.detail}</span>
            </span>
            <span className="fr-pill" data-tone={steps[f.key]?.state === 'done' ? 'done' : steps[f.key]?.state === 'failed' ? 'failed' : undefined} data-testid="ready-state">
              {word(f)}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="fr-btn fr-primary" data-testid="ready-set-up" disabled={running} aria-busy={running} onClick={() => void run()}>
        {running ? 'Setting up…' : `Set up everything (${todo.length})`}
      </button>
    </div>
  );
}

export default ReadyInOneClick;
