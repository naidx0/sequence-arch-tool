import assert from 'node:assert';
import { test } from 'node:test';
import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';

const SRC = `
package shop.invoices;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.beans.factory.annotation.Value;

@RestController
@RequestMapping("/invoices")
public class InvoiceController {

    @Value("\${cart.endpoint:cart}")
    private String cartEndpoint;

    @Value("\${PAYMENTS_URL}")
    private String paymentsUrl;

    @RabbitListener(queues = {"a", "b"})
    public void onMessage() {}

    @GetMapping("/{id}")
    public String getInvoice(@PathVariable String id) {
        return restTemplate.getForObject(cartEndpoint + "/ping", String.class);
    }
}
`;

test('Java facts: @Value relaxed binding (with and without a default) and annotation extraction', async () => {
  await initParser();
  const facts = extractFacts(SRC, 'InvoiceController.java', 'java');

  // @Value("${cart.endpoint:cart}") -> relaxed-bound env CART_ENDPOINT with a literal fallback
  const cartEndpoint = facts.assignments.get('cartEndpoint');
  assert.ok(cartEndpoint, 'expected an assignment for cartEndpoint');
  assert.deepStrictEqual(cartEndpoint, [
    { t: 'env', name: 'CART_ENDPOINT', fallback: [{ t: 'lit', v: 'cart' }] },
  ]);

  // @Value("${PAYMENTS_URL}") -> no default, no fallback
  const paymentsUrl = facts.assignments.get('paymentsUrl');
  assert.ok(paymentsUrl, 'expected an assignment for paymentsUrl');
  assert.deepStrictEqual(paymentsUrl, [{ t: 'env', name: 'PAYMENTS_URL', fallback: undefined }]);

  // class/field/method annotations all captured with correct target + context
  assert.ok(facts.annotations, 'expected annotations to be populated for a Java file');
  const byName = (name: string) => facts.annotations!.filter((a) => a.name === name);

  const restController = byName('RestController');
  assert.strictEqual(restController.length, 1);
  assert.strictEqual(restController[0].target, 'class');
  assert.strictEqual(restController[0].className, 'InvoiceController');

  const requestMapping = byName('RequestMapping');
  assert.strictEqual(requestMapping.length, 1);
  assert.deepStrictEqual(requestMapping[0].args[''], [{ t: 'lit', v: '/invoices' }]);

  const valueAnnos = byName('Value');
  assert.strictEqual(valueAnnos.length, 2);
  assert.strictEqual(valueAnnos[0].target, 'field');
  assert.strictEqual(valueAnnos[0].fieldName, 'cartEndpoint');
  assert.strictEqual(valueAnnos[1].fieldName, 'paymentsUrl');

  const rabbit = byName('RabbitListener');
  assert.strictEqual(rabbit.length, 1);
  assert.strictEqual(rabbit[0].target, 'method');
  assert.strictEqual(rabbit[0].className, 'InvoiceController');
  assert.deepStrictEqual(rabbit[0].args['queues'], [
    { t: 'lit', v: 'a' },
    { t: 'lit', v: 'b' },
  ]);

  const getMapping = byName('GetMapping');
  assert.strictEqual(getMapping.length, 1);
  assert.strictEqual(getMapping[0].target, 'method');

  // restTemplate.getForObject(cartEndpoint + "/ping", ...) resolves through
  // the cartEndpoint field binding to an env-with-fallback URL.
  const call = facts.calls.find((c) => c.callee === 'restTemplate.getForObject');
  assert.ok(call, 'expected a restTemplate.getForObject call');
  assert.deepStrictEqual(call!.args[0], [
    { t: 'ref', name: 'cartEndpoint' },
    { t: 'lit', v: '/ping' },
  ]);
});
