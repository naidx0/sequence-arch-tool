import type { FileFacts, TableAccessFact } from '../types.js';
import { resolveParts } from '../parse/facts.js';

// Go database/sql idioms end in Query/QueryRow/QueryContext/QueryRowContext/
// Exec/ExecContext — none of which end in the bare "query"/"exec" the original
// regex already covers case-insensitively. Bare Get/Select are intentionally
// NOT added here — too generic, would false-positive on unrelated getters.
// Spring JdbcTemplate's queryForObject/queryForList/queryForMap/queryForRowSet
// don't end in a bare "query" either — added explicitly rather than widening
// "query" to a prefix match (which would also swallow unrelated queryXyz()).
const DB_CALLEE_HINT =
  /(execute|text|prepare|sql|run|query(row)?(context)?|exec(context)?|queryfor(object|list|map|rowset))$/i;
const STRONG_SQL_START = /^\s*(select|insert|update|delete|create\s+table|alter\s+table)\b/i;

interface SqlHit {
  table: string;
  access: 'read' | 'write';
}

export function extractTablesFromSql(sql: string): SqlHit[] {
  const hits: SqlHit[] = [];
  const seen = new Set<string>();
  const push = (table: string, access: 'read' | 'write') => {
    const t = table.replace(/["'`]/g, '').toLowerCase();
    // filter obvious non-tables
    if (!/^[a-z_][a-z0-9_.]*$/.test(t)) return;
    const key = `${t}:${access}`;
    if (!seen.has(key)) {
      seen.add(key);
      hits.push({ table: t, access });
    }
  };
  for (const m of sql.matchAll(/\b(?:from|join)\s+([A-Za-z_"'`][\w."'`]*)/gi)) {
    // "DELETE FROM x" is a write; plain FROM/JOIN is a read
    const before = sql.slice(0, m.index).trimEnd().toLowerCase();
    if (before.endsWith('delete')) push(m[1], 'write');
    else push(m[1], 'read');
  }
  for (const m of sql.matchAll(/\binsert\s+into\s+([A-Za-z_"'`][\w."'`]*)/gi)) push(m[1], 'write');
  for (const m of sql.matchAll(/\bupdate\s+([A-Za-z_"'`][\w."'`]*)\s+set\b/gi)) push(m[1], 'write');
  return hits;
}

const ORM_BASE_HINT = /(Base|DeclarativeBase|Model)\b/;

export function detectDb(service: string, facts: FileFacts[]): TableAccessFact[] {
  const out: TableAccessFact[] = [];
  for (const f of facts) {
    const snippet = (line: number) => (f.lines[line - 1] ?? '').trim().slice(0, 200);

    // raw SQL in call arguments
    for (const call of f.calls) {
      const calleeHint = DB_CALLEE_HINT.test(call.callee);
      for (const rawArg of call.args) {
        const parts = resolveParts(rawArg, f.assignments);
        // join literals (f-string SQL still yields lits around holes)
        const text = parts.map((p) => (p.t === 'lit' ? p.v : ' ? ')).join('');
        if (!text || text.length < 12) continue;
        if (!calleeHint && !STRONG_SQL_START.test(text)) continue;
        if (!/\b(from|join|into|update)\b/i.test(text)) continue;
        for (const hit of extractTablesFromSql(text)) {
          out.push({
            service,
            table: hit.table,
            access: hit.access,
            via: 'sql',
            file: f.file,
            line: call.line,
            snippet: snippet(call.line),
          });
        }
      }
    }

    // ORM models (SQLAlchemy declarative)
    for (const cls of f.classes) {
      const table = cls.stringProps['__tablename__'];
      if (table && cls.bases.some((b) => ORM_BASE_HINT.test(b))) {
        out.push({
          service,
          table: table.toLowerCase(),
          access: 'unknown',
          via: 'orm',
          file: f.file,
          line: cls.line,
          snippet: snippet(cls.line),
        });
      }
    }

    // JPA: a class annotated @Entity, with an explicit @Table(name = "x")
    // giving the table name — direction unknown, same as the SQLAlchemy path.
    if (f.annotations) {
      const entityClasses = new Set(
        f.annotations.filter((a) => a.name === 'Entity' && a.target === 'class').map((a) => a.className)
      );
      for (const a of f.annotations) {
        if (a.target !== 'class' || a.name !== 'Table' || !entityClasses.has(a.className)) continue;
        const nameArg = a.args['name'] ?? a.args[''];
        const table = nameArg && nameArg.length === 1 && nameArg[0].t === 'lit' ? nameArg[0].v : undefined;
        if (table) {
          out.push({
            service,
            table: table.toLowerCase(),
            access: 'unknown',
            via: 'orm',
            file: f.file,
            line: a.line,
            snippet: snippet(a.line),
          });
        }
      }

      // Spring Data JPA @Query("SELECT ...") on a repository method — run the
      // same SQL table extractor used for raw-SQL call arguments.
      for (const a of f.annotations) {
        if (a.name !== 'Query' || a.target !== 'method') continue;
        const sqlArg = a.args[''] ?? a.args['value'];
        const text = sqlArg && sqlArg.length === 1 && sqlArg[0].t === 'lit' ? sqlArg[0].v : undefined;
        if (!text || text.length < 12) continue;
        for (const hit of extractTablesFromSql(text)) {
          out.push({
            service,
            table: hit.table,
            access: hit.access,
            via: 'sql',
            file: f.file,
            line: a.line,
            snippet: snippet(a.line),
          });
        }
      }
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   WHICH ENGINE — the fact the scan could see and did not record.

   `joinAll` mints an inferred datastore from parsed table accesses and states,
   correctly, that "a SELECT proves a database is there, not which one it is".
   That is honest and it left a real gap: the DRIVER names the engine. A file
   that calls `sqlite3.connect` is not evidence that some database exists, it is
   evidence that SQLite exists, and the scan read that line already.

   The gap had a cost. The claim checker's whole premise is that the graph
   enumerates the datastores it found, so a technology that is absent can be
   refuted — and with every inferred store recording no engine, the checker
   could not tell "this repo does not use MySQL" from "this repo's engine is
   unknown". It flagged SQLITE as unsupported on a repository whose only
   database is SQLite.

   THIS MATCHES DRIVERS, NEVER PROSE. Each signature is a call or an import that
   only appears when the driver is actually wired in; a bare mention of
   "postgres" in a comment or a connection-string variable name proves nothing
   and is not matched. Every fact carries the file and line it came from, so the
   engine is as citable as every other claim in the graph.
   ══════════════════════════════════════════════════════════════════════════ */

/** A database engine the code demonstrably drives, with the line that proves it. */
export interface DbEngineFact {
  service: string;
  /** Canonical engine name, matching the vocabulary the claim checker uses. */
  engine: 'sqlite' | 'postgres' | 'mysql' | 'mongodb' | 'redis';
  file: string;
  line: number;
  snippet: string;
}

/**
 * Driver signatures, most specific first.
 *
 * Anchored on the API a driver actually exposes — `sqlite3.connect`,
 * `psycopg2.connect`, `new MongoClient` — rather than on the package name
 * alone, so a dependency listed and never used does not become a claim about
 * the running system.
 */
const ENGINE_SIGNATURES: ReadonlyArray<{ engine: DbEngineFact['engine']; re: RegExp }> = [
  { engine: 'sqlite', re: /\b(?:sqlite3\s*\.\s*(?:connect|Database)|better-sqlite3|from\s+['"]sqlite3?['"]|require\(\s*['"](?:better-)?sqlite3['"]|import\s+sqlite3\b|aiosqlite\b)/ },
  { engine: 'postgres', re: /\b(?:psycopg2?\s*\.\s*connect|asyncpg\s*\.\s*(?:connect|create_pool)|new\s+Pool\s*\(|from\s+['"]pg['"]|require\(\s*['"]pg['"]|pgxpool\s*\.\s*New|lib\/pq)/ },
  { engine: 'mysql', re: /\b(?:mysql\s*\.\s*connector|pymysql\s*\.\s*connect|MySQLdb\s*\.\s*connect|require\(\s*['"]mysql2?['"]|from\s+['"]mysql2?['"]|go-sql-driver\/mysql)/ },
  { engine: 'mongodb', re: /\b(?:new\s+MongoClient|MongoClient\s*\(|mongoose\s*\.\s*connect|pymongo\s*\.\s*MongoClient|mongo-driver\/mongo)/ },
  { engine: 'redis', re: /\b(?:redis\s*\.\s*(?:createClient|Redis|from_url)|new\s+Redis\s*\(|go-redis\/redis|StrictRedis\s*\()/ },
];

/**
 * Engines this service demonstrably drives. One fact per engine — the FIRST
 * occurrence, because the claim is "this repo uses SQLite" and forty more
 * `sqlite3.connect` calls do not make it truer, they make the evidence list
 * unreadable.
 */
export function detectDbEngines(service: string, facts: FileFacts[]): DbEngineFact[] {
  const seen = new Map<string, DbEngineFact>();
  for (const f of facts) {
    for (let i = 0; i < f.lines.length; i++) {
      const line = f.lines[i] ?? '';
      if (line.length === 0 || line.length > 400) continue;
      for (const { engine, re } of ENGINE_SIGNATURES) {
        if (seen.has(engine) || !re.test(line)) continue;
        seen.set(engine, {
          service,
          engine,
          file: f.file,
          line: i + 1,
          snippet: line.trim().slice(0, 200),
        });
      }
    }
  }
  /* Sorted so a scan is byte-stable. */
  return [...seen.values()].sort((a, b) => a.engine.localeCompare(b.engine));
}
