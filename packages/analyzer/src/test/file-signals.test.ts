/**
 * r183 Task D — the deterministic "what it does" line must say something.
 *
 * Owner, on a real repo (schwai_com, `frontend-shared`, 11 TypeScript files):
 *
 * > "Oh, cool, what it does: 'a group of 11 related files.' It does files.
 * > What does that mean? ... These files contain layouts and marketing pages
 * > for checkout, etc. That's what I should say, but instead this is what it's
 * > giving."
 *
 * These tests lock BOTH halves of the fix: the grounded summary fires on
 * real-shaped names, and the honest count-only fallback still fires when the
 * names genuinely carry no pattern (we never claim a pattern that isn't there).
 * No AI is involved on either path — this is the keyless, local-first answer.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from '@sequence/schema';
import { describeFileGroup, nameFileGroup, tokenizeFileName } from '../explain/fileSignals.js';
import { labelCluster } from '../cluster/cluster.js';
import { buildStructuralTree } from '../explain/explain.js';
import type { PlainNode } from '../explain/plaintree.js';

/** The owner's actual reported file set for `frontend-shared`. */
const SCHWAI_SHARED = [
  'src/Chat.tsx',
  'src/Layout.tsx',
  'src/marketing.ts',
  'src/PaidCheckoutFields.tsx',
  'src/banquest.d.ts',
];

test('r183: schwai_com frontend-shared names produce a real description, not a count', () => {
  const summary = describeFileGroup(SCHWAI_SHARED);
  assert.ok(summary, 'a recognisable file set must produce a description');
  const lower = summary.toLowerCase();
  assert.ok(
    /marketing|checkout|layout/.test(lower),
    `summary must name a real signal visible in the filenames, got: ${summary}`
  );
  assert.ok(!/related file/.test(lower), `summary must not be the count sentence, got: ${summary}`);
});

test('r183: the honest fallback still fires for genuinely unpatterned filenames', () => {
  // Nothing in these names maps to any known signal. The correct answer is
  // "I cannot tell" (undefined) so the caller keeps its count sentence — NOT a
  // fabricated domain claim.
  const summary = describeFileGroup([
    'src/blorp.ts',
    'src/qqmm.ts',
    'src/frobnitz.ts',
    'src/zx91.ts',
    'src/wibble.ts',
  ]);
  assert.strictEqual(summary, undefined);
});

test('r183: one stray match in a big group does not get to name the whole group', () => {
  // 1 of 12 files says "config". Claiming the group is "configuration modules"
  // would be a pattern that isn't there.
  const names = ['src/config.ts', ...Array.from({ length: 11 }, (_, i) => `src/aa${i}bb.ts`)];
  assert.strictEqual(describeFileGroup(names), undefined);
});

test('r183: descriptions are deterministic and grounded in extensions', () => {
  const a = describeFileGroup(SCHWAI_SHARED);
  const b = describeFileGroup(SCHWAI_SHARED);
  assert.strictEqual(a, b, 'same input must give the same sentence (no AI, no randomness)');
  // 3 of 5 are .tsx, so the head noun is "components", not the generic "files".
  assert.ok(a && a.endsWith('components.'), `expected a component head noun, got: ${a}`);

  const mods = describeFileGroup(['src/checkoutRoutes.ts', 'src/orderHandler.ts', 'src/cart.ts']);
  assert.ok(mods && mods.endsWith('modules.'), `expected a module head noun, got: ${mods}`);
});

test('r183: tokenizer splits camelCase, paths and .d.ts', () => {
  assert.deepStrictEqual(tokenizeFileName('src/PaidCheckoutFields.tsx'), [
    'src',
    'paid',
    'checkout',
    'fields',
  ]);
  assert.ok(tokenizeFileName('types/banquest.d.ts').includes('dts'));
  assert.deepStrictEqual(tokenizeFileName('api/user-profile_page.ts'), [
    'api',
    'user',
    'profile',
    'page',
  ]);
});

/* ------------------------------------------------------- end to end wiring - */

function findFeature(node: PlainNode, id: string): PlainNode | undefined {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findFeature(c, id);
    if (hit) return hit;
  }
  return undefined;
}

/** A minimal graph shaped like the owner's report: one service, one module. */
function schwaiShapedGraph(fileNames: string[]): ArchGraph {
  return {
    version: 1,
    repoName: 'schwai',
    nodes: [
      { id: 'svc:frontend', kind: 'service', label: 'frontend', path: 'apps/frontend' },
      {
        id: 'mod:frontend-shared',
        kind: 'module',
        label: 'frontend-shared',
        path: 'apps/frontend/src',
        parentId: 'svc:frontend',
        meta: { files: fileNames.length },
      },
      ...fileNames.map((p) => ({
        id: `file:${p}`,
        kind: 'file' as const,
        label: p.slice(p.lastIndexOf('/') + 1),
        path: p,
        parentId: 'mod:frontend-shared',
        meta: { language: 'TypeScript' },
      })),
    ],
    edges: [],
  } as unknown as ArchGraph;
}

test('r183: the plain tree (no AI key) carries the grounded module summary', () => {
  const tree = buildStructuralTree(schwaiShapedGraph(SCHWAI_SHARED));
  const feature = findFeature(tree, 'p:mod:frontend-shared');
  assert.ok(feature, 'module must appear in the plain tree');
  assert.ok(feature.summary, 'module must have a summary');
  assert.ok(
    /marketing|checkout|layout/i.test(feature.summary),
    `plain tree summary must name a real signal, got: ${feature.summary}`
  );
});

test('r183: the plain tree keeps the count sentence when nothing is recognisable', () => {
  const names = ['a/blorp.ts', 'a/qqmm.ts', 'a/frobnitz.ts'];
  const tree = buildStructuralTree(schwaiShapedGraph(names));
  const feature = findFeature(tree, 'p:mod:frontend-shared');
  assert.ok(feature);
  assert.strictEqual(feature.summary, 'A group of 3 related files.');
});

/* ===================================================================== r184 ==
 * NAMING FROM A PATTERN. Owner, 2026-08-01:
 *
 * > "can we give it a system to name certain objects if it sees patterns, if
 * > it's not explicitly called [something]? For example, if it sees a pattern…
 * > for a backend purchasing system, can we just call it 'Purchasing workflow'
 * > or something?"
 *
 * Same dictionary as the description above — one mechanism, two renderings.
 * The fixture is the owner's REAL directory, not a convenient one.
 */

/** `backend/app/models/` from the owner's repo, verbatim. */
const OWNER_MODELS = [
  'backend/app/models/class_catalog.py',
  'backend/app/models/class_quiz_question.py',
  'backend/app/models/coupon_code.py',
  'backend/app/models/coupon_redemption.py',
  'backend/app/models/entitlement.py',
  'backend/app/models/one_time_charge.py',
  'backend/app/models/personal_subscription.py',
  'backend/app/models/profile.py',
  'backend/app/models/public_email_domain.py',
  'backend/app/models/webinar_owner_count.py',
];

test('r184: the owner\'s models directory is named for what it does, not where it sits', () => {
  const name = nameFileGroup(OWNER_MODELS);
  assert.ok(name, 'a 10-file billing/catalog model layer must get a name');
  // The point of the ask: NOT "Models".
  assert.ok(!/^models?$/i.test(name!), `must not fall back to the directory name, got: ${name}`);
  assert.match(name!, /billing|purchas|catalog|subscription|entitlement/i);
});

test('r184: the module label itself changes — end to end through labelCluster', () => {
  const label = labelCluster(OWNER_MODELS, 'backend', 'backend/app/models/entitlement.py');
  assert.ok(!/^models$/i.test(label), `labelCluster must not stop at "models", got: ${label}`);
  assert.match(label, /billing|purchas|catalog/i);
});

test('r184: a genuinely unpatterned group keeps the honest mechanical name', () => {
  // Nothing in these names is in the dictionary. A name we cannot ground is
  // worse than a boring one that is true.
  const noise = [
    'backend/app/models/aardvark.py',
    'backend/app/models/frobnitz.py',
    'backend/app/models/qqmm.py',
    'backend/app/models/blorp.py',
  ];
  assert.strictEqual(nameFileGroup(noise), undefined);
  assert.strictEqual(labelCluster(noise, 'backend', noise[0]), 'models');
});

test('r184: an EXPLICIT directory name always wins over the inferred one', () => {
  // "if it's not explicitly called [something]" — when it is, we keep it.
  const billing = [
    'backend/billing/coupon.py',
    'backend/billing/charge.py',
    'backend/billing/plan.py',
  ];
  assert.strictEqual(labelCluster(billing, 'backend'), 'billing');
});

test('r184: a thin or tied pattern names nothing at all', () => {
  // Two files is a coincidence, not a pattern.
  assert.strictEqual(nameFileGroup(['checkout.ts', 'invoice.ts']), undefined);
  // One billing file in a group of eight is below the coverage floor.
  assert.strictEqual(
    nameFileGroup([
      'invoice.py', 'aardvark.py', 'frobnitz.py', 'qqmm.py',
      'blorp.py', 'zzz.py', 'yyy.py', 'xxx.py',
    ]),
    undefined,
  );
  // Three domains equally present: the group really does several things.
  assert.strictEqual(
    nameFileGroup(['checkout.ts', 'admin.ts', 'search.ts']),
    undefined,
  );
});

test('r184: naming reads FILE names, never the directory they sit in', () => {
  // Every path below carries the token `models`; not one file name does. If the
  // path counted, this would be "Data models" — the answer the owner rejected.
  const name = nameFileGroup(OWNER_MODELS);
  assert.notStrictEqual(name, 'Data models');
});

test('r184: the owner\'s own example shape yields his own words', () => {
  assert.strictEqual(
    nameFileGroup(['purchase_order.py', 'checkout.ts', 'invoice.py', 'coupon_code.py', 'one_time_charge.py']),
    'Purchasing workflow',
  );
});

test('r184: naming is deterministic and order-independent', () => {
  const a = nameFileGroup(OWNER_MODELS);
  const b = nameFileGroup([...OWNER_MODELS].reverse());
  assert.strictEqual(a, b);
  assert.strictEqual(a, nameFileGroup(OWNER_MODELS));
});

test('r184: the name and the description never claim different things', () => {
  // One dictionary, two renderings: whatever the name says, the sentence agrees.
  const name = nameFileGroup(OWNER_MODELS)!;
  const desc = describeFileGroup(OWNER_MODELS)!;
  assert.ok(name && desc);
  const head = name.split(' &')[0].toLowerCase();
  assert.ok(
    desc.toLowerCase().includes(head) || /checkout|payment|course|catalog/.test(desc.toLowerCase()),
    `name "${name}" and description "${desc}" must rest on the same signal`,
  );
});

/* ===================================================================== G15 ==
 * `describeFileGroup` joined two signal labels with `and`, but many labels
 * already contain "and" ("checkout and payment", "sign-in and account"), so
 * the composed sentence read "Test and checkout and payment".
 */

test('G15: two-signal descriptions do not double "and"', () => {
  const names = [
    'test/a.spec.ts',
    'test/b.spec.ts',
    'src/checkout.ts',
    'src/payment.ts',
    'src/cart.ts',
  ];
  const summary = describeFileGroup(names)!;
  assert.ok(summary, 'mixed test + checkout files must produce a description');
  const lower = summary.toLowerCase();
  assert.ok(!/and .+ and .+ and/.test(lower), `must not chain three "and"s, got: ${summary}`);
  assert.ok(
    lower.includes('test') && lower.includes('checkout'),
    `must name both signals, got: ${summary}`,
  );
  assert.match(summary, /checkout and payment, test modules\./i);
});

test('G15: two labels that both contain "and" are comma-joined', () => {
  const names = [
    'src/auth.ts',
    'src/login.ts',
    'src/checkout.ts',
    'src/payment.ts',
    'src/cart.ts',
  ];
  const summary = describeFileGroup(names)!;
  assert.ok(summary);
  assert.match(summary, /checkout and payment, sign-in and account/i);
});

/**
 * G14 — breakout row sub-lines are one nowrap ellipsis line. When both the
 * counted-symbol sentence and a domain pattern are grounded, the specific
 * detail must LEAD so a narrow row does not ellipsize into the vague label.
 */
test('G14: counted symbols lead the module summary when domain context is also grounded', () => {
  const RENDER = [
    'render/data.go',
    'render/html.go',
    'render/json.go',
    'render/msgpack.go',
    'render/protobuf.go',
    'render/redirect.go',
    'render/render.go',
    'render/text.go',
    'render/xml.go',
    'render/yaml.go',
    'render/reader.go',
    'render/writer.go',
    'render/reader_test.go',
    'render/render_test.go',
  ];
  const counted = '14 go files in render, defining Instance, loadTemplate, Render.';
  const tree = buildStructuralTree(
    {
      version: 1,
      repoName: 'gin',
      nodes: [
        { id: 'svc:gin', kind: 'service', label: 'gin' },
        {
          id: 'mod:gin/render',
          kind: 'module',
          label: 'render',
          parentId: 'svc:gin',
          meta: { files: RENDER.length, description: counted },
        },
        ...RENDER.map((p) => ({
          id: `file:${p}`,
          kind: 'file' as const,
          label: p.slice(p.lastIndexOf('/') + 1),
          path: p,
          parentId: 'mod:gin/render',
        })),
      ],
      edges: [],
    } as unknown as ArchGraph
  );
  const feature = findFeature(tree, 'p:mod:gin/render');
  assert.ok(feature?.summary, 'module must have a summary');
  assert.ok(
    feature.summary!.startsWith(counted),
    `counted detail must lead (G14), got: ${feature.summary}`
  );
  if (/serialization/i.test(feature.summary!)) {
    const [lead] = feature.summary!.split(' — ');
    assert.ok(lead.includes('Instance'), `ellipsis must keep symbols in the lead, got: ${lead}`);
  }
});
