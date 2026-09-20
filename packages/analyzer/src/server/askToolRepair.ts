/**
 * ARGUMENT REPAIR — a tool call that can be made valid is made valid, and the
 * repair is named (docs/research/carrying-harness-plan.md, rule 1, wave A1).
 *
 * Every shape below was seen from a small local model on this repository or on
 * the SWE-bench mini-50 runs: arguments written at the top level of the tool
 * object instead of under `args`; `file` where the tool takes `path`; an
 * `edits` array sent as a JSON string; `old`/`new` for `oldString`/`newString`;
 * a plan's `steps` as one newline-separated string; a `./` prefix on a path.
 * Each of those used to cost a corrective round or a refusal that read as
 * "the tool is broken". None of them is ambiguous: the intended call is the
 * only reading, so the harness takes it and says so.
 *
 * What is NOT repaired: a missing argument (there is nothing to read it from),
 * a value that names a file or node the repository does not have (that is a
 * resolution question, `askResolve.ts`), and anything where two readings are
 * possible. Repair is a reversal of a known transform, never a guess.
 */

/** The keys a tool object carries beside its arguments. */
const ENVELOPE_KEYS = new Set(['id', 'name', 'args', 'arguments', 'evidence', 'tool', 'type']);

/** Canonical argument → the spellings a model sends instead. */
const ALIASES: Record<string, Record<string, readonly string[]>> = {
  read_file: { path: ['file', 'filepath', 'file_path', 'filename', 'filePath'] },
  edit_file: { path: ['file', 'filepath', 'file_path', 'filename', 'filePath'] },
  who_calls: { target: ['path', 'file', 'name', 'symbol', 'node', 'nodeId', 'id', 'service'] },
  locate_symbol: { name: ['symbol', 'identifier', 'query', 'target', 'function'] },
  search_files: { query: ['pattern', 'q', 'text', 'search', 'regex', 'needle'] },
  read_topology: { service: ['id', 'name', 'target', 'serviceId'] },
  run_command: { cmd: ['command', 'cmdline', 'shell'] },
  fetch_url: { url: ['href', 'link', 'uri'] },
  mark_step_done: { step: ['text', 'title', 'name', 'id'] },
  propose_files: { files: ['edits', 'changes'] },
};

/** Arguments that must be arrays, and that a model sometimes sends as a string. */
const ARRAY_ARGS: Record<string, readonly string[]> = {
  edit_file: ['edits'],
  propose_files: ['files'],
  propose_topology: ['nodes', 'edges'],
  propose_chart: ['items', 'links'],
  update_todos: ['items'],
  write_plan: ['steps'],
  propose_plan: ['concepts'],
  walk_example: ['steps'],
};

/** Arguments that are lists of short strings, which a model may send as prose lines. */
const LINE_LIST_ARGS: Record<string, readonly string[]> = {
  write_plan: ['steps'],
  propose_plan: ['concepts'],
};

/** Keys inside an `edits` item, in the spellings they arrive in. */
const EDIT_ITEM_ALIASES: Record<string, readonly string[]> = {
  oldString: ['old', 'old_string', 'oldText', 'old_text', 'from', 'search', 'find', 'before'],
  newString: ['new', 'new_string', 'newText', 'new_text', 'to', 'replace', 'replacement', 'after'],
  replaceAll: ['replace_all', 'all', 'global'],
};

/** Reverse the known ways a small model spells JSON: curly quotes, trailing
 *  commas, Python's single-quoted repr and its literals. Each is a reversal of
 *  one transform; nothing structural is guessed. */
export function repairToolJsonText(body: string): string {
  let out = body
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,(\s*[}\]])/g, '$1');
  /* SINGLE-QUOTED JSON, Python's repr. Only when the body holds no double quote
     at all, so an apostrophe inside a legitimate JSON string is never touched. */
  if (!out.includes('"') && out.includes("'")) out = out.replace(/'/g, '"');
  out = out
    .replace(/:\s*True\b/g, ': true')
    .replace(/:\s*False\b/g, ': false')
    .replace(/:\s*None\b/g, ': null');
  return out;
}

/**
 * The arguments of a parsed tool object. `args` when present; otherwise the
 * object's own keys minus the envelope, which is what a model that wrote
 * `{"name":"read_file","path":"src/a.ts"}` meant.
 */
export function argsFromToolObject(
  r: Record<string, unknown>,
): { args: Record<string, unknown> | undefined; repairs: string[] } {
  const repairs: string[] = [];
  const explicit = r.args ?? r.arguments;
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) {
    if (r.args === undefined) repairs.push('read "arguments" as args');
    return { args: { ...(explicit as Record<string, unknown>) }, repairs };
  }
  if (typeof explicit === 'string') {
    const parsed = tryParseObject(explicit);
    if (parsed) {
      repairs.push('parsed args from a JSON string');
      return { args: parsed, repairs };
    }
  }
  const spilled: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!ENVELOPE_KEYS.has(k)) spilled[k] = v;
  }
  if (Object.keys(spilled).length > 0) {
    repairs.push('took top-level keys as args');
    return { args: spilled, repairs };
  }
  return { args: undefined, repairs };
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  for (const candidate of [text, repairToolJsonText(text)]) {
    try {
      const v = JSON.parse(candidate) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

function tryParseArray(text: string): unknown[] | undefined {
  for (const candidate of [text, repairToolJsonText(text)]) {
    try {
      const v = JSON.parse(candidate) as unknown;
      if (Array.isArray(v)) return v;
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

/** Split prose lines into list items: bullets, numbering and checkboxes stripped. */
function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => {
      /* Strip every leading marker, not just one: `- [ ] step` wears two. */
      let out = l;
      for (;;) {
        const next = out.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, '');
        if (next === out) break;
        out = next;
      }
      return out.trim();
    })
    .filter((l) => l.length > 0);
}

/**
 * Repair one request's arguments in place of the model's spelling. Returns the
 * canonical arguments and the list of repairs made, in the order made, each a
 * short phrase for the evidence line. An empty list means the call was already
 * canonical.
 */
export function repairAskToolArgs(
  name: string,
  args: Record<string, unknown> | undefined,
): { args: Record<string, unknown> | undefined; repairs: string[] } {
  if (!args) return { args, repairs: [] };
  const out: Record<string, unknown> = { ...args };
  const repairs: string[] = [];

  /* Aliases: a canonical key missing, one alias present with a usable value. */
  for (const [canonical, spellings] of Object.entries(ALIASES[name] ?? {})) {
    if (out[canonical] !== undefined && out[canonical] !== '') continue;
    for (const alias of spellings) {
      const v = out[alias];
      if (v !== undefined && v !== null && v !== '') {
        out[canonical] = v;
        delete out[alias];
        repairs.push(`read "${alias}" as "${canonical}"`);
        break;
      }
    }
  }

  /* Arrays sent as strings. */
  for (const key of ARRAY_ARGS[name] ?? []) {
    const v = out[key];
    if (typeof v !== 'string') continue;
    const parsed = tryParseArray(v);
    if (parsed) {
      out[key] = parsed;
      repairs.push(`parsed "${key}" from a JSON string`);
      continue;
    }
    if ((LINE_LIST_ARGS[name] ?? []).includes(key)) {
      const lines = linesToList(v);
      if (lines.length > 0) {
        out[key] = lines;
        repairs.push(`split "${key}" into ${lines.length} lines`);
      }
    }
  }
  /* A single object where an array of one was meant. */
  for (const key of ARRAY_ARGS[name] ?? []) {
    const v = out[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[key] = [v];
      repairs.push(`wrapped "${key}" in an array`);
    }
  }

  /* edit_file items: the pair of strings under the names the tool documents. */
  if (name === 'edit_file' && Array.isArray(out.edits)) {
    let renamed = 0;
    out.edits = (out.edits as unknown[]).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const e = { ...(item as Record<string, unknown>) };
      for (const [canonical, spellings] of Object.entries(EDIT_ITEM_ALIASES)) {
        if (e[canonical] !== undefined) continue;
        for (const alias of spellings) {
          if (e[alias] !== undefined) {
            e[canonical] = e[alias];
            delete e[alias];
            renamed += 1;
            break;
          }
        }
      }
      return e;
    });
    if (renamed > 0) repairs.push(`renamed ${renamed} edit field${renamed === 1 ? '' : 's'} to oldString/newString`);
  }

  /* Paths: a `./` prefix and backslashes are the same repo-relative path. */
  for (const key of ['path', 'target', 'glob'] as const) {
    const v = out[key];
    if (typeof v !== 'string') continue;
    let p = v.replace(/\\/g, '/');
    if (p.startsWith('./')) p = p.slice(2);
    if (p !== v) {
      out[key] = p;
      repairs.push(`normalised "${key}"`);
    }
  }

  return { args: out, repairs };
}

/**
 * Pull the identifier out of a phrase a model handed to `locate_symbol`, such as
 * "the runAskPipeline function" or "where is buildDigest defined". The longest
 * token that looks like code wins; ordinary words are dropped first. Returns
 * undefined when nothing in the phrase could be a symbol.
 */
export function extractIdentifierFromPhrase(phrase: string): string | undefined {
  const STOP = new Set([
    'the', 'a', 'an', 'of', 'in', 'is', 'it', 'this', 'that', 'to', 'for', 'and', 'or', 'where',
    'what', 'which', 'how', 'does', 'do', 'did', 'defined', 'definition', 'define', 'find', 'locate',
    'symbol', 'function', 'method', 'class', 'const', 'variable', 'type', 'interface', 'file',
    'called', 'call', 'calls', 'named', 'name', 'declared', 'declaration', 'implementation',
    'implemented', 'used', 'use', 'uses', 'module', 'export', 'exports', 'import', 'imports',
    'please', 'show', 'me', 'my', 'our', 'we', 'you', 'code', 'source', 'repo', 'repository',
  ]);
  const tokens = phrase.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  const candidates = tokens.filter((t) => !STOP.has(t.toLowerCase()));
  if (candidates.length === 0) return undefined;
  const codeLike = (t: string): number =>
    (/[a-z][A-Z]/.test(t) ? 2 : 0) + (t.includes('_') ? 2 : 0) + (/^[A-Z]/.test(t) ? 1 : 0);
  candidates.sort((a, b) => codeLike(b) - codeLike(a) || b.length - a.length);
  return candidates[0];
}
