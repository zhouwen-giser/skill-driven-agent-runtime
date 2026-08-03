#!/usr/bin/env bash
set -euo pipefail

EXPECTED_REPO="zhouwen-giser/skill-driven-agent-runtime"
BRANCH="feature/v1.4-node-control-backend"

test -z "$(git status --porcelain=v1)"
gh --version
gh auth status

repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
test "$repo" = "$EXPECTED_REPO"

default_branch="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
test "$default_branch" = "main"

git fetch --prune --tags origin
git switch main
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

printf 'MAIN_SHA=%s\n' "$(git rev-parse HEAD)"
printf 'MAIN_TREE_SHA=%s\n' "$(git rev-parse HEAD^{tree})"
printf 'MAIN_COMMIT_TIME=%s\n' "$(git show -s --format=%cI HEAD)"

pnpm install --frozen-lockfile
pnpm verify

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "REMOTE_BRANCH_EXISTS: resume policy required"
  exit 2
fi

git switch -c "$BRANCH" origin/main
git push -u origin "$BRANCH"
echo "P00_BRANCH_CREATED"
