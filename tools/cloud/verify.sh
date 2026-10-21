#!/usr/bin/env bash
# Fast verify for cloud sessions. Logs go to $LOG_DIR (default /tmp/seq-verify); stdout is a short summary.
#   tools/cloud/verify.sh quick            build + test:ci                     (~3 min)
#   tools/cloud/verify.sh pkg <name>...    build + that package's tests        (e.g. analyzer web2 desktop)
#   tools/cloud/verify.sh full             build + test:ci + every package, no bail
# Exit 0 only when every step passed. Never pipes a gate through head/tail; reads bare exit codes.
set -uo pipefail
cd "$(dirname "$0")/../.."
LOG_DIR="${LOG_DIR:-/tmp/seq-verify}"
mkdir -p "$LOG_DIR"
mode="${1:-quick}"; shift || true
fail=0
step() { # name, cmd...
  local name="$1"; shift
  local t0=$SECONDS
  # Tests that attach a repo are jailed to $HOME: when the checkout lives outside it (cloud boxes), run tests with HOME at the checkout's parent.
  if [[ "$name" == test* && "$PWD/" != "$HOME/"* ]]; then env HOME="$(dirname "$PWD")" "$@" > "$LOG_DIR/$name.log" 2>&1
  else "$@" > "$LOG_DIR/$name.log" 2>&1; fi
  local rc=$?
  printf '%-22s exit %d  %3ds  %s\n' "$name" "$rc" $((SECONDS - t0)) "$LOG_DIR/$name.log"
  [ "$rc" -ne 0 ] && fail=1
  return 0
}
step build pnpm build
case "$mode" in
  quick) step test-ci pnpm test:ci ;;
  pkg)   for p in "$@"; do step "test-$p" pnpm --filter "@sequence/$p" test; done ;;
  full)  step test-ci pnpm test:ci
         step test-all pnpm -r --no-bail test ;;
  *) echo "usage: $0 quick|pkg <name>...|full" >&2; exit 2 ;;
esac
[ "$fail" -eq 0 ] && echo "ALL GREEN" || { echo "FAILED (see logs)"; grep -hE "^\s*not ok|^# fail [1-9]|✖" "$LOG_DIR"/*.log 2>/dev/null | cut -c1-160 | sort -u | head -30; }
exit "$fail"
