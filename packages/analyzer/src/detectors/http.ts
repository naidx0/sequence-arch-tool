import type {
  AnnotationFact,
  ClientCallFact,
  FileFacts,
  MountFact,
  Part,
  RouteFact,
} from '../types.js';
import { resolveParts } from '../parse/facts.js';
import { allowlistsFor } from '../lang/packs.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all', 'options', 'head']);
// Go gin/echo: uppercase method calls, e.g. r.GET("/x", handler); "Any" -> wildcard.
// Case-sensitive Set lookups keep this from double-firing on the lowercase JS branch above.
const GO_UPPER_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
// Go fiber/chi: title-case method calls, e.g. r.Get("/x", handler).
const GO_TITLE_METHODS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch']);

/** Known HTTP client callee patterns (JS + Python + Go + Java). Java's
 * RestTemplate/WebClient methods are receiver-agnostic (any variable name) —
 * the URL-shaped-arg requirement below (isUrlShaped) is the precision gate,
 * same rationale as every other receiver-agnostic pattern in this regex.
 * The receiver is matched with `.*` rather than `\w+` for the two Java
 * alternatives: WebClient's fluent builder style chains multiple calls before
 * the one that matters (`webClientBuilder.build().get().uri(...)`), so the
 * callee's "receiver" text routinely contains its own dots/parens — verified
 * against spring-petclinic-microservices' actual api-gateway client code,
 * where a naive `\w+\.` receiver would never match (see
 * docs/SPIKE_RESULTS.md v3 P2). */
const KNOWN_CLIENT_RE =
  /^(fetch|axios(\.\w+)?|got(\.\w+)?|ky(\.\w+)?|requests\.(get|post|put|delete|patch|head|options|request)|httpx\.(get|post|put|delete|patch|request)|(\w+\.)?(client|session)\.(get|post|put|delete|patch|request)|http\.(Get|Post|Head|PostForm)|\w+\.NewRequest(WithContext)?|.*\.(getForObject|getForEntity|postForObject|postForEntity|exchange|put|delete)|.*\.uri)$/;

const JAVA_ROUTE_METHOD_ANNOTATIONS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

/** args[''] (positional) or args['path']/args['value'] (named) — the three
 * equivalent ways to spell a Spring mapping annotation's path. */
function springAnnoPath(a: AnnotationFact): string {
  const parts = a.args[''] ?? a.args['path'] ?? a.args['value'];
  return parts && parts.length === 1 && parts[0].t === 'lit' ? parts[0].v : '';
}

/** RequestMapping's `method = RequestMethod.GET` (or an array of them) comes
 * through as one-Part-per-enum-constant, each a dotted-text literal
 * ("RequestMethod.GET") — pull the trailing segment. */
function springAnnoHttpMethods(a: AnnotationFact): string[] {
  const parts = a.args['method'];
  if (!parts) return [];
  const out: string[] = [];
  for (const p of parts) {
    if (p.t === 'lit') out.push(p.v.split('.').pop()!.toUpperCase());
  }
  return out;
}

/** Spring MVC/WebFlux routes: @RestController/@Controller classes' methods
 * annotated with @GetMapping/@PostMapping/etc. or a method-level
 * @RequestMapping. A class-level @RequestMapping on a controller class sets
 * the path prefix for all of its routes — applied directly when building each
 * RouteFact's path rather than emitted as a service-wide MountFact, since the
 * prefix is per-class, not per-service. */
function detectJavaRoutes(service: string, facts: FileFacts[], routes: RouteFact[]): void {
  for (const f of facts) {
    // Annotation-based routing is a language idiom, so which annotations mark a
    // controller comes from the file's language pack rather than from a
    // `language === 'java'` branch reasoned out again in every detector. Only
    // Java's pack lists any, so this is the same gate it replaces.
    const controllerAnnotations = allowlistsFor(f.language).routeControllerAnnotations;
    if (controllerAnnotations.length === 0 || !f.annotations) continue;
    const controllerClasses = new Set(
      f.annotations
        .filter((a) => a.target === 'class' && controllerAnnotations.includes(a.name))
        .map((a) => a.className)
        .filter((c): c is string => !!c)
    );
    if (controllerClasses.size === 0) continue;
    const classPrefixes = new Map<string, string>();
    for (const a of f.annotations) {
      if (a.target === 'class' && a.name === 'RequestMapping' && a.className && controllerClasses.has(a.className)) {
        classPrefixes.set(a.className, springAnnoPath(a));
      }
    }
    for (const a of f.annotations) {
      if (a.target !== 'method' || !a.className || !controllerClasses.has(a.className)) continue;
      const prefix = classPrefixes.get(a.className) ?? '';
      const methodMapping = JAVA_ROUTE_METHOD_ANNOTATIONS[a.name];
      if (methodMapping) {
        const path = springAnnoPath(a);
        routes.push({ service, method: methodMapping, path: prefix + (path || '/'), file: f.file, line: a.line });
      } else if (a.name === 'RequestMapping') {
        const path = springAnnoPath(a);
        const fullPath = prefix + (path || '/');
        const methods = springAnnoHttpMethods(a);
        if (methods.length === 0) {
          routes.push({ service, method: '*', path: fullPath, file: f.file, line: a.line });
        } else {
          for (const m of methods) routes.push({ service, method: m, path: fullPath, file: f.file, line: a.line });
        }
      }
    }
  }
}

function firstMeaningful(parts: Part[]): Part | undefined {
  return parts.find((p) => !(p.t === 'lit' && p.v === ''));
}

function isUrlShaped(parts: Part[], knownClient: boolean, sameOriginOk = false): boolean {
  const first = firstMeaningful(parts);
  if (!first) return false;
  if (first.t === 'lit' && /^https?:\/\//.test(first.v)) return true;
  if (first.t === 'env') {
    if (knownClient) return true;
    // generic callee: require a literal path segment after the env base to
    // avoid counting things like create_engine(DATABASE_URL)
    return parts.some((p, i) => i > 0 && p.t === 'lit' && p.v.startsWith('/'));
  }
  /*
   * A RELATIVE PATH IS A URL WHEN THE FILE DEMONSTRABLY CALLS OUT.
   *
   * This accepted exactly two shapes — an `http(s)://` literal or an env var —
   * so `'/api/items'` was not URL-shaped and produced no fact at all. That is
   * the commonest way a browser app talks to its own server.
   *
   * Real frontends also do not hand `fetch` a literal; they funnel through a
   * helper. Measured verbatim in ml-harness: `fetch(base.url + path)` at
   * client.ts:153 and `getJson('/api/recipes')` at :278. The fetch has no
   * literal path, the literal path is not at a fetch, so neither half was
   * URL-shaped alone and a two-tier repo drew nothing.
   *
   * `sameOriginOk` is the first of two guards: the caller sets it only for a
   * file containing a real known client call at a real line, so a module that
   * merely passes '/tmp/x' to something cannot make an edge. The second guard is
   * in the joiner — the path must match a route another service registered.
   *
   * `//host/path` is protocol-relative and names a DIFFERENT origin, so it is
   * excluded here rather than silently treated as same-origin.
   */
  if (sameOriginOk && first.t === 'lit' && first.v.startsWith('/') && !first.v.startsWith('//')) {
    return true;
  }
  return false;
}

function methodFromCalleeName(callee: string): string | undefined {
  const last = callee.split('.').pop() ?? callee;
  const m = last.toLowerCase().match(/^(get|post|put|delete|patch|head|options)/);
  return m ? m[1].toUpperCase() : undefined;
}

/** The route registration's handler argument (`router.get('/x', listOrders)`
 * -> 'listOrders'), read from the RAW (unresolved) positional arg so a plain
 * identifier reference survives — `resolveParts` collapses an unresolved
 * `ref` to a hole, which is right for URL building but would erase the one
 * thing we need here: the name to go find the real handler function by.
 * Anything other than a bare identifier (an inline function, a member
 * expression like `ctrl.list`, a computed value) is intentionally left
 * unresolved rather than guessed at — the caller degrades to the
 * registration site and says so. */
function handlerRefName(call: { args: Part[][] }): string | undefined {
  const arg = call.args[1];
  return arg && arg.length === 1 && arg[0].t === 'ref' ? arg[0].name : undefined;
}

export function detectHttp(
  service: string,
  facts: FileFacts[]
): { routes: RouteFact[]; mounts: MountFact[]; clients: ClientCallFact[] } {
  const routes: RouteFact[] = [];
  const mounts: MountFact[] = [];
  const clients: ClientCallFact[] = [];

  detectJavaRoutes(service, facts, routes);

  for (const f of facts) {
    /* Does this file actually call out? One real known client call at a real
     * line is what licenses a bare relative literal here to count as a URL. */
    const fileCallsOut = f.calls.some((c) => KNOWN_CLIENT_RE.test(c.callee));
    const snippet = (line: number) => (f.lines[line - 1] ?? '').trim().slice(0, 200);

    for (const call of f.calls) {
      const calleeParts = call.callee.split('.');
      const lastSeg = calleeParts[calleeParts.length - 1];
      const arg0 = call.args[0] ? resolveParts(call.args[0], f.assignments) : undefined;
      const arg0Lit =
        arg0 && arg0.length === 1 && arg0[0].t === 'lit' ? arg0[0].v : undefined;

      // ---- routes ----
      if (
        calleeParts.length === 2 &&
        HTTP_METHODS.has(lastSeg) &&
        arg0Lit !== undefined &&
        arg0Lit.startsWith('/')
      ) {
        // could be a route (app.get('/x', handler)) or a client (client.get('/x'))
        // client objects usually have base URLs; route receivers get a handler arg.
        // Heuristic: routes in JS have >=2 args (path, handler) or are decorator
        // calls in Python (0 extra args). Client calls on relative paths without a
        // wired base are dropped later anyway, so prefer route interpretation.
        routes.push({
          service,
          method: lastSeg === 'all' ? '*' : lastSeg.toUpperCase(),
          path: arg0Lit,
          file: f.file,
          line: call.line,
          handlerName: handlerRefName(call),
        });
        continue;
      }

      // Go gin/echo: r.GET("/x", handler) / r.Any("/x", handler)
      if (
        calleeParts.length === 2 &&
        (GO_UPPER_METHODS.has(lastSeg) || lastSeg === 'Any') &&
        arg0Lit !== undefined &&
        arg0Lit.startsWith('/')
      ) {
        routes.push({
          service,
          method: lastSeg === 'Any' ? '*' : lastSeg,
          path: arg0Lit,
          file: f.file,
          line: call.line,
          handlerName: handlerRefName(call),
        });
        continue;
      }

      // Go fiber/chi: r.Get("/x", handler)
      if (
        calleeParts.length === 2 &&
        GO_TITLE_METHODS.has(lastSeg) &&
        arg0Lit !== undefined &&
        arg0Lit.startsWith('/')
      ) {
        routes.push({
          service,
          method: lastSeg.toUpperCase(),
          path: arg0Lit,
          file: f.file,
          line: call.line,
          handlerName: handlerRefName(call),
        });
        continue;
      }

      // Go net/http: http.HandleFunc / mux.HandleFunc / mux.Handle
      if (
        (lastSeg === 'HandleFunc' || lastSeg === 'Handle') &&
        arg0Lit !== undefined &&
        arg0Lit.startsWith('/')
      ) {
        routes.push({
          service,
          method: '*',
          path: arg0Lit,
          /*
           * A TRAILING SLASH IN ServeMux IS A SUBTREE, NOT A PATH.
           *
           * `mux.HandleFunc("/shipments/", h)` matches everything under
           * /shipments/ — it is how a Go service takes a path parameter with no
           * router. Without this the gateway's call to /shipments/:id matched no
           * route, and the edge degraded to the service with confidence 0.75 and
           * `matchedRoute: null` while every other edge in the same fixture
           * matched a FILE at 0.95. The next feature to read that signal would
           * have reported a dangling route that is not dangling.
           */
          prefix: arg0Lit.endsWith('/') && arg0Lit !== '/',
          file: f.file,
          line: call.line,
          handlerName: handlerRefName(call),
        });
        continue;
      }

      // Go router groups: r.Group("/prefix")
      if (lastSeg === 'Group' && arg0Lit !== undefined && arg0Lit.startsWith('/')) {
        mounts.push({ service, prefix: arg0Lit, file: f.file, line: call.line });
        continue;
      }

      // flask style: app.route('/x', methods=['GET','POST'])
      if (lastSeg === 'route' && arg0Lit !== undefined && arg0Lit.startsWith('/')) {
        const methods = call.kwargs['methods'];
        const list =
          methods && methods.length > 0
            ? methods.filter((p) => p.t === 'lit').map((p) => (p as { v: string }).v)
            : ['GET'];
        for (const m of list) {
          routes.push({ service, method: m.toUpperCase(), path: arg0Lit, file: f.file, line: call.line });
        }
        continue;
      }

      // express mounts: app.use('/prefix', router); fastapi: include_router(r, prefix="/x")
      if (lastSeg === 'use' && arg0Lit !== undefined && arg0Lit.startsWith('/')) {
        mounts.push({ service, prefix: arg0Lit, file: f.file, line: call.line });
        continue;
      }
      if (lastSeg === 'include_router') {
        const prefix = call.kwargs['prefix'];
        const lit = prefix && prefix.length === 1 && prefix[0].t === 'lit' ? prefix[0].v : undefined;
        if (lit) mounts.push({ service, prefix: lit, file: f.file, line: call.line });
        continue;
      }

      // ---- clients ----
      const known = KNOWN_CLIENT_RE.test(call.callee);
      // find the URL argument: first arg whose resolved parts are URL-shaped
      let urlParts: Part[] | undefined;
      for (const rawArg of call.args) {
        const resolved = resolveParts(rawArg, f.assignments);
        if (isUrlShaped(resolved, known, fileCallsOut)) {
          urlParts = resolved;
          break;
        }
      }
      // proxy/client config objects: createProxyMiddleware({target}), axios({baseURL/url})
      if (!urlParts) {
        for (const key of ['target', 'baseURL', 'url']) {
          const kw = call.kwargs[key];
          if (kw) {
            const resolved = resolveParts(kw, f.assignments);
            if (isUrlShaped(resolved, true)) {
              urlParts = resolved;
              break;
            }
          }
        }
      }
      if (!urlParts) continue;

      let method: string | undefined;
      const kwMethod = call.kwargs['method'];
      if (/(^|\.)NewRequest(WithContext)?$/.test(call.callee) && arg0Lit) {
        // Go: http.NewRequest(method, url, body) / NewRequestWithContext(ctx, method, url, body)
        method = arg0Lit.toUpperCase();
      } else if (kwMethod && kwMethod.length === 1 && kwMethod[0].t === 'lit') {
        method = (kwMethod[0] as { v: string }).v.toUpperCase();
      } else if (known && call.callee !== 'fetch') {
        method = methodFromCalleeName(call.callee);
      } else if (call.callee === 'fetch') {
        method = 'GET';
      } else {
        method = methodFromCalleeName(call.callee);
      }

      clients.push({
        service,
        method,
        url: urlParts,
        file: f.file,
        line: call.line,
        snippet: snippet(call.line),
      });
    }
  }
  return { routes, mounts, clients };
}
