/**
 * Insight + whiteboard MCP tools — the adoption wedge.
 *
 * The owner's charge (2026-08-31): Sequence must not be "tied down to one
 * simple system". People will not switch harnesses wholesale; they WILL call
 * a tool from the editor they already sit in. These tools hand Sequence's
 * moat — the grounded logic engine and the live system-design board — to any
 * MCP client (Cursor, Claude Code, Codex, …) with zero migration:
 *
 *   - `risks`      — the logic engine's ranked structural risks, grounded.
 *   - `impact`     — the blast radius of changing one named node, grounded.
 *   - `whiteboard` — a SELF-CONTAINED interactive HTML system-design board
 *     written into the repo: pan, zoom, click-for-evidence, search. No
 *     server, no network, no login — open the file, see the system. The
 *     same grounded graph the Sequence app draws, portable to any editor.
 *
 * Everything here is keyless and local-first: real detected structure or an
 * honest refusal, never a fabricated design.
 */

import fs from 'node:fs';
import path from 'node:path';
import { computeRisks, computeImpact, type SystemRisk } from '@sequence/schema';
import type { ArchGraph } from '@sequence/schema';
import { projectEdges, kindFamily, buildLift } from '@sequence/export';

/* ------------------------------------------------------------- resolution -- */

/**
 * Resolve a user-supplied name to one graph node id. Exact id first; then a
 * unique case-insensitive label; then a unique id/label suffix. Ambiguity is
 * an ANSWER (the candidates), never a guess — same rule as who_calls.
 */
export function resolveNodeName(
  graph: ArchGraph,
  name: string,
): { id: string } | { candidates: string[] } {
  const exact = graph.nodes.find((n) => n.id === name);
  if (exact) return { id: exact.id };
  const norm = name.toLowerCase();
  const byLabel = graph.nodes.filter((n) => (n.label ?? '').toLowerCase() === norm);
  if (byLabel.length === 1) return { id: byLabel[0]!.id };
  if (byLabel.length > 1) return { candidates: byLabel.map((n) => n.id).slice(0, 10) };
  const bySuffix = graph.nodes.filter(
    (n) => n.id.toLowerCase().endsWith(norm) || (n.label ?? '').toLowerCase().endsWith(norm),
  );
  if (bySuffix.length === 1) return { id: bySuffix[0]!.id };
  return { candidates: bySuffix.map((n) => n.id).slice(0, 10) };
}

/* ------------------------------------------------------------------ risks -- */

export interface RisksOutput {
  repoName: string;
  risks: Array<
    Pick<SystemRisk, 'nodeId' | 'label' | 'kind' | 'blastRadius' | 'directDependents' | 'total'>
  >;
}

export function risksFromGraph(graph: ArchGraph, topN = 10): RisksOutput {
  const links = graph.edges.map((e) => ({ srcId: e.srcId, dstId: e.dstId }));
  const nodes = graph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label ?? n.id }));
  const risks = computeRisks(links, nodes, { topN });
  return {
    repoName: graph.repoName,
    // impactedBy (the full dependent id list) is deliberately dropped — it is
    // the `impact` tool's answer, and here it multiplies the payload by the
    // graph size for a ranking the scores already carry.
    risks: risks.map((r) => ({
      nodeId: r.nodeId,
      label: r.label,
      kind: r.kind,
      blastRadius: r.blastRadius,
      directDependents: r.directDependents,
      total: r.total,
    })),
  };
}

/* ----------------------------------------------------------------- impact -- */

export interface ImpactOutput {
  nodeId: string;
  exists: boolean;
  /** What breaks: everything that can reach the node (direct + transitive). */
  impactedBy: string[];
  impactedByDirect: string[];
  /** What it needs: everything reachable from the node (direct + transitive). */
  dependsOn: string[];
  dependsOnDirect: string[];
}

export function impactFromGraph(graph: ArchGraph, nodeId: string): ImpactOutput {
  /*
   * Two altitudes, one honest answer. Raw edges connect FILES; a service id
   * is not an endpoint of any of them, so computing on raw links reported
   * exists:false for every service (measured by this file's own test). A
   * component-kind node is therefore assessed on the PROJECTED service-level
   * graph (by label — the projection's own key); files and functions keep
   * the raw file-level closure.
   */
  const node = graph.nodes.find((n) => n.id === nodeId);
  const componentKinds = new Set(['service', 'datastore', 'topic', 'entry', 'agent']);
  if (node && componentKinds.has(node.kind)) {
    /*
     * Query the projection with ITS OWN key, not the raw label. buildLift keys
     * a topic as `topic:<label>` (to match score.ts), so querying with the raw
     * label returned exists:false for every topic. And `exists` must reflect
     * that the NODE is real — a service with no service-level edges is a real
     * node with an empty blast radius, not a missing one (resolveNodeName just
     * resolved it). computeImpact.exists only means "appeared in the link set".
     */
    const key = buildLift(graph)(node.id)?.label ?? node.label ?? node.id;
    const links = projectEdges(graph).map((e) => ({ srcId: e.src, dstId: e.dst }));
    const r = computeImpact(links, key);
    return {
      nodeId,
      exists: true,
      impactedBy: r.impactedBy,
      impactedByDirect: r.impactedByDirect,
      dependsOn: r.dependsOn,
      dependsOnDirect: r.dependsOnDirect,
    };
  }
  const links = graph.edges.map((e) => ({ srcId: e.srcId, dstId: e.dstId }));
  const r = computeImpact(links, nodeId);
  return {
    nodeId,
    exists: r.exists,
    impactedBy: r.impactedBy,
    impactedByDirect: r.impactedByDirect,
    dependsOn: r.dependsOn,
    dependsOnDirect: r.dependsOnDirect,
  };
}

/* ------------------------------------------------------------- whiteboard -- */

interface BoardNode {
  id: string;
  label: string;
  kind: string;
  files: number;
}

interface BoardEdge {
  src: string;
  dst: string;
  family: string;
  labels: string[];
}

/** The compact, service-level model the board embeds. */
export function buildBoardModel(graph: ArchGraph): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const fileCounts = new Map<string, number>();
  const parentOf = new Map<string, string>();
  for (const n of graph.nodes) if (n.parentId) parentOf.set(n.id, n.parentId);
  const topOf = (id: string): string => {
    let cur = id;
    for (let hops = 0; hops < 32; hops++) {
      const p = parentOf.get(cur);
      if (!p || p === 'repo' || p === graph.repoName) break;
      cur = p;
    }
    return cur;
  };
  for (const n of graph.nodes) {
    if (n.kind !== 'file') continue;
    const top = topOf(n.id);
    fileCounts.set(top, (fileCounts.get(top) ?? 0) + 1);
  }
  /*
   * Index by the PROJECTION KEY (buildLift's label), not the raw label:
   * projectEdges emits a topic endpoint as `topic:<label>`, so a board keyed by
   * raw label matched no topic edges and rendered every queue participant as a
   * disconnected island. Board nodes keep a clean DISPLAY label; edges are
   * matched on the projection key and rewritten back to display labels.
   */
  const keep = new Set(['service', 'datastore', 'topic', 'entry', 'agent']);
  const lift = buildLift(graph);
  const byKey = new Map<string, BoardNode>();
  const displayOf = new Map<string, string>();
  for (const n of graph.nodes) {
    if (!keep.has(n.kind)) continue;
    const display = n.label ?? n.id;
    const key = lift(n.id)?.label ?? display;
    if (!byKey.has(key)) {
      byKey.set(key, { id: n.id, label: display, kind: n.kind, files: fileCounts.get(n.id) ?? 0 });
      displayOf.set(key, display);
    }
  }
  const nodes = [...byKey.values()];
  const edges: BoardEdge[] = projectEdges(graph)
    .filter((e) => displayOf.has(e.src) && displayOf.has(e.dst))
    .map((e) => ({
      src: displayOf.get(e.src)!,
      dst: displayOf.get(e.dst)!,
      family: e.family,
      labels: e.labels.slice(0, 6),
    }));
  return { nodes, edges };
}

/**
 * Render the self-contained interactive whiteboard HTML. Layered layout:
 * sources (no incoming edges) left, sinks right, everything else by longest
 * incoming path — the classic dependency sweep, computed in plain JS at
 * render time so the file needs no library and no network. Single file,
 * dark, Graphite-quiet; every color painted explicitly.
 */
export function renderWhiteboardHtml(graph: ArchGraph): string {
  const model = buildBoardModel(graph);
  const data = JSON.stringify(model).replace(/</g, '\\u003c');
  const title = `${graph.repoName} — system board`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{--bg:#0E1013;--card:#1B1F24;--line:#2A2F36;--ink:#E9ECEF;--dim:#98A1AA;--faint:#5C656E;
    --http:#6FB6CC;--db:#D9A15B;--queue:#9B8CD9;--grpc:#7FBE9B;--other:#8A939C;--hi:#E8C468;}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
    font:14px/1.5 ui-sans-serif,system-ui,sans-serif;overflow:hidden}
  #bar{position:fixed;top:0;left:0;right:0;display:flex;gap:12px;align-items:center;
    padding:10px 14px;background:rgba(14,16,19,.92);border-bottom:1px solid var(--line);z-index:5}
  #bar b{font-size:13px;letter-spacing:.04em}
  #q{background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:6px;
    padding:5px 10px;font:12px ui-monospace,monospace;width:220px;outline:none}
  #legend{margin-left:auto;display:flex;gap:10px;font:10px ui-monospace,monospace;color:var(--dim)}
  .lg::before{content:"";display:inline-block;width:14px;height:2px;margin:0 4px 3px 0;vertical-align:middle;background:currentColor}
  #board{position:absolute;inset:0;cursor:grab}
  #board.dragging{cursor:grabbing}
  #panel{position:fixed;top:52px;right:0;bottom:0;width:300px;background:var(--card);
    border-left:1px solid var(--line);padding:16px;overflow:auto;display:none}
  #panel h2{font-size:14px;margin:0 0 2px}
  #panel .kind{font:10px ui-monospace,monospace;color:var(--faint);text-transform:uppercase;letter-spacing:.1em}
  #panel h3{font:10px ui-monospace,monospace;color:var(--faint);text-transform:uppercase;letter-spacing:.1em;margin:16px 0 6px}
  #panel .edge{font:11.5px ui-monospace,monospace;color:var(--dim);margin:0 0 4px;word-break:break-all}
  #panel .edge b{color:var(--ink);font-weight:600}
  .node rect{fill:var(--card);stroke:var(--line);stroke-width:1;rx:8}
  .node:hover rect,.node.sel rect{stroke:var(--hi);stroke-width:1.5}
  .node.dim{opacity:.25}
  .node text{fill:var(--ink);font:600 12px ui-sans-serif,system-ui,sans-serif;pointer-events:none}
  .node .k{fill:var(--faint);font:9px ui-monospace,monospace;letter-spacing:.08em}
  .node{cursor:pointer}
  #foot{position:fixed;left:14px;bottom:10px;font:10px ui-monospace,monospace;color:var(--faint)}
</style></head><body>
<div id="bar"><b>${escapeHtml(graph.repoName)}</b><input id="q" placeholder="search nodes…">
  <div id="legend"><span class="lg" style="color:var(--http)">http</span><span class="lg" style="color:var(--grpc)">grpc</span><span class="lg" style="color:var(--queue)">queue</span><span class="lg" style="color:var(--db)">db</span></div></div>
<div id="board"></div><div id="panel"></div>
<div id="foot">Sequence whiteboard — grounded from a real scan. Drag to pan, wheel to zoom, click a node for evidence.</div>
<script>
const DATA=${data};
const FAM={http:'var(--http)',grpc:'var(--grpc)',queue_publish:'var(--queue)',queue_consume:'var(--queue)',db_access:'var(--db)'};
const W=190,H=64,GX=90,GY=28;
// layered layout: longest-path layering over the edge set
const idx=new Map(DATA.nodes.map((n,i)=>[n.label,i]));
const layer=DATA.nodes.map(()=>0);
for(let pass=0;pass<DATA.nodes.length;pass++){let moved=false;
  for(const e of DATA.edges){const s=idx.get(e.src),d=idx.get(e.dst);
    if(s==null||d==null||s===d)continue;
    if(layer[d]<layer[s]+1){layer[d]=Math.min(layer[s]+1,DATA.nodes.length);moved=true}}
  if(!moved)break}
const cols=new Map();
DATA.nodes.forEach((n,i)=>{const c=layer[i];if(!cols.has(c))cols.set(c,[]);cols.get(c).push(i)});
const pos=[];
[...cols.keys()].sort((a,b)=>a-b).forEach(c=>{cols.get(c).forEach((i,r)=>{pos[i]={x:40+c*(W+GX),y:70+r*(H+GY)}})});
const maxX=Math.max(...pos.map(p=>p.x))+W+60,maxY=Math.max(...pos.map(p=>p.y))+H+60;
const svgNS='http://www.w3.org/2000/svg';
const svg=document.createElementNS(svgNS,'svg');
svg.setAttribute('width','100%');svg.setAttribute('height','100%');
let vb={x:0,y:0,w:Math.max(maxX,900),h:Math.max(maxY,600)};
const applyVB=()=>svg.setAttribute('viewBox',vb.x+' '+vb.y+' '+vb.w+' '+vb.h);applyVB();
document.getElementById('board').appendChild(svg);
const defs=document.createElementNS(svgNS,'defs');
defs.innerHTML='<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#5C656E"/></marker>';
svg.appendChild(defs);
const eg=document.createElementNS(svgNS,'g');svg.appendChild(eg);
for(const e of DATA.edges){const s=idx.get(e.src),d=idx.get(e.dst);if(s==null||d==null)continue;
  const p1=pos[s],p2=pos[d];
  const l=document.createElementNS(svgNS,'path');
  const x1=p1.x+W,y1=p1.y+H/2,x2=p2.x,y2=p2.y+H/2,mx=(x1+x2)/2;
  l.setAttribute('d','M'+x1+' '+y1+' C'+mx+' '+y1+','+mx+' '+y2+','+x2+' '+y2);
  l.setAttribute('fill','none');l.setAttribute('stroke-width','1.5');l.setAttribute('marker-end','url(#a)');
  l.style.stroke=FAM[e.family]?FAM[e.family].slice(4,-1)&&'':'';
  l.setAttribute('style','stroke:'+(FAM[e.family]||'var(--other)'));
  eg.appendChild(l)}
const panel=document.getElementById('panel');
// Every label is repo-derived text (file paths, service names) and enters
// innerHTML — so it MUST be escaped, or a label like "</script>" or "<img
// onerror=…>" corrupts the board or runs. esc() is applied at every sink.
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function select(i){document.querySelectorAll('.node.sel').forEach(n=>n.classList.remove('sel'));
  const n=DATA.nodes[i];const g=document.getElementById('n'+i);if(g)g.classList.add('sel');
  const ins=DATA.edges.filter(e=>e.dst===n.label),outs=DATA.edges.filter(e=>e.src===n.label);
  panel.style.display='block';
  panel.innerHTML='<div class="kind">'+esc(n.kind)+' · '+n.files+' file(s)</div><h2>'+esc(n.label)+'</h2>'
   +'<h3>receives ('+ins.length+')</h3>'+ins.map(e=>'<p class="edge"><b>'+esc(e.src)+'</b> → '+esc(e.family)+(e.labels.length?': '+esc(e.labels.join(', ')):'')+'</p>').join('')
   +'<h3>calls ('+outs.length+')</h3>'+outs.map(e=>'<p class="edge">→ <b>'+esc(e.dst)+'</b> '+esc(e.family)+(e.labels.length?': '+esc(e.labels.join(', ')):'')+'</p>').join('');}
DATA.nodes.forEach((n,i)=>{const g=document.createElementNS(svgNS,'g');
  g.setAttribute('class','node');g.setAttribute('id','n'+i);
  g.setAttribute('transform','translate('+pos[i].x+','+pos[i].y+')');
  g.innerHTML='<rect width="'+W+'" height="'+H+'" rx="8"/>'
   +'<text class="k" x="14" y="20">'+esc(n.kind.toUpperCase())+'</text>'
   +'<text x="14" y="42">'+esc(n.label.slice(0,24))+'</text>';
  g.addEventListener('click',ev=>{ev.stopPropagation();select(i)});
  svg.appendChild(g)});
let drag=null;const board=document.getElementById('board');
board.addEventListener('mousedown',e=>{drag={x:e.clientX,y:e.clientY,vx:vb.x,vy:vb.y};board.classList.add('dragging')});
window.addEventListener('mousemove',e=>{if(!drag)return;const k=vb.w/board.clientWidth;
  vb.x=drag.vx-(e.clientX-drag.x)*k;vb.y=drag.vy-(e.clientY-drag.y)*k;applyVB()});
window.addEventListener('mouseup',()=>{drag=null;board.classList.remove('dragging')});
board.addEventListener('wheel',e=>{e.preventDefault();const k=e.deltaY>0?1.12:0.89;
  const mx=vb.x+vb.w*(e.clientX/board.clientWidth),my=vb.y+vb.h*(e.clientY/board.clientHeight);
  vb.w*=k;vb.h*=k;vb.x=mx-vb.w*(e.clientX/board.clientWidth);vb.y=my-vb.h*(e.clientY/board.clientHeight);applyVB()},{passive:false});
svg.addEventListener('click',()=>{panel.style.display='none';document.querySelectorAll('.node.sel').forEach(n=>n.classList.remove('sel'))});
document.getElementById('q').addEventListener('input',e=>{const q=e.target.value.toLowerCase();
  DATA.nodes.forEach((n,i)=>{const g=document.getElementById('n'+i);
    if(!g)return;g.classList.toggle('dim',!!q&&!n.label.toLowerCase().includes(q))})});
</script></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Write the whiteboard beside the scan cache and return where it landed.
 * `outPath` (relative to the repo, or absolute) overrides the default
 * `.sequence/whiteboard.html`. The write refuses to leave the repo — an MCP
 * client asking for `../..` gets an error, not a surprise file.
 *
 * THE ABSOLUTE PATH IS CHECKED TOO, and the earlier version's exemption for it
 * was a real hole rather than a convenience. That code read "unless the caller
 * passed an absolute path of their own", which is a sound threat model when the
 * caller is a person typing a path. On an MCP surface the caller is a MODEL,
 * and `outPath` is a tool field whose own description invited an absolute path.
 * The server's entire job is reading a repository, so the model's context is
 * full of untrusted text — a README, a comment, a filename — that can steer the
 * next tool call. That turns an unchecked `outPath` into an arbitrary-file-write
 * primitive reachable by prompt injection: not "a surprise file" in the repo,
 * but a chosen file anywhere the process can write.
 *
 * `allowOutsideRepo` keeps the old behaviour for a programmatic caller that
 * really is the user, and is deliberately opt-in. The MCP tool never passes it,
 * which matches this repo's untrusted-by-default stance: the library keeps its
 * flexibility, and the surface where the caller is a model does not get it.
 */
export function writeWhiteboard(
  graph: ArchGraph,
  repoPath: string,
  outPath?: string,
  opts: { allowOutsideRepo?: boolean } = {},
): { path: string; nodes: number; edges: number } {
  const model = buildBoardModel(graph);
  const html = renderWhiteboardHtml(graph);
  const rel = outPath ?? path.join('.sequence', 'whiteboard.html');
  const target = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(repoPath, rel);
  if (!opts.allowOutsideRepo) {
    const root = path.resolve(repoPath);
    /*
     * BOUNDARY, not prefix. `startsWith(root)` lets a SIBLING whose name shares
     * the repo's basename escape — repo `/work/app`, outPath `../app-secrets/x`
     * resolves to `/work/app-secrets/x`, which startsWith('/work/app') is true.
     * Require an exact match or a real path-separator boundary.
     */
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`outPath escapes the repo: ${outPath}`);
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, 'utf8');
  return { path: target, nodes: model.nodes.length, edges: model.edges.length };
}
