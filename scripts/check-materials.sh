#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required=(README.md AGENTS.md PLANS.md CODEX_GOAL_PROMPT.md PROJECT_STATUS.md docs/01_REQUIREMENTS_BASELINE.md docs/17_TRACEABILITY_MATRIX.md)
for f in "${required[@]}"; do
  test -s "$ROOT/$f" || { echo "missing: $f"; exit 1; }
done
if grep -E "UNPINNED|VERIFY_AT_PIN" "$ROOT/third_party/sources.lock.yaml" >/dev/null; then
  echo "third-party sources are not pinned yet (expected before EP-00 completion)"
  exit 2
fi
echo "materials check passed"
