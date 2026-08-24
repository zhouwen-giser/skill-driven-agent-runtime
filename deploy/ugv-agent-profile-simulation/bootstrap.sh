#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="authority"
uap_record_failure() {
  local uap_exit="$1"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
    bootstrap "$uap_stage" failed "$uap_exit" bootstrap >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

"$script_directory/bootstrap-authority.sh"

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  bootstrap complete passed 0 bootstrap
