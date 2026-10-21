/* ══════════════════════════════════════════════════════════════════════════
   ANY PROVIDER, AND THE KEYS YOU ALREADY HAVE
   packages/web2/src/settings/ProviderCatalogCard.tsx

   Two things above the key form in Settings › Models, from GET /api/providers/catalog
   (the models.dev catalog Sequence ships; analyzer providerCatalog.ts):

   1. FOUND ON THIS MACHINE. A provider whose key is already in the environment
      (DEEPSEEK_API_KEY, GROQ_API_KEY, ...) is offered by name, with its current
      models: Use saves a model that READS the key from that variable on every
      start (`apiKeyEnv`), so nothing is pasted and the key is never written to
      disk. An offer, never a choice: nothing is saved until the person presses Use.
   2. ANY PROVIDER. A search over every provider in the catalog; picking one
      fills the form below (wire, base URL, a current model) and links to where a
      key is had. A prefill, never a lock.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { AiProfileView, ProviderKind } from '@sequence/api-types';

import { S2Icon } from '../shell2/icons';
import { BrandMark } from './logos/BrandMark';
import { providerMark } from './logos/providerMark';
import { MenuSelect } from './sbParts';

export const PROVIDER_CATALOG_ROUTE = '/api/providers/catalog';

export interface CatalogModel {
  id: string;
  name: string;
  context?: number;
  cost?: [number, number];
  reasoning?: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  wire: ProviderKind;
  api: string;
  env: string[];
  doc?: string;
  models: CatalogModel[];
}

export interface DetectedProvider {
  id: string;
  name: string;
  keyEnv: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderCatalogCardProps {
  fetchImpl?: Fetch;
  /** Saves one new model (the panel appends it to the saved list and makes it the default); null on success, else why not. */
  save: (entry: AiProfileView) => Promise<string | null>;
  /** Fill the form below with a provider from the search. */
  onPick: (p: { provider: ProviderKind; baseUrl: string; model: string; name: string; providerName: string; keyUrl?: string }) => void;
  /** The models already saved, so a provider that is already set up does not offer itself again. */
  saved?: readonly AiProfileView[];
}

/** `128000` -> `128K`, `1000000` -> `1M`. */
export function contextLabel(n: number | undefined): string {
  if (!n) return '';
  return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`;
}

/** A price in dollars, always two places: `$0.80`. */
export function dollars(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** The price per million tokens when the catalog knows it. */
export function priceLine(m: CatalogModel): string {
  return m.cost ? `${dollars(m.cost[0])} in / ${dollars(m.cost[1])} out per 1M` : '';
}

/** One model's line: name, window, and price per million tokens when the catalog knows it. */
export function modelLine(m: CatalogModel): string {
  const bits = [m.name];
  const ctx = contextLabel(m.context);
  if (ctx) bits.push(`${ctx} context`);
  const price = priceLine(m);
  if (price) bits.push(price);
  return bits.join(', ');
}

/** A menu option: the name and window only, so a narrow select never cuts the price off; the price sits under it. */
function optionLine(m: CatalogModel): string {
  const ctx = contextLabel(m.context);
  return ctx ? `${m.name}, ${ctx} context` : m.name;
}

/**
 * The model a provider starts on: the catalog lists newest first, which for the big providers is often a
 * small or experimental one. A sensible everyday model where the name says so, else the newest.
 */
export function defaultModel(p: CatalogProvider): CatalogModel {
  const prefer: Record<string, RegExp> = { anthropic: /sonnet/i, openai: /^gpt-[\d.]+$/i, openrouter: /sonnet|gpt-[\d.]+$/i, google: /pro/i };
  const re = prefer[p.id];
  return (re && p.models.find((m) => re.test(m.id))) || p.models[0]!;
}

const pageFetch: Fetch = (i, init) => fetch(i, init);

export function ProviderCatalogCard({ fetchImpl = pageFetch, save, onPick, saved = [] }: ProviderCatalogCardProps) {
  const [providers, setProviders] = useState<CatalogProvider[] | null>(null);
  const [detected, setDetected] = useState<DetectedProvider[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    void fetchImpl(PROVIDER_CATALOG_ROUTE, { headers: { accept: 'application/json' } })
      .then(async (r) => (r.ok ? ((await r.json()) as { providers?: unknown; detected?: unknown }) : null))
      .then((b) => {
        if (!live.current || !b || !Array.isArray(b.providers)) return;
        setProviders(b.providers as CatalogProvider[]);
        setDetected(Array.isArray(b.detected) ? (b.detected as DetectedProvider[]) : []);
      })
      .catch(() => {
        /* No catalog route (an older server, hosted mode): the card is simply not offered. */
      });
    return () => {
      live.current = false;
    };
  }, [fetchImpl]);

  const byId = useMemo(() => new Map((providers ?? []).map((p) => [p.id, p])), [providers]);
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!providers || q === '') return [];
    return providers.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q)).slice(0, 8);
  }, [providers, query]);

  if (providers === null) return null;

  /* A provider already saved at its address (with its variable or a pasted key) is set up: not offered again. */
  const savedAt = new Set(saved.map((s) => (s.baseUrl ?? '').replace(/\/+$/, '').toLowerCase()));
  const offers = detected.filter((d) => byId.has(d.id) && !savedAt.has(byId.get(d.id)!.api.replace(/\/+$/, '').toLowerCase()));

  const use = async (d: DetectedProvider): Promise<void> => {
    const p = byId.get(d.id)!;
    const modelId = chosen[d.id] ?? defaultModel(p).id;
    const m = p.models.find((x) => x.id === modelId) ?? p.models[0]!;
    setBusy(d.id);
    setFailed(({ [d.id]: _gone, ...rest }) => rest);
    /* A fresh id each time: an earlier model for this provider (renamed, or its variable changed) is never overwritten. */
    const why = await save({ id: `env-${p.id}-${Date.now().toString(36)}`.slice(0, 64), name: `${p.name} ${m.name}`.slice(0, 80), provider: p.wire, baseUrl: p.api, model: m.id, apiKeyEnv: d.keyEnv });
    if (!live.current) return;
    setBusy(null);
    if (why) setFailed((f) => ({ ...f, [d.id]: why }));
  };

  return (
    <section className="sb-group">
    <h3 className="sb-lab">Other providers</h3>
    <div className="sb-card sb-provcat" data-testid="provider-catalog">
      {offers.length > 0 ? (
        <>
          <p className="sb-hint" data-testid="provider-catalog-found-hint">
            Found on this machine. Use one and Sequence reads the key from its variable each time it starts; the key is not copied anywhere.
          </p>
          <ul className="sb-list" data-testid="provider-catalog-found">
            {offers.map((d) => {
              const p = byId.get(d.id)!;
              const modelId = chosen[d.id] ?? defaultModel(p).id;
              const price = priceLine(p.models.find((x) => x.id === modelId) ?? p.models[0]!);
              return (
                <li key={d.id} className="sb-row sb-provcat-row sb-provcat-found" data-testid="provider-catalog-offer" data-provider={d.id}>
                  <BrandMark id={p.id} mark={providerMark(p.id)} name={p.name} />
                  <span className="sb-row-txt">
                    <span className="sb-row-t">{p.name}</span>
                    <span className="sb-row-sub">Found in your environment</span>
                    {price ? (
                      <span className="sb-row-sub" data-testid="provider-catalog-price">
                        {price}
                      </span>
                    ) : null}
                    {failed[d.id] ? (
                      <span className="sb-fail" role="alert" data-testid="provider-catalog-failure">
                        Could not save {p.name}: {failed[d.id]}
                      </span>
                    ) : null}
                  </span>
                  <MenuSelect
                    value={modelId}
                    options={p.models.map((m) => ({ value: m.id, label: optionLine(m), ...(priceLine(m) ? { desc: priceLine(m) } : {}) }))}
                    onChange={(v) => setChosen((c) => ({ ...c, [d.id]: v }))}
                    testid="provider-catalog-model"
                    ariaLabel={`${p.name} model`}
                  />
                  <button type="button" className="sb-pill" data-testid="provider-catalog-use" data-provider={d.id} disabled={busy !== null} onClick={() => void use(d)}>
                    {busy === d.id ? 'Saving…' : 'Use'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <div className="sb-provcat-search">
        <span className="sb-copy-lab">Any provider ({providers.length})</span>
        <label className="s2-field sb-provcat-field">
          <S2Icon name="search" small />
          <input
            type="search"
            data-testid="provider-catalog-search"
            aria-label="Search providers"
            placeholder="Groq, Mistral, Together, DeepSeek…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {hits.length > 0 ? (
        <ul className="sb-list" data-testid="provider-catalog-hits">
          {hits.map((p) => (
            <li key={p.id} className="sb-row sb-provcat-row sb-provcat-hit" data-testid="provider-catalog-hit" data-provider={p.id}>
              <BrandMark id={p.id} mark={providerMark(p.id)} name={p.name} />
              <span className="sb-row-txt">
                <span className="sb-row-t">{p.name}</span>
                <span className="sb-row-sub">{modelLine(defaultModel(p))}</span>
              </span>
              <button
                type="button"
                className="sb-pill"
                data-testid="provider-catalog-pick"
                data-provider={p.id}
                onClick={() => {
                  const m = defaultModel(p);
                  onPick({ provider: p.wire, baseUrl: p.api, model: m.id, name: `${p.name} ${m.name}`, providerName: p.name, ...(p.doc ? { keyUrl: p.doc } : {}) });
                  setQuery('');
                }}
              >
                Set up
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() !== '' ? (
        <p className="sb-note" data-testid="provider-catalog-none">
          No provider in the catalog matches "{query.trim()}". Other, below, takes any OpenAI-compatible address.
        </p>
      ) : null}
    </div>
    </section>
  );
}

export default ProviderCatalogCard;
