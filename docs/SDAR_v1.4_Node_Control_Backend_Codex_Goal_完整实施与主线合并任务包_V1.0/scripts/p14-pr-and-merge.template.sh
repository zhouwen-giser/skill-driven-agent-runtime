#!/usr/bin/env bash
set -euo pipefail

branch="feature/v1.4-node-control-backend"
test "$(git branch --show-current)" = "$branch"
test -z "$(git status --porcelain=v1)"

git fetch origin main
git merge --no-ff origin/main
pnpm verify
test -z "$(git status --porcelain=v1)"

candidate_sha="$(git rev-parse HEAD)"
git push origin HEAD

pr_url="$(gh pr create \
  --base main \
  --head "$branch" \
  --title "feat(v1.4): add single-node control backend" \
  --body-file reports/v1.4-node-control/release/pr-body.md)"
pr_number="$(gh pr view "$pr_url" --json number -q .number)"

gh pr checks "$pr_number" --watch --fail-fast
gh pr merge "$pr_number" --merge --delete-branch

git fetch origin main
git merge-base --is-ancestor "$candidate_sha" origin/main

printf 'PR=%s CANDIDATE=%s MAIN=%s\n' \
  "$pr_url" "$candidate_sha" "$(git rev-parse origin/main)"
