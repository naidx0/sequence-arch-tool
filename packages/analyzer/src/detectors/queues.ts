import type { FileFacts, QueueOpFact } from '../types.js';
import { resolveParts } from '../parse/facts.js';
import { allowlistsFor } from '../lang/packs.js';

function litOf(parts: ReturnType<typeof resolveParts>): string | undefined {
  if (parts.length === 1 && parts[0].t === 'lit' && parts[0].v.length > 0) return parts[0].v;
  return undefined;
}

export function detectQueues(service: string, facts: FileFacts[]): QueueOpFact[] {
  const ops: QueueOpFact[] = [];
  for (const f of facts) {
    const snippet = (line: number) => (f.lines[line - 1] ?? '').trim().slice(0, 200);
    // Which callee/annotation idioms this file's language actually uses, from
    // its language pack. Same sets these branches used to hard-code inline —
    // stated once in `lang/packs.ts` instead of re-reasoned per detector.
    const allowlists = allowlistsFor(f.language);

    // Spring AMQP/Kafka consumer annotations: @RabbitListener(queues = "x" | {"a","b"}),
    // @KafkaListener(topics = "x" | {"a","b"}) — array values already flattened to one
    // Part per element by evalAnnotationArg, same convention as JS/Python array kwargs.
    for (const a of f.annotations ?? []) {
      if (a.target !== 'method') continue;
      const key = allowlists.queueConsumerAnnotations[a.name];
      if (key) {
        const values = a.args[key] ?? a.args[''];
        for (const p of values ?? []) {
          if (p.t === 'lit' && p.v) {
            ops.push({
              service,
              op: 'consume',
              topic: p.v,
              literal: true,
              file: f.file,
              line: a.line,
              snippet: snippet(a.line),
            });
          }
        }
      }
    }

    for (const call of f.calls) {
      const last = call.callee.split('.').pop() ?? call.callee;
      const arg0 = call.args[0] ? resolveParts(call.args[0], f.assignments) : undefined;
      const arg0Lit = arg0 ? litOf(arg0) : undefined;

      const push = (op: 'publish' | 'consume', topic: string) =>
        ops.push({
          service,
          op,
          topic,
          literal: true,
          file: f.file,
          line: call.line,
          snippet: snippet(call.line),
        });

      // redis / generic publish("topic", payload)
      if (last === 'publish' && arg0Lit && !arg0Lit.startsWith('/')) {
        push('publish', arg0Lit);
        continue;
      }
      // Producers whose topic is the first positional literal: kafka-python /
      // aiokafka `send`/`send_and_wait` (Python), Spring KafkaTemplate `send`
      // (Java). The pack gates it per language so it cannot double-fire
      // alongside kafkajs's object-kwarg form below, which TypeScript/JavaScript
      // uses instead and whose pack therefore lists no first-arg producer.
      if (allowlists.queuePublishFirstArg.includes(last) && arg0Lit) {
        push('publish', arg0Lit);
        continue;
      }
      // kafkajs producer.send({ topic: 'x', messages: [...] })
      if (last === 'send' && call.kwargs['topic']) {
        const t = litOf(resolveParts(call.kwargs['topic'], f.assignments));
        if (t) {
          push('publish', t);
          continue;
        }
      }
      // Spring RabbitTemplate.convertAndSend(routingKey, message) or
      // convertAndSend(exchange, routingKey, message) — the topic-shaped arg
      // is whichever position is "routingKey" for the overload actually used
      // (position 1 when an exchange arg is also present, else position 0);
      // prefer it over the exchange name when both resolve to literals.
      if (last === 'convertAndSend') {
        const routingKeyIdx = call.args.length >= 3 ? 1 : 0;
        const exchangeIdx = call.args.length >= 3 ? 0 : undefined;
        const rk = call.args[routingKeyIdx] ? litOf(resolveParts(call.args[routingKeyIdx], f.assignments)) : undefined;
        const ex = exchangeIdx !== undefined && call.args[exchangeIdx]
          ? litOf(resolveParts(call.args[exchangeIdx], f.assignments))
          : undefined;
        const topic = rk ?? ex;
        if (topic) {
          push('publish', topic);
          continue;
        }
      }
      // rabbitmq pika basic_publish(exchange=..., routing_key='x') / amqplib sendToQueue('q')
      if (last === 'basic_publish') {
        const rk = call.kwargs['routing_key'] && litOf(resolveParts(call.kwargs['routing_key'], f.assignments));
        const ex = call.kwargs['exchange'] && litOf(resolveParts(call.kwargs['exchange'], f.assignments));
        const t = rk || ex || arg0Lit;
        if (t) {
          push('publish', t);
          continue;
        }
      }
      if (last === 'sendToQueue' && arg0Lit) {
        push('publish', arg0Lit);
        continue;
      }

      // Go amqp (rabbitmq/amqp091-go, streadway/amqp): ch.Publish(exchange, key, ...) /
      // ch.PublishWithContext(ctx, exchange, key, ...). Also covers go-redis's
      // rdb.Publish(ctx, channel, msg) for free: ctx (arg0) resolves to a hole and
      // is skipped, so the scan naturally lands on the channel/key literal.
      // Case-sensitive exact match keeps this from double-firing on the lowercase
      // JS/Python "publish" branch above.
      if (last === 'Publish' || last === 'PublishWithContext') {
        const start = last === 'PublishWithContext' ? 1 : 0;
        let topic: string | undefined;
        for (let i = start; i < start + 3 && i < call.args.length; i++) {
          const lit = litOf(resolveParts(call.args[i], f.assignments));
          if (lit) {
            topic = lit;
            break;
          }
        }
        if (topic) {
          push('publish', topic);
          continue;
        }
      }

      // Go amqp: ch.Consume(queue, ...) — literal queue name -> consume;
      // dynamic queue name -> the existing dynamic-topic fallback below.
      if (last === 'Consume') {
        if (arg0Lit) {
          push('consume', arg0Lit);
          continue;
        }
        ops.push({
          service, op: 'consume', topic: '(dynamic)', literal: false,
          file: f.file, line: call.line, snippet: snippet(call.line),
        });
        continue;
      }

      // go-redis: rdb.Subscribe(ctx, "channel") / rdb.PSubscribe(ctx, "pattern").
      // Try arg0-lit first (in case someone calls it without a ctx arg), then arg1.
      if (last === 'Subscribe' || last === 'PSubscribe') {
        if (arg0Lit) {
          push('consume', arg0Lit);
          continue;
        }
        const a1 = call.args[1] ? litOf(resolveParts(call.args[1], f.assignments)) : undefined;
        if (a1) {
          push('consume', a1);
          continue;
        }
      }

      // segmentio/kafka-go: kafka.NewWriter(kafka.WriterConfig{Topic: "x", ...}) /
      // kafka.NewReader(kafka.ReaderConfig{Topic: "x", ...}) — Topic comes through
      // as a kwarg via the composite-literal argument extraction in facts.ts.
      if (/Writer/.test(call.callee) && call.kwargs['Topic']) {
        const t = litOf(resolveParts(call.kwargs['Topic'], f.assignments));
        if (t) {
          push('publish', t);
          continue;
        }
      }
      if (/Reader/.test(call.callee) && call.kwargs['Topic']) {
        const t = litOf(resolveParts(call.kwargs['Topic'], f.assignments));
        if (t) {
          push('consume', t);
          continue;
        }
      }

      // consume side
      if (last === 'subscribe') {
        // redis pubsub.subscribe('chan') / kafkajs consumer.subscribe({topic(s): ...})
        if (arg0Lit) {
          push('consume', arg0Lit);
          continue;
        }
        for (const key of ['topic', 'topics']) {
          const kw = call.kwargs[key];
          if (kw) {
            for (const p of kw) {
              if (p.t === 'lit' && p.v) push('consume', p.v);
            }
          }
        }
        continue;
      }
      if ((last === 'AIOKafkaConsumer' || last === 'KafkaConsumer') && arg0Lit) {
        push('consume', arg0Lit);
        continue;
      }
      if ((last === 'basic_consume' || last === 'consume') && call.kwargs['queue']) {
        const t = litOf(resolveParts(call.kwargs['queue'], f.assignments));
        if (t) {
          push('consume', t);
          continue;
        }
      }
      if (last === 'psubscribe' && arg0Lit) {
        push('consume', arg0Lit);
        continue;
      }

      // strong queue APIs where the topic itself is dynamic (class attrs, params):
      // still record the op so the joiner can draw a lower-confidence edge to the broker
      if (last === 'basic_publish' || last === 'sendToQueue') {
        ops.push({
          service, op: 'publish', topic: '(dynamic)', literal: false,
          file: f.file, line: call.line, snippet: snippet(call.line),
        });
      } else if (last === 'basic_consume') {
        ops.push({
          service, op: 'consume', topic: '(dynamic)', literal: false,
          file: f.file, line: call.line, snippet: snippet(call.line),
        });
      }
    }
  }
  return ops;
}
