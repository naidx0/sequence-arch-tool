#!/usr/bin/env bash
# Apply the cloud lab's Sequence patches in order, dry-run first.
#
#   bash apply-all.sh [--apply] [--from N] [PATCH_DIR]
#
# Default (no --apply): builds a throwaway worktree at HEAD, applies every
# patch there with --3way, prints one line per patch (clean / merged / CONFLICT
# with the files), removes the worktree. Your working tree is never touched.
#
# --apply: runs the same dry run, and only if every patch lands without a
# conflict, applies them to your working tree. Nothing is staged or committed.
#
# --from N: start at patch N (e.g. --from 6 once 0001-0005 are in).
#
# Refuses a working tree with tracked changes, except
# .agents/skills/sequence-design/SKILL.md, which stays modified and unstaged.
set -u

apply=0
from=1
dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --from) shift; from="${1:-1}" ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) dir="$1" ;;
  esac
  shift
done
[ -n "$dir" ] || dir="$(cd "$(dirname "$0")/.." && pwd)/patches"
[ -d "$dir" ] || { echo "no patch directory at $dir"; exit 2; }

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "run this inside the sequence repo"; exit 2; }
cd "$root"

dirty="$(git status --porcelain --untracked-files=no | grep -v '\.agents/skills/sequence-design/SKILL\.md$' || true)"
if [ -n "$dirty" ]; then
  echo "refusing: tracked changes in the working tree (commit or stash them first):"
  echo "$dirty"
  exit 2
fi

patches=()
for p in "$dir"/00*.patch; do
  [ -e "$p" ] || continue
  n="$(basename "$p" | sed 's/^0*\([0-9]*\)-.*/\1/')"
  [ "$n" -ge "$from" ] && patches+=("$p")
done
[ ${#patches[@]} -gt 0 ] || { echo "no patches numbered $from or above in $dir"; exit 2; }

run_stack() { # $1 = tree to apply in; prints a line per patch; returns 1 on the first conflict
  local tree="$1" p name out conflicted
  for p in "${patches[@]}"; do
    name="$(basename "$p")"
    if git -C "$tree" apply "$p" 2>/dev/null; then
      echo "  clean     $name"
      continue
    fi
    out="$(git -C "$tree" apply --3way "$p" 2>&1)"
    conflicted="$(git -C "$tree" diff --name-only --diff-filter=U)"
    if [ -z "$conflicted" ] && ! echo "$out" | grep -q '^error:'; then
      git -C "$tree" reset -q
      echo "  merged    $name (3-way)"
      continue
    fi
    echo "  CONFLICT  $name"
    if [ -n "$conflicted" ]; then
      echo "$conflicted" | sed 's/^/              /'
    else
      echo "$out" | grep '^error:' | head -5 | sed 's/^/              /'
    fi
    return 1
  done
  return 0
}

scratch="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/seq-apply-$$")"
wt="$scratch/wt"
git worktree add -q --detach "$wt" HEAD || { echo "could not create a scratch worktree"; exit 2; }
cleanup() { git worktree remove --force "$wt" >/dev/null 2>&1; git worktree prune; rm -rf "$scratch"; }
trap cleanup EXIT

echo "dry run on HEAD $(git rev-parse --short HEAD), ${#patches[@]} patch(es) from $dir"
if ! run_stack "$wt"; then
  echo "stopped: that patch needs a hand merge at this HEAD. Nothing in your working tree changed."
  exit 1
fi
echo "all patches land on HEAD."

if [ "$apply" -eq 1 ]; then
  echo "applying to the working tree"
  run_stack "$root" || { echo "unexpected conflict while applying; inspect with git status"; exit 1; }
  echo "done. Nothing is staged or committed; re-run the gates listed in handoff.md."
fi
