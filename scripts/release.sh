#!/usr/bin/env bash
# Release both published packages in lockstep:
#   @tavon-ai/workspace-server and @tavon-ai/pi-ai-sdk-bridge
#
# Usage:
#   scripts/release.sh <version|patch|minor|major> [--dry-run]
#
# Steps: preflight (clean tree, main, up to date) → bump both versions →
# build/test/typecheck → commit + tag vX.Y.Z → push → publish (workspace-server
# first, since the bridge depends on it).
#
# Always publishes via pnpm: it rewrites "workspace:^" to a real semver range.
# `npm publish` would ship the literal "workspace:^" and break installs.

set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:?usage: scripts/release.sh <version|patch|minor|major> [--dry-run]}"
DRY_RUN="${2:-}"

if [[ -n "$DRY_RUN" && "$DRY_RUN" != "--dry-run" ]]; then
  echo "unknown argument: $DRY_RUN" >&2
  exit 1
fi

# --- preflight ---------------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is not clean" >&2
  exit 1
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "error: releases must be cut from main (on: $branch)" >&2
  exit 1
fi
git fetch origin main
# Local commits ahead of origin are fine (they get pushed below); only reject
# when origin has commits we don't.
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "error: origin/main has commits not on local main; pull first" >&2
  exit 1
fi

# --- version bump (lockstep) ---------------------------------------------------
for pkg in packages/workspace-server packages/bridge; do
  (cd "$pkg" && npm version "$BUMP" --no-git-tag-version >/dev/null)
done
version="$(node -p "require('./packages/bridge/package.json').version")"
ws_version="$(node -p "require('./packages/workspace-server/package.json').version")"
if [[ "$version" != "$ws_version" ]]; then
  echo "error: versions diverged ($version vs $ws_version)" >&2
  exit 1
fi
echo "releasing v$version"

# --- verify -------------------------------------------------------------------
pnpm -r build
pnpm -r test
pnpm -r typecheck

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  pnpm --filter @tavon-ai/workspace-server publish --dry-run --no-git-checks
  pnpm --filter @tavon-ai/pi-ai-sdk-bridge publish --dry-run --no-git-checks
  git checkout -- packages/workspace-server/package.json packages/bridge/package.json
  echo "dry run complete; version bumps reverted, nothing tagged or pushed"
  exit 0
fi

# --- commit, tag, push ----------------------------------------------------------
git commit -am "chore: release v$version"
git tag "v$version"
git push origin main "v$version"

# --- publish (dependency order: workspace-server before bridge) -----------------
pnpm --filter @tavon-ai/workspace-server publish
pnpm --filter @tavon-ai/pi-ai-sdk-bridge publish

echo "released v$version"
echo "verify: npm view @tavon-ai/workspace-server@$version version && npm view @tavon-ai/pi-ai-sdk-bridge@$version version"
