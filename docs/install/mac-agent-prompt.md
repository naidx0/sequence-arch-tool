# Install Sequence on an Apple Silicon Mac, with your coding agent

Open Claude Code or Codex on your Mac and paste the block below. It installs the latest Sequence
release and opens it. Nothing else to set up.

Why this exists: the Mac build is not notarized with Apple, so a normal download plus double-click
ends at an "Apple could not verify" dialog. The agent does the checked download and the one
permission step for you, and tells you what it did.

The site (`site/src/data/macPrompt.ts`) carries the same text; `site/tests/mac-prompt.test.mjs`
fails if the two drift apart.

## The prompt

```text
Install the Sequence desktop app on this Mac, then open it. Run the commands yourself and show me each result. Stop and tell me if anything fails; do not skip a check.

1. Check the machine. Run `uname -m` (must print arm64) and `sw_vers -productVersion`. If it is not Apple silicon, stop and say so. If macOS is older than 12, warn me but continue.

2. Find the latest release. Never hard-code a version. In a fresh temp directory (`mktemp -d`), run:
   curl -fsSL https://api.github.com/repos/naidx0/sequence-arch-tool/releases/latest -o release.json
   Read tag_name and the asset URLs with `plutil -extract tag_name raw release.json` (built into macOS 12+), or read the JSON file yourself. From its assets take the one whose name ends in "-arm64-mac.zip" (the Apple silicon build) and the one named SHASUMS256.txt, and download both with curl -fL using their browser_download_url. Only download from github.com/naidx0/sequence-arch-tool.

3. Verify. Find the zip's line in SHASUMS256.txt and compare it with `shasum -a 256` of the zip. If they differ, delete the download and stop.

4. Install. Unpack with `ditto -x -k <zip> <temp dir>/out`, remove any old /Applications/Sequence.app (quit it first if it is running), then `ditto <temp dir>/out/Sequence.app /Applications/Sequence.app`. Do not use sudo. Only if /Applications refuses the write, tell me and ask before using sudo or switching to ~/Applications.

5. Clear the quarantine flag on that one app: `xattr -dr com.apple.quarantine /Applications/Sequence.app`. Tell me why in one line: Sequence is not notarized by Apple yet, so macOS blocks a quarantined copy with "Apple could not verify"; this removes the flag from this app only and changes no system setting. "No such xattr" is fine. It is usually a no-op for a curl download and harmless; the step is kept for a zip opened from a browser download.

6. Launch with `open /Applications/Sequence.app`, wait a few seconds, and confirm it is running (`pgrep -x Sequence`).

7. Report: the version installed, the checksum result, the install path, and whether it launched.

If the download or the checksum fails and I say to continue, fall back to building from source. Check `node -v` (20 or newer) and use pnpm (`corepack enable` if needed). Then `git clone https://github.com/naidx0/sequence-arch-tool ~/sequence`, `cd ~/sequence`, `pnpm install && pnpm build && pnpm start`. It opens in my browser. Do not run any script you have not read, and do not pipe curl into a shell.
```

## What the prompt relies on

- Public repo: `https://github.com/naidx0/sequence-arch-tool`; assets are named
  `Sequence-<version>-arm64-mac.zip`, `Sequence-<version>-arm64.dmg` and `SHASUMS256.txt`
  (`.github/workflows/release.yml`, `packages/desktop/electron-builder.yml`).
- The zip is used instead of the dmg because it needs no disk-image mount; both hold the same
  ad-hoc-signed, un-notarized `Sequence.app`.
- Source launch: the prompt uses the pnpm commands `pnpm install && pnpm build && pnpm start` (root
  `package.json` has a `start` script). The README "Run from source" section says `./start.sh`, which
  does the same.
