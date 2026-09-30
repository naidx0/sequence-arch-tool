import assert from 'node:assert';
import { test } from 'node:test';
import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';
import { detectGrpc } from '../detectors/grpc.js';

// @grpc/grpc-js's real server-registration idiom (verified against Online
// Boutique's currencyservice/server.js and paymentservice/server.js): a
// single-step `server.addService(pkg.XService.service, {...})` call, plus the
// two-step form paymentservice actually uses — the proto package is stashed
// on `this.packages...` and only dereferenced into a local before addService
// is called. This mirrors both real files closely enough to gate on.
const DIRECT_SRC = `
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const shopProto = _loadProto(MAIN_PROTO_PATH).hipstershop;
const healthProto = _loadProto(HEALTH_PROTO_PATH).grpc.health.v1;

function main() {
  const server = new grpc.Server();
  server.addService(shopProto.CurrencyService.service, { convert, getSupportedCurrencies });
  server.addService(healthProto.Health.service, { check });
  server.bindAsync('[::]:1234', grpc.ServerCredentials.createInsecure(), () => server.start());
}
`;

const TWO_STEP_SRC = `
class HipsterShopServer {
  loadAllProtos(protoRoot) {
    const hipsterShopPackage = this.packages.hipsterShop.hipstershop;
    const paymentService = hipsterShopPackage.PaymentService.service;
    this.server.addService(paymentService, { charge: this.chargeHandler });
  }
}
`;

test('extractFacts + detectGrpc: @grpc/grpc-js addService(X.service, ...) direct form', async () => {
  await initParser();
  const facts = extractFacts(DIRECT_SRC, 'currencyservice/server.js', 'js');
  const { servers } = detectGrpc('currencyservice', [facts]);

  const currency = servers.find((s) => s.grpcService === 'CurrencyService');
  assert.ok(currency, `expected a CurrencyService server fact, got: ${JSON.stringify(servers)}`);
  assert.strictEqual(currency!.service, 'currencyservice');
  assert.strictEqual(currency!.file, 'currencyservice/server.js');

  // the generic grpc.health.v1 "Health" service is deliberately skipped —
  // it's not a proto service any client in these repos dials by that name,
  // and matching it would just be noise.
  assert.ok(
    !servers.some((s) => s.grpcService === 'Health'),
    'Health should be filtered out by SERVER_NAME_SKIP'
  );
});

test('extractFacts + detectGrpc: @grpc/grpc-js addService(X.service, ...) two-step (local-binding) form', async () => {
  await initParser();
  const facts = extractFacts(TWO_STEP_SRC, 'paymentservice/server.js', 'js');
  const { servers } = detectGrpc('paymentservice', [facts]);

  const payment = servers.find((s) => s.grpcService === 'PaymentService');
  assert.ok(
    payment,
    `expected a PaymentService server fact from the two-step form, got: ${JSON.stringify(servers)}`
  );
  assert.strictEqual(payment!.service, 'paymentservice');
});

test('detectGrpc: addService dedupes per (service, grpcService, file) even if a pattern would fire twice', async () => {
  await initParser();
  const src = `
    server.addService(shopProto.CurrencyService.service, { convert });
    server.addService(shopProto.CurrencyService.service, { convert });
  `;
  const facts = extractFacts(src, 'currencyservice/server.js', 'js');
  const { servers } = detectGrpc('currencyservice', [facts]);
  const matches = servers.filter((s) => s.grpcService === 'CurrencyService');
  assert.strictEqual(matches.length, 1, `expected exactly one deduped server fact, got ${matches.length}`);
});
