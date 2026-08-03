#!/usr/bin/env bash
set -euo pipefail

phase="${1:?phase required, e.g. P03}"
branch="$(git branch --show-current)"
test "$branch" = "feature/v1.4-node-control-backend"
test -z "$(git status --porcelain=v1)"

git push origin HEAD
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git ls-remote origin "refs/heads/$branch" | cut -f1)"
test "$local_sha" = "$remote_sha"

printf '%s local=%s remote=%s\n' "$phase" "$local_sha" "$remote_sha"
