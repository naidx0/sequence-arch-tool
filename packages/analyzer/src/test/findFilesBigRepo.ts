/**
 * A synthetic 20,000-file repository for the find_files memory and latency
 * tests: TypeScript-shaped files (~1.6 KB each, ~32 MB in all) with imports,
 * definitions and comments drawn from a 6,000-word vocabulary plus names unique
 * to each file, in one commit. Deterministic.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeBigRepo(files = 20_000): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-ff-big-')));
  let seed = 12345;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const syl = ['ka', 'lo', 'mi', 'ten', 'ra', 'sul', 'vor', 'pe', 'qua', 'dex', 'ni', 'bra', 'zo', 'tul', 'fen', 'gor', 'ha', 'jin', 'wex', 'yu'];
  const vocab: string[] = [];
  for (let i = 0; i < 6000; i++) vocab.push(syl[i % 20]! + syl[Math.floor(i / 20) % 20]! + syl[Math.floor(i / 400) % 20]! + (i >= 8000 ? String(i) : ''));
  const w = (): string => vocab[rnd(vocab.length)]!;
  const rel = (i: number): string => `packages/p${i % 40}/src/m${i % 500}/${w()}${i}.ts`;
  const names: string[] = [];
  for (let i = 0; i < files; i++) names.push(rel(i));
  for (let i = 0; i < files; i++) {
    const lines: string[] = [];
    for (let k = 0; k < 3; k++) {
      const j = rnd(files);
      lines.push(`import { ${w()}${j} } from '${path.posix.relative(path.posix.dirname(names[i]!), names[j]!).replace(/\.ts$/, '')}';`);
    }
    for (let f = 0; f < 4; f++) {
      const fn = `${w()}${w().replace(/^./, (c) => c.toUpperCase())}${i}_${f}`;
      lines.push(`/** ${w()} ${w()} ${w()} ${w()} ${w()} ${w()} ${w()} */`);
      lines.push(`export function ${fn}(${w()}: number, ${w()}: string): number {`);
      lines.push(`  const ${w()} = ${w()}${rnd(100)} + ${rnd(1000)}; // ${w()} ${w()} ${w()}`);
      lines.push(`  if (${w()} > ${rnd(50)}) return ${w()}(${w()}, '${w()} ${w()}');`);
      lines.push(`  return ${w()}.${w()}(${w()}) * ${rnd(9)};`);
      lines.push('}');
    }
    const p = path.join(dir, names[i]!);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${lines.join('\n')}\n`);
  }
  const git = (...a: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, stdio: 'ignore', maxBuffer: 1 << 28 });
  };
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'big synthetic repo');
  return dir;
}
