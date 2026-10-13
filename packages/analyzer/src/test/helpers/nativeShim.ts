import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A fake command that is a real executable, on every OS.
 *
 * The code under test refuses a Windows `.cmd` wrapper it does not know (executableFromResolved), as the real
 * `claude` is a native binary, so a fake written as a `.cmd` cannot stand in for it. On Windows this compiles a
 * tiny C# launcher with the .NET Framework compiler every Windows has, once per source hash (cached under the OS temp
 * dir), and copies it to `<dir>/<name>.exe`. The launcher reads `<name>.exe.target` beside itself (line 1: the program,
 * line 2: the script), runs `program script args...` with the same stdio and returns its exit code. On POSIX it writes
 * a `#!/bin/sh` script that does the same. Every child here is started hidden: no console window is ever opened.
 */

const CS = String.raw`using System;
using System.Diagnostics;
using System.IO;
using System.Text;
static class Shim {
  const char B = (char)92;
  static readonly string Q1 = ((char)34).ToString();
  static string Q(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
    var sb = new StringBuilder(Q1);
    int bs = 0;
    foreach (char c in a) {
      if (c == B) { bs++; continue; }
      if (c == '"') { sb.Append(B, bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
      sb.Append(B, bs); bs = 0; sb.Append(c);
    }
    sb.Append(B, bs * 2); sb.Append('"');
    return sb.ToString();
  }
  static int Main(string[] args) {
    string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
    string[] t = File.ReadAllLines(self + ".target");
    var sb = new StringBuilder(Q(t[1]));
    foreach (var a in args) sb.Append(' ').Append(Q(a));
    var psi = new ProcessStartInfo(t[0], sb.ToString());
    psi.UseShellExecute = false;
    using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }
  }
}
`;

function compiledShim(): string {
  const hash = createHash('sha256').update(CS).digest('hex').slice(0, 16);
  const cache = path.join(os.tmpdir(), `sequence-native-shim-${hash}.exe`);
  if (fs.existsSync(cache)) return cache;
  const csc = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-shim-build-'));
  try {
    const src = path.join(work, 'shim.cs');
    const out = path.join(work, 'shim.exe');
    fs.writeFileSync(src, CS);
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${out}`, src], { windowsHide: true, stdio: 'pipe' });
    fs.copyFileSync(out, `${cache}.${process.pid}`);
    fs.renameSync(`${cache}.${process.pid}`, cache);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return cache;
}

/** Make `<dir>/<name>` (`.exe` on Windows) run `node scriptPath args...`. Returns the file written. */
export function makeNativeShim(dir: string, name: string, scriptPath: string): string {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const exe = path.join(dir, `${name}.exe`);
    fs.copyFileSync(compiledShim(), exe);
    fs.writeFileSync(`${exe}.target`, `${process.execPath}\n${scriptPath}\n`);
    return exe;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}
