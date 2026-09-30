#!/usr/bin/env node
/**
 * Gateway entrypoint. Reads config from the environment, wires the durable
 * file-backed spend store + a per-instance rate limiter, and starts listening.
 *
 * Startup is deliberately tolerant: a missing OPENROUTER_API_KEY logs a clear
 * error but the server STILL boots (proxy calls then return 500) so a bad deploy
 * is observable instead of a crash loop. A missing SEQUENCE_GATEWAY_TOKEN logs a
 * loud warning and accepts all callers (dev only).
 */
import { loadConfig } from './config.js';
import { FileSpendStore } from './store.js';
import { SlidingWindowRateLimiter } from './rateLimit.js';
import { createGateway, consoleLogger } from './gateway.js';

function main(): void {
  const config = loadConfig();

  if (!config.openrouterApiKey) {
    consoleLogger.error(
      '[gateway] OPENROUTER_API_KEY is not set — the service will boot but every proxy call returns 500 (misconfigured).'
    );
  }
  if (config.callerTokens === null) {
    consoleLogger.warn(
      '[gateway] SEQUENCE_GATEWAY_TOKEN is UNSET — accepting ALL callers. This is DEV ONLY; set it before exposing the gateway.'
    );
  } else if (config.callerTokens.length === 0) {
    consoleLogger.warn('[gateway] SEQUENCE_GATEWAY_TOKEN is empty — no caller tokens accepted (all requests 401).');
  }

  const store = new FileSpendStore(config.stateDir);
  const rateLimiter = new SlidingWindowRateLimiter(config.rateLimitPerMin);
  const server = createGateway({ config, store, rateLimiter });

  server.listen(config.port, () => {
    consoleLogger.info(
      `[gateway] listening on :${config.port} → ${config.openrouterBaseUrl} (model default ${config.defaultModel}, backstop $${config.globalSpendBackstopUsd})`
    );
  });
}

main();
