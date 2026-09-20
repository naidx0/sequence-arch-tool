import fs from 'node:fs';
import path from 'node:path';
import type { ServiceRole, WireKind } from '../types.js';

export const DATASTORE_IMAGES: Record<string, string> = {
  postgres: 'postgres',
  postgis: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  mongo: 'mongodb',
  elasticsearch: 'elasticsearch',
  memcached: 'memcached',
  clickhouse: 'clickhouse',
};

export const BROKER_IMAGES: Record<string, string> = {
  redis: 'redis',
  valkey: 'redis',
  rabbitmq: 'rabbitmq',
  kafka: 'kafka',
  redpanda: 'kafka',
  nats: 'nats',
  activemq: 'activemq',
  mosquitto: 'mqtt',
};

/** Classify a container image as a known datastore/broker, or a plain app. */
export function classify(image: string | undefined): { role: ServiceRole; tech?: string } {
  if (!image) return { role: 'app' };
  const base = image.split(':')[0].split('/').pop() ?? image;
  for (const [key, tech] of Object.entries(DATASTORE_IMAGES)) {
    if (base.includes(key)) return { role: 'datastore', tech };
  }
  for (const [key, tech] of Object.entries(BROKER_IMAGES)) {
    if (base.includes(key)) return { role: 'broker', tech };
  }
  return { role: 'app' };
}

function hasSourceMarkers(abs: string): boolean {
  const entries = fs.readdirSync(abs);
  return entries.some(
    (e) =>
      /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java)$/.test(e) ||
      ['src', 'app', 'lib'].includes(e) ||
      e === 'package.json' ||
      e === 'requirements.txt' ||
      e === 'pyproject.toml' ||
      e === 'go.mod' ||
      e === 'pom.xml' ||
      e === 'build.gradle' ||
      e === 'build.gradle.kts'
  );
}

/** Image-only services often have their source in a same-named directory of
 * the monorepo (services/<name>, <name>, apps/<name>, packages/<name>).
 * `extraCandidates` lets callers add layout-specific guesses (e.g. Kubernetes
 * repos following the Online Boutique convention of src/<name>) without
 * changing the default order for existing callers. */
export function inferSourceDir(
  repoRoot: string,
  name: string,
  extraCandidates: string[] = []
): string | undefined {
  for (const cand of [`services/${name}`, name, `apps/${name}`, `packages/${name}`, ...extraCandidates]) {
    const abs = path.join(repoRoot, cand);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && hasSourceMarkers(abs)) {
      return cand;
    }
  }
  // Deterministic suffix fallback: some multi-repo-style monorepos (e.g. the
  // spring-petclinic-microservices layout) name every service directory
  // `<prefix>-<name>` or `<prefix>-<name>-service` rather than nesting them
  // under services/apps/packages/<name> or naming them exactly `<name>`.
  // Only fires when none of the conventional candidates above hit, and only
  // when EXACTLY ONE top-level directory ends in `-${name}` or equals a
  // `-service`-stripped/added variant of it — an ambiguous match (more than
  // one candidate) is not guessable and is skipped with a warning by the
  // caller rather than guessed at.
  let topLevel: string[];
  try {
    topLevel = fs.readdirSync(repoRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return undefined;
  }
  const nameVariants = new Set([
    name,
    name.endsWith('-service') ? name.slice(0, -'-service'.length) : `${name}-service`,
  ]);
  const suffixMatches = topLevel.filter((dir) =>
    [...nameVariants].some((v) => dir === v || dir.endsWith(`-${v}`))
  );
  const candidatesWithSource = suffixMatches.filter((dir) => hasSourceMarkers(path.join(repoRoot, dir)));
  if (candidatesWithSource.length === 1) return candidatesWithSource[0];
  return undefined;
}

const SCHEME_KIND: Record<string, WireKind> = {
  http: 'http',
  https: 'http',
  postgres: 'db',
  postgresql: 'db',
  mysql: 'db',
  mariadb: 'db',
  mongodb: 'db',
  redis: 'broker',
  rediss: 'broker',
  amqp: 'broker',
  amqps: 'broker',
  kafka: 'broker',
  nats: 'broker',
};

/** Resolve a hostname against known service names, also matching Kubernetes-style
 * dotted forms on their first label: `<name>.<namespace>.svc.cluster.local` and
 * the shorter `<name>.<namespace>` both resolve to `<name>` when that first label
 * is itself a known service. Compose service names never contain dots, so this
 * is a no-op extension for compose callers. */
function resolveHostname(host: string, serviceNames: Set<string>): string | undefined {
  if (serviceNames.has(host)) return host;
  const svcClusterLocal = host.match(/^([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\.svc\.cluster\.local$/);
  if (svcClusterLocal && serviceNames.has(svcClusterLocal[1])) return svcClusterLocal[1];
  const nameAndNamespace = host.match(/^([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/);
  if (nameAndNamespace && serviceNames.has(nameAndNamespace[1])) return nameAndNamespace[1];
  return undefined;
}

/**
 * Find references to other known services inside an env value.
 * Handles URL forms (scheme://[user:pass@]host[:port]/...) and bare host:port.
 */
export function parseWireValue(
  value: string,
  serviceNames: Set<string>
): { targetService: string; kind: WireKind; port?: number } | undefined {
  // JDBC URLs (`jdbc:postgresql://host:port/db`) wrap a normal scheme://
  // URL behind a `jdbc:` prefix — strip it before the usual scheme match so
  // mysql/postgresql/mariadb resolve exactly like every other URL-shaped
  // wire value (smallest clean change per docs/SPIKE_RESULTS.md v3 P2).
  const jdbcStripped = value.replace(/^jdbc:/i, '');
  const urlMatch = jdbcStripped.match(
    /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/\s]+@)?([A-Za-z0-9_.-]+)(?::(\d+))?/i
  );
  if (urlMatch) {
    const [, scheme, host, port] = urlMatch;
    const resolved = resolveHostname(host, serviceNames);
    if (resolved) {
      return {
        targetService: resolved,
        kind: SCHEME_KIND[scheme.toLowerCase()] ?? 'addr',
        port: port ? Number(port) : undefined,
      };
    }
    return undefined;
  }
  // comma-separated broker lists (kafka:9092,kafka2:9092) — take first internal hit
  for (const piece of value.split(',')) {
    const m = piece.trim().match(/^([A-Za-z0-9_.-]+):(\d+)$/);
    if (m) {
      const resolved = resolveHostname(m[1], serviceNames);
      if (resolved) return { targetService: resolved, kind: 'addr', port: Number(m[2]) };
    }
  }
  const resolved = resolveHostname(value.trim(), serviceNames);
  if (resolved) return { targetService: resolved, kind: 'addr' };
  return undefined;
}
