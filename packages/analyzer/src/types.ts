/** Internal fact model shared between discovery, parsing, detectors and the joiner. */

export type Lang = 'ts' | 'js' | 'py' | 'go' | 'java';

/** A piece of a string-valued expression, after light constant evaluation. */
export type Part =
  | { t: 'lit'; v: string }
  /**
   * An environment variable, optionally with a static default
   * (`x || 'lit'`, `os.getenv('X', 'lit')`).
   *
   * `byConvention` marks the ones that were NOT read from `process.env` /
   * `os.environ` but inferred from a SCREAMING_SNAKE member access
   * (`config.API_URL`, `settings.EMAILER_URL`). That inference is safe for the
   * joiner, which only draws an edge when compose actually wires the name — and
   * unsafe for anyone asking the opposite question. On this repository it turned
   * `Number.POSITIVE_INFINITY` and an exit-code map's `EXIT.CANCELLED` into
   * environment variables, which the service-input card would have reported as
   * "read but never declared": an accusation built out of a heuristic.
   *
   * So the derivation travels with the part. A consumer may use these to CONFIRM
   * a name it already knows is declared, and must not use them to INVENT one.
   */
  | { t: 'env'; name: string; fallback?: Part[]; byConvention?: true }
  | { t: 'ref'; name: string } // reference to a module-level constant, resolved later
  | { t: 'hole' }; // dynamic — unknowable statically

export interface CallFact {
  /** callee text, e.g. "axios.get", "app.post", "r.publish" */
  callee: string;
  /** positional args, each lightly evaluated */
  args: Part[][];
  /** keyword/object args: python keyword args and JS object-literal props of arg objects */
  kwargs: Record<string, Part[]>;
  line: number;
}

export interface ClassFact {
  name: string;
  bases: string[];
  /** class-body string assignments like __tablename__ = "orders" */
  stringProps: Record<string, string>;
  line: number;
}

export interface FunctionFact {
  name: string;
  startLine: number;
  endLine: number;
  /**
   * True when the declaration binds to a receiver/instance rather than to the
   * enclosing package or module — a Go `method_declaration`, i.e. `func (e
   * *Engine) Run()`. Only Go sets it today, and only one consumer reads it:
   * Go's package-scope call resolution (buildFunctionGraph), which must never
   * resolve a bare `Run(...)` to a method, because in Go a method is only
   * reachable through its receiver. Optional so every other extractor and
   * every existing FunctionFact literal is unchanged.
   */
  method?: boolean;
}

export interface ImportFact {
  raw: string; // module specifier as written
  line: number;
  /** Local binding names this import statement names explicitly, e.g.
   * `import { a, b as c } from 'x'` -> ['a', 'c'] (the alias, since that's what
   * call sites actually reference); `from x import a, b` likewise. Undefined
   * when the statement has no symbol-level clause to read (bare `import 'x'`,
   * Go/Java package imports, unparsed CommonJS `require`) — those fall back to
   * module-granular matching same as `moduleGranular: true` below. */
  names?: string[];
  /** True for a namespace import (`import * as ns`, `from x import *`) or a
   * default import (`import x from '...'`) — genuinely module-granular: there
   * is no specific named symbol to hold the import accountable to, so callers
   * must attribute to the module and say so rather than claim a precision
   * that was never observed. */
  moduleGranular?: boolean;
}

/** A Java annotation usage (`@Foo(...)`), on a class, method, or field.
 * `args['']` holds a single positional value (e.g. `@RequestMapping("/x")`,
 * `@Value("${x}")`); named `element_value_pair`s land under their own key
 * (`@GetMapping(path = "/x")`). Array-valued arguments (`@RabbitListener(queues
 * = {"a","b"})`) are represented as multiple Parts in the same array, one per
 * element — mirroring how array-valued kwargs are already flattened for JS/Python. */
export interface AnnotationFact {
  name: string; // without the leading '@', e.g. "RestController", "GetMapping", "Value"
  args: Record<string, Part[]>;
  target: 'class' | 'method' | 'field';
  className?: string;
  fieldName?: string;
  line: number;
}

/** Where an env read sits in the expression tree — see `collectEnvReads`. */
export type EnvReadPosition =
  | 'assigned'
  | 'argument'
  | 'condition'
  | 'interpolation'
  | 'chained'
  | 'returned'
  | 'other';

/**
 * One environment-variable read, recorded WHEREVER it occurs.
 *
 * The other fact channels record a read only where they happen to look — an
 * assignment's value, a call's arguments — so a read in a condition or behind a
 * call chain had nowhere to be recorded. Measured on this repository, that was
 * 25 of the 27 env names the fact pass missed.
 */
export interface EnvRead {
  name: string;
  line: number;
  position: EnvReadPosition;
}

export interface FileFacts {
  /** repo-relative path */
  file: string;
  language: Lang;
  loc: number;
  imports: ImportFact[];
  calls: CallFact[];
  functions: FunctionFact[];
  classes: ClassFact[];
  /** module-level constant assignments */
  assignments: Map<string, Part[]>;
  parseErrors: number;
  /** raw source lines, for evidence snippets */
  lines: string[];
  /**
   * Every env read in the file, with where it sits. The service-input card reads
   * THIS rather than reconstructing reads from assignments and calls, so a read
   * is counted once and its position can be explained.
   */
  envReads: EnvRead[];
  /** Java-only: class/method/field annotation usages. Optional so other
   * languages' FileFacts shape is unaffected. */
  annotations?: AnnotationFact[];
  /**
   * Java-only (U33): declared name -> unqualified type name, for fields,
   * locals, parameters and for-each bindings. `null` marks a name the file
   * declares with two different types, which resolves to nothing rather than
   * to whichever declaration came first. Optional, so no other language's
   * `FileFacts` shape changes.
   */
  varTypes?: Map<string, string | null>;
  /**
   * Go-only (H10): the `package` clause of this file. Used to determine the
   * default import binding for unaliased imports (Go uses the declared package
   * name, not the last path segment).
   */
  goPackageName?: string;
}

export type ServiceRole = 'app' | 'datastore' | 'broker';

export interface ServiceInfo {
  name: string;
  /** repo-relative source dir (from build context); undefined for image-only services */
  dir?: string;
  image?: string;
  env: Record<string, string>;
  dependsOn: string[];
  role: ServiceRole;
  /** e.g. postgres, redis, kafka — for datastore/broker roles */
  tech?: string;
}

export type WireKind = 'http' | 'db' | 'broker' | 'addr';

/** An env var on `service` whose value points at another compose service. */
export interface Wire {
  service: string;
  envKey: string;
  value: string;
  targetService: string;
  kind: WireKind;
  /** for http/addr wires: port if present */
  port?: number;
  /** line in the manifest file where this env var is declared (approximate) */
  composeLine?: number;
  /** the manifest file that declared this wire (compose file, or a specific
   * Kubernetes/Helm manifest); joiner evidence prefers this over composeFile
   * when present, since a K8s repo has many manifest files, not one. */
  sourceFile?: string;
}

export interface Discovery {
  composeFile: string;
  services: ServiceInfo[];
  wires: Wire[];
  warnings: string[];
  /** which discovery source produced this graph. 'code' is the manifest-LESS
   * code-first path (no compose/k8s/helm) — app roots derived from package
   * manifests; see discovery/codefirst.ts. */
  manifestKind: 'compose' | 'kubernetes' | 'helm' | 'code';
  /**
   * At least one compose service declared `build.context: .` and was narrowed to
   * its Dockerfile's directory (see `narrowRootContext`). That declaration is the
   * compose file admitting the repo is BIGGER than the services it lists — which
   * is the signal that app roots outside compose should still be surfaced, so a
   * monorepo's other apps are not invisible. Absent on every ordinary compose
   * repo, which is what keeps their graphs byte-identical.
   */
  rootContextNarrowed?: boolean;
}

// ---- detector outputs ----

export interface RouteFact {
  service: string;
  method: string; // GET/POST/... or *
  path: string; // as written, e.g. /orders/{order_id} or /:id
  file: string;
  line: number;
  /** The handler argument's identifier, when the registration call passes one
   * as a plain reference (`router.get('/x', listOrders)` -> 'listOrders').
   * Undefined for annotation/decorator-style routes (the registration site IS
   * the handler already), inline anonymous handlers, or a handler expression
   * too dynamic to name (`ctrl.list`, a computed member, ...) — those keep
   * attributing to the registration site rather than guessing. */
  handlerName?: string;
  /**
   * True when the framework treats this registration as a PREFIX rather than an
   * exact path.
   *
   * Go's `net/http` ServeMux is the case that forced this: `mux.HandleFunc(
   * "/shipments/", h)` — note the trailing slash — matches every path beneath
   * `/shipments/`, which is how a Go service takes a path parameter without a
   * router. A caller asking for `/shipments/{id}` therefore DOES hit it.
   *
   * Recorded at detection time because that is the only place the framework is
   * known. A blanket "a trailing slash means prefix" rule in the joiner would be
   * wrong for Express and FastAPI, where a trailing slash is just part of the
   * path.
   */
  prefix?: boolean;
}

export interface MountFact {
  service: string;
  prefix: string;
  file: string;
  line: number;
}

export interface ClientCallFact {
  service: string;
  method?: string;
  /** URL split into parts; first lit/env part decides the host */
  url: Part[];
  file: string;
  line: number;
  snippet: string;
}

export interface QueueOpFact {
  service: string;
  op: 'publish' | 'consume';
  /** literal topic name, or skeleton with * for holes */
  topic: string;
  literal: boolean;
  file: string;
  line: number;
  snippet: string;
}

export interface TableAccessFact {
  service: string;
  table: string;
  access: 'read' | 'write' | 'unknown';
  via: 'sql' | 'orm';
  file: string;
  line: number;
  snippet: string;
}

export interface ConnectionFact {
  service: string;
  /** compose service name of the datastore/broker this code connects to */
  targetService: string;
  /** how the hostname was established */
  how: 'env-wire' | 'env-fallback' | 'literal';
  file: string;
  line: number;
  snippet: string;
}

export interface GrpcClientFact {
  service: string;
  grpcService: string; // proto service name, e.g. Inventory
  /** channel address parts if found */
  addr?: Part[];
  file: string;
  line: number;
  snippet: string;
}

export interface GrpcServerFact {
  service: string;
  grpcService: string;
  file: string;
  line: number;
  snippet: string;
}

export interface ProtoServiceFact {
  grpcService: string;
  file: string;
  line: number;
}
