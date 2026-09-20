/**
 * Tier-3 industry starter catalog (moat layer 3).
 * `fragmentIds` are docker-compose service keys the scaffold brief can emit verbatim.
 */
import type { IndustryStarter } from './index.js';

export const INDUSTRY_STARTERS: IndustryStarter[] = [
  {
    id: 'monolith-api',
    title: 'Monolith API',
    groundedOnly: true,
    fragmentIds: ['api', 'postgres'],
  },
  {
    id: 'event-driven',
    title: 'Event-driven pipeline',
    groundedOnly: true,
    fragmentIds: ['api', 'worker', 'postgres', 'redis'],
  },
];
