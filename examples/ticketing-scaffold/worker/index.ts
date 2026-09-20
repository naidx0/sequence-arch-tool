import { createClient } from 'redis';

// queue_consume edge worker -> ticket.created via REDIS_URL
const subscriber = createClient({ url: process.env.REDIS_URL });

async function main() {
  await subscriber.connect();
  await subscriber.subscribe('ticket.created', (message) => {
    // handle message
    console.log('received ticket.created', message);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
