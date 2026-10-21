/* ══════════════════════════════════════════════════════════════════════════
   READABLE TOOL ROWS: THE COMMAND, NOT ITS SHELL; RUNS OF CALLS FOLDED
   packages/web2/src/chat/commandLabel.ts

   Design after T3 Code's work-log/commandLabel.ts and Synara's
   components/chat/toolCallGroup.logic.ts (both MIT), from the build spec's
   description; no code was copied.

   CODEX WRAPS EVERY COMMAND IN A SHELL. The live recordings title a call
   `Run "C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command
   "npm test -- graph"`; the person asked for `npm test -- graph`, and that is
   what the row says. The wrapper rules match acp/arity.ts (unwrapShell),
   which scopes "Always" to the same command.

   A RUN OF CALLS IS ONE ROW. "Ran 3 commands, edited 2 files, read 4 files":
   the counts by kind, in the order the kinds first appeared, expanding on
   click. Pure, table-tested.
   ══════════════════════════════════════════════════════════════════════════ */

/** Split a command line into words, honouring quotes (the same rules as acp/arity.ts). */
function words(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === '\\' && quote === '"' && command[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += c;
    has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

const base = (w: string): string => (w.split(/[\\/]/).pop() ?? w).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

/** The command a shell wrapper runs, or the line itself. */
export function unwrapShell(command: string): string {
  const line = command.trim();
  const w = words(line);
  if (w.length >= 3) {
    const shell = base(w[0]!);
    const flag = w[1]!.toLowerCase();
    if ((shell === 'powershell' || shell === 'pwsh') && (flag === '-command' || flag === '-c')) return unwrapShell(w.slice(2).join(' '));
    if ((shell === 'bash' || shell === 'sh' || shell === 'zsh') && /^-l?c$|^-cl$/.test(flag)) return unwrapShell(w.slice(2).join(' '));
    if (shell === 'cmd' && (flag === '/c' || flag === '/s')) return unwrapShell(w.slice(flag === '/s' && w[2]?.toLowerCase() === '/c' ? 3 : 2).join(' '));
  }
  return line;
}

/**
 * A long line cut from the LEFT: the end of a command (its arguments, the file
 * it names) is what tells two rows apart, so that is the part kept.
 */
export function cutLeft(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - (max - 1))}`;
}

/** A tool card's title as a person reads it: `Run <shell> -Command "x"` is `x`; Claude's `` `x` `` is `x`. */
export function readableToolTitle(title: string, toolKind: string | null): string {
  const run = /^Run\s+([\s\S]+)$/.exec(title);
  if (run) return unwrapShell(run[1]!);
  if (toolKind === 'execute') {
    const tick = /^`([\s\S]+)`$/.exec(title.trim());
    if (tick) return unwrapShell(tick[1]!);
  }
  return title;
}

const TOOL_VERB: Record<string, string> = {
  execute: 'Run',
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  fetch: 'Fetch',
};

/**
 * A tool row's two halves: a quiet verb and the thing it acted on. "Read
 * src/a.ts" splits at its verb; a command ("pnpm test") gets "Run" put in
 * front; a title with no known verb for its kind is all target.
 */
export function splitToolTitle(title: string, toolKind: string | null): { verb: string | null; target: string } {
  const text = readableToolTitle(title, toolKind).trim();
  const verb = toolKind ? TOOL_VERB[toolKind] : undefined;
  if (!verb) return { verb: null, target: text };
  const lead = /^([A-Z][a-z]+)\s+(\S[\s\S]*)$/.exec(text);
  if (lead && toolKind !== 'execute') return { verb: lead[1]!, target: lead[2]! };
  return { verb, target: text };
}

type Kind = 'command' | 'edit' | 'read' | 'search' | 'fetch' | 'other';

function kindOf(toolKind: string | null): Kind {
  switch (toolKind) {
    case 'execute':
      return 'command';
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit';
    case 'read':
      return 'read';
    case 'search':
      return 'search';
    case 'fetch':
      return 'fetch';
    default:
      return 'other';
  }
}

const PHRASE: Record<Kind, [string, string, string]> = {
  command: ['Ran', 'command', 'commands'],
  edit: ['edited', 'file', 'files'],
  read: ['read', 'file', 'files'],
  search: ['', 'search', 'searches'],
  fetch: ['fetched', 'page', 'pages'],
  other: ['used', 'tool', 'tools'],
};

/**
 * "Ran 3 commands, edited 2 files" for a run of tool calls. Each edit call
 * counts the files it changed (`files`, at least 1). The first verb is
 * capitalised; the kinds keep the order they first appeared in.
 */
export function foldSummary(calls: readonly { toolKind: string | null; files?: number }[]): string {
  const counts = new Map<Kind, number>();
  for (const c of calls) {
    const k = kindOf(c.toolKind);
    counts.set(k, (counts.get(k) ?? 0) + (k === 'edit' ? Math.max(1, c.files ?? 1) : 1));
  }
  const parts = [...counts].map(([k, n]) => {
    const [verb, one, many] = PHRASE[k];
    const noun = `${n} ${n === 1 ? one : many}`;
    /* A search counts as "3 searches", not "searched 3 times". */
    return verb ? `${verb.toLowerCase()} ${noun}` : noun;
  });
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
