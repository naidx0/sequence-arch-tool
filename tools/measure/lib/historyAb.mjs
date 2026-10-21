/* ══════════════════════════════════════════════════════════════════════════
   DIFF AND HOTSPOTS A/B — the truth, the questions and the answers (pure)
   tools/measure/lib/historyAb.mjs

   As registered in lab/log.md (2026-10-05, "Diff and Hotspots views against
   the Map"). Used by tools/measure/board-views-ab.mjs --views diff,hotspots.
   ══════════════════════════════════════════════════════════════════════════ */

const posix = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/** id -> the deepest drawn id above it (or itself). */
export function lifter(graph, drawnIds) {
  const drawn = new Set(drawnIds);
  const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  return (id) => {
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      if (drawn.has(cur)) return cur;
      seen.add(cur);
      cur = parent.get(cur);
    }
    return undefined;
  };
}

/** path -> drawn box: the scan's node for that path, else the drawn box whose
 *  directory holds it (a deleted file, a file the scan has no node for). */
export function boxForPath(graph, drawnIds) {
  const lift = lifter(graph, drawnIds);
  const byPath = new Map(graph.nodes.filter((n) => n.path).map((n) => [posix(n.path), n.id]));
  const dirs = graph.nodes
    .filter((n) => n.path && n.kind !== 'file')
    .map((n) => ({ dir: posix(n.path).replace(/\/$/, ''), id: n.id }))
    .sort((a, b) => b.dir.length - a.dir.length);
  return (path) => {
    const p = posix(path);
    const exact = byPath.get(p);
    if (exact) return lift(exact);
    const d = dirs.find((x) => x.dir !== '' && (p === x.dir || p.startsWith(`${x.dir}/`)));
    return d ? lift(d.id) : undefined;
  };
}

/** Diff truth: the changed boxes, and per box the drawn pairs touching it
 *  whose evidence lies in a changed file. `pairs`: the pairs the Map draws. */
export function diffTruth(graph, drawnIds, pairs, files) {
  const boxOf = boxForPath(graph, drawnIds);
  const changedBoxes = new Set();
  for (const f of files) {
    const id = boxOf(f.path) ?? (f.from ? boxOf(f.from) : undefined);
    if (id) changedBoxes.add(id);
  }
  const changedPaths = new Set(files.flatMap((f) => [posix(f.path), ...(f.from ? [posix(f.from)] : [])]));
  const lift = lifter(graph, drawnIds);
  const wanted = new Set(pairs);
  const touched = new Set();
  for (const e of graph.edges) {
    const a = lift(e.srcId);
    const b = lift(e.dstId);
    if (!a || !b || a === b) continue;
    const k = `${a}->${b}`;
    if (!wanted.has(k)) continue;
    if ((e.evidence ?? []).some((ev) => changedPaths.has(posix(ev.file)))) touched.add(k);
  }
  return { changedBoxes, touched };
}

/** Hotspots truth: heat per drawn box = sum pageRank(file) x commits(file). */
export function heatTruth(graph, drawnIds, churn) {
  const lift = lifter(graph, drawnIds);
  const counts = new Map(Object.entries(churn).map(([p, n]) => [posix(p), n]));
  const heat = new Map();
  for (const n of graph.nodes) {
    if (n.kind !== 'file' || !n.path) continue;
    const c = counts.get(posix(n.path)) ?? 0;
    if (!c) continue;
    const id = lift(n.id);
    if (!id) continue;
    const pr = typeof n.meta?.pageRank === 'number' ? n.meta.pageRank : 0;
    heat.set(id, (heat.get(id) ?? 0) + pr * c);
  }
  for (const [k, v] of [...heat]) if (!(v > 0)) heat.delete(k);
  return heat;
}

const byScore = (score, label) => (a, b) => score(b) - score(a) || String(label(a)).localeCompare(String(label(b))) || a.localeCompare(b);

/** The registered questions for one level. */
export function historyQuestions(drawnIds, diff, heat, label) {
  const ids = [...drawnIds].sort();
  const qs = [];
  for (const x of ids) qs.push({ q: 'D1', x });
  qs.push({ q: 'D2' });
  for (const x of [...diff.changedBoxes].sort()) qs.push({ q: 'D3', x });
  qs.push({ q: 'H1' }, { q: 'H2' });
  const hot = [...heat.keys()].sort();
  const pairs = [];
  for (let i = 0; i < hot.length; i++)
    for (let j = i + 1; j < hot.length; j++) {
      if (heat.get(hot[i]) !== heat.get(hot[j])) pairs.push({ q: 'H3', a: hot[i], b: hot[j] });
    }
  qs.push(...pairs.slice(0, 15));
  void label;
  return qs;
}

/**
 * The answer to one question from what a reader saw:
 *   changed: Set of box ids marked changed; touched: Set of 'a->b';
 *   rank: Map id -> rank (1 = riskiest), or a score Map for a proxy reader
 *   (higher = riskier) given as { score, label }.
 */
export function historyAnswer(q, seen) {
  const { changed = new Set(), touched = new Set(), order = [], riskier = () => false } = seen;
  if (q.q === 'D1') return changed.has(q.x) ? 'yes' : 'no';
  if (q.q === 'D2') return [...changed].sort().join(',');
  if (q.q === 'D3') return [...touched].filter((k) => k.split('->').includes(q.x)).sort().join(',');
  if (q.q === 'H1') return order[0] ?? '';
  if (q.q === 'H2') return order.slice(0, 3).sort().join(',');
  if (q.q === 'H3') return riskier(q.a, q.b) ? 'yes' : 'no';
  return '';
}

/** The truth as a reader would state it. */
export function truthSeen(diff, heat, label) {
  const order = [...heat.keys()].sort(byScore((id) => heat.get(id), label));
  return {
    changed: diff.changedBoxes,
    touched: diff.touched,
    order,
    riskier: (a, b) => (heat.get(a) ?? 0) > (heat.get(b) ?? 0),
  };
}

/** A reader with ranks painted (1 = riskiest); an unranked box is not risky. */
export function rankSeen(rank) {
  const order = [...rank.keys()].sort((a, b) => rank.get(a) - rank.get(b));
  return {
    order,
    riskier: (a, b) => {
      const ra = rank.get(a);
      const rb = rank.get(b);
      if (ra === undefined) return false;
      if (rb === undefined) return true;
      return ra < rb;
    },
  };
}

/** The Map's proxy: lines drawn at each box (ties by label). */
export function lineCountSeen(boxIds, lines, label) {
  const count = new Map(boxIds.map((id) => [id, 0]));
  for (const k of lines) for (const id of k.split('->')) if (count.has(id)) count.set(id, count.get(id) + 1);
  const order = [...count.keys()].filter((id) => count.get(id) > 0).sort(byScore((id) => count.get(id), label));
  return { order, riskier: (a, b) => (count.get(a) ?? 0) > (count.get(b) ?? 0) };
}
