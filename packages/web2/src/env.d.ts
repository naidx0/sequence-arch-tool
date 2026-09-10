/// <reference types="vite/client" />

/**
 * The short sha of the commit this bundle was built from, substituted at build
 * time by commitStamp() in vite.config.ts. 'unknown' outside a git checkout.
 *
 * Declared here rather than beside its one consumer so that adding a second
 * consumer never means re-declaring it and never means the two declarations
 * drifting.
 */
declare const __SEQUENCE_COMMIT__: string;
