import assert from 'node:assert';
import { test } from 'node:test';
import {
  addEntity,
  addProperty,
  addRelationship,
  emptyDomain,
  removeEntity,
  removeProperty,
  removeRelationship,
  renameEntity,
  updateProperty,
  validateDomain,
  type DomainModel,
} from './domain.js';

/**
 * Unit lock for the pure Domain-model (ontology) layer (v17 Phase 1): the
 * structural validator and the immutable mutation helpers. Every validator error
 * class must fire; every helper must round-trip to a valid model and never mutate
 * its input; id derivation must be deterministic and de-duped.
 */

// --- validateDomain: the happy path ------------------------------------------

test('validateDomain: an empty domain is ok', () => {
  const r = validateDomain(emptyDomain('x'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

/** A small, valid model: Owner (name) 1-→* Pet (name, owner→ref Owner). */
function sample(): DomainModel {
  return {
    version: 1,
    name: 'clinic',
    entities: [
      {
        id: 'ent:owner',
        name: 'Owner',
        properties: [{ id: 'prop:name', name: 'Name', type: 'string' }],
      },
      {
        id: 'ent:pet',
        name: 'Pet',
        properties: [
          { id: 'prop:name', name: 'Name', type: 'string' },
          { id: 'prop:owner', name: 'Owner', type: 'ref', refEntityId: 'ent:owner' },
        ],
      },
    ],
    relationships: [
      { id: 'rel:has-many', srcId: 'ent:owner', dstId: 'ent:pet', kind: 'has-many' },
    ],
  };
}

test('validateDomain: a well-formed model is ok (with a ref property + relationship)', () => {
  const r = validateDomain(sample());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validateDomain: a self-relationship and a self-reference are legal', () => {
  const m: DomainModel = {
    version: 1,
    name: 'org',
    entities: [
      {
        id: 'ent:emp',
        name: 'Employee',
        properties: [{ id: 'prop:mgr', name: 'Manager', type: 'ref', refEntityId: 'ent:emp' }],
      },
    ],
    relationships: [
      { id: 'rel:reports', srcId: 'ent:emp', dstId: 'ent:emp', kind: 'references' },
    ],
  };
  assert.equal(validateDomain(m).ok, true);
});

test('validateDomain: an entity with zero properties is a warning, not an error', () => {
  const m: DomainModel = {
    version: 1,
    name: 'x',
    entities: [{ id: 'ent:empty', name: 'Empty', properties: [] }],
    relationships: [],
  };
  const r = validateDomain(m);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes('ent:empty') && w.includes('no properties')));
});

// --- validateDomain: every error class fires ---------------------------------

test('validateDomain: duplicate entity id', () => {
  const m = sample();
  m.entities[1].id = 'ent:owner';
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('duplicate entity id: ent:owner')));
});

test('validateDomain: duplicate property id WITHIN an entity', () => {
  const m = sample();
  m.entities[1].properties[1].id = 'prop:name'; // collides with the sibling in Pet
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('duplicate property id: prop:name')));
});

test('validateDomain: the SAME property id across DIFFERENT entities is fine', () => {
  // both Owner and Pet already carry a 'prop:name' — that must NOT be an error.
  const r = validateDomain(sample());
  assert.ok(!r.errors.some((e) => e.includes('duplicate property id')));
});

test('validateDomain: dangling relationship endpoints', () => {
  const m = sample();
  m.relationships.push({ id: 'rel:x', srcId: 'ent:ghost', dstId: 'ent:pet', kind: 'has-one' });
  m.relationships.push({ id: 'rel:y', srcId: 'ent:owner', dstId: 'ent:nope', kind: 'has-one' });
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown srcId ent:ghost')));
  assert.ok(r.errors.some((e) => e.includes('unknown dstId ent:nope')));
});

test('validateDomain: a ref property missing its refEntityId', () => {
  const m = sample();
  delete m.entities[1].properties[1].refEntityId;
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('missing refEntityId')));
});

test('validateDomain: a ref property pointing at a missing entity', () => {
  const m = sample();
  m.entities[1].properties[1].refEntityId = 'ent:missing';
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('points to unknown entity ent:missing')));
});

test('validateDomain: a NON-ref property carrying a refEntityId (dishonest shape)', () => {
  const m = sample();
  m.entities[0].properties[0].refEntityId = 'ent:pet'; // a 'string' prop must not carry one
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('must not carry refEntityId')));
});

test('validateDomain: empty entity and property names', () => {
  const m = sample();
  m.entities[0].name = '   ';
  m.entities[1].properties[0].name = '';
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('entity ent:owner has an empty name')));
  assert.ok(r.errors.some((e) => e.includes('has an empty name') && e.includes('prop:name')));
});

test('validateDomain: an invalid relationship kind', () => {
  const m = sample();
  (m.relationships[0] as { kind: unknown }).kind = 'owns-a-lot';
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("invalid kind 'owns-a-lot'")));
});

test('validateDomain: an invalid property type', () => {
  const m = sample();
  (m.entities[0].properties[0] as { type: unknown }).type = 'blob';
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("invalid type 'blob'")));
});

// --- mutation helpers: round-trip validity -----------------------------------

test('mutation round-trip: build a whole model through the helpers; each step stays ok', () => {
  let m = emptyDomain('clinic');
  assert.equal(validateDomain(m).ok, true);

  const a = addEntity(m, { name: 'Owner', description: 'A pet owner' });
  m = a.model;
  assert.equal(validateDomain(m).ok, true);

  const b = addEntity(m, { name: 'Pet' });
  m = b.model;
  assert.equal(validateDomain(m).ok, true);

  const p1 = addProperty(m, a.id, { name: 'Name', type: 'string', required: true });
  m = p1.model;
  assert.equal(validateDomain(m).ok, true);

  const p2 = addProperty(m, b.id, { name: 'Owner', type: 'ref', refEntityId: a.id });
  m = p2.model;
  assert.equal(validateDomain(m).ok, true);

  const rel = addRelationship(m, { srcId: a.id, dstId: b.id, kind: 'has-many', label: 'owns' });
  m = rel.model;
  assert.equal(validateDomain(m).ok, true);

  m = renameEntity(m, a.id, 'Pet Owner');
  assert.equal(validateDomain(m).ok, true);
  assert.equal(m.entities.find((e) => e.id === a.id)?.name, 'Pet Owner');

  // Flip the ref property to a plain string — refEntityId must be dropped, model still ok.
  m = updateProperty(m, b.id, p2.id, { type: 'string' });
  assert.equal(validateDomain(m).ok, true);
  const flipped = m.entities.find((e) => e.id === b.id)?.properties.find((p) => p.id === p2.id);
  assert.equal(flipped?.type, 'string');
  assert.equal(flipped?.refEntityId, undefined);

  m = removeProperty(m, a.id, p1.id);
  assert.equal(validateDomain(m).ok, true);

  m = removeRelationship(m, rel.id);
  assert.equal(validateDomain(m).ok, true);
  assert.equal(m.relationships.length, 0);

  m = removeEntity(m, a.id);
  assert.equal(validateDomain(m).ok, true);
});

test('addProperty: a NON-ref spec never keeps a stray refEntityId (honest shape)', () => {
  const a = addEntity(emptyDomain('d'), { name: 'A' });
  const b = addEntity(a.model, { name: 'B' });
  const p = addProperty(b.model, a.id, {
    name: 'Field',
    type: 'string',
    refEntityId: b.id, // caller error — must be ignored for a non-ref
  });
  const prop = p.model.entities.find((e) => e.id === a.id)?.properties[0];
  assert.equal(prop?.refEntityId, undefined);
  assert.equal(validateDomain(p.model).ok, true);
});

// --- removeEntity cascade ----------------------------------------------------

test('removeEntity: cascades relationships AND demotes ref properties that point at it', () => {
  // Owner <- Pet(owner: ref Owner) + a relationship touching Owner.
  const m = sample();
  const out = removeEntity(m, 'ent:owner');

  // The entity is gone.
  assert.ok(!out.entities.some((e) => e.id === 'ent:owner'));
  // Every relationship touching it is gone.
  assert.equal(out.relationships.length, 0);
  // The ref property that pointed at Owner is demoted to 'id', refEntityId cleared.
  const petOwner = out.entities
    .find((e) => e.id === 'ent:pet')
    ?.properties.find((p) => p.id === 'prop:owner');
  assert.equal(petOwner?.type, 'id');
  assert.equal(petOwner?.refEntityId, undefined);
  // The result is a clean, valid model.
  assert.equal(validateDomain(out).ok, true);
});

// --- immutability ------------------------------------------------------------

test('helpers are immutable: the input model is never mutated', () => {
  const base = sample();
  const snapshot = structuredClone(base);

  addEntity(base, { name: 'New' });
  renameEntity(base, 'ent:owner', 'Renamed');
  removeEntity(base, 'ent:owner');
  addProperty(base, 'ent:pet', { name: 'Age', type: 'number' });
  updateProperty(base, 'ent:pet', 'prop:owner', { type: 'string' });
  removeProperty(base, 'ent:pet', 'prop:name');
  addRelationship(base, { srcId: 'ent:owner', dstId: 'ent:pet', kind: 'has-one' });
  removeRelationship(base, 'rel:has-many');

  assert.deepEqual(base, snapshot);
});

// --- deterministic, de-duped id derivation -----------------------------------

test('id derivation: deterministic slug + dedupe suffix, replay is byte-identical', () => {
  const run = (): { e1: string; e2: string; p1: string; p2: string; r1: string; r2: string } => {
    const e1 = addEntity(emptyDomain('d'), { name: 'Pet' });
    const e2 = addEntity(e1.model, { name: 'Pet' }); // same name → dedupe
    const p1 = addProperty(e2.model, e1.id, { name: 'Name', type: 'string' });
    const p2 = addProperty(p1.model, e1.id, { name: 'Name', type: 'string' }); // dedupe within entity
    const r1 = addRelationship(p2.model, { srcId: e1.id, dstId: e2.id, kind: 'has-one', label: 'owns' });
    const r2 = addRelationship(r1.model, { srcId: e1.id, dstId: e2.id, kind: 'has-one', label: 'owns' });
    return { e1: e1.id, e2: e2.id, p1: p1.id, p2: p2.id, r1: r1.id, r2: r2.id };
  };

  const first = run();
  assert.equal(first.e1, 'ent:pet');
  assert.equal(first.e2, 'ent:pet-2');
  assert.equal(first.p1, 'prop:name');
  assert.equal(first.p2, 'prop:name-2');
  assert.equal(first.r1, 'rel:owns');
  assert.equal(first.r2, 'rel:owns-2');

  // Replaying the exact same operations yields byte-identical ids.
  assert.deepEqual(run(), first);
});

test('addRelationship: id falls back to the kind when no label is given', () => {
  const a = addEntity(emptyDomain('d'), { name: 'A' });
  const b = addEntity(a.model, { name: 'B' });
  const r = addRelationship(b.model, { srcId: a.id, dstId: b.id, kind: 'many-to-many' });
  assert.equal(r.id, 'rel:many-to-many');
});

// --- v17 review round-1: validateDomain is TOTAL on malformed/partial input ---

test('validateDomain: TOTAL — a partial blob (no properties array) does not throw', () => {
  // A stale localStorage value or hand-edited file can lack nested arrays. The
  // documented "never throws" contract must hold: report the shape, do not crash.
  const partial = { version: 1, name: 'x', entities: [{ id: 'ent:a', name: 'A' }], relationships: [] } as unknown as DomainModel;
  let r: ReturnType<typeof validateDomain> | undefined;
  assert.doesNotThrow(() => {
    r = validateDomain(partial);
  });
  assert.equal(r!.ok, true); // a missing property list is treated as empty, not an error
});

test('validateDomain: TOTAL — missing top-level arrays are flagged, not thrown', () => {
  const bad = { version: 1, name: 'x' } as unknown as DomainModel;
  let r: ReturnType<typeof validateDomain> | undefined;
  assert.doesNotThrow(() => {
    r = validateDomain(bad);
  });
  assert.equal(r!.ok, false);
  assert.ok(r!.errors.some((e) => e.includes('entities array')));
  assert.ok(r!.errors.some((e) => e.includes('relationships array')));
});

test('validateDomain: an empty entity id is flagged', () => {
  const m = { version: 1, name: 'x', entities: [{ id: '', name: 'A', properties: [] }], relationships: [] } as DomainModel;
  const r = validateDomain(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('empty id')));
});

// --- v17 review: validateDomain is TOTAL on a null/non-object ELEMENT ---------
// Vision §3: a null/non-object element inside entities/properties/relationships
// (e.g. a hand-edited {"entities":[null]} blob) must be REPORTED, never
// dereferenced — the validator returns its normal {ok,errors,warnings} instead
// of throwing `Cannot read properties of null`.

test('validateDomain: TOTAL — a null entity element does not throw and is flagged', () => {
  const m = { version: 1, name: 'x', entities: [null], relationships: [] } as unknown as DomainModel;
  let r: ReturnType<typeof validateDomain> | undefined;
  assert.doesNotThrow(() => {
    r = validateDomain(m);
  });
  assert.equal(typeof r!.ok, 'boolean');
  assert.ok(Array.isArray(r!.errors) && Array.isArray(r!.warnings));
  assert.equal(r!.ok, false);
  assert.ok(r!.errors.some((e) => e.includes('entity[0]') && e.includes('not an object')));
});

test('validateDomain: TOTAL — a null property element does not throw and is flagged', () => {
  const m = {
    version: 1,
    name: 'x',
    entities: [{ id: 'ent:a', name: 'A', properties: [null] }],
    relationships: [],
  } as unknown as DomainModel;
  let r: ReturnType<typeof validateDomain> | undefined;
  assert.doesNotThrow(() => {
    r = validateDomain(m);
  });
  assert.ok(Array.isArray(r!.errors) && Array.isArray(r!.warnings));
  assert.equal(r!.ok, false);
  assert.ok(r!.errors.some((e) => e.includes('property[0]') && e.includes('not an object')));
});

test('validateDomain: TOTAL — a null relationship element does not throw and is flagged', () => {
  const m = {
    version: 1,
    name: 'x',
    entities: [{ id: 'ent:a', name: 'A', properties: [{ id: 'prop:n', name: 'N', type: 'string' }] }],
    relationships: [null],
  } as unknown as DomainModel;
  let r: ReturnType<typeof validateDomain> | undefined;
  assert.doesNotThrow(() => {
    r = validateDomain(m);
  });
  assert.ok(Array.isArray(r!.errors) && Array.isArray(r!.warnings));
  assert.equal(r!.ok, false);
  assert.ok(r!.errors.some((e) => e.includes('relationship[0]') && e.includes('not an object')));
});
