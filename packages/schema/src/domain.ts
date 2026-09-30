/**
 * The Domain-model (ontology) contract — v17's "design your entities before you
 * build" layer.
 *
 * This module is the ANALOG of `program.ts`'s ArchGraph/Program pattern: a set of
 * typed node/edge kinds plus a PURE validator. Where a Program is a control-flow
 * graph and an ArchGraph is a detected architecture, a {@link DomainModel} is a
 * hand-authored ONTOLOGY — the entities, their datatype properties, and the
 * typed relationships between them (Pet · Owner · Appointment). It answers "what
 * are the *things* in this system and how do they relate", ahead of / alongside
 * the code that will implement them.
 *
 * OWL-honest mapping (stated so the types can't drift):
 *  - {@link DomainEntity}       ≈ an OWL class.
 *  - {@link DomainProperty}     ≈ a datatype property (a literal-valued attribute)
 *    — EXCEPT `type:'ref'`, an inline object-property-style pointer to another
 *    entity (a foreign key), which MUST name its target via `refEntityId`.
 *  - {@link DomainRelationship} ≈ an object property with cardinality (`kind`).
 *
 * HONESTY / PURITY CONTRACT (mirrors program.ts):
 *  - {@link validateDomain} is PURE and TOTAL: it never throws and it returns
 *    EVERY problem it finds (not just the first), so an editor can surface the
 *    whole list at once. `ok` is false ONLY on real structural errors; advisory
 *    notes (e.g. an entity with zero properties) are non-fatal and reported
 *    separately in `warnings` — they never flip `ok`.
 *  - A `ref` property must carry a `refEntityId` pointing at a real entity; a
 *    NON-ref property must NOT carry one (an honest shape — a string field does
 *    not secretly reference a table). Self-relationships (src === dst) and
 *    self-references (a ref property pointing back at its own entity) are LEGAL.
 *  - Every mutation helper is IMMUTABLE: it returns a NEW model (structural
 *    clone), never mutating its input — matching the store's immutability and
 *    `design.ts`. Ids are derived DETERMINISTICALLY (a readable slug of the name
 *    plus a `-2`/`-3` dedupe suffix), so replaying the same operations yields a
 *    byte-identical model.
 *
 * Everything in this file is pure and browser-safe (no fs, no network, no DOM).
 */

/** The primitive shape of one datatype property, plus the inline-pointer `ref`. */
export type DomainPropertyType = 'string' | 'number' | 'boolean' | 'date' | 'id' | 'ref';

/** Every legal {@link DomainPropertyType} — the runtime whitelist the validator checks against. */
export const DOMAIN_PROPERTY_TYPES: readonly DomainPropertyType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'id',
  'ref',
];

/**
 * One attribute of an entity. For every type EXCEPT `ref` this is a plain
 * literal-valued datatype property. For `type:'ref'` it is an inline pointer to
 * another entity and `refEntityId` is REQUIRED (and must name a real entity);
 * for any other type `refEntityId` must be ABSENT (see {@link validateDomain}).
 */
export interface DomainProperty {
  id: string;
  name: string;
  type: DomainPropertyType;
  required?: boolean;
  /** REQUIRED iff `type === 'ref'`; forbidden otherwise. Names the target entity's id. */
  refEntityId?: string;
  description?: string;
}

/** An entity ≈ an OWL class: a named thing with a bag of {@link DomainProperty}. */
export interface DomainEntity {
  id: string;
  name: string;
  description?: string;
  properties: DomainProperty[];
}

/** A typed relationship's cardinality/shape ≈ an OWL object property. */
export type DomainRelationshipKind =
  | 'has-one'
  | 'has-many'
  | 'belongs-to'
  | 'many-to-many'
  | 'references';

/** Every legal {@link DomainRelationshipKind} — the runtime whitelist the validator checks against. */
export const DOMAIN_RELATIONSHIP_KINDS: readonly DomainRelationshipKind[] = [
  'has-one',
  'has-many',
  'belongs-to',
  'many-to-many',
  'references',
];

/**
 * A directed relationship between two entities. `srcId`/`dstId` name real
 * entities (self-relationships, `srcId === dstId`, are legal). `kind` carries the
 * cardinality; `label` is an optional human name for the edge.
 */
export interface DomainRelationship {
  id: string;
  srcId: string;
  dstId: string;
  kind: DomainRelationshipKind;
  label?: string;
  description?: string;
}

/** A whole domain model: a named set of entities and the relationships between them. */
export interface DomainModel {
  version: 1;
  name: string;
  entities: DomainEntity[];
  relationships: DomainRelationship[];
}

/**
 * The result of {@link validateDomain}: `ok` plus the full list of `errors`, and
 * a separate list of non-fatal `warnings`. `ok` reflects `errors` ONLY — a model
 * with warnings but no errors is still `ok`.
 */
export interface ValidateDomainResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a domain model's structure. PURE and TOTAL — no side effects, never
 * throws, and returns EVERY problem it finds (not just the first). The checks:
 *
 *  - entity ids are unique; every entity has a non-empty name;
 *  - property ids are unique WITHIN each entity (the same id may recur across
 *    different entities — properties are entity-scoped); every property has a
 *    non-empty name and a known {@link DomainPropertyType};
 *  - a `ref` property MUST carry a `refEntityId` that names a real entity; a
 *    NON-ref property must NOT carry a `refEntityId` (honest shape);
 *  - relationship ids are unique; each `kind` is a known
 *    {@link DomainRelationshipKind}; `srcId`/`dstId` both name real entities.
 *    Self-relationships (`srcId === dstId`) are LEGAL and never flagged.
 *
 * Non-fatal advisories go to `warnings` (never flipping `ok`): today, an entity
 * with zero properties.
 */
export function validateDomain(m: DomainModel): ValidateDomainResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // TOTAL: tolerate a malformed/partial blob (e.g. a stale localStorage value or
  // a hand-edited file) — coerce missing arrays to empty and flag the shape
  // rather than throwing. This keeps the "never throws" contract literally true.
  const rawEntities = Array.isArray(m?.entities) ? m.entities : [];
  const rawRelationships = Array.isArray(m?.relationships) ? m.relationships : [];
  if (!m || !Array.isArray(m.entities)) errors.push('domain model has no entities array');
  if (!m || !Array.isArray(m.relationships)) errors.push('domain model has no relationships array');

  // TOTAL (vision §3): a null/non-object element inside entities/relationships
  // (e.g. a hand-edited blob like {"entities":[null]}) must be REPORTED as
  // invalid input, never dereferenced — otherwise `e.id` throws and the whole
  // validator crashes instead of returning its errors list.
  const entities: DomainEntity[] = [];
  rawEntities.forEach((e, i) => {
    if (e === null || typeof e !== 'object') errors.push(`entity[${i}] is not an object`);
    else entities.push(e);
  });

  // --- entity ids unique ----------------------------------------------------
  const entityIds = new Set<string>();
  for (const e of entities) {
    if (typeof e?.id !== 'string' || e.id.trim() === '') errors.push('an entity has an empty id');
    if (entityIds.has(e.id)) errors.push(`duplicate entity id: ${e.id}`);
    entityIds.add(e.id);
  }

  // --- per-entity: name, property ids, property shape -----------------------
  for (const e of entities) {
    if (typeof e.name !== 'string' || e.name.trim() === '') {
      errors.push(`entity ${e.id} has an empty name`);
    }

    // Guard element access the same way: a null/non-object property inside an
    // entity's `properties` array is reported, not dereferenced.
    const props: DomainProperty[] = [];
    (Array.isArray(e.properties) ? e.properties : []).forEach((p, i) => {
      if (p === null || typeof p !== 'object') {
        errors.push(`property[${i}] in entity ${e.id} is not an object`);
      } else {
        props.push(p);
      }
    });
    const propIds = new Set<string>();
    for (const p of props) {
      if (propIds.has(p.id)) {
        errors.push(`entity ${e.id} has a duplicate property id: ${p.id}`);
      }
      propIds.add(p.id);
    }

    for (const p of props) {
      if (typeof p.name !== 'string' || p.name.trim() === '') {
        errors.push(`property ${p.id} in entity ${e.id} has an empty name`);
      }
      if (!DOMAIN_PROPERTY_TYPES.includes(p.type)) {
        errors.push(`property ${p.id} in entity ${e.id} has invalid type '${String(p.type)}'`);
      }
      if (p.type === 'ref') {
        if (p.refEntityId === undefined) {
          errors.push(`ref property ${p.id} in entity ${e.id} is missing refEntityId`);
        } else if (!entityIds.has(p.refEntityId)) {
          errors.push(
            `ref property ${p.id} in entity ${e.id} points to unknown entity ${p.refEntityId}`
          );
        }
      } else if (p.refEntityId !== undefined) {
        errors.push(`non-ref property ${p.id} in entity ${e.id} must not carry refEntityId`);
      }
    }

    if (props.length === 0) warnings.push(`entity ${e.id} has no properties`);
  }

  // --- relationships: unique ids, valid kind, real endpoints ----------------
  // Same totality guard: a null/non-object relationship element is reported,
  // never dereferenced (r.id/r.kind/r.srcId would otherwise throw).
  const relationships: DomainRelationship[] = [];
  rawRelationships.forEach((r, i) => {
    if (r === null || typeof r !== 'object') errors.push(`relationship[${i}] is not an object`);
    else relationships.push(r);
  });
  const relIds = new Set<string>();
  for (const r of relationships) {
    if (relIds.has(r.id)) errors.push(`duplicate relationship id: ${r.id}`);
    relIds.add(r.id);
    if (!DOMAIN_RELATIONSHIP_KINDS.includes(r.kind)) {
      errors.push(`relationship ${r.id} has invalid kind '${String(r.kind)}'`);
    }
    if (!entityIds.has(r.srcId)) {
      errors.push(`relationship ${r.id} has unknown srcId ${r.srcId}`);
    }
    if (!entityIds.has(r.dstId)) {
      errors.push(`relationship ${r.id} has unknown dstId ${r.dstId}`);
    }
    // NOTE: srcId === dstId (a self-relationship) is deliberately allowed.
  }

  return { ok: errors.length === 0, errors, warnings };
}

/* ============================================================ id derivation === */

/** The id namespace for entities — distinct from property/relationship ids. */
export const DOMAIN_ENTITY_PREFIX = 'ent:';
/** The id namespace for properties (unique only within their entity). */
export const DOMAIN_PROP_PREFIX = 'prop:';
/** The id namespace for relationships. */
export const DOMAIN_REL_PREFIX = 'rel:';

/** A URL/id-safe slug of a human name; never empty. */
function slug(name: string): string {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'x' : s;
}

/** Trim + bound a user-supplied name; empty falls back to a readable placeholder. */
function cleanName(name: string): string {
  const t = (name ?? '').trim().slice(0, 80);
  return t === '' ? 'Untitled' : t;
}

/**
 * Derive a stable id from a base name: `<prefix><slug>` and, on collision with
 * `existing`, a `-2`/`-3`… suffix (bumped until free). Deterministic — the same
 * inputs always yield the same id, so replaying operations is byte-identical.
 */
function deriveId(existing: Set<string>, prefix: string, base: string): string {
  const root = prefix + slug(base);
  if (!existing.has(root)) return root;
  let i = 2;
  while (existing.has(`${root}-${i}`)) i++;
  return `${root}-${i}`;
}

/* ================================================================== clones === */

/** A structural deep clone — the basis of the "return a new model" contract. */
function cloneModel(m: DomainModel): DomainModel {
  return {
    version: 1,
    name: m.name,
    entities: m.entities.map((e) => ({ ...e, properties: e.properties.map((p) => ({ ...p })) })),
    relationships: m.relationships.map((r) => ({ ...r })),
  };
}

/* =============================================================== mutations === */

/** A brand-new, empty domain model with the given name. */
export function emptyDomain(name: string): DomainModel {
  return { version: 1, name: cleanName(name), entities: [], relationships: [] };
}

/**
 * Add an entity. Returns a NEW model plus the new entity's id (deterministically
 * derived, unique among entities).
 */
export function addEntity(
  m: DomainModel,
  spec: { name: string; description?: string }
): { model: DomainModel; id: string } {
  const next = cloneModel(m);
  const id = deriveId(new Set(next.entities.map((e) => e.id)), DOMAIN_ENTITY_PREFIX, spec.name);
  const entity: DomainEntity = { id, name: cleanName(spec.name), properties: [] };
  if (spec.description !== undefined) entity.description = spec.description;
  next.entities.push(entity);
  return { model: next, id };
}

/** Rename an entity (id stays STABLE so references survive). New model returned. */
export function renameEntity(m: DomainModel, id: string, name: string): DomainModel {
  const next = cloneModel(m);
  const e = next.entities.find((x) => x.id === id);
  if (e) e.name = cleanName(name);
  return next;
}

/**
 * Remove an entity, CASCADING every dependency so the result stays valid:
 *  - the entity itself is dropped;
 *  - every relationship touching it (as src OR dst) is removed;
 *  - every `ref` property that pointed AT it is DEMOTED to a plain `id` property
 *    and its `refEntityId` cleared — the user's property slot is preserved (less
 *    surprising than silently deleting the column) while the dangling reference
 *    is honestly severed. `validateDomain` on the result is `ok`.
 * New model returned.
 */
export function removeEntity(m: DomainModel, id: string): DomainModel {
  const next = cloneModel(m);
  next.entities = next.entities.filter((e) => e.id !== id);
  next.relationships = next.relationships.filter((r) => r.srcId !== id && r.dstId !== id);
  for (const e of next.entities) {
    e.properties = e.properties.map((p) => {
      if (p.type === 'ref' && p.refEntityId === id) {
        const demoted: DomainProperty = { id: p.id, name: p.name, type: 'id' };
        if (p.required !== undefined) demoted.required = p.required;
        if (p.description !== undefined) demoted.description = p.description;
        return demoted; // refEntityId deliberately dropped
      }
      return p;
    });
  }
  return next;
}

/**
 * Add a property to an entity. Returns a NEW model plus the new property's id
 * (unique within that entity). A missing entity is a no-op returning the cloned
 * model and an empty id. Honest shape: `refEntityId` is kept ONLY for `ref`
 * properties.
 */
export function addProperty(
  m: DomainModel,
  entityId: string,
  spec: { name: string; type: DomainPropertyType; required?: boolean; refEntityId?: string; description?: string }
): { model: DomainModel; id: string } {
  const next = cloneModel(m);
  const e = next.entities.find((x) => x.id === entityId);
  if (!e) return { model: next, id: '' };
  const id = deriveId(new Set(e.properties.map((p) => p.id)), DOMAIN_PROP_PREFIX, spec.name);
  const prop: DomainProperty = { id, name: cleanName(spec.name), type: spec.type };
  if (spec.required !== undefined) prop.required = spec.required;
  if (spec.type === 'ref' && spec.refEntityId !== undefined) prop.refEntityId = spec.refEntityId;
  if (spec.description !== undefined) prop.description = spec.description;
  e.properties.push(prop);
  return { model: next, id };
}

/**
 * Patch a property (id is immutable). Re-normalizes the honest shape: after the
 * patch, `refEntityId` is retained ONLY when the resulting type is `ref`, so
 * flipping a `ref` property to any other type clears its pointer automatically.
 * A missing entity/property is a no-op. New model returned.
 */
export function updateProperty(
  m: DomainModel,
  entityId: string,
  propertyId: string,
  patch: Partial<Omit<DomainProperty, 'id'>>
): DomainModel {
  const next = cloneModel(m);
  const e = next.entities.find((x) => x.id === entityId);
  if (!e) return next;
  const idx = e.properties.findIndex((p) => p.id === propertyId);
  if (idx < 0) return next;
  const cur = e.properties[idx];
  const merged = { ...cur, ...patch };
  const type = merged.type;
  const out: DomainProperty = { id: cur.id, name: cleanName(merged.name), type };
  if (merged.required !== undefined) out.required = merged.required;
  if (type === 'ref' && merged.refEntityId !== undefined) out.refEntityId = merged.refEntityId;
  if (merged.description !== undefined) out.description = merged.description;
  e.properties[idx] = out;
  return next;
}

/** Remove a property from an entity. A missing entity/property is a no-op. New model returned. */
export function removeProperty(m: DomainModel, entityId: string, propertyId: string): DomainModel {
  const next = cloneModel(m);
  const e = next.entities.find((x) => x.id === entityId);
  if (e) e.properties = e.properties.filter((p) => p.id !== propertyId);
  return next;
}

/**
 * Add a relationship. Returns a NEW model plus the new relationship's id
 * (derived from the label, falling back to the kind, then deduped). The caller is
 * responsible for passing real endpoint ids — `validateDomain` reports any that
 * are not; this helper does not silently drop them.
 */
export function addRelationship(
  m: DomainModel,
  spec: { srcId: string; dstId: string; kind: DomainRelationshipKind; label?: string; description?: string }
): { model: DomainModel; id: string } {
  const next = cloneModel(m);
  const base = spec.label && spec.label.trim() !== '' ? spec.label : spec.kind;
  const id = deriveId(new Set(next.relationships.map((r) => r.id)), DOMAIN_REL_PREFIX, base);
  const rel: DomainRelationship = { id, srcId: spec.srcId, dstId: spec.dstId, kind: spec.kind };
  if (spec.label !== undefined) rel.label = spec.label;
  if (spec.description !== undefined) rel.description = spec.description;
  next.relationships.push(rel);
  return { model: next, id };
}

/** Remove a relationship by id. A missing id is a no-op. New model returned. */
export function removeRelationship(m: DomainModel, id: string): DomainModel {
  const next = cloneModel(m);
  next.relationships = next.relationships.filter((r) => r.id !== id);
  return next;
}
