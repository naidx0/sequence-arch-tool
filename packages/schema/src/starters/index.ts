/**
 * Per-industry starter catalogue (v17 Phase 3).
 *
 * A STARTER is an HONEST, ready-made starting point: a `mode:'design'`
 * {@link ArchGraph} (and, where natural, a companion {@link DomainModel}) that a
 * user can load into Design mode and then edit freely. It is NOT a scan and NOT
 * a promise — it is a small, structurally VALID intent spec that saves the blank
 * page. Every starter's `buildArch()` is `validateGraph`-clean (zero problems)
 * and every `buildDomain()` is `validateDomain`-`ok`; the accompanying test file
 * (`starters.test.ts`) locks both invariants for the whole registry.
 *
 * PURITY / DETERMINISM: every `build*` is a pure factory that returns a FRESH
 * literal each call (no `Date.now`, no randomness, no shared mutable state), so
 * building the same starter twice is deep-equal — the same guarantee the design
 * store and domain helpers give. Design edges follow the contract exactly:
 * `origin:'design'`, `confidence:1`, `evidence:[]`, and kind-constrained
 * src/dst (see INTERACTION_SRC_KINDS / INTERACTION_DST_KINDS in ./index.js).
 * Service nodes carry a `meta.language` hint so a design-mode graph produces no
 * scaffolder warnings.
 *
 * Browser-safe (no fs / network / DOM): the web catalogue picker imports this.
 */

import type { ArchEdge, ArchGraph, ArchNode } from '../index.js';
import type { ProjectType } from '../classify.js';
import type { DomainModel } from '../domain.js';
import { addEntity, addProperty, addRelationship, emptyDomain } from '../domain.js';

/** One catalogue entry: metadata + pure builders. `buildDomain` is optional. */
export interface Starter {
  /** Stable, url-safe registry key (also the picker's `data-testid` suffix). */
  id: string;
  /** Human title shown in the picker. */
  title: string;
  /** The industry / use-case this starter speaks to. */
  industry: string;
  /** The aligned {@link ProjectType} (a real member of the classifier taxonomy). */
  projectType: ProjectType;
  /** One honest sentence: what it seeds, and that it is a starting point. */
  description: string;
  /** Build a fresh, validateGraph-clean design ArchGraph. */
  buildArch(): ArchGraph;
  /** Optionally build a fresh, validateDomain-ok DomainModel. */
  buildDomain?(): DomainModel;
}

/* ============================================================ arch helpers === */

const REPO_ID = 'repo';

function repoNode(label: string): ArchNode {
  return { id: REPO_ID, kind: 'repo', label };
}

/** A design-mode service node, always carrying a `meta.language` hint. */
function svc(
  label: string,
  language: 'ts' | 'py',
  framework?: 'express' | 'fastapi'
): ArchNode {
  const meta: ArchNode['meta'] = { language };
  if (framework) meta.framework = framework;
  return { id: `svc:${label}`, kind: 'service', label, parentId: REPO_ID, meta };
}

function ds(label: string, tech: 'postgres' | 'redis'): ArchNode {
  return { id: `ds:${label}`, kind: 'datastore', label, parentId: REPO_ID, meta: { tech } };
}

function topic(label: string): ArchNode {
  return { id: `topic:${label}`, kind: 'topic', label, parentId: REPO_ID };
}

/** A design edge — origin 'design', confidence 1, no evidence (contract). */
function edge(
  id: string,
  srcId: string,
  dstId: string,
  kind: ArchEdge['kind'],
  detail?: ArchEdge['detail']
): ArchEdge {
  const e: ArchEdge = { id, srcId, dstId, kind, confidence: 1, origin: 'design', evidence: [] };
  if (detail) e.detail = detail;
  return e;
}

function designGraph(repoName: string, nodes: ArchNode[], edges: ArchEdge[]): ArchGraph {
  return {
    version: 1,
    mode: 'design',
    scannedAt: '',
    repoRoot: '',
    repoName,
    nodes,
    edges,
    warnings: [],
  };
}

/* ========================================================== domain helper ==== */

/**
 * A tiny fluent wrapper over the pure domain helpers so a starter can author a
 * model without hand-threading the immutable model + derived ids. Every method
 * mutates only the wrapper's own field (the underlying helpers stay pure and
 * return fresh models), so `build()` yields a fresh, deterministic model.
 */
class DomainBuilder {
  private m: DomainModel;
  constructor(name: string) {
    this.m = emptyDomain(name);
  }
  entity(name: string, props: Array<Omit<Parameters<typeof addProperty>[2], never>>): string {
    const added = addEntity(this.m, { name });
    this.m = added.model;
    for (const p of props) {
      this.m = addProperty(this.m, added.id, p).model;
    }
    return added.id;
  }
  rel(srcId: string, dstId: string, kind: Parameters<typeof addRelationship>[1]['kind'], label?: string): void {
    this.m = addRelationship(this.m, { srcId, dstId, kind, label }).model;
  }
  build(): DomainModel {
    return this.m;
  }
}

/* ================================================================ starters === */

/** e-commerce / marketplace — a small storefront + catalog + orders + payments mesh. */
function ecommerceArch(): ArchGraph {
  const nodes: ArchNode[] = [
    repoNode('marketplace'),
    svc('storefront', 'ts', 'express'),
    svc('catalog-api', 'ts', 'express'),
    svc('orders-api', 'ts', 'express'),
    svc('payments-api', 'ts', 'express'),
    ds('catalog-db', 'postgres'),
    ds('orders-db', 'postgres'),
    ds('cache', 'redis'),
    topic('order-placed'),
  ];
  const edges: ArchEdge[] = [
    edge('e1', 'svc:storefront', 'svc:catalog-api', 'http', { method: 'GET', pathPattern: '/products' }),
    edge('e2', 'svc:storefront', 'svc:orders-api', 'http', { method: 'POST', pathPattern: '/orders' }),
    edge('e3', 'svc:orders-api', 'svc:payments-api', 'http', { method: 'POST', pathPattern: '/charges' }),
    edge('e4', 'svc:catalog-api', 'ds:catalog-db', 'db_read'),
    edge('e5', 'svc:catalog-api', 'ds:cache', 'db_write'),
    edge('e6', 'svc:orders-api', 'ds:orders-db', 'db_write'),
    edge('e7', 'svc:orders-api', 'topic:order-placed', 'queue_publish', { topic: 'order-placed' }),
  ];
  return designGraph('marketplace', nodes, edges);
}

function ecommerceDomain(): DomainModel {
  const b = new DomainBuilder('Marketplace');
  const customer = b.entity('Customer', [
    { name: 'id', type: 'id', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'name', type: 'string' },
  ]);
  const product = b.entity('Product', [
    { name: 'id', type: 'id', required: true },
    { name: 'sku', type: 'string', required: true },
    { name: 'title', type: 'string', required: true },
    { name: 'priceCents', type: 'number', required: true },
  ]);
  const order = b.entity('Order', [
    { name: 'id', type: 'id', required: true },
    { name: 'status', type: 'string', required: true },
    { name: 'customer', type: 'ref', required: true, refEntityId: customer },
    { name: 'placedAt', type: 'date' },
  ]);
  const lineItem = b.entity('LineItem', [
    { name: 'id', type: 'id', required: true },
    { name: 'quantity', type: 'number', required: true },
    { name: 'unitPriceCents', type: 'number', required: true },
    { name: 'order', type: 'ref', required: true, refEntityId: order },
    { name: 'product', type: 'ref', required: true, refEntityId: product },
  ]);
  b.rel(customer, order, 'has-many', 'places');
  b.rel(order, customer, 'belongs-to', 'placed by');
  b.rel(order, lineItem, 'has-many', 'contains');
  b.rel(lineItem, product, 'references', 'of product');
  return b.build();
}

/** SaaS + billing — app + API + a billing worker consuming invoice events. */
function saasArch(): ArchGraph {
  const nodes: ArchNode[] = [
    repoNode('saas-app'),
    svc('web', 'ts', 'express'),
    svc('api', 'ts', 'express'),
    svc('billing-worker', 'py', 'fastapi'),
    ds('app-db', 'postgres'),
    ds('queue', 'redis'),
    topic('invoice-created'),
  ];
  const edges: ArchEdge[] = [
    edge('e1', 'svc:web', 'svc:api', 'http', { method: 'GET', pathPattern: '/me' }),
    edge('e2', 'svc:api', 'ds:app-db', 'db_read'),
    edge('e3', 'svc:api', 'ds:app-db', 'db_write'),
    edge('e4', 'svc:api', 'topic:invoice-created', 'queue_publish', { topic: 'invoice-created' }),
    edge('e5', 'svc:billing-worker', 'topic:invoice-created', 'queue_consume', { topic: 'invoice-created' }),
    edge('e6', 'svc:billing-worker', 'ds:app-db', 'db_write'),
  ];
  return designGraph('saas-app', nodes, edges);
}

function saasDomain(): DomainModel {
  const b = new DomainBuilder('SaaS + billing');
  const account = b.entity('Account', [
    { name: 'id', type: 'id', required: true },
    { name: 'name', type: 'string', required: true },
  ]);
  const plan = b.entity('Plan', [
    { name: 'id', type: 'id', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'priceCents', type: 'number', required: true },
    { name: 'interval', type: 'string', required: true },
  ]);
  const user = b.entity('User', [
    { name: 'id', type: 'id', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'role', type: 'string' },
    { name: 'account', type: 'ref', required: true, refEntityId: account },
  ]);
  const subscription = b.entity('Subscription', [
    { name: 'id', type: 'id', required: true },
    { name: 'status', type: 'string', required: true },
    { name: 'currentPeriodEnd', type: 'date' },
    { name: 'account', type: 'ref', required: true, refEntityId: account },
    { name: 'plan', type: 'ref', required: true, refEntityId: plan },
  ]);
  const invoice = b.entity('Invoice', [
    { name: 'id', type: 'id', required: true },
    { name: 'amountCents', type: 'number', required: true },
    { name: 'paid', type: 'boolean', required: true },
    { name: 'issuedAt', type: 'date' },
    { name: 'subscription', type: 'ref', required: true, refEntityId: subscription },
  ]);
  b.rel(account, user, 'has-many', 'members');
  b.rel(account, subscription, 'has-many', 'subscribes');
  b.rel(subscription, account, 'belongs-to', 'for account');
  b.rel(subscription, plan, 'references', 'on plan');
  b.rel(subscription, invoice, 'has-many', 'billed as');
  return b.build();
}

/** Mobile + backend — a mobile client, an API, and a push-notification worker. */
function mobileArch(): ArchGraph {
  const nodes: ArchNode[] = [
    repoNode('mobile-app'),
    // The mobile client is a code location but not an HTTP framework — a language
    // hint keeps the graph warning-free without claiming a server framework.
    svc('mobile-client', 'ts'),
    svc('api', 'ts', 'express'),
    svc('push-worker', 'ts'),
    ds('app-db', 'postgres'),
    ds('cache', 'redis'),
    topic('notifications'),
  ];
  const edges: ArchEdge[] = [
    edge('e1', 'svc:mobile-client', 'svc:api', 'http', { method: 'GET', pathPattern: '/feed' }),
    edge('e2', 'svc:mobile-client', 'svc:api', 'http', { method: 'POST', pathPattern: '/posts' }),
    edge('e3', 'svc:api', 'ds:app-db', 'db_write'),
    edge('e4', 'svc:api', 'ds:cache', 'db_read'),
    edge('e5', 'svc:api', 'topic:notifications', 'queue_publish', { topic: 'notifications' }),
    edge('e6', 'svc:push-worker', 'topic:notifications', 'queue_consume', { topic: 'notifications' }),
  ];
  return designGraph('mobile-app', nodes, edges);
}

function mobileDomain(): DomainModel {
  const b = new DomainBuilder('Mobile app');
  const user = b.entity('User', [
    { name: 'id', type: 'id', required: true },
    { name: 'handle', type: 'string', required: true },
    { name: 'email', type: 'string' },
  ]);
  const device = b.entity('Device', [
    { name: 'id', type: 'id', required: true },
    { name: 'platform', type: 'string', required: true },
    { name: 'pushToken', type: 'string' },
    { name: 'user', type: 'ref', required: true, refEntityId: user },
  ]);
  const post = b.entity('Post', [
    { name: 'id', type: 'id', required: true },
    { name: 'body', type: 'string', required: true },
    { name: 'createdAt', type: 'date' },
    { name: 'author', type: 'ref', required: true, refEntityId: user },
  ]);
  const comment = b.entity('Comment', [
    { name: 'id', type: 'id', required: true },
    { name: 'body', type: 'string', required: true },
    { name: 'author', type: 'ref', required: true, refEntityId: user },
    { name: 'post', type: 'ref', required: true, refEntityId: post },
  ]);
  b.rel(user, device, 'has-many', 'devices');
  b.rel(user, post, 'has-many', 'authors');
  b.rel(post, user, 'belongs-to', 'by author');
  b.rel(post, comment, 'has-many', 'comments');
  return b.build();
}

/** Blog / content site — a rendered site fronting a small CMS API. */
function blogArch(): ArchGraph {
  const nodes: ArchNode[] = [
    repoNode('content-site'),
    svc('web', 'ts', 'express'),
    svc('cms-api', 'ts', 'express'),
    ds('content-db', 'postgres'),
  ];
  const edges: ArchEdge[] = [
    edge('e1', 'svc:web', 'svc:cms-api', 'http', { method: 'GET', pathPattern: '/posts' }),
    edge('e2', 'svc:cms-api', 'ds:content-db', 'db_read'),
    edge('e3', 'svc:cms-api', 'ds:content-db', 'db_write'),
  ];
  return designGraph('content-site', nodes, edges);
}

function blogDomain(): DomainModel {
  const b = new DomainBuilder('Content site');
  const author = b.entity('Author', [
    { name: 'id', type: 'id', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'bio', type: 'string' },
  ]);
  const category = b.entity('Category', [
    { name: 'id', type: 'id', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'slug', type: 'string', required: true },
  ]);
  const post = b.entity('Post', [
    { name: 'id', type: 'id', required: true },
    { name: 'title', type: 'string', required: true },
    { name: 'slug', type: 'string', required: true },
    { name: 'body', type: 'string', required: true },
    { name: 'publishedAt', type: 'date' },
    { name: 'author', type: 'ref', required: true, refEntityId: author },
    { name: 'category', type: 'ref', refEntityId: category },
  ]);
  const comment = b.entity('Comment', [
    { name: 'id', type: 'id', required: true },
    { name: 'body', type: 'string', required: true },
    { name: 'authorName', type: 'string' },
    { name: 'post', type: 'ref', required: true, refEntityId: post },
  ]);
  b.rel(author, post, 'has-many', 'writes');
  b.rel(category, post, 'has-many', 'groups');
  b.rel(post, author, 'belongs-to', 'by author');
  b.rel(post, comment, 'has-many', 'comments');
  return b.build();
}

/** Internal tool / CRUD — a single app server over one database. */
function internalToolArch(): ArchGraph {
  const nodes: ArchNode[] = [
    repoNode('internal-tool'),
    svc('app', 'ts', 'express'),
    ds('app-db', 'postgres'),
  ];
  const edges: ArchEdge[] = [
    edge('e1', 'svc:app', 'ds:app-db', 'db_read'),
    edge('e2', 'svc:app', 'ds:app-db', 'db_write'),
  ];
  return designGraph('internal-tool', nodes, edges);
}

function internalToolDomain(): DomainModel {
  const b = new DomainBuilder('Internal tool');
  const user = b.entity('User', [
    { name: 'id', type: 'id', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'role', type: 'string', required: true },
  ]);
  const customer = b.entity('Customer', [
    { name: 'id', type: 'id', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string' },
  ]);
  const ticket = b.entity('Ticket', [
    { name: 'id', type: 'id', required: true },
    { name: 'subject', type: 'string', required: true },
    { name: 'status', type: 'string', required: true },
    { name: 'createdAt', type: 'date' },
    { name: 'customer', type: 'ref', required: true, refEntityId: customer },
    { name: 'assignee', type: 'ref', refEntityId: user },
  ]);
  const audit = b.entity('AuditLog', [
    { name: 'id', type: 'id', required: true },
    { name: 'action', type: 'string', required: true },
    { name: 'at', type: 'date', required: true },
    { name: 'actor', type: 'ref', required: true, refEntityId: user },
  ]);
  b.rel(customer, ticket, 'has-many', 'raises');
  b.rel(user, ticket, 'has-many', 'assigned');
  b.rel(ticket, customer, 'belongs-to', 'for customer');
  b.rel(user, audit, 'has-many', 'acted');
  return b.build();
}

/** Serverless API — a function gateway + worker over a table and an event topic. */
function serverlessArch(): ArchGraph {
  const nodes: ArchNode[] = [
    repoNode('serverless-api'),
    svc('api-gateway', 'ts'),
    svc('worker-fn', 'ts'),
    ds('table', 'postgres'),
    topic('events'),
  ];
  const edges: ArchEdge[] = [
    edge('e1', 'svc:api-gateway', 'ds:table', 'db_write'),
    edge('e2', 'svc:api-gateway', 'topic:events', 'queue_publish', { topic: 'events' }),
    edge('e3', 'svc:worker-fn', 'topic:events', 'queue_consume', { topic: 'events' }),
    edge('e4', 'svc:worker-fn', 'ds:table', 'db_read'),
  ];
  return designGraph('serverless-api', nodes, edges);
}

/* ================================================================ registry === */

/**
 * The catalogue. Each entry is honest: a real, valid starting graph (and, where
 * natural, a companion domain model) — never a broken or fabricated one. Edit
 * freely after loading.
 */
export const STARTERS: readonly Starter[] = [
  {
    id: 'ecommerce',
    title: 'E-commerce marketplace',
    industry: 'Retail / marketplace',
    projectType: 'microservices',
    description:
      'Storefront, catalog, orders and payments services with an order-placed event — a starting point, edit freely.',
    buildArch: ecommerceArch,
    buildDomain: ecommerceDomain,
  },
  {
    id: 'saas-billing',
    title: 'SaaS with billing',
    industry: 'B2B SaaS',
    projectType: 'server-web',
    description:
      'App, API and a billing worker over accounts, plans and invoices — a starting point, edit freely.',
    buildArch: saasArch,
    buildDomain: saasDomain,
  },
  {
    id: 'mobile-backend',
    title: 'Mobile app + backend',
    industry: 'Consumer mobile',
    projectType: 'mobile',
    description:
      'A mobile client, an API and a push-notification worker over users, posts and devices — a starting point, edit freely.',
    buildArch: mobileArch,
    buildDomain: mobileDomain,
  },
  {
    id: 'blog-content',
    title: 'Blog / content site',
    industry: 'Media / publishing',
    projectType: 'server-web',
    description:
      'A rendered site fronting a small CMS API over authors, posts and categories — a starting point, edit freely.',
    buildArch: blogArch,
    buildDomain: blogDomain,
  },
  {
    id: 'internal-tool',
    title: 'Internal tool (CRUD)',
    industry: 'Internal / operations',
    projectType: 'monolith',
    description:
      'A single app server over one database with users, customers, tickets and an audit log — a starting point, edit freely.',
    buildArch: internalToolArch,
    buildDomain: internalToolDomain,
  },
  {
    id: 'serverless-api',
    title: 'Serverless event API',
    industry: 'Serverless / events',
    projectType: 'serverless',
    description:
      'A function gateway and worker over a table and an events topic — a starting point, edit freely.',
    buildArch: serverlessArch,
  },
];

/** Look a starter up by id (undefined when unknown). */
export function getStarter(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}
