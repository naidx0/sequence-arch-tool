/**
 * The release-signing public key main pins for SHASUMS256.txt, the same value as SIGNING_PUBLIC_KEY in the analyzer's
 * server/appUpdate.ts (tools/ci/signing-key-match.test.mjs fails if the two differ). While it is null, releases are not
 * signed and the HTTPS download from the fixed release URL is the only anchor; once a key is pinned here and there, main
 * also downloads SHASUMS256.txt.sig and refuses a SHASUMS256.txt it does not sign.
 */
export const SIGNING_PUBLIC_KEY: string | null = null;
