/* ══════════════════════════════════════════════════════════════════════════
   "ALWAYS" MEANS THIS COMMAND, AT ITS ARITY
   packages/acp/src/arity.ts

   Design after OpenCode's permission/arity.ts (github.com/sst/opencode, MIT,
   Copyright (c) 2025 opencode): a command's PREFIX is its first N words,
   where N is how many words name the command for that tool. `git checkout
   main` is `git checkout`, never `git`; `npm run build` is `npm run build`;
   `ls -la` is `ls`. The table below is written here, not copied.

   Agents often wrap the command in a shell (`powershell.exe -Command "…"`,
   `bash -lc '…'`, `cmd /c …`); the prefix is the wrapped command's, because
   that is what the person read and approved.
   ══════════════════════════════════════════════════════════════════════════ */

/** Words that name the command, by its first word (or first two). Unlisted: 1. */
const ARITY: Readonly<Record<string, number>> = {
  git: 2,
  npm: 2,
  'npm run': 3,
  'npm exec': 3,
  pnpm: 2,
  'pnpm run': 3,
  'pnpm exec': 3,
  'pnpm dlx': 3,
  yarn: 2,
  'yarn run': 3,
  bun: 2,
  'bun run': 3,
  npx: 2,
  bunx: 2,
  node: 2,
  deno: 2,
  python: 2,
  python3: 2,
  py: 2,
  pip: 2,
  pip3: 2,
  uv: 2,
  'uv run': 3,
  poetry: 2,
  cargo: 2,
  go: 2,
  dotnet: 2,
  make: 2,
  docker: 2,
  'docker compose': 3,
  kubectl: 2,
  gh: 3,
  terraform: 2,
  brew: 2,
  apt: 2,
  'apt-get': 2,
  winget: 2,
  choco: 2,
};

/** Split a command line into words, honouring quotes. */
export function words(command: string): string[] {
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

/** The command a shell wrapper runs, or the line itself when it is not wrapped. */
export function unwrapShell(command: string): string {
  const w = words(command.trim());
  if (w.length >= 3) {
    const shell = base(w[0]!);
    const flag = w[1]!.toLowerCase();
    if ((shell === 'powershell' || shell === 'pwsh') && (flag === '-command' || flag === '-c')) return unwrapShell(w.slice(2).join(' '));
    if ((shell === 'bash' || shell === 'sh' || shell === 'zsh') && /^-l?c$|^-cl$/.test(flag)) return unwrapShell(w.slice(2).join(' '));
    if (shell === 'cmd' && (flag === '/c' || flag === '/s')) return unwrapShell(w.slice(flag === '/s' && w[2]?.toLowerCase() === '/c' ? 3 : 2).join(' '));
  }
  return command.trim();
}

/**
 * The prefix an "Always" rule is scoped to: `npm test`, `git checkout`,
 * `npm run build`, `ls`. Null for an empty command.
 */
export function commandPrefix(command: string): string | null {
  const w = words(unwrapShell(command));
  if (w.length === 0) return null;
  const first = base(w[0]!);
  const two = w.length > 1 ? `${first} ${w[1]}` : '';
  const n = ARITY[two] ?? ARITY[first] ?? 1;
  return [first, ...w.slice(1, n)].join(' ');
}

/** Whether `command` falls under the rule for `prefix`. */
export function matchesPrefix(command: string, prefix: string): boolean {
  return commandPrefix(command) === prefix;
}
