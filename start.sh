#!/usr/bin/env bash
# Sequence — one-command launch.
# Usage:  ./start.sh            (attach a repo from the home screen)
#         ./start.sh /path/to/your/repo    (scan that repo on startup)
#         ./start.sh --port 4173 --no-open (pass CLI flags through)
#
# Boots the local platform server and opens your default browser to it.
# Everything runs locally on your machine (127.0.0.1) — nothing is uploaded.
set -euo pipefail

# Resolve paths from the *caller's* cwd. `cd` to the script dir happens next,
# so a relative repo path like `./start.sh ../my-app` or invoking this script
# via an absolute path from another folder must not be resolved against the
# Sequence repo root.
USER_CWD="$PWD"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

launcher_usage() {
  cat <<'EOF'
Sequence — one-command launch.

  ./start.sh                  start the app (pick a repo from the home screen)
  ./start.sh /path/to/repo    scan that repo on startup
  ./start.sh --port 4173      pass CLI flags through
  ./start.sh --no-open        start without opening a browser

This is help, not a crash. Run ./start.sh with no extra words to start the app.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  launcher_usage
  exit 0
fi

# Positional first arg = repo path (from the caller's cwd). Anything else that
# does not start with `-` used to be forwarded as a CLI subcommand, which
# printed the full `sequence` usage page and exited 1 — it looked like start
# failed. Refuse that, with a short launcher error, before install/build.
REPO_FROM_POS=""
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  given="$1"
  shift
  if [ "${given#/}" != "$given" ] && [ -d "$given" ]; then
    # Absolute path.
    REPO_FROM_POS="$(cd "$given" && pwd)"
  elif [ -d "$USER_CWD/$given" ]; then
    # Relative to where the user typed the command, not Sequence's root.
    REPO_FROM_POS="$(cd "$USER_CWD/$given" && pwd)"
  else
    echo "start.sh: not a directory: $given" >&2
    echo "" >&2
    launcher_usage >&2
    exit 1
  fi
fi

# 1. pnpm (via corepack, ships with Node 16.13+)
if ! command -v pnpm >/dev/null 2>&1; then
  echo "▸ enabling pnpm via corepack…"
  corepack enable >/dev/null 2>&1 || {
    echo "  corepack not available. Install pnpm: https://pnpm.io/installation" >&2
    exit 1
  }
fi

# 2. install deps if missing OR older than the manifests that declare them
#
#    Missing-only was the same trap step 3 already documents for dist, and it cost
#    the owner two sessions. `node_modules/` existed, so this check passed — but a
#    pulled commit had ADDED a dependency (@fontsource-variable/inter, then
#    @fontsource/jetbrains-mono), so the tree was present and incomplete. The build
#    then died on an unresolvable CSS @import and blamed `tsc && vite build`, which
#    is the one thing that was not wrong.
#
#    pnpm writes node_modules/.modules.yaml on every install, so a manifest newer
#    than that marker means the tree is behind what the repo now declares. Same
#    timestamp trick as the build check below, same class of bug removed.
needs_install=0
if [ ! -d node_modules ] || [ ! -d packages/web2/node_modules ]; then
  needs_install=1
  install_reason="first run"
elif [ ! -f node_modules/.modules.yaml ]; then
  needs_install=1
  install_reason="no pnpm install marker — tree is in an unknown state"
else
  newer_manifest=$(find package.json packages/*/package.json pnpm-lock.yaml       -newer node_modules/.modules.yaml -print -quit 2>/dev/null || true)
  if [ -n "$newer_manifest" ]; then
    needs_install=1
    install_reason="${newer_manifest} changed since the last install"
  fi
fi
if [ "$needs_install" -eq 1 ]; then
  echo "▸ installing dependencies — ${install_reason}…"
  pnpm install
fi

# 3. build if the compiled output is missing OR older than the source
#
#    Missing-only was a trap: after `git pull` the dist was still there, just
#    stale, so start.sh skipped the build and served the OLD app. The user then
#    reasonably concluded the fix had not shipped. Comparing timestamps costs a
#    directory walk and removes a whole class of "I see the old thing".
needs_build=0
if [ ! -f packages/analyzer/dist/cli.js ] || [ ! -f packages/web2/dist/index.html ]; then
  needs_build=1
  reason="first run"
else
  # Anything under a package's src/ newer than the newest build output wins.
  # `site` was dropped 2026-08-20 — the marketing site is retired to docs/archive/v1-site/.
  newest_src=$(find packages/*/src -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' \) \
      -newer packages/web2/dist/index.html -print -quit 2>/dev/null || true)
  if [ -n "$newest_src" ]; then
    needs_build=1
    reason="source changed since the last build (${newest_src})"
  fi
fi
# 3b. a machine that ran v1 still has a gitignored packages/web/dist. It is not
#     read any more — say so once, out loud, because "I see the old UI" was
#     exactly this file pointing at that directory.
if [ -d packages/web/dist ]; then
  echo "▸ note: leftover packages/web/dist from v1 — ignored, the app is served from packages/web2/dist"
fi

if [ "$needs_build" -eq 1 ]; then
  echo "▸ building — ${reason}…"
  pnpm build
fi

# 4. launch — opens your browser automatically.
#    ./start.sh                  -> home screen (pick a repo in the UI)
#    ./start.sh /path/to/repo    -> attach that repo on startup
#    ./start.sh --port 4173 ...  -> pass CLI flags straight through
if [ -f .env.local ]; then
  echo "▸ loading local env from .env.local…"
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi
echo "▸ starting Sequence…"
if [ -n "$REPO_FROM_POS" ]; then
  exec node packages/analyzer/dist/cli.js app --repo "$REPO_FROM_POS" "$@"
elif [ $# -eq 0 ]; then
  exec node packages/analyzer/dist/cli.js app
else
  exec node packages/analyzer/dist/cli.js app "$@"
fi
