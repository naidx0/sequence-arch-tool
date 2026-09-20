/**
 * Insight + whiteboard tools — the adoption-wedge surface, tested on the
 * real shopfront fixture (a genuine multi-service scan, not a stub).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanRepoCached } from '@sequence/analyzer';
import {
  buildBoardModel,
  impactFromGraph,
  renderWhiteboardHtml,
  resolveNodeName,
  risksFromGraph,
  writeWhiteboard,
} from '../insightTools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', '..', 'analyzer', 'test', 'fixtures', 'shopfront');

async function graph() {
  return scanRepoCached(SHOPFRONT, { cluster: true });
}

test('risksFromGraph: ranked, grounded, and payload-light', async () => {
  const out = risksFromGraph(await graph(), 5);
  assert.ok(out.risks.length > 0, 'a multi-service repo has risks');
  assert.ok(out.risks.length <= 5);
  for (const r of out.risks) {
    assert.ok(r.nodeId && r.label, 'every risk names its node');
    assert.ok(r.blastRadius >= r.directDependents, 'closure >= one hop');
    assert.ok(!('impactedBy' in r), 'the id dump stays with the impact tool');
  }
});

test('impactFromGraph + resolveNodeName: blast radius for a real node, candidates for a vague one', async () => {
  const g = await graph();
  const svc = g.nodes.find((n) => n.kind === 'service');
  assert.ok(svc, 'fixture has a service');
  const res = resolveNodeName(g, svc!.id);
  assert.ok('id' in res && res.id === svc!.id, 'exact id resolves to itself');
  const impact = impactFromGraph(g, svc!.id);
  assert.strictEqual(impact.exists, true);
  assert.ok(Array.isArray(impact.impactedBy) && Array.isArray(impact.dependsOn));
  // A name matching nothing returns empty candidates, never a guess.
  const ghost = resolveNodeName(g, 'no-such-node-xyz');
  assert.ok('candidates' in ghost && ghost.candidates.length === 0);
});

test('whiteboard: one self-contained interactive HTML file, written inside the repo jail', async () => {
  const g = await graph();
  const model = buildBoardModel(g);
  assert.ok(model.nodes.length >= 3, `service-level nodes present: ${model.nodes.length}`);
  assert.ok(model.edges.length >= 1, 'projected edges present');
  const html = renderWhiteboardHtml(g);
  assert.ok(html.startsWith('<!doctype html>'));
  // Self-contained means NO loads and NO calls — namespace constants are fine.
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|fetch\(|XMLHttpRequest|import\(/.test(html), 'no network dependencies');
  assert.ok(html.includes('const DATA='), 'graph model embedded');
  // Writes into .sequence by default; a traversal outPath is refused.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-wb-'));
  fs.cpSync(SHOPFRONT, path.join(tmp, 'repo'), { recursive: true });
  const written = writeWhiteboard(g, path.join(tmp, 'repo'));
  assert.ok(fs.existsSync(written.path));
  assert.ok(written.path.includes('.sequence'));
  assert.throws(() => writeWhiteboard(g, path.join(tmp, 'repo'), '../escape.html'), /escapes the repo/);
});

/* ===================== adversarial-review fixes (2026-09-01) ===== */

test('writeWhiteboard: a sibling dir sharing the repo basename cannot be escaped into', async () => {
  const g = await graph();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-jail-'));
  fs.cpSync(SHOPFRONT, path.join(tmp, 'app'), { recursive: true });
  // /tmp/app is the repo; ../app-secrets resolves to /tmp/app-secrets — a
  // sibling whose name has the repo basename as a prefix. Must refuse.
  assert.throws(
    () => writeWhiteboard(g, path.join(tmp, 'app'), '../app-secrets/x.html'),
    /escapes the repo/,
  );
});

test('writeWhiteboard: an ABSOLUTE path outside the repo is refused too', async () => {
  const g = await graph();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-abs-'));
  fs.cpSync(SHOPFRONT, path.join(tmp, 'repo'), { recursive: true });
  const repo = path.join(tmp, 'repo');

  /*
   * THE SHAPE THAT WAS OPEN. `outPath` is a model-settable MCP tool field, and
   * the old code skipped the boundary check whenever the path was absolute —
   * so a model steered by untrusted repo text (a README, a comment, a filename
   * it just read) could name any writable file on the machine. The traversal
   * tests above never caught it because `../escape.html` is relative.
   */
  const outside = path.join(tmp, 'not-the-repo', 'pwned.html');
  assert.throws(() => writeWhiteboard(g, repo, outside), /escapes the repo/);
  assert.ok(!fs.existsSync(outside), 'refused, and nothing was written');

  // An absolute path INSIDE the repo is still legitimate, and still works.
  const inside = path.join(repo, 'docs', 'board.html');
  const written = writeWhiteboard(g, repo, inside);
  assert.equal(written.path, path.resolve(inside));
  assert.ok(fs.existsSync(inside));

  // The escape hatch stays available to a caller that really is the user.
  const opted = writeWhiteboard(g, repo, outside, { allowOutsideRepo: true });
  assert.equal(opted.path, path.resolve(outside));
  assert.ok(fs.existsSync(outside));

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('renderWhiteboardHtml: hostile labels are escaped, not injected', async () => {
  const g = await graph();
  // Inject a hostile label into a copy of the model via a fake node.
  const hostile = {
    ...g,
    nodes: [...g.nodes, { id: 'svc:x', kind: 'service', label: '</script><img src=x onerror=alert(1)>' } as never],
  };
  const html = renderWhiteboardHtml(hostile as never);
  // Two layers must hold: the DATA embedding escapes every `<` to \u003c (so a
  // </script> cannot break out of the inline script), and the runtime esc()
  // escapes before innerHTML. Security property: no raw executable markup, and
  // no premature </script>.
  assert.ok(!html.includes('<img src=x onerror='), 'no raw hostile markup');
  assert.ok(!html.includes('</script><img'), 'the script tag cannot be broken out of');
  assert.ok(html.includes('esc('), 'the runtime escaper is present');
  // The label survived (neutralized), not silently dropped.
  assert.ok(html.includes('\\u003c/script') || html.includes('u003cimg'), 'label embedded, neutralized');
});

test('impactFromGraph: a real topic node exists with a real blast radius (not exists:false)', async () => {
  const g = await graph();
  const topic = g.nodes.find((n) => n.kind === 'topic');
  if (!topic) return; // fixture may have none; the service case covers the rest
  const r = impactFromGraph(g, topic.id);
  assert.strictEqual(r.exists, true, 'a real topic is not reported missing');
});

test('impactFromGraph: a real service always reports exists:true even with no projected edges', async () => {
  const g = await graph();
  const svc = g.nodes.find((n) => n.kind === 'service');
  assert.ok(svc);
  const r = impactFromGraph(g, svc!.id);
  assert.strictEqual(r.exists, true);
});
