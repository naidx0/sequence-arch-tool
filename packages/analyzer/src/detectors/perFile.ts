/**
 * The detectors, one file at a time, so a file that has not changed is not detected again.
 *
 * Every detector in this directory is a loop over the service's files that pushes
 * what it finds, so a service's answer is the concatenation of its files' answers.
 * Two things are not a plain concatenation and are handled here, not guessed:
 *
 *   - Java routes lead the service's route list (`detectHttp` runs its Java pass over
 *     ALL files first), so each file reports them apart and `mergeDetections` puts
 *     them first;
 *   - `detectDbEngines` keeps the FIRST occurrence of each engine across the service,
 *     so each file reports its own first occurrence and the merge keeps the first file's.
 *
 * What else a file's answer depends on is in `detectionsKey`: the service it is
 * attributed to, the infra services and env wires `detectConnections` resolves hosts
 * against, and whether any file of the service imports grpc. A cached answer is served
 * only when that key matches, so adding a datastore to compose or a grpc import to a
 * sibling file re-detects the files it could change.
 *
 * `scan-incremental.test.ts` runs the whole scan through both paths and compares.
 */
import { createHash } from 'node:crypto';
import type {
  ClientCallFact,
  ConnectionFact,
  FileFacts,
  GrpcClientFact,
  GrpcServerFact,
  MountFact,
  QueueOpFact,
  RouteFact,
  ServiceInfo,
  TableAccessFact,
  Wire,
} from '../types.js';
import { detectConnections } from './connections.js';
import { detectDb, detectDbEngines, type DbEngineFact } from './db.js';
import { detectGrpc } from './grpc.js';
import { detectHttpFile } from './http.js';
import { detectQueues } from './queues.js';

/**
 * What the detectors found in one file. Plain data: it is persisted in the scan index, SPARSE: a key whose list
 * is empty is absent (most files detect nothing, and ten empty lists per file per service was most of the bytes).
 */
export interface FileDetections {
  java?: RouteFact[];
  routes?: RouteFact[];
  mounts?: MountFact[];
  clients?: ClientCallFact[];
  queues?: QueueOpFact[];
  tables?: TableAccessFact[];
  engines?: DbEngineFact[];
  conns?: ConnectionFact[];
  grpcClients?: GrpcClientFact[];
  grpcServers?: GrpcServerFact[];
}

const EMPTY: FileDetections = Object.freeze({}) as FileDetections;

/**
 * A copy of `d` that later passes may keep or change (joinAll and the node build are handed these facts).
 * Most files detect nothing, so most copies are the one shared empty answer, which `mergeDetections` only reads.
 */
export function cloneDetections(d: FileDetections): FileDetections {
  let out: Record<string, unknown> | undefined;
  for (const k of Object.keys(d) as Array<keyof FileDetections>) {
    const list = d[k];
    if (list && list.length > 0) (out ??= {})[k] = structuredClone(list);
  }
  return (out as FileDetections | undefined) ?? EMPTY;
}

/** Everything besides the file that its detections depend on, as a digest. */
export function detectionsKey(
  service: ServiceInfo,
  infraByName: ReadonlyMap<string, ServiceInfo>,
  wires: readonly Wire[],
  serviceHasGrpcImport: boolean,
): string {
  return createHash('sha1')
    .update(
      JSON.stringify([
        service.name,
        [...infraByName.keys()].sort(),
        wires
          .filter((w) => w.service === service.name)
          .map((w) => [w.envKey, w.targetService])
          .sort(),
        serviceHasGrpcImport,
      ]),
    )
    .digest('hex');
}

export function detectFile(
  service: ServiceInfo,
  f: FileFacts,
  infraByName: Map<string, ServiceInfo>,
  wires: Wire[],
  serviceHasGrpcImport: boolean,
): FileDetections {
  const http = detectHttpFile(service.name, f);
  const grpc = detectGrpc(service.name, [f], serviceHasGrpcImport);
  return {
    java: http.java,
    routes: http.routes,
    mounts: http.mounts,
    clients: http.clients,
    queues: detectQueues(service.name, [f]),
    tables: detectDb(service.name, [f]),
    engines: detectDbEngines(service.name, [f]),
    conns: detectConnections(service, [f], infraByName, wires),
    grpcClients: grpc.clients,
    grpcServers: grpc.servers,
  };
}

/** A service's detections from its files' (in file order): what the detectors' loops would have returned. */
export function mergeDetections(per: readonly FileDetections[]): {
  routes: RouteFact[];
  mounts: MountFact[];
  clients: ClientCallFact[];
  queueOps: QueueOpFact[];
  tables: TableAccessFact[];
  dbEngines: DbEngineFact[];
  connections: ConnectionFact[];
  grpcClients: GrpcClientFact[];
  grpcServers: GrpcServerFact[];
} {
  const engines = new Map<string, DbEngineFact>();
  for (const p of per) for (const e of p.engines ?? []) if (!engines.has(e.engine)) engines.set(e.engine, e);
  const all = <K extends keyof FileDetections>(k: K): NonNullable<FileDetections[K]> => {
    const out: unknown[] = [];
    for (const p of per) {
      const list = p[k];
      if (list) out.push(...list);
    }
    return out as NonNullable<FileDetections[K]>;
  };
  return {
    routes: [...all('java'), ...all('routes')],
    mounts: all('mounts'),
    clients: all('clients'),
    queueOps: all('queues'),
    tables: all('tables'),
    dbEngines: [...engines.values()].sort((a, b) => a.engine.localeCompare(b.engine)),
    connections: all('conns'),
    grpcClients: all('grpcClients'),
    grpcServers: all('grpcServers'),
  };
}
