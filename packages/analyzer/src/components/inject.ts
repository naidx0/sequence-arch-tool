/**
 * The run-node seam: what a turn's prompt gets from the components engine.
 *
 *   enabled:false  nothing is matched or offered; an explicit load is refused.
 *   manual         no offers; only explicit ids (`components: [id]`, /components <id>, + menu) load.
 *   approve        matches are OFFERED (component:offer), never injected. Accepting an offer
 *                  injects the body on that thread's next prompt (an accepted offer resolves once).
 *   auto           `ready` matches are injected once per thread; `review` ones are only offered.
 *
 * Every injected body is announced as `component:used`.
 *
 * The once-per-thread rule is the notes ledger (harness/refineNotes.ts ThreadNoteLedger) under its
 * own key suffix, so a rewind or compaction that forgets a chat's notes forgets its components too.
 */
import crypto from 'node:crypto';
import type { ThreadNoteLedger } from '../harness/refineNotes.js';
import { readComponentBody, readComponentPreamble, type Catalog, type ComponentEntry } from './catalog.js';
import { matchComponents } from './match.js';
import type { ComponentMode } from './settings.js';

/** Like MAX_SKILL_BODY_CHARS (2000) for a repo skill, but a component is a whole playbook. */
export const MAX_COMPONENT_BODY_CHARS = 6000;

export const componentLedgerKey = (noteKey: string): string => `${noteKey}#components`;
const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** The block a component adds to a prompt, or null when it has no readable body. */
export function componentBlock(c: ComponentEntry): string | null {
  const body = readComponentBody(c);
  if (!body) return null;
  /* The preamble (safety text) goes first and is never cut; the cap is on the SKILL.md part only. */
  const pre = readComponentPreamble(c);
  if (c.preamble && !pre) return null;
  /* A big skill is cut at the cap, and the cut says where the rest is, so the agent can read on. */
  const capped = body.length > MAX_COMPONENT_BODY_CHARS ? `${body.slice(0, MAX_COMPONENT_BODY_CHARS)}…\n\n${truncationNote(c)}` : body;
  return `COMPONENT: ${oneLine(c.label)}\n${pre ? `${pre}\n\n` : ''}${capped}`;
}

/** Said after a cut body: where the whole skill is, and how to page it. */
export const truncationNote = (c: ComponentEntry): string =>
  `[Cut at ${MAX_COMPONENT_BODY_CHARS} characters. The full skill and its references/ files are in ${c.dir.replace(/\\/g, '/')}; read them with your file tools, or call \`components load\` with \`offset\` (and \`file\` for a references/ file).]`;

export interface PendingOffer {
  offerId: string;
  componentId: string;
  name: string;
  reason: string;
}

/**
 * Offers the person has not answered, and answers not yet used, per thread. In memory like the
 * ledger: after a restart a thread is offered again, which costs a card, never a wrong claim.
 */
export class OfferBook {
  private readonly byId = new Map<string, { key: string; offer: PendingOffer; state: 'pending' | 'accepted' | 'declined' }>();

  /** Open an offer unless this thread already has one (or a decline) for the component. */
  open(key: string, o: Omit<PendingOffer, 'offerId'>): PendingOffer | null {
    for (const e of this.byId.values()) if (e.key === key && e.offer.componentId === o.componentId && e.state !== 'accepted') return null;
    const offer = { ...o, offerId: crypto.randomUUID() };
    this.byId.set(offer.offerId, { key, offer, state: 'pending' });
    return offer;
  }

  /** Answer an offer. False when it is unknown or already answered. */
  answer(offerId: string, accept: boolean): boolean {
    const e = this.byId.get(offerId);
    if (!e || e.state !== 'pending') return false;
    e.state = accept ? 'accepted' : 'declined';
    return true;
  }

  /** Component ids accepted on this thread and not yet sent. */
  accepted(key: string): string[] {
    return [...this.byId.values()].filter((e) => e.key === key && e.state === 'accepted').map((e) => e.offer.componentId);
  }

  /** The turn carrying these went out: their offers resolve. */
  consume(key: string, componentIds: readonly string[]): void {
    for (const [id, e] of this.byId) if (e.key === key && e.state === 'accepted' && componentIds.includes(e.offer.componentId)) this.byId.delete(id);
  }

  forget(keyPrefix: string): void {
    for (const [id, e] of this.byId) if (e.key.startsWith(keyPrefix)) this.byId.delete(id);
  }
}

export interface ComponentPlan {
  /** Goes in front of the person's message; '' when nothing loads. */
  text: string;
  loaded: { id: string; name: string; tokens: number }[];
  offers: PendingOffer[];
  /** Explicit ids that could not load, with why. */
  skipped: { id: string; reason: string }[];
  /** Accepted offers this plan looked at: only these resolve when the turn goes out. */
  settled: string[];
  /** Explicit loads were asked for while components are switched off. */
  refused: boolean;
}

export const COMPONENTS_OFF_MESSAGE = 'Components are switched off. Turn them on with /components on, then load this again.';

export function planComponents(i: {
  catalog: Catalog;
  prompt: string;
  enabled: boolean;
  mode: ComponentMode;
  forced?: readonly string[];
  noteKey: string;
  thread: string | null;
  ledger: ThreadNoteLedger;
  offers: OfferBook;
}): ComponentPlan {
  const explicit = [...new Set(i.forced ?? [])];
  if (!i.enabled) return { text: '', loaded: [], offers: [], skipped: [], settled: [], refused: explicit.length > 0 };
  const byId = new Map(i.catalog.components.map((c) => [c.id, c]));
  const key = componentLedgerKey(i.noteKey);
  const blocks: string[] = [];
  const loaded: ComponentPlan['loaded'] = [];
  const skipped: { id: string; reason: string }[] = [];
  const settled: string[] = [];
  const acceptedNow = i.offers.accepted(i.noteKey);
  const offers: PendingOffer[] = [];
  const seen = new Set<string>();
  const isSent = (c: ComponentEntry, text: string): boolean => i.ledger.unsent(key, i.thread, [{ id: c.id, tip: text }]).length === 0;
  const add = (c: ComponentEntry, text: string): void => {
    blocks.push(text);
    loaded.push({ id: c.id, name: c.label, tokens: Math.ceil(text.length / 4) });
  };

  /* Asked for by id, or accepted from an offer on this thread: loaded whatever the mode, and whatever its status. */
  for (const id of [...explicit, ...acceptedNow]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id);
    const text = c && c.status !== 'link-only' ? componentBlock(c) : null;
    if (!c) skipped.push({ id, reason: 'no such component' });
    else if (c.status === 'link-only') skipped.push({ id, reason: 'a link, not a loadable component' });
    else if (!text) skipped.push({ id, reason: 'its text could not be read' });
    else if (!isSent(c, text)) add(c, text);
    if (acceptedNow.includes(id)) settled.push(id);
  }
  if (i.mode !== 'manual') {
    for (const m of matchComponents(i.prompt, i.catalog)) {
      const c = byId.get(m.id);
      if (!c || seen.has(m.id)) continue;
      const text = componentBlock(c);
      if (text && isSent(c, text)) continue; // this thread already has it
      if (i.mode === 'auto' && c.status === 'ready' && text) add(c, text);
      else {
        const o = i.offers.open(i.noteKey, { componentId: c.id, name: c.label, reason: m.why });
        if (o) offers.push(o);
      }
    }
  }
  return { text: blocks.length ? `${blocks.join('\n\n')}\n\n---\n\n` : '', loaded, offers, skipped, settled, refused: false };
}

/** Record the plan's loads as sent (call once the turn has gone out). */
export function markComponents(plan: ComponentPlan, noteKey: string, thread: string | null, ledger: ThreadNoteLedger, offers: OfferBook, catalog: Catalog): void {
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const items = plan.loaded.flatMap((l) => {
    const c = byId.get(l.id);
    const tip = c ? componentBlock(c) : null;
    return c && tip ? [{ id: c.id, tip }] : [];
  });
  ledger.mark(componentLedgerKey(noteKey), thread, items);
  /* Only what this plan looked at resolves: an offer accepted while the turn ran loads on the next prompt. */
  offers.consume(noteKey, plan.settled);
}

export function componentEvents(plan: ComponentPlan, turnId: string): Record<string, unknown>[] {
  return [
    ...plan.offers.map((o) => ({ type: 'component:offer', turnId, offerId: o.offerId, componentId: o.componentId, name: o.name, reason: o.reason })),
    ...plan.loaded.map((l) => ({ type: 'component:used', turnId, componentId: l.id, name: l.name })),
    ...plan.skipped.map((k) => ({ type: 'component:skipped', turnId, componentId: k.id, reason: k.reason })),
  ];
}
