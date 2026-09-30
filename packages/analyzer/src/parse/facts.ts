import type { AnnotationFact, CallFact, ClassFact, EnvRead, EnvReadPosition, FileFacts, FunctionFact, ImportFact, Lang, Part } from '../types.js';
import { parseSource, walk, type TSNode, type TSTree } from './treesitter.js';
import { bump } from './profile.js';

const MAX_CALLEE_LEN = 80;

function unquote(s: string): string {
  return s.replace(/^["'`]|["'`]$/g, '');
}

/**
 * Unquote a PYTHON string literal, stripping its prefix first.
 *
 * `b"X"`, `r'X'`, `rb"X"`, `f"X"` — the prefix sits OUTSIDE the quotes, so it
 * has to go before {@link unquote} sees the value, not after.
 *
 * DOING IT AFTER CORRUPTED EVERY NAME BEGINNING WITH ONE OF THOSE LETTERS. The
 * previous form was `unquote(text).replace(/^[bframBFRAM]*​/, '')`, applied to
 * the already-unquoted name, and measured on the shopfront fixture it produced:
 *
 *     os.environ["REDIS_URL"]     -> EDIS_URL
 *     os.environ["MY_VAR"]        -> Y_VAR
 *     os.environ["API_KEY"]       -> PI_KEY
 *     os.environ[b"REDIS_URL"]    -> "REDIS_URL   (the case it was written for)
 *
 * So a Python service reading REDIS_URL declared REDIS_URL in compose looked
 * like a service reading something else entirely: a declared input with no
 * reader AND an undeclared read, from one typo-shaped bug. It also never fixed
 * the prefixed form it existed for.
 *
 * The lookahead is what makes it safe: letters are removed only when a quote
 * follows them, so a bare name is never touched.
 */
function unquotePy(s: string): string {
  return unquote(s.replace(/^[brufBRUF]{1,3}(?=["'])/, ''));
}

/** Parse a JS/TS `import_clause` node into the symbol-granular shape
 * `ImportFact` needs: the local binding names a `{ a, b as c }` clause
 * actually names (callers reference the alias, so that's what we collect),
 * plus whether a namespace/default binding is also present — those are
 * inherently module-granular (no single named export to hold accountable),
 * so the caller must fall back to whole-module matching and say so rather
 * than pretend a `{ a, b }` clause's precision applies to them too.
 * Verified against the real tree shape (`namespace_import` wraps its own
 * `identifier`; `named_imports` -> `import_specifier` with 1 child for a bare
 * name or 2 for `name as alias`, second child is the local alias). */
function parseJsImportClause(clause: TSNode): { names: string[]; moduleGranular: boolean } {
  const names: string[] = [];
  let moduleGranular = false;
  for (let i = 0; i < clause.namedChildCount; i++) {
    const c = clause.namedChild(i)!;
    if (c.type === 'identifier') {
      moduleGranular = true; // default import binding
    } else if (c.type === 'namespace_import') {
      moduleGranular = true;
    } else if (c.type === 'named_imports') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const spec = c.namedChild(j)!;
        if (spec.type !== 'import_specifier') continue;
        const local = spec.namedChildCount > 1 ? spec.namedChild(1) : spec.namedChild(0);
        if (local) names.push(local.text);
      }
    }
  }
  return { names, moduleGranular };
}

/** Parse a Python `import_from_statement`'s name children (everything after
 * the module's own `dotted_name`) into the same symbol-granular shape: named
 * children (`dotted_name`, `aliased_import`) become `names` (alias when
 * present, since that's the local binding calls use); a `wildcard_import`
 * (`from x import *`) is module-granular, same rationale as a JS namespace
 * import — there is no single symbol to hold accountable. */
function parsePyFromImportNames(stmt: TSNode): { names: string[]; moduleGranular: boolean } {
  const names: string[] = [];
  let moduleGranular = false;
  for (let i = 1; i < stmt.namedChildCount; i++) {
    const c = stmt.namedChild(i)!;
    if (c.type === 'wildcard_import') {
      moduleGranular = true;
    } else if (c.type === 'aliased_import') {
      const alias = c.namedChildCount > 1 ? c.namedChild(1) : c.namedChild(0);
      if (alias) names.push(alias.text);
    } else if (c.type === 'dotted_name') {
      names.push(c.text);
    }
  }
  return { names, moduleGranular };
}

// ---------- expression evaluation (light constant folding) ----------

/**
 * The shape an environment variable's name has by convention: SCREAMING_SNAKE,
 * three characters or more. The floor is not cosmetic — a two-letter name
 * matches half the identifiers in any file, and this convention is the only
 * thing separating `{ PORT }` from `{ id }` in a destructuring pattern.
 */
const ENV_NAME_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/;

function evalJs(node: TSNode): Part[] {
  switch (node.type) {
    case 'string': {
      let out = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === 'string_fragment') out += c.text;
      }
      return [{ t: 'lit', v: out }];
    }
    case 'ternary_expression': {
      /*
       * `process.env.X ? 'a' : 'b'` — the env read is the CONDITION, and it was
       * being thrown away with the branches.
       *
       * Measured on Hoppscotch: `envPrefix: process.env.HOPP_ALLOW_RUNTIME_ENV
       * ? 'VITE_BUILDTIME_' : 'VITE_'` in two vite configs, which made the
       * service-input card accuse six services of never reading a variable read
       * on line 24 of a file it had parsed.
       *
       * Only env parts come back, and a hole otherwise — for the same reason as
       * the object case above. A ternary evaluates to ONE of its branches, so
       * handing both to the URL and host detectors would reconstruct a string
       * that never existed.
       */
      const found: Part[] = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        for (const part of evalJs(node.namedChild(i)!)) if (part.t === 'env') found.push(part);
      }
      return found.length > 0 ? found : [{ t: 'hole' }];
    }
    case 'object': {
      /*
       * DESCEND FOR ENV READS ONLY, and return a hole when there are none.
       *
       * extractCallJs already lifts a TOP-LEVEL object argument into kwargs, so
       * `f({ k: process.env.X })` was visible. A NESTED one was not: the kwarg's
       * value is evaluated by this function, and with no `object` case it came
       * back a bare hole. Measured on the shopfront fixture, that hid
       * `headers: { authorization: \`Bearer ${process.env.STRIPE_KEY}\` }` —
       * one level down from an argument that was already being read correctly.
       *
       * ONLY the env parts come back, never the object's other values. The Part
       * stream is reassembled into strings by the URL and host detectors, so
       * returning an object's literals would let `{ path: '/x' }` contribute to
       * a reconstructed URL that never existed. An env read is safe to surface
       * because it names a variable rather than supplying a fragment, and a hole
       * is still the answer when the object holds none — an object is not a
       * string and must not start looking like one.
       */
      const found: Part[] = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)!;
        const v = c.type === 'pair' ? c.childForFieldName('value') : null;
        if (v) for (const part of evalJs(v)) if (part.t === 'env') found.push(part);
      }
      return found.length > 0 ? found : [{ t: 'hole' }];
    }
    case 'template_string': {
      const parts: Part[] = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)!;
        if (c.type === 'string_fragment') parts.push({ t: 'lit', v: c.text });
        else if (c.type === 'template_substitution') {
          const inner = c.namedChild(0);
          parts.push(...(inner ? evalJs(inner) : [{ t: 'hole' } as Part]));
        }
      }
      return parts;
    }
    case 'member_expression': {
      const m = node.text.match(/^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/);
      if (m) return [{ t: 'env', name: m[1] }];
      // convention: config.API_URL / settings.EMAILER_URL — SCREAMING_SNAKE members
      // of config objects mirror env var names. Safe because the joiner only
      // creates edges for names actually wired in compose.
      const cfg = node.text.match(/^[\w.$]+\.([A-Z][A-Z0-9_]{2,})$/);
      // `byConvention` because this is an INFERENCE, not a read. See the Part
      // type: it is enough to confirm a declared name, never to invent one.
      if (cfg) return [{ t: 'env', name: cfg[1], byConvention: true }];
      // @grpc/grpc-js server registration idiom:
      // `server.addService(shopProto.CurrencyService.service, {...})`, or the
      // two-step form `const service = pkg.CurrencyService.service; ...
      // addService(service, impls)`. detectGrpc (detectors/grpc.ts) needs the
      // literal *shape* of this member-expression (the identifier just before
      // the trailing `.service`), not an evaluated runtime value — there's no
      // separate "raw text" carrier on CallFact/Part, and adding one would mean
      // reworking the Part model for every language. The narrowest fix: fold
      // the member-expression's own text into a literal Part here, gated tight
      // enough (must literally end in `.service`, capped length) that it can't
      // leak into ordinary URL/host-part resolution — no real hostname or URL
      // path ends in a bare ".service" member access. This also makes the
      // two-step assignment form work for free: the `const service = ...`
      // declarator binds this same literal into `assignments`, so
      // resolveParts() on the later `addService(service, ...)` call's
      // `{t:'ref', name:'service'}` arg resolves right back to it.
      if (node.text.length < 120 && /\.service$/.test(node.text)) return [{ t: 'lit', v: node.text }];
      return [{ t: 'hole' }];
    }
    case 'subscript_expression': {
      const obj = node.childForFieldName('object');
      const idx = node.childForFieldName('index');
      if (obj?.text === 'process.env' && idx?.type === 'string') {
        return [{ t: 'env', name: unquote(idx.text) }];
      }
      return [{ t: 'hole' }];
    }
    case 'identifier':
      return [{ t: 'ref', name: node.text }];
    case 'non_null_expression':
    case 'parenthesized_expression':
    case 'await_expression':
    case 'as_expression':
    case 'satisfies_expression': {
      const inner = node.namedChild(0);
      return inner ? evalJs(inner) : [{ t: 'hole' }];
    }
    case 'binary_expression': {
      const op = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (op?.text === '+' && left && right) return [...evalJs(left), ...evalJs(right)];
      // env-with-default: process.env.X || 'fallback' / ?? 'fallback'
      if ((op?.text === '||' || op?.text === '??') && left && right) {
        const l = evalJs(left);
        if (l.length === 1 && l[0].t === 'env') {
          return [{ t: 'env', name: l[0].name, fallback: evalJs(right) }];
        }
        return l; // best effort: assume left when it's static
      }
      return [{ t: 'hole' }];
    }
    default:
      return [{ t: 'hole' }];
  }
}

function evalPy(node: TSNode): Part[] {
  switch (node.type) {
    case 'string': {
      const parts: Part[] = [];
      let hasInterp = false;
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)!;
        if (c.type === 'string_content') parts.push({ t: 'lit', v: c.text });
        else if (c.type === 'interpolation') {
          hasInterp = true;
          const inner = c.namedChild(0);
          parts.push(...(inner ? evalPy(inner) : [{ t: 'hole' } as Part]));
        }
      }
      if (!hasInterp) {
        return [{ t: 'lit', v: parts.map((p) => (p.t === 'lit' ? p.v : '')).join('') }];
      }
      return parts;
    }
    case 'concatenated_string': {
      const parts: Part[] = [];
      for (let i = 0; i < node.namedChildCount; i++) parts.push(...evalPy(node.namedChild(i)!));
      return parts;
    }
    case 'subscript': {
      const value = node.childForFieldName('value');
      const sub = node.childForFieldName('subscript');
      if (value?.text === 'os.environ' && sub?.type === 'string') {
        return [{ t: 'env', name: unquotePy(sub.text) }];
      }
      return [{ t: 'hole' }];
    }
    case 'call': {
      const fn = node.childForFieldName('function');
      const fnText = fn?.text;
      const argsNode = node.childForFieldName('arguments');
      if (fnText === 'os.getenv' || fnText === 'os.environ.get') {
        const a0 = argsNode?.namedChild(0);
        const a1 = argsNode?.namedChild(1);
        if (a0?.type === 'string') {
          return [
            {
              t: 'env',
              name: unquotePy(a0.text),
              fallback: a1 ? evalPy(a1) : undefined,
            },
          ];
        }
      }
      // "http://{user}:8080/x".format(user=USER) — interpolate placeholders
      if (fn?.type === 'attribute' && fnText?.endsWith('.format')) {
        const receiver = fn.childForFieldName('object');
        if (receiver?.type === 'string') {
          const template = evalPy(receiver);
          if (template.length === 1 && template[0].t === 'lit') {
            const kw = new Map<string, Part[]>();
            const pos: Part[][] = [];
            if (argsNode) {
              for (let i = 0; i < argsNode.namedChildCount; i++) {
                const a = argsNode.namedChild(i)!;
                if (a.type === 'keyword_argument') {
                  const name = a.childForFieldName('name')?.text;
                  const value = a.childForFieldName('value');
                  if (name && value) kw.set(name, evalPy(value));
                } else {
                  pos.push(evalPy(a));
                }
              }
            }
            const parts: Part[] = [];
            let posIdx = 0;
            const re = /\{(\w*)(?:![sr])?(?::[^}]*)?\}/g;
            let last = 0;
            const s = template[0].v;
            for (const m of s.matchAll(re)) {
              if (m.index! > last) parts.push({ t: 'lit', v: s.slice(last, m.index) });
              const filler = m[1] ? kw.get(m[1]) : pos[posIdx++];
              parts.push(...(filler ?? [{ t: 'hole' } as Part]));
              last = m.index! + m[0].length;
            }
            if (last < s.length) parts.push({ t: 'lit', v: s.slice(last) });
            return parts;
          }
        }
      }
      return [{ t: 'hole' }];
    }
    case 'identifier':
      return [{ t: 'ref', name: node.text }];
    case 'parenthesized_expression': {
      const inner = node.namedChild(0);
      return inner ? evalPy(inner) : [{ t: 'hole' }];
    }
    case 'binary_operator': {
      const op = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (op?.text === '+' && left && right) return [...evalPy(left), ...evalPy(right)];
      return [{ t: 'hole' }];
    }
    case 'boolean_operator': {
      // env-with-default: os.environ.get("X") or "fallback"
      const op = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (op?.text === 'or' && left && right) {
        const l = evalPy(left);
        if (l.length === 1 && l[0].t === 'env') {
          return [{ t: 'env', name: l[0].name, fallback: evalPy(right) }];
        }
        return l;
      }
      return [{ t: 'hole' }];
    }
    default:
      return [{ t: 'hole' }];
  }
}

// tree-sitter-go field reference (verified against the actual grammar, not just
// docs — some fields differ from naive guesses):
//  import_spec: field `name` (alias, optional), field `path` (string literal)
//  var_spec/const_spec: field `name` (identifier), field `value` (an
//    expression_list wrapping the real value — NOT the value node directly)
//  short_var_declaration: field `left`/`right`, both expression_list
//  call_expression: field `function`, field `arguments` (argument_list)
//  selector_expression: field `operand`, field `field` (field_identifier)
//  composite_literal: field `type`, field `body` (literal_value)
//  keyed_element: field `key`/`value`, each wrapping a `literal_element` whose
//    only child is the real key/value node
//  unary_expression (&x): field `operand`, field `operator`
//  binary_expression: field `left`, `operator`, `right`
function evalGo(node: TSNode): Part[] {
  switch (node.type) {
    case 'interpreted_string_literal': {
      let out = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === 'interpreted_string_literal_content') out += c.text;
      }
      return [{ t: 'lit', v: out }];
    }
    case 'raw_string_literal': {
      let out = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === 'raw_string_literal_content') out += c.text;
      }
      return [{ t: 'lit', v: out }];
    }
    case 'identifier':
      return [{ t: 'ref', name: node.text }];
    case 'parenthesized_expression': {
      const inner = node.namedChild(0);
      return inner ? evalGo(inner) : [{ t: 'hole' }];
    }
    case 'binary_expression': {
      const op = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (op?.text === '+' && left && right) return [...evalGo(left), ...evalGo(right)];
      return [{ t: 'hole' }];
    }
    case 'call_expression': {
      const fn = node.childForFieldName('function');
      const fnText = fn?.text;
      const argsNode = node.childForFieldName('arguments');
      if (fnText === 'os.Getenv') {
        const a0 = argsNode?.namedChild(0);
        if (a0) {
          const lit = evalGo(a0);
          if (lit.length === 1 && lit[0].t === 'lit') return [{ t: 'env', name: lit[0].v }];
        }
        return [{ t: 'hole' }];
      }
      // fmt.Sprintf(tpl, args...) — interpolate %s|%d|%v|%q positionally;
      // unknown verbs still consume an arg (real printf semantics) but yield a hole.
      if (fnText === 'fmt.Sprintf') {
        const a0 = argsNode?.namedChild(0);
        const tpl = a0 ? evalGo(a0) : undefined;
        if (tpl && tpl.length === 1 && tpl[0].t === 'lit') {
          const rest: TSNode[] = [];
          if (argsNode) {
            for (let i = 1; i < argsNode.namedChildCount; i++) rest.push(argsNode.namedChild(i)!);
          }
          const s = tpl[0].v;
          const parts: Part[] = [];
          const re = /%[-+#0 ]*\d*(?:\.\d+)?([a-zA-Z%])/g;
          let last = 0;
          let ri = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(s))) {
            if (m.index > last) parts.push({ t: 'lit', v: s.slice(last, m.index) });
            const verb = m[1];
            if (verb === '%') {
              parts.push({ t: 'lit', v: '%' });
            } else {
              const argNode = rest[ri++];
              if (verb === 's' || verb === 'd' || verb === 'v' || verb === 'q') {
                parts.push(...(argNode ? evalGo(argNode) : [{ t: 'hole' } as Part]));
              } else {
                parts.push({ t: 'hole' });
              }
            }
            last = m.index + m[0].length;
          }
          if (last < s.length) parts.push({ t: 'lit', v: s.slice(last) });
          return parts;
        }
        return [{ t: 'hole' }];
      }
      return [{ t: 'hole' }];
    }
    case 'selector_expression':
      return [{ t: 'hole' }];
    default:
      return [{ t: 'hole' }];
  }
}

// tree-sitter-java field reference (verified against the actual grammar via
// scratch parse scripts, not assumed — see docs/SPIKE_RESULTS.md v3 P2 note):
//  string_literal: wraps `string_fragment` children, same shape as JS `string`.
//  method_invocation: field `object` (optional — absent for a bare/instance-
//    scoped call), field `name` (identifier, the method name, NOT part of a
//    combined "function" field like JS/Go), field `arguments` (argument_list).
//  binary_expression: field `left`/`operator`/`right`, same as JS/Go.
//  parenthesized_expression: no named fields — the inner expression is
//    namedChild(0), same as every other language here.
//  field_declaration/local_variable_declaration: field `type`, but the
//    declared name+initializer live on a `variable_declarator` child (field
//    `declarator` gives only the FIRST one — multi-declarator lines like
//    `private String a, b;` need to walk namedChildren for all of them).
//    variable_declarator: field `name` (identifier), field `value` (present
//    only when initialized).
//  class_declaration: field `name`, field `superclass` (wraps `extends` +
//    the actual type node as its only child), field `interfaces` (wraps
//    `implements` + a `type_list` of type nodes).
//  annotation/marker_annotation: field `name` (identifier, WITHOUT the `@`).
//    `annotation` (not `marker_annotation`) additionally has field
//    `arguments` (`annotation_argument_list`), whose children are either a
//    single non-pair node (positional value, e.g. `@Value("${x}")`) or one
//    or more `element_value_pair`s (`@GetMapping(path = "/x")`) — a pair's
//    KEY is namedChild(0), NOT a named field (only `value` is a named field
//    on element_value_pair — verified; naive assumption would have been wrong).
//  Neither class_declaration/method_declaration/field_declaration expose a
//    `modifiers` FIELD — the modifiers node (holding annotations + keywords
//    like `public`/`static`) is always namedChild(0) when present.
function evalJava(node: TSNode): Part[] {
  switch (node.type) {
    case 'string_literal': {
      let out = '';
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === 'string_fragment') out += c.text;
      }
      return [{ t: 'lit', v: out }];
    }
    case 'identifier':
      return [{ t: 'ref', name: node.text }];
    case 'parenthesized_expression': {
      const inner = node.namedChild(0);
      return inner ? evalJava(inner) : [{ t: 'hole' }];
    }
    case 'binary_expression': {
      const op = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (op?.text === '+' && left && right) return [...evalJava(left), ...evalJava(right)];
      return [{ t: 'hole' }];
    }
    case 'method_invocation': {
      const obj = node.childForFieldName('object');
      const nameNode = node.childForFieldName('name');
      const argsNode = node.childForFieldName('arguments');
      const calleeText = obj ? `${obj.text}.${nameNode?.text ?? ''}` : (nameNode?.text ?? '');
      // System.getenv("X") — the documented convention — AND a receiver-agnostic
      // "getenv(key[, default])" wrapper, since real code doesn't always call
      // System.getenv directly: robot-shop's shipping service (see
      // docs/SPIKE_RESULTS.md v3 P2) defines a private `getenv(key, def)`
      // instance method that wraps `System.getenv(key)` with a Java-idiomatic
      // default, exactly like Python's `os.getenv(key, default)` — this is the
      // same class of heuristic already applied there, just for Java's lack of
      // a builtin two-arg getenv.
      if (/(?:^|\.)getenv$/.test(calleeText)) {
        const a0 = argsNode?.namedChild(0);
        const a1 = argsNode?.namedChild(1);
        if (a0) {
          const nameLit = evalJava(a0);
          if (nameLit.length === 1 && nameLit[0].t === 'lit') {
            return [{ t: 'env', name: nameLit[0].v, fallback: a1 ? evalJava(a1) : undefined }];
          }
        }
        return [{ t: 'hole' }];
      }
      // String.format(tpl, args...) — %s (and other consuming verbs) positional
      // interpolation, mirroring Go's fmt.Sprintf handling: unrecognized verbs
      // still consume an argument (real format semantics) but yield a hole.
      if (calleeText === 'String.format') {
        const a0 = argsNode?.namedChild(0);
        const tpl = a0 ? evalJava(a0) : undefined;
        if (tpl && tpl.length === 1 && tpl[0].t === 'lit') {
          const rest: TSNode[] = [];
          if (argsNode) {
            for (let i = 1; i < argsNode.namedChildCount; i++) rest.push(argsNode.namedChild(i)!);
          }
          const s = tpl[0].v;
          const parts: Part[] = [];
          const re = /%[-#+ 0,(]*\d*(?:\.\d+)?([a-zA-Z%])/g;
          let last = 0;
          let ri = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(s))) {
            if (m.index > last) parts.push({ t: 'lit', v: s.slice(last, m.index) });
            const verb = m[1];
            if (verb === '%') {
              parts.push({ t: 'lit', v: '%' });
            } else if (verb === 'n') {
              parts.push({ t: 'lit', v: '\n' });
            } else {
              const argNode = rest[ri++];
              if (verb === 's' || verb === 'S' || verb === 'd') {
                parts.push(...(argNode ? evalJava(argNode) : [{ t: 'hole' } as Part]));
              } else {
                parts.push({ t: 'hole' });
              }
            }
            last = m.index + m[0].length;
          }
          if (last < s.length) parts.push({ t: 'lit', v: s.slice(last) });
          return parts;
        }
        return [{ t: 'hole' }];
      }
      return [{ t: 'hole' }];
    }
    default:
      return [{ t: 'hole' }];
  }
}

/** Evaluate a Java annotation `element_value_pair`/positional value. Distinct
 * from evalJava because annotation values have their own shapes: a string
 * literal (the common case), an array initializer (flattened to one Part per
 * element, mirroring how array-valued kwargs are already flattened for JS/Python
 * — see extractCallJs/extractCallPy), or an enum constant reference
 * (`RequestMethod.GET`, a `field_access`) rendered as its full dotted text so
 * callers can pull the trailing segment. */
function evalAnnotationArg(node: TSNode): Part[] {
  if (node.type === 'element_value_array_initializer') {
    const elems: Part[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const ev = evalAnnotationArg(node.namedChild(i)!);
      if (ev.length === 1 && ev[0].t === 'lit') elems.push(ev[0]);
    }
    return elems;
  }
  if (node.type === 'field_access') return [{ t: 'lit', v: node.text }];
  return evalJava(node);
}

const JAVA_VALUE_PLACEHOLDER = /^\$\{([^:}]+)(?::(.*))?\}$/;

/** Spring relaxed binding: `cart.endpoint` <-> `CART_ENDPOINT` (uppercase,
 * `.`/`-` -> `_`). Used to bind a `@Value("${some.prop:default}")`-annotated
 * field to the env var Spring itself would resolve it from — exported for
 * `detectors/springconfig.ts`, which applies the exact same convention to
 * `${prop:default}` placeholders found inside application.properties/yml
 * values. */
export function relaxedBinding(prop: string): string {
  return prop.toUpperCase().replace(/[.-]/g, '_');
}

/** Extract annotation usages from a `modifiers` node (the always-namedChild(0)
 * holder of both annotations and keyword modifiers on a class/method/field
 * declaration — see the field-reference note above evalJava). */
function extractAnnotationsFromModifiers(
  modifiers: TSNode | null | undefined,
  target: AnnotationFact['target'],
  className: string | undefined,
  fieldName: string | undefined,
  out: AnnotationFact[]
): void {
  if (!modifiers || modifiers.type !== 'modifiers') return;
  for (let i = 0; i < modifiers.namedChildCount; i++) {
    const n = modifiers.namedChild(i)!;
    if (n.type !== 'annotation' && n.type !== 'marker_annotation') continue;
    const nameNode = n.childForFieldName('name');
    if (!nameNode) continue;
    const args: Record<string, Part[]> = {};
    if (n.type === 'annotation') {
      const argList = n.childForFieldName('arguments');
      if (argList) {
        for (let j = 0; j < argList.namedChildCount; j++) {
          const a = argList.namedChild(j)!;
          if (a.type === 'element_value_pair') {
            const keyNode = a.namedChild(0); // NOT a named field — verified
            const valNode = a.childForFieldName('value');
            const key = keyNode?.text;
            if (key && valNode) args[key] = evalAnnotationArg(valNode);
          } else {
            args[''] = evalAnnotationArg(a);
          }
        }
      }
    }
    out.push({ name: nameNode.text, args, target, className, fieldName, line: n.startPosition.row + 1 });
  }
}

/** Walk up from any node to the class_declaration it's lexically inside, for
 * attributing method-level annotations to their enclosing class without a
 * separate scope-tracking traversal. */
function enclosingClassName(node: TSNode): string | undefined {
  let cur: TSNode | null = node.parent;
  while (cur) {
    if (cur.type === 'class_declaration') return cur.childForFieldName('name')?.text;
    cur = cur.parent;
  }
  return undefined;
}

function extractCallJava(node: TSNode, calls: CallFact[]): void {
  const obj = node.childForFieldName('object');
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;
  const callee = obj ? `${obj.text}.${nameNode.text}` : nameNode.text;
  if (callee.length > MAX_CALLEE_LEN) return;
  const argsNode = node.childForFieldName('arguments');
  const args: Part[][] = [];
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      args.push(evalJava(argsNode.namedChild(i)!));
    }
  }
  // Java call arguments have no keyword/kwargs concept (unlike JS object
  // literals or Python keyword args) — annotation element_value_pairs carry
  // the equivalent structured data and are extracted separately into
  // AnnotationFact.args.
  calls.push({ callee, args, kwargs: {}, line: node.startPosition.row + 1 });
}

/** Bind a field/local declarator's name to its evaluated initializer,
 * all-scope first-wins (same policy as every other language here) — except a
 * `@Value("${prop:default}")`-annotated field, which always binds to the env
 * part Spring's relaxed binding would resolve, regardless of whether the
 * field also has (has none, typically) a literal initializer. */
function bindJavaDeclarators(
  declHolder: TSNode,
  modifiers: TSNode | null | undefined,
  assignments: Map<string, Part[]>
): void {
  let valueAnnotationRaw: string | undefined;
  if (modifiers?.type === 'modifiers') {
    for (let i = 0; i < modifiers.namedChildCount; i++) {
      const n = modifiers.namedChild(i)!;
      if (n.type !== 'annotation') continue;
      if (n.childForFieldName('name')?.text !== 'Value') continue;
      const argList = n.childForFieldName('arguments');
      const posArg = argList?.namedChild(0);
      if (posArg) {
        const v = evalJava(posArg);
        if (v.length === 1 && v[0].t === 'lit') valueAnnotationRaw = v[0].v;
      }
    }
  }
  for (let i = 0; i < declHolder.namedChildCount; i++) {
    const decl = declHolder.namedChild(i)!;
    if (decl.type !== 'variable_declarator') continue;
    const name = decl.childForFieldName('name')?.text;
    if (!name) continue;
    if (valueAnnotationRaw !== undefined) {
      const m = valueAnnotationRaw.match(JAVA_VALUE_PLACEHOLDER);
      if (m) {
        assignments.set(name, [
          { t: 'env', name: relaxedBinding(m[1]), fallback: m[2] !== undefined ? [{ t: 'lit', v: m[2] }] : undefined },
        ]);
        continue;
      }
    }
    if (assignments.has(name)) continue;
    const value = decl.childForFieldName('value');
    assignments.set(name, value ? evalJava(value) : [{ t: 'hole' }]);
  }
}

function extractJavaClassBases(node: TSNode): string[] {
  const bases: string[] = [];
  const superclass = node.childForFieldName('superclass');
  if (superclass) {
    const typeNode = superclass.namedChild(0);
    if (typeNode) bases.push(typeNode.text);
  }
  const interfacesWrap = node.childForFieldName('interfaces');
  if (interfacesWrap) {
    const typeList = interfacesWrap.namedChild(0); // `type_list`
    if (typeList) {
      for (let i = 0; i < typeList.namedChildCount; i++) bases.push(typeList.namedChild(i)!.text);
    }
  }
  return bases;
}

function evalExpr(node: TSNode, lang: Lang): Part[] {
  return lang === 'py' ? evalPy(node) : lang === 'go' ? evalGo(node) : evalJs(node);
}

/** Resolve ref parts against module-level assignments (bounded depth). */
export function resolveParts(
  parts: Part[],
  assignments: Map<string, Part[]>,
  depth = 2
): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    if (p.t === 'ref') {
      const target = assignments.get(p.name);
      if (target && depth > 0) out.push(...resolveParts(target, assignments, depth - 1));
      else out.push({ t: 'hole' });
    } else {
      out.push(p);
    }
  }
  // merge adjacent literals
  const merged: Part[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (p.t === 'lit' && last?.t === 'lit') last.v += p.v;
    else merged.push({ ...p });
  }
  return merged;
}

// ---------- fact extraction ----------

function extractCallJs(node: TSNode, calls: CallFact[]): void {
  /*
   * `new_expression` IS A CALL, and leaving it out made every constructed
   * client invisible.
   *
   * A tree-sitter call_expression names its callee in the `function` field; a
   * new_expression names it in `constructor`. Only the first was read, so
   * `new Pool({ connectionString: process.env.DATABASE_URL })` produced NO call
   * fact at all — not a hole, nothing — and with it went the object's kwargs and
   * the env read inside them. Measured on the shopfront fixture that was the
   * single remaining false "declared, never read": a service accused of not
   * reading DATABASE_URL, which it reads on line 3.
   *
   * The blast radius is wider than that one card. `new Pool`, `new Redis`,
   * `new MongoClient`, `new WebSocket` are the ordinary way a dependency is
   * created in JS, and none of them could be traced to evidence.
   *
   * The callee keeps its `new ` prefix. Construction and invocation are
   * different facts, and a bare `Pool` would be indistinguishable from calling a
   * function of that name — grounded-not-guessed applies to the name too.
   */
  const isNew = node.type === 'new_expression';
  const fnNode = node.childForFieldName(isNew ? 'constructor' : 'function');
  if (!fnNode) return;
  const callee = isNew ? `new ${fnNode.text}` : fnNode.text;
  if (callee.length > MAX_CALLEE_LEN) return;
  const argsNode = node.childForFieldName('arguments');
  const args: Part[][] = [];
  const kwargs: Record<string, Part[]> = {};
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i)!;
      if (a.type === 'object') {
        for (let j = 0; j < a.namedChildCount; j++) {
          const pair = a.namedChild(j)!;
          if (pair.type !== 'pair') continue;
          const key = pair.childForFieldName('key');
          const value = pair.childForFieldName('value');
          if (!key || !value) continue;
          const k = key.type === 'string' ? unquote(key.text) : key.text;
          if (value.type === 'array') {
            // e.g. { topics: ['a', 'b'] } — flatten each element as its own kwarg entry
            const elems: Part[] = [];
            for (let e = 0; e < value.namedChildCount; e++) {
              const el = value.namedChild(e)!;
              const ev = evalJs(el);
              if (ev.length === 1 && ev[0].t === 'lit') elems.push(ev[0]);
            }
            if (elems.length > 0) kwargs[k] = elems;
          } else {
            kwargs[k] = evalJs(value);
          }
        }
        args.push([{ t: 'hole' }]);
      } else {
        args.push(evalJs(a));
      }
    }
  }
  calls.push({ callee, args, kwargs, line: node.startPosition.row + 1 });
}

function extractCallPy(node: TSNode, calls: CallFact[]): void {
  const fnNode = node.childForFieldName('function');
  if (!fnNode) return;
  const callee = fnNode.text;
  if (callee.length > MAX_CALLEE_LEN) return;
  const argsNode = node.childForFieldName('arguments');
  const args: Part[][] = [];
  const kwargs: Record<string, Part[]> = {};
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i)!;
      if (a.type === 'keyword_argument') {
        const name = a.childForFieldName('name')?.text;
        const value = a.childForFieldName('value');
        if (name && value) {
          if (value.type === 'list') {
            const elems: Part[] = [];
            for (let e = 0; e < value.namedChildCount; e++) {
              const ev = evalPy(value.namedChild(e)!);
              if (ev.length === 1 && ev[0].t === 'lit') elems.push(ev[0]);
            }
            if (elems.length > 0) kwargs[name] = elems;
            else kwargs[name] = [{ t: 'hole' }];
          } else {
            kwargs[name] = evalPy(value);
          }
        }
      } else {
        args.push(evalPy(a));
      }
    }
  }
  calls.push({ callee, args, kwargs, line: node.startPosition.row + 1 });
}

function extractClassPy(node: TSNode, classes: ClassFact[]): void {
  const name = node.childForFieldName('name')?.text ?? '?';
  const bases: string[] = [];
  const superclasses = node.childForFieldName('superclasses');
  if (superclasses) {
    for (let i = 0; i < superclasses.namedChildCount; i++) {
      bases.push(superclasses.namedChild(i)!.text);
    }
  }
  const stringProps: Record<string, string> = {};
  const body = node.childForFieldName('body');
  if (body) {
    for (let i = 0; i < body.namedChildCount; i++) {
      const stmt = body.namedChild(i)!;
      if (stmt.type !== 'expression_statement') continue;
      const assign = stmt.namedChild(0);
      if (assign?.type !== 'assignment') continue;
      const left = assign.childForFieldName('left');
      const right = assign.childForFieldName('right');
      if (left?.type === 'identifier' && right?.type === 'string') {
        stringProps[left.text] = unquote(right.text);
      }
    }
  }
  classes.push({ name, bases, stringProps, line: node.startPosition.row + 1 });
}

function pushFunction(functions: FunctionFact[], name: string | undefined, node: TSNode): void {
  if (!name) return;
  const startLine = node.startPosition.row + 1;
  const newlineCount = (node.text.match(/\n/g) ?? []).length;
  functions.push({
    name,
    startLine,
    endLine: startLine + newlineCount,
  });
}

/** Named arrow/function expressions: `const foo = () => {}` / `const bar = function() {}`. */
function nameFromVariableDeclaratorParent(node: TSNode): string | undefined {
  const parent = node.parent;
  if (parent?.type !== 'variable_declarator') return undefined;
  const nameNode = parent.childForFieldName('name');
  if (nameNode?.type === 'identifier') return nameNode.text;
  return undefined;
}

function extractFunctionJs(node: TSNode, functions: FunctionFact[]): void {
  if (node.type === 'function_declaration') {
    pushFunction(functions, node.childForFieldName('name')?.text, node);
  } else if (node.type === 'method_definition') {
    pushFunction(functions, node.childForFieldName('name')?.text, node);
  } else if (node.type === 'function_expression') {
    pushFunction(functions, node.childForFieldName('name')?.text ?? nameFromVariableDeclaratorParent(node), node);
  } else if (node.type === 'arrow_function') {
    pushFunction(functions, nameFromVariableDeclaratorParent(node), node);
  }
}

/**
 * U31 — anonymous CJS export assignments: `exports.name = function() {}`.
 * Named function expressions on the RHS are already extracted by
 * {@link extractFunctionJs}; this path covers the anonymous bodies Express
 * uses throughout `lib/`.
 */
function cjsExportName(left: TSNode): string | undefined {
  if (left.type !== 'member_expression') return undefined;
  const prop = left.childForFieldName('property');
  if (prop?.type !== 'property_identifier') return undefined;
  const obj = left.childForFieldName('object');
  if (!obj) return undefined;
  if (obj.type === 'identifier' && obj.text === 'exports') return prop.text;
  if (obj.type === 'member_expression') {
    const outerObj = obj.childForFieldName('object');
    const outerProp = obj.childForFieldName('property');
    if (
      outerObj?.type === 'identifier' &&
      outerObj.text === 'module' &&
      outerProp?.type === 'property_identifier' &&
      outerProp.text === 'exports'
    ) {
      return prop.text;
    }
  }
  return undefined;
}

function extractCjsExportFunction(node: TSNode, functions: FunctionFact[]): void {
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) return;
  const name = cjsExportName(left);
  if (!name) return;
  if (right.type !== 'function_expression' && right.type !== 'arrow_function') return;
  if (right.type === 'function_expression' && right.childForFieldName('name')?.text) return;
  pushFunction(functions, name, right);
}

function extractFunctionPy(node: TSNode, functions: FunctionFact[]): void {
  if (node.type === 'function_definition') {
    pushFunction(functions, node.childForFieldName('name')?.text, node);
  }
}

function extractFunctionGo(node: TSNode, functions: FunctionFact[]): void {
  if (node.type === 'function_declaration' || node.type === 'method_declaration') {
    const before = functions.length;
    pushFunction(functions, node.childForFieldName('name')?.text, node);
    // Record WHICH of the two it was. A Go method is reachable only through its
    // receiver, so package-scope resolution of a bare `Foo(...)` must not land
    // on `func (c *Context) Foo()`. Set after the push so `pushFunction` keeps
    // its single responsibility and every other language is untouched.
    if (node.type === 'method_declaration' && functions.length > before) {
      functions[functions.length - 1].method = true;
    }
  }
}

function extractFunctionJava(node: TSNode, functions: FunctionFact[]): void {
  if (node.type === 'method_declaration') {
    pushFunction(functions, node.childForFieldName('name')?.text, node);
  }
}

/**
 * U33 — the DECLARED type of a Java name, so a call through a receiver can be
 * resolved to the file that declares the receiver's type.
 *
 * Java's every cross-file call goes through a receiver: `this.owners.findById`,
 * `owner.getPet`, `EntityUtils.getById`. Nothing in `CallFact.callee` says what
 * `owners` IS, so `buildFunctionGraph` had no way to reach `OwnerRepository.java`
 * and EVERY resolved call edge in a Java repo was intra-file (measured: 0
 * cross-file call edges on spring-petclinic-monolith and spring-boot, which is
 * why both report `stemPlays: false`). The declared type is right there in the
 * source — this reads it rather than guessing.
 *
 * The type recorded is the ERASED, UNQUALIFIED name: `List<Pet> pets` records
 * `List`, not `Pet`; `a.b.Owner o` records nothing (a scoped type identifier is
 * left alone rather than truncated to a name that might mean something else in
 * this file). Consumers resolve that simple name the way javac would — imports
 * first, then the file's own package.
 *
 * AMBIGUOUS NAMES RESOLVE TO NOTHING, the same rule every other resolver here
 * uses. Java scoping is per-block and this map is per-file, so a local `Pet p`
 * in one method and a `Visit p` in another are two different `p`s. Rather than
 * pick one, a name declared with two different types is dropped entirely: an
 * edge is never emitted on a guess about which declaration was in scope.
 */
function bindJavaVarType(node: TSNode, varTypes: Map<string, string | null>): void {
  const typeNode = node.childForFieldName('type');
  if (!typeNode) return;
  let simple: string | undefined;
  if (typeNode.type === 'type_identifier') {
    simple = typeNode.text;
  } else if (typeNode.type === 'generic_type') {
    const head = typeNode.namedChild(0);
    if (head?.type === 'type_identifier') simple = head.text;
  }
  if (!simple) return;

  const record = (name: string | undefined): void => {
    if (!name) return;
    const prev = varTypes.get(name);
    if (prev === undefined) varTypes.set(name, simple!);
    else if (prev !== simple) varTypes.set(name, null); // two types, one name
  };

  // formal_parameter / enhanced_for_statement carry `name` directly;
  // field_declaration / local_variable_declaration carry one or more
  // `variable_declarator` children (`private String a, b;`).
  const direct = node.childForFieldName('name');
  if (direct) {
    record(direct.text);
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const decl = node.namedChild(i)!;
    if (decl.type !== 'variable_declarator') continue;
    record(decl.childForFieldName('name')?.text);
  }
}

function extractCallGo(node: TSNode, calls: CallFact[]): void {
  const fnNode = node.childForFieldName('function');
  if (!fnNode) return;
  const callee = fnNode.text;
  if (callee.length > MAX_CALLEE_LEN) return;
  const argsNode = node.childForFieldName('arguments');
  const args: Part[][] = [];
  const kwargs: Record<string, Part[]> = {};
  if (argsNode) {
    for (let i = 0; i < argsNode.namedChildCount; i++) {
      const a = argsNode.namedChild(i)!;
      // kafka.WriterConfig{Topic: "x"} or &redis.Options{Addr: ...} — extract
      // keyed struct-literal fields into kwargs, mirroring JS object args /
      // Python keyword args; the slot itself becomes a hole in positional args.
      let composite: TSNode | undefined;
      if (a.type === 'composite_literal') {
        composite = a;
      } else if (a.type === 'unary_expression' && a.childForFieldName('operator')?.text === '&') {
        const operand = a.childForFieldName('operand');
        if (operand?.type === 'composite_literal') composite = operand;
      }
      if (composite) {
        const body = composite.childForFieldName('body');
        if (body) {
          for (let j = 0; j < body.namedChildCount; j++) {
            const el = body.namedChild(j)!;
            if (el.type !== 'keyed_element') continue;
            const keyWrap = el.childForFieldName('key');
            const valWrap = el.childForFieldName('value');
            const keyNode = keyWrap?.namedChild(0) ?? keyWrap;
            const valNode = valWrap?.namedChild(0) ?? valWrap;
            if (!keyNode || !valNode) continue;
            let k: string | undefined;
            if (keyNode.type === 'identifier' || keyNode.type === 'field_identifier') {
              k = keyNode.text;
            } else {
              const kv = evalGo(keyNode);
              if (kv.length === 1 && kv[0].t === 'lit') k = kv[0].v;
            }
            if (k) kwargs[k] = evalGo(valNode);
          }
        }
        args.push([{ t: 'hole' }]);
      } else {
        args.push(evalGo(a));
      }
    }
  }
  calls.push({ callee, args, kwargs, line: node.startPosition.row + 1 });
}

/** short_var_declaration (a, b := ...) / assignment: zip left identifiers with
 * evaluated right-hand expressions, all-scope, first-wins. */
function bindGoShortVarDecl(
  leftList: TSNode,
  rightList: TSNode,
  assignments: Map<string, Part[]>
): void {
  const lefts: TSNode[] = [];
  for (let i = 0; i < leftList.namedChildCount; i++) lefts.push(leftList.namedChild(i)!);
  const rights: TSNode[] = [];
  for (let i = 0; i < rightList.namedChildCount; i++) rights.push(rightList.namedChild(i)!);

  // special case: v, ok := os.LookupEnv("X") — bind the FIRST identifier to
  // the env var itself (the "ok" bool carries no static value worth tracking).
  if (lefts.length === 2 && rights.length === 1 && rights[0].type === 'call_expression') {
    const fn = rights[0].childForFieldName('function');
    if (fn?.text === 'os.LookupEnv') {
      const argsNode = rights[0].childForFieldName('arguments');
      const a0 = argsNode?.namedChild(0);
      if (a0 && lefts[0].type === 'identifier' && !assignments.has(lefts[0].text)) {
        const nameLit = evalGo(a0);
        if (nameLit.length === 1 && nameLit[0].t === 'lit') {
          assignments.set(lefts[0].text, [{ t: 'env', name: nameLit[0].v }]);
        }
      }
      return;
    }
  }

  if (lefts.length === rights.length) {
    for (let i = 0; i < lefts.length; i++) {
      if (lefts[i].type === 'identifier' && lefts[i].text !== '_' && !assignments.has(lefts[i].text)) {
        assignments.set(lefts[i].text, evalGo(rights[i]));
      }
    }
  }
}

/** var_spec / const_spec: field `value` is an expression_list wrapping the
 * real value node (not the value directly). */
function bindGoSpec(node: TSNode, assignments: Map<string, Part[]>): void {
  const name = node.childForFieldName('name');
  const valueList = node.childForFieldName('value');
  if (name?.type === 'identifier' && valueList) {
    const value = valueList.namedChild(0);
    if (value && !assignments.has(name.text)) {
      assignments.set(name.text, evalGo(value));
    }
  }
}

/**
 * Parse one file into facts.
 *
 * The syntax tree is ALWAYS disposed, including on the way out of a throw.
 * Tree-sitter trees are allocated in the WASM heap, which the JS garbage
 * collector cannot reach: for as long as this function leaked them, a scan
 * large enough (n8n, ~15.6K files) exhausted that heap, emscripten called
 * `abort()`, and — because the runtime cannot be restarted in-process — EVERY
 * later file in the run failed to parse. That is what turned five real repos
 * into "0 files" rows in the full-tier QA run.
 */

/* ------------------------------------------- the expression-position slot -- */

/**
 * EVERY ENV READ, WHEREVER IT SITS.
 *
 * The rest of this file fires on STATEMENT kinds and asks what is inside them —
 * an assignment's value, a call's arguments. That model has no slot for a read
 * that is neither assigned nor passed:
 *
 *   if (process.env.SEQUENCE_DISABLE_ACP) {                   // a condition
 *   const k = (process.env.DEEPSEEK_API_KEY ?? '').trim();    // chained
 *
 * Measured over this repository's product source, 25 of the 27 env names the
 * fact pass missed were that shape. It is not a missing syntax case: adding a
 * parenthesised case, a binary case and a member-chain case each recovers a
 * handful and leaves the next shape missing, because the shapes are unbounded.
 *
 * So this walk is INVERTED. It fires on the env node itself and asks its
 * ANCESTORS where it sits, which makes a read findable because it is a read
 * rather than because someone enumerated the container it landed in.
 *
 * `position` is recorded rather than normalised away: the service-input card
 * says different sentences for a read in a condition and a read in an argument,
 * and a consumer that does not care can ignore the field.
 */
const ENV_MEMBER = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/;
const ENV_SUBSCRIPT = /^process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]$/;
const PY_ENVIRON = /^os\.environ\[\s*[bruBRU]*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]$/;
const PY_GETENV = /^os\.getenv\(\s*[bruBRU]*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/;
const GO_GETENV = /^os\.Getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/;
const JAVA_GETENV = /^System\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/;

function envNameOfNode(n: TSNode, lang: Lang): string | undefined {
  const text = n.text;
  if (text.length > 200) return undefined;
  if (lang === 'ts' || lang === 'js') {
    if (n.type === 'member_expression') return ENV_MEMBER.exec(text)?.[1];
    if (n.type === 'subscript_expression') return ENV_SUBSCRIPT.exec(text)?.[1];
    return undefined;
  }
  if (lang === 'py') {
    if (n.type === 'subscript') return PY_ENVIRON.exec(text)?.[1];
    if (n.type === 'call') return PY_GETENV.exec(text)?.[1];
    return undefined;
  }
  if (lang === 'go' && n.type === 'call_expression') return GO_GETENV.exec(text)?.[1];
  if (lang === 'java' && n.type === 'method_invocation') return JAVA_GETENV.exec(text)?.[1];
  return undefined;
}

/**
 * Did the climb arrive from this parent's `condition` field?
 *
 * Identity on the child we came from, not byte offsets — `TSNode` exposes no
 * start/end index, and the ancestor climb already knows which branch it walked
 * up through, which answers the question exactly.
 */
function cameFromCondition(parent: TSNode, child: TSNode): boolean {
  const cond = parent.childForFieldName('condition');
  if (cond === null) return false;
  /*
   * POSITION, NOT IDENTITY. web-tree-sitter hands back a NEW JS wrapper on every
   * `childForFieldName` call, so `===` against the node the climb came from is
   * always false — and `if (process.env.X)` was labelled `other` while the
   * condition branch sat there looking correct. Start row and column identify a
   * node in a tree uniquely, which is what the comparison needs.
   */
  return (
    cond.startPosition.row === child.startPosition.row &&
    cond.startPosition.column === child.startPosition.column
  );
}

/**
 * Where this read sits, from its ancestors.
 *
 * Bounded at eight levels: past that the enclosing construct says nothing useful
 * about the read, and an unbounded climb on a deep tree is a cost paid on every
 * file of every scan.
 */
function envPositionOf(node: TSNode): EnvReadPosition {
  let cur: TSNode | null = node;
  let child: TSNode = node;
  for (let depth = 0; depth < 8 && cur?.parent; depth++) {
    child = cur;
    cur = cur.parent;
    const t = cur.type;
    if (t === 'if_statement' || t === 'while_statement' || t === 'do_statement') {
      /* Only the CONDITION counts — a read in the body is not guarding anything. */
      return cameFromCondition(cur, child) ? 'condition' : 'other';
    }
    if (t === 'ternary_expression' || t === 'conditional_expression') {
      return cameFromCondition(cur, child) ? 'condition' : 'other';
    }
    if (t === 'template_substitution' || t === 'interpolation') return 'interpolation';
    if (t === 'return_statement') return 'returned';
    if (t === 'arguments' || t === 'argument_list') return 'argument';
    if (
      t === 'variable_declarator' ||
      t === 'assignment' ||
      t === 'assignment_expression' ||
      /* Go: `v := os.Getenv("PORT")` and `var v = …` */
      t === 'short_var_declaration' ||
      t === 'var_spec' ||
      t === 'const_spec'
    ) {
      return 'assigned';
    }
    if (t === 'member_expression' || t === 'call_expression' || t === 'attribute' || t === 'call') {
      /* `(X ?? '').trim()` — the read is the RECEIVER of a chain, so the
         assignment above records the chain and never the read inside it. */
      if (child !== cur.childForFieldName('arguments')) return 'chained';
    }
  }
  return 'other';
}

function collectEnvReads(root: TSNode, lang: Lang): EnvRead[] {
  const out: EnvRead[] = [];
  const seen = new Set<string>();
  walk(root, (n) => {
    const name = envNameOfNode(n, lang);
    if (name === undefined) return;
    const line = n.startPosition.row + 1;
    /*
     * One entry per name per line. Two nodes can match the same read — a
     * `subscript` and the `member_expression` inside it — and a card counting
     * rows would report one variable twice.
     */
    const key = `${name}@${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, line, position: envPositionOf(n) });
  });
  return out;
}

export function extractFacts(src: string, file: string, lang: Lang): FileFacts {
  const isTsx = file.endsWith('.tsx') || file.endsWith('.jsx');
  const t0 = performance.now();
  const tree = parseSource(src, lang === 'js' && isTsx ? 'ts' : lang, isTsx);
  const t1 = performance.now();
  bump('05a tree-sitter parse', t1 - t0);
  try {
    return factsFromTree(tree, src, file, lang);
  } finally {
    const t2 = performance.now();
    tree.delete();
    bump('05d tree.delete', performance.now() - t2);
  }
}

function factsFromTree(tree: TSTree, src: string, file: string, lang: Lang): FileFacts {
  const tWalkStart = performance.now();
  const root = tree.rootNode;
  const lines = src.split('\n');

  const imports: ImportFact[] = [];
  const calls: CallFact[] = [];
  const functions: FunctionFact[] = [];
  const classes: ClassFact[] = [];
  const assignments = new Map<string, Part[]>();

  /**
   * ERROR-node count, tallied DURING the fact walk rather than by a second
   * full traversal (`countErrors`).
   *
   * Every one of these walks visits the same nodes in the same order and none
   * of them prunes (no callback returns `false`), so counting here is the same
   * number `countErrors(root)` produced — but it costs one traversal instead of
   * two. Measured on the real corpus (H12): the separate `countErrors` walk was
   * 2.47s of django's 16.2s scan and 10.75s of n8n's 71.5s, i.e. ~15% of the
   * whole scan spent re-walking trees that had just been walked.
   */
  let parseErrors = 0;
  let goPackageName: string | undefined;

  if (lang === 'go') {
    walk(root, (n) => {
      if (n.type === 'ERROR') parseErrors++;
      if (n.type === 'package_clause') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i);
          if (c?.type === 'package_identifier' && c.text && !goPackageName) {
            goPackageName = c.text;
          }
        }
      } else if (n.type === 'import_spec') {
        const p = n.childForFieldName('path');
        if (p) {
          const litParts = evalGo(p);
          if (litParts.length === 1 && litParts[0].t === 'lit') {
            const aliasNode = n.childForFieldName('name');
            const alias = aliasNode?.text;
            const line = n.startPosition.row + 1;
            if (alias === '_') return;
            if (alias === '.') {
              imports.push({ raw: litParts[0].v, line, moduleGranular: true });
              return;
            }
            imports.push({
              raw: litParts[0].v,
              line,
              names: alias ? [alias] : undefined,
            });
          }
        }
      } else if (n.type === 'short_var_declaration') {
        const left = n.childForFieldName('left');
        const right = n.childForFieldName('right');
        if (left && right) bindGoShortVarDecl(left, right, assignments);
      } else if (n.type === 'var_spec' || n.type === 'const_spec') {
        bindGoSpec(n, assignments);
      } else if (n.type === 'call_expression') {
        extractCallGo(n, calls);
      } else {
        extractFunctionGo(n, functions);
      }
    });
  } else if (lang === 'py') {
    walk(root, (n) => {
      if (n.type === 'ERROR') parseErrors++;
      if (n.type === 'assignment') {
        // any scope: constants inside functions matter for URL resolution too
        const left = n.childForFieldName('left');
        const right = n.childForFieldName('right');
        if (left?.type === 'identifier' && right && !assignments.has(left.text)) {
          assignments.set(left.text, evalPy(right));
        }
      } else if (n.type === 'import_statement') {
        // import a.b, c
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)!;
          const name = c.type === 'aliased_import' ? c.childForFieldName('name')?.text : c.text;
          if (name) imports.push({ raw: name, line: n.startPosition.row + 1 });
        }
      } else if (n.type === 'import_from_statement') {
        const mod = n.childForFieldName('module_name')?.text;
        if (mod) {
          const { names, moduleGranular } = parsePyFromImportNames(n);
          imports.push({
            raw: mod,
            line: n.startPosition.row + 1,
            names: names.length > 0 ? names : undefined,
            moduleGranular: moduleGranular || names.length === 0,
          });
        }
      } else if (n.type === 'call') {
        extractCallPy(n, calls);
      } else if (n.type === 'class_definition') {
        extractClassPy(n, classes);
      } else {
        extractFunctionPy(n, functions);
      }
    });
  } else if (lang === 'java') {
    // handled in the dedicated Java walk below, after this if/else chain —
    // kept separate rather than folded in here since it needs its own
    // annotations array and several Java-only helper functions.
  } else {
    walk(root, (n) => {
      if (n.type === 'ERROR') parseErrors++;
      if (n.type === 'variable_declarator') {
        // any scope, first declaration wins on name collisions
        const name = n.childForFieldName('name');
        const value = n.childForFieldName('value');
        if (name?.type === 'identifier' && value && !assignments.has(name.text)) {
          assignments.set(name.text, evalJs(value));
        } else if (name?.type === 'object_pattern' && value && /env|config/i.test(value.text)) {
          // const { EMAILER_URL } = envConfig.getValues() — destructured names
          // mirror env var names (joiner-gated on compose wiring)
          /*
           * THREE SHAPES, NOT ONE. Only the bare shorthand was read, so two
           * ordinary idioms produced no fact at all:
           *
           *   const { PORT } = process.env               // read
           *   const { PORT = '3000' } = process.env      // MISSED — a default
           *   const { DATABASE_URL: dsn } = process.env  // MISSED — renamed
           *
           * A default and a rename are how a variable is read when it is
           * optional or when its name is ugly, which is most of the time. The
           * default is kept as the Part's `fallback`, the same field the
           * `x || 'lit'` and `os.getenv('X', 'lit')` forms already fill.
           */
          const bind = (envName: string, local: string, fallback?: Part[]): void => {
            if (!ENV_NAME_SHAPE.test(envName) || assignments.has(local)) return;
            assignments.set(local, [
              { t: 'env', name: envName, ...(fallback === undefined ? {} : { fallback }) },
            ]);
          };
          for (let i = 0; i < name.namedChildCount; i++) {
            const prop = name.namedChild(i)!;
            if (prop.type === 'shorthand_property_identifier_pattern') {
              bind(prop.text, prop.text);
            } else if (prop.type === 'object_assignment_pattern') {
              // `{ PORT = '3000' }` — left is the name, right is the default.
              const left = prop.childForFieldName('left');
              const right = prop.childForFieldName('right');
              if (left?.type === 'shorthand_property_identifier_pattern') {
                bind(left.text, left.text, right ? evalJs(right) : undefined);
              }
            } else if (prop.type === 'pair_pattern') {
              /*
               * `{ DATABASE_URL: dsn }` — the KEY is the environment variable and
               * the VALUE is the local binding. Getting these the wrong way round
               * would record a variable named `dsn`, which no manifest declares.
               */
              const key = prop.childForFieldName('key');
              const val = prop.childForFieldName('value');
              if (key === null || val === null) continue;
              if (val.type === 'identifier') {
                bind(key.text, val.text);
              } else if (val.type === 'assignment_pattern') {
                // `{ DATABASE_URL: dsn = 'x' }` — renamed AND defaulted.
                const local = val.childForFieldName('left');
                const dflt = val.childForFieldName('right');
                if (local?.type === 'identifier') {
                  bind(key.text, local.text, dflt ? evalJs(dflt) : undefined);
                }
              }
            }
          }
        }
      } else if (n.type === 'import_statement') {
        const source = n.childForFieldName('source');
        if (source) {
          const raw = unquote(source.text);
          const line = n.startPosition.row + 1;
          const clause = n.namedChild(0);
          if (clause && clause.type === 'import_clause') {
            const { names, moduleGranular } = parseJsImportClause(clause);
            imports.push({
              raw,
              line,
              names: names.length > 0 ? names : undefined,
              moduleGranular: moduleGranular || names.length === 0,
            });
          } else {
            // side-effect only import (`import './x'`) — no clause to narrow.
            imports.push({ raw, line, moduleGranular: true });
          }
        }
      } else if (n.type === 'export_statement' && n.childForFieldName('source')) {
        /*
         * A RE-EXPORT IS A DEPENDENCY, and this saw none of them.
         *
         * `export { renderBrief } from './brief.js'` and `export * from './x.js'`
         * make the exporting file depend on the exported one exactly as an
         * import does — the module is loaded, its code runs, a change to it
         * changes this file's surface. Only `import_statement` was handled, so
         * every one of these edges was missing from the graph.
         *
         * FOUND FROM A PICTURE. A derived chart of `brief.ts` drew four
         * importers and omitted `index.ts`, which reaches it by re-export. The
         * chart was right about the scan and the scan was wrong about the
         * repository, and a barrel `index.ts` is exactly where a codebase
         * concentrates these.
         *
         * Recorded as an import because that is what it is to every consumer of
         * `FileFacts`: same shape, same resolution, same edge. Introducing a
         * second kind would make every existing reader of imports wrong by
         * omission instead.
         */
        const source = n.childForFieldName('source')!;
        const raw = unquote(source.text);
        const line = n.startPosition.row + 1;
        /* `export * from` names nothing in particular, so it is module-granular
           like a side-effect import; `export { a, b } from` names its own. */
        let clause: ReturnType<typeof n.namedChild> = null;
        for (let i = 0; i < n.namedChildCount; i += 1) {
          const child = n.namedChild(i);
          if (child?.type === 'export_clause') {
            clause = child;
            break;
          }
        }
        const names: string[] = [];
        if (clause) {
          for (let i = 0; i < clause.namedChildCount; i += 1) {
            const spec = clause.namedChild(i);
            const name = spec?.childForFieldName('name')?.text ?? spec?.text;
            if (name) names.push(name);
          }
        }
        imports.push({
          raw,
          line,
          ...(names.length > 0 ? { names } : {}),
          moduleGranular: names.length === 0,
        });
      } else if (n.type === 'assignment_expression') {
        extractCjsExportFunction(n, functions);
      } else if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function');
        if (fn?.text === 'require') {
          const argsNode = n.childForFieldName('arguments');
          const a0 = argsNode?.namedChild(0);
          if (a0?.type === 'string') {
            // `require('./x')` carries no destructuring info here (that lives on
            // the enclosing variable_declarator, not this call) — honestly
            // module-granular rather than pretending to know which symbol.
            imports.push({ raw: unquote(a0.text), line: n.startPosition.row + 1, moduleGranular: true });
          }
        }
        extractCallJs(n, calls);
      } else if (n.type === 'new_expression') {
        extractCallJs(n, calls);
      } else {
        extractFunctionJs(n, functions);
      }
    });
  }

  const annotations: AnnotationFact[] = [];
  /** U33 — Java declared types; `null` marks a name declared with two types. */
  const javaVarTypes = new Map<string, string | null>();
  if (lang === 'java') {
    walk(root, (n) => {
      if (
        n.type === 'field_declaration' ||
        n.type === 'local_variable_declaration' ||
        n.type === 'formal_parameter' ||
        n.type === 'enhanced_for_statement'
      ) {
        bindJavaVarType(n, javaVarTypes);
      }
      if (n.type === 'ERROR') parseErrors++;
      if (n.type === 'import_declaration') {
        // scoped_identifier/identifier nesting is deep (see facts.ts field
        // notes above evalJava) — a text regex on the whole declaration is
        // simpler and just as reliable than field-walking it.
        const m = n.text.match(/^import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;?$/);
        if (m) imports.push({ raw: m[1], line: n.startPosition.row + 1 });
      } else if (n.type === 'method_invocation') {
        extractCallJava(n, calls);
      } else if (n.type === 'class_declaration') {
        const name = n.childForFieldName('name')?.text ?? '?';
        const bases = extractJavaClassBases(n);
        classes.push({ name, bases, stringProps: {}, line: n.startPosition.row + 1 });
        const modifiers = n.namedChild(0);
        extractAnnotationsFromModifiers(modifiers, 'class', name, undefined, annotations);
      } else if (n.type === 'method_declaration') {
        extractFunctionJava(n, functions);
        const modifiers = n.namedChild(0);
        extractAnnotationsFromModifiers(modifiers, 'method', enclosingClassName(n), undefined, annotations);
      } else if (n.type === 'field_declaration') {
        const modifiers = n.namedChild(0);
        bindJavaDeclarators(n, modifiers, assignments);
        // field-target annotations (e.g. @Value) — one AnnotationFact per
        // declarator sharing the field_declaration's modifiers.
        for (let i = 0; i < n.namedChildCount; i++) {
          const decl = n.namedChild(i)!;
          if (decl.type !== 'variable_declarator') continue;
          const fieldName = decl.childForFieldName('name')?.text;
          extractAnnotationsFromModifiers(modifiers, 'field', enclosingClassName(n), fieldName, annotations);
        }
      } else if (n.type === 'local_variable_declaration') {
        // locals can't carry Spring annotations — no modifiers lookup needed.
        bindJavaDeclarators(n, null, assignments);
      }
    });
  }

  bump('05b fact walk (incl. ERROR tally)', performance.now() - tWalkStart);

  return {
    file,
    language: lang,
    loc: lines.length,
    imports,
    calls,
    functions,
    classes,
    assignments,
    parseErrors,
    lines,
    /* Folded into the same pass, not a second traversal — the parse runs over
       every file of every scan, and a full extra walk there is a cost nobody
       agreed to pay. */
    envReads: collectEnvReads(root, lang),
    ...(lang === 'java' ? { annotations, varTypes: javaVarTypes } : {}),
    ...(lang === 'go' && goPackageName ? { goPackageName } : {}),
  };
}
