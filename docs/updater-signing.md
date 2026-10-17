# Signed updates (M2): design note

Status: **the app can check a signature, and the check is off.** It turns on when the owner creates
the key and pins its public half. That is the owner's decision, because it needs a CI secret.

## The gap

The in-app updater (`packages/analyzer/src/server/appUpdate.ts`) downloads the installer only from
`https://github.com/naidx0/sequence-arch-tool/releases/download/<tag>/`. It runs the installer only
when the file's SHA-256 matches `SHASUMS256.txt` from the same release. That catches a truncated or
corrupted download. It does not catch a release that someone else published: anyone who can
publish a release (a stolen token, a compromised workflow) can upload a matching installer and
`SHASUMS256.txt` together. A signature by a key that never leaves CI closes that gap.

## The design

- **Algorithm:** ed25519, a detached signature over the exact bytes of `SHASUMS256.txt`. One
  signature covers every asset, because each asset is already bound to the manifest by its SHA-256.
- **Signature file:** `SHASUMS256.txt.sig`, uploaded with the release. It holds the base64 of the raw
  64-byte signature on one line. Node checks it with `crypto.verify(null, …)`, so the app needs no
  new dependency. minisign uses the same ed25519 keys. We do not use its file format because the
  app would then need a minisign parser.
- **Public key:** pinned in the app as `SIGNING_PUBLIC_KEY` (SPKI PEM) in `appUpdate.ts`. It is
  `null` today, which turns the check off. When it is set, the check is **required**: a release with
  no `.sig`, a signature by another key, or a malformed signature gets "nothing was downloaded or
  run". The `.sig` URL must start with the same pinned release-download prefix as the other assets.
- **Secret key:** stored only in a GitHub Actions secret, `SEQUENCE_RELEASE_SIGNING_KEY` (PKCS#8
  PEM). It is never kept in the repo, a file on a laptop, a log or an artifact.

## What the owner does to turn it on

1. Make the key pair on a trusted machine. Keep the private key only long enough to paste it into
   the secret.
   ```sh
   openssl genpkey -algorithm ed25519 -out release-signing.pem
   openssl pkey -in release-signing.pem -pubout -out release-signing.pub.pem
   ```
2. In GitHub, go to Settings > Secrets and variables > Actions > New repository secret. Name it
   `SEQUENCE_RELEASE_SIGNING_KEY` and paste the contents of `release-signing.pem`. Then delete the
   local file securely.
3. In `.github/workflows/release.yml`, add a step after `sha256sum * > SHASUMS256.txt`:
   ```sh
   printf '%s\n' "$SEQUENCE_RELEASE_SIGNING_KEY" > "$RUNNER_TEMP/k.pem"
   openssl pkeyutl -sign -inkey "$RUNNER_TEMP/k.pem" -rawin -in SHASUMS256.txt | base64 -w0 > SHASUMS256.txt.sig
   rm -f "$RUNNER_TEMP/k.pem"
   ```
   The step gets `env: SEQUENCE_RELEASE_SIGNING_KEY: ${{ secrets.SEQUENCE_RELEASE_SIGNING_KEY }}`.
4. Paste `release-signing.pub.pem` into `SIGNING_PUBLIC_KEY`, then ship that build. Builds from
   then on need every release to be signed. Builds from before ignore the `.sig`.

## Order matters

Publish one signed release **before** shipping the build that requires signatures. Otherwise the
first build with the pinned key refuses every release up to and including its own.

## Rotating or losing the key

The pinned key can only be replaced by an update the old key signed. If the key is lost, users
must download the next release by hand from the release page, which the Settings page always
offers. A rotation is a release signed by the old key whose build pins the new key.

## Tests

`packages/analyzer/src/test/app-update.test.ts`, test "M2 (ready, off by default)", generates a
throwaway key pair while the test runs, so no key is stored anywhere. It proves four things: the
flag is off by default, a valid signature passes, a signature by another key fails, and an unsigned
release fails once a key is pinned.
