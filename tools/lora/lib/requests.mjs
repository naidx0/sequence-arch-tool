/**
 * Change-request synthesis — grounded, deterministic, and CURATED IN A FILE.
 *
 * The rule that shapes this whole module: **a request may only ever name things
 * that really exist in that repo's scan.** A synthesized ask that mentions a
 * service the repo does not have teaches the model that inventing components is
 * normal — which is the exact failure Phase 0 exists to eliminate. So every slot
 * in every recipe is filled from the scanned graph's own nodes, by id, and
 * `assertGrounded` re-checks the finished text against the node-id set before it
 * leaves this file.
 *
 * The MIX lives in `tools/lora/request-recipes.json`, not here.
 * `docs/lora-operator-guide.md` §7 names it as a human judgment call — "whether
 * the generated change requests are realistic ... the mix should look like what a
 * real user asks, not what was easy to generate". A heuristic buried in code is
 * not reviewable; a JSON file with a `why` on every row is.
 *
 * Determinism: the only randomness is a seeded PRNG keyed on
 * `${seed}:${repoId}`, so the same repo at the same pinned SHA always yields the
 * same requests in the same order — a dataset you cannot rebuild is a dataset you
 * cannot debug.
 */
import fs from 'node:fs';

import { RECIPES_PATH } from './paths.mjs';

/** Node kinds a recipe slot may ask for. Deliberately the three card kinds. */
export const SLOT_KINDS = Object.freeze(['service', 'datastore', 'topic']);

export function loadRecipes(file = RECIPES_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateRecipes(raw);
  return raw;
}

/** Reject a recipe file that could produce an ungrounded or unusable request. */
export function validateRecipes(raw) {
  const problems = [];
  if (!raw || !Array.isArray(raw.recipes) || raw.recipes.length === 0) {
    throw new Error('request-recipes.json: expected a non-empty `recipes` array');
  }
  const families = new Set(Object.keys(raw.families ?? {}));
  const ids = new Set();
  for (const r of raw.recipes) {
    const where = `recipe "${r.id ?? '(no id)'}"`;
    if (!r.id) problems.push(`${where}: missing id`);
    if (ids.has(r.id)) problems.push(`${where}: duplicate id`);
    ids.add(r.id);
    if (!families.has(r.family)) problems.push(`${where}: family "${r.family}" is not declared in \`families\``);
    if (!Array.isArray(r.needs) || r.needs.length === 0) problems.push(`${where}: \`needs\` must list at least one slot kind`);
    for (const k of r.needs ?? []) {
      if (!SLOT_KINDS.includes(k)) problems.push(`${where}: slot kind "${k}" is not one of ${SLOT_KINDS.join('/')}`);
    }
    if (typeof r.text !== 'string' || r.text.trim() === '') problems.push(`${where}: missing \`text\``);
    if (typeof r.why !== 'string' || r.why.trim() === '') {
      problems.push(`${where}: missing \`why\` — every family in the mix must state the reason it is in the mix (guide §7)`);
    }
    if (!(Number.isFinite(r.weight) && r.weight > 0)) problems.push(`${where}: \`weight\` must be a positive number`);
    // Every {n.field} placeholder must address a slot the recipe actually asks for.
    for (const m of String(r.text ?? '').matchAll(/\{(\d+)\.(\w+)\}/g)) {
      const idx = Number(m[1]);
      if (!Array.isArray(r.needs) || idx >= r.needs.length) {
        problems.push(`${where}: text references slot {${idx}} but \`needs\` has ${r.needs?.length ?? 0}`);
      }
      if (m[2] !== 'id' && m[2] !== 'label') {
        problems.push(`${where}: text references {${idx}.${m[2]}} — only .id and .label exist`);
      }
    }
    // A request that never cites an id can never be checked for grounding.
    if (!/\{\d+\.id\}/.test(String(r.text ?? ''))) {
      problems.push(`${where}: text must cite at least one real node id via {n.id} — an uncited request cannot be proven grounded`);
    }
  }
  if (problems.length > 0) throw new Error(`request-recipes.json is invalid:\n  - ${problems.join('\n  - ')}`);
  return raw;
}

/** xmur3 + mulberry32: a tiny, dependency-free, reproducible PRNG. */
function seededRandom(key) {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Candidate nodes per slot kind, ordered most-connected first.
 *
 * Degree order is not cosmetic: a request about the repo's busiest service is
 * the request a real user would actually ask, and it gives the teacher model a
 * digest neighbourhood rich enough to answer from. Ties break on id so the
 * ordering is total and stable.
 */
export function candidatesByKind(graph) {
  const degree = new Map();
  for (const e of graph.edges ?? []) {
    degree.set(e.srcId, (degree.get(e.srcId) ?? 0) + 1);
    degree.set(e.dstId, (degree.get(e.dstId) ?? 0) + 1);
  }
  const out = new Map(SLOT_KINDS.map((k) => [k, []]));
  for (const n of graph.nodes ?? []) {
    if (out.has(n.kind)) out.get(n.kind).push(n);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return out;
}

/** Which recipes this repo can actually satisfy, given how many nodes of each kind it has. */
export function eligibleRecipes(recipes, byKind) {
  return recipes.filter((r) => {
    const need = new Map();
    for (const k of r.needs) need.set(k, (need.get(k) ?? 0) + 1);
    for (const [k, n] of need) {
      if ((byKind.get(k)?.length ?? 0) < n) return false;
    }
    return true;
  });
}

function fillSlots(recipe, byKind, rnd, pool) {
  const used = new Set();
  const slots = [];
  for (const kind of recipe.needs) {
    const options = (byKind.get(kind) ?? []).slice(0, pool).filter((n) => !used.has(n.id));
    if (options.length === 0) return null;
    const pick = options[Math.floor(rnd() * options.length)];
    used.add(pick.id);
    slots.push(pick);
  }
  return slots;
}

function render(text, slots) {
  return text.replace(/\{(\d+)\.(id|label)\}/g, (_m, i, field) => {
    const node = slots[Number(i)];
    return field === 'id' ? node.id : node.label || node.id;
  });
}

function weightedPick(list, rnd) {
  const total = list.reduce((s, r) => s + r.weight, 0);
  let x = rnd() * total;
  for (const r of list) {
    x -= r.weight;
    if (x <= 0) return r;
  }
  return list[list.length - 1];
}

/**
 * Synthesize `count` grounded change requests for one scanned repo.
 *
 * @param {object} args
 * @param {object} args.graph    the real ArchGraph from `scanRepo`
 * @param {string} args.repoId   manifest id — part of the PRNG key
 * @param {object} args.recipes  parsed request-recipes.json
 * @param {number} [args.count]
 * @param {string} [args.seed]
 * @param {number} [args.pool]   how many top-degree nodes a slot may draw from
 * @returns {{id:string, repoId:string, recipeId:string, family:string, text:string, citedIds:string[]}[]}
 */
export function synthesizeRequests({ graph, repoId, recipes, count = 8, seed = 'phase0', pool = 12 }) {
  const byKind = candidatesByKind(graph);
  const eligible = eligibleRecipes(recipes.recipes, byKind);
  if (eligible.length === 0) return [];
  const rnd = seededRandom(`${seed}:${repoId}`);
  const ids = new Set((graph.nodes ?? []).map((n) => n.id));

  const out = [];
  const seenText = new Set();
  // Bounded attempts: a small repo can run out of DISTINCT requests long before
  // `count`, and emitting the same request twice would over-weight it in training.
  for (let attempt = 0; attempt < count * 12 && out.length < count; attempt++) {
    const recipe = weightedPick(eligible, rnd);
    const slots = fillSlots(recipe, byKind, rnd, pool);
    if (!slots) continue;
    const text = render(recipe.text, slots);
    if (seenText.has(text)) continue;
    seenText.add(text);
    const citedIds = slots.map((n) => n.id);
    assertGrounded({ text, citedIds }, ids, repoId);
    out.push({
      id: `${repoId}#${out.length}`,
      repoId,
      recipeId: recipe.id,
      family: recipe.family,
      text,
      citedIds,
    });
  }
  return out;
}

/**
 * The guard, applied to every request before it can leave this module.
 *
 * Checks both directions: every id we *claim* to have cited is a real node, and
 * every backticked token in the rendered text is a real node id. The second half
 * is what catches a recipe whose prose hard-codes an id someone typed by hand.
 */
export function assertGrounded(request, nodeIds, repoId = '?') {
  for (const id of request.citedIds) {
    if (!nodeIds.has(id)) {
      throw new Error(`[${repoId}] synthesized request cites "${id}", which is not a node in the scan: ${request.text}`);
    }
  }
  for (const m of request.text.matchAll(/`([^`]+)`/g)) {
    if (!nodeIds.has(m[1])) {
      throw new Error(`[${repoId}] synthesized request quotes \`${m[1]}\`, which is not a node in the scan: ${request.text}`);
    }
  }
  return true;
}
