import fs from 'node:fs';
import type {
  FileFacts,
  GrpcClientFact,
  GrpcServerFact,
  Part,
  ProtoServiceFact,
} from '../types.js';
import { resolveParts } from '../parse/facts.js';

export function parseProtoServices(protoFile: string, repoRel: string): ProtoServiceFact[] {
  const out: ProtoServiceFact[] = [];
  const src = fs.readFileSync(protoFile, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*service\s+(\w+)\s*\{?/);
    if (m) out.push({ grpcService: m[1], file: repoRel, line: i + 1 });
  }
  return out;
}

// Generated servers that aren't application-level gRPC services — skip these
// even though they match a real server-registration pattern (Go's
// Register(\w+)Server$, or JS's addService(X.service, ...)). Every language's
// gRPC health-check wiring registers a service literally named "Health" this
// way; it isn't a proto service any client in these repos dials by that name
// (health clients, where present, are their own out-of-scope skip already —
// see Go's healthpb import), so treating it as a real server would only add
// noise, never recall.
const SERVER_NAME_SKIP = new Set(['Health', 'ServerReflection', 'ChannelzService']);

export function detectGrpc(
  service: string,
  facts: FileFacts[]
): { clients: GrpcClientFact[]; servers: GrpcServerFact[] } {
  const clients: GrpcClientFact[] = [];
  const servers: GrpcServerFact[] = [];

  // Dedupe guard shared by every server-registration pattern below (Python
  // add_XServicer_to_server, Go RegisterXServer, Java ImplBase, JS addService)
  // — more than one idiom can in principle name the same proto service in the
  // same file (e.g. a fluent grpc-java builder chain visits several
  // `.addService(...)` call nodes), and we only want one GrpcServerFact per
  // (service, grpcService, file) out of this function.
  const seenServer = new Set<string>();
  const pushServer = (fact: GrpcServerFact): void => {
    const key = `${fact.service}|${fact.grpcService}|${fact.file}`;
    if (seenServer.has(key)) return;
    seenServer.add(key);
    servers.push(fact);
  };

  // Go client gate, service-wide: a service that imports anything grpc-ish
  // ANYWHERE in its own files plausibly deals with gRPC, even when the actual
  // New(\w+)Client call site lives in a different file than the grpc.Dial /
  // import line — a common Go layout (e.g. connection setup in main.go,
  // RPC call sites in a separate rpc.go/handlers.go, as in Online Boutique's
  // frontend). Keeps the original per-file signal too, so this only widens
  // the gate rather than narrowing it.
  const serviceHasGrpcImport = facts.some((f) => f.imports.some((i) => /grpc/i.test(i.raw)));

  for (const f of facts) {
    const snippet = (line: number) => (f.lines[line - 1] ?? '').trim().slice(0, 200);

    // channel targets in this file (used to enrich client facts)
    let channelAddr: Part[] | undefined;
    for (const call of f.calls) {
      if (/(^|\.)insecure_channel$|(^|\.)secure_channel$/.test(call.callee) && call.args[0]) {
        channelAddr = resolveParts(call.args[0], f.assignments);
      }
    }
    // Java: ManagedChannelBuilder.forAddress(host, port) / .forTarget("host:port")
    // — only the host (first arg) matters for hostname resolution downstream
    // (the joiner inspects addr[0] alone), so the port arg is never needed.
    let javaChannelAddr: Part[] | undefined;
    for (const call of f.calls) {
      if (/^ManagedChannelBuilder\.(forAddress|forTarget)$/.test(call.callee) && call.args[0]) {
        javaChannelAddr = resolveParts(call.args[0], f.assignments);
      }
    }
    // Go: grpc.Dial(target, ...) / grpc.NewClient(target, ...)
    let goChannelAddr: Part[] | undefined;
    for (const call of f.calls) {
      if (/^grpc\.(Dial|NewClient)$/.test(call.callee) && call.args[0]) {
        goChannelAddr = resolveParts(call.args[0], f.assignments);
      }
    }
    // Go client gate: only trust New(\w+)Client callees when this file plausibly
    // deals with gRPC at all — either it imports something grpc-ish, or it dialed
    // a grpc channel in this same file. Keeps this from matching arbitrary
    // "NewFooClient" constructors (e.g. an HTTP SDK) that have nothing to do with gRPC.
    const hasGrpcImport = serviceHasGrpcImport || f.imports.some((i) => /grpc/i.test(i.raw));
    const hasGrpcDial = goChannelAddr !== undefined;

    for (const call of f.calls) {
      // python generated stubs: inventory_pb2_grpc.InventoryStub(channel)
      const stubMatch = call.callee.match(/(\w+)_pb2_grpc\.(\w+)Stub$/);
      if (stubMatch) {
        clients.push({
          service,
          grpcService: stubMatch[2],
          addr: channelAddr,
          file: f.file,
          line: call.line,
          snippet: snippet(call.line),
        });
        continue;
      }
      // python server registration: add_InventoryServicer_to_server(...)
      const addMatch = call.callee.match(/add_(\w+)Servicer_to_server$/);
      if (addMatch) {
        pushServer({
          service,
          grpcService: addMatch[1],
          file: f.file,
          line: call.line,
          snippet: snippet(call.line),
        });
        continue;
      }
      // @grpc/grpc-js server registration: server.addService(shopProto.CurrencyService.service, {...})
      // (also the two-step `const svc = pkg.CurrencyService.service; server.addService(svc, impls)`
      // form, resolved the same way via resolveParts + f.assignments). arg0's
      // *text shape* — a member-expression ending in `.service` — is what
      // identifies this idiom; evalJs (parse/facts.ts) special-cases exactly
      // that shape into a literal Part carrying the raw text instead of the
      // usual hole, specifically so this regex has something to match against.
      // See the addService-focused fixture test for the case that motivated this.
      if (/(?:^|\.)addService$/.test(call.callee) && call.args[0]) {
        const resolved = resolveParts(call.args[0], f.assignments);
        const arg0 = resolved.find((p) => !(p.t === 'lit' && p.v === ''));
        const svcMatch = arg0?.t === 'lit' ? arg0.v.match(/(\w+)\.service$/) : undefined;
        if (svcMatch && !SERVER_NAME_SKIP.has(svcMatch[1])) {
          pushServer({
            service,
            grpcService: svcMatch[1],
            file: f.file,
            line: call.line,
            snippet: snippet(call.line),
          });
          continue;
        }
      }
      // Go generated client constructors: pb.NewInventoryClient(conn)
      const goClientMatch = call.callee.match(/(?:^|\.)New(\w+)Client$/);
      if (goClientMatch && (hasGrpcImport || hasGrpcDial)) {
        clients.push({
          service,
          grpcService: goClientMatch[1],
          addr: goChannelAddr,
          file: f.file,
          line: call.line,
          snippet: snippet(call.line),
        });
        continue;
      }
      // Go generated server registration: pb.RegisterInventoryServer(s, impl)
      const goServerMatch = call.callee.match(/(?:^|\.)Register(\w+)Server$/);
      if (goServerMatch && !SERVER_NAME_SKIP.has(goServerMatch[1])) {
        pushServer({
          service,
          grpcService: goServerMatch[1],
          file: f.file,
          line: call.line,
          snippet: snippet(call.line),
        });
      }

      // Java generated client stubs: InventoryGrpc.newBlockingStub(channel) /
      // InventoryGrpc.newFutureStub(channel) / InventoryGrpc.newStub(channel)
      // (protoc-gen-grpc-java's standard static factory methods).
      const javaClientMatch = call.callee.match(/^(\w+)Grpc\.new(?:Blocking|Future)?Stub$/);
      if (javaClientMatch) {
        clients.push({
          service,
          grpcService: javaClientMatch[1],
          addr: javaChannelAddr,
          file: f.file,
          line: call.line,
          snippet: snippet(call.line),
        });
      }
    }

    for (const cls of f.classes) {
      for (const base of cls.bases) {
        const m = base.match(/(\w+)_pb2_grpc\.(\w+)Servicer$/);
        if (m) {
          pushServer({
            service,
            grpcService: m[2],
            file: f.file,
            line: cls.line,
            snippet: snippet(cls.line),
          });
        }
        // Java generated server base: class MyImpl extends InventoryGrpc.InventoryImplBase
        // — by protoc-gen-grpc-java convention the Grpc-prefix and ImplBase-prefix
        // are always the same proto service name (InventoryGrpc.InventoryImplBase),
        // verified against the shape generated for shopfront's own inventory.proto-style
        // services; using the Grpc-prefix capture keeps this symmetric with the
        // client-side match above.
        const javaServerMatch = base.match(/^(\w+)Grpc\.\w+ImplBase$/);
        if (javaServerMatch) {
          pushServer({
            service,
            grpcService: javaServerMatch[1],
            file: f.file,
            line: cls.line,
            snippet: snippet(cls.line),
          });
        }
      }
    }
  }
  return { clients, servers };
}
