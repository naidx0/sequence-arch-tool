/**
 * The Mac install prompt a person gives their own coding agent (Claude Code or Codex).
 * Source of truth for review: docs/install/mac-agent-prompt.md. site/tests/mac-prompt.test.mjs
 * fails if this copy drifts from it. No version is written here: the agent resolves the latest
 * release tag itself, so this never goes stale when the site moves to a new version.
 */
export const MAC_AGENT_PROMPT = `Install the Sequence desktop app on this Mac, then open it. Run the commands yourself and show me each result. Stop and tell me if anything fails; do not skip a check.

1. Check the machine. Run \`uname -m\` (must print arm64) and \`sw_vers -productVersion\`. If it is not Apple silicon, stop and say so. If macOS is older than 12, warn me but continue.

2. Find the latest release. Never hard-code a version. In a fresh temp directory (\`mktemp -d\`), run:
   curl -fsSL https://api.github.com/repos/naidx0/sequence-arch-tool/releases/latest -o release.json
   Read tag_name and the asset URLs with \`plutil -extract tag_name raw release.json\` (built into macOS 12+), or read the JSON file yourself. From its assets take the one whose name ends in "-arm64-mac.zip" (the Apple silicon build) and the one named SHASUMS256.txt, and download both with curl -fL using their browser_download_url. Only download from github.com/naidx0/sequence-arch-tool.

3. Verify. Find the zip's line in SHASUMS256.txt and compare it with \`shasum -a 256\` of the zip. If they differ, delete the download and stop.

4. Install. Unpack with \`ditto -x -k <zip> <temp dir>/out\`, remove any old /Applications/Sequence.app (quit it first if it is running), then \`ditto <temp dir>/out/Sequence.app /Applications/Sequence.app\`. Do not use sudo. Only if /Applications refuses the write, tell me and ask before using sudo or switching to ~/Applications.

5. Clear the quarantine flag on that one app: \`xattr -dr com.apple.quarantine /Applications/Sequence.app\`. Tell me why in one line: Sequence is not notarized by Apple yet, so macOS blocks a quarantined copy with "Apple could not verify"; this removes the flag from this app only and changes no system setting. "No such xattr" is fine. It is usually a no-op for a curl download and harmless; the step is kept for a zip opened from a browser download.

6. Launch with \`open /Applications/Sequence.app\`, wait a few seconds, and confirm it is running (\`pgrep -x Sequence\`).

7. Report: the version installed, the checksum result, the install path, and whether it launched.

If the download or the checksum fails and I say to continue, fall back to building from source. Check \`node -v\` (20 or newer) and use pnpm (\`corepack enable\` if needed). Then \`git clone https://github.com/naidx0/sequence-arch-tool ~/sequence\`, \`cd ~/sequence\`, \`pnpm install && pnpm build && pnpm start\`. It opens in my browser. Do not run any script you have not read, and do not pipe curl into a shell.`;
