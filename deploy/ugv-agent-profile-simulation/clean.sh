#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="shutdown"
uap_record_failure() {
  local uap_exit="$1"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
    clean "$uap_stage" failed "$uap_exit" clean >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

uap_initialize_state >/dev/null
"$script_directory/down.sh"
uap_stage="volume-cleanup"
for uap_volume in "${UAP_SDAR_VOLUMES[@]}"; do
  uap_remove_owned_volume "$UAP_SDAR_PROJECT" "$uap_volume"
done
for uap_volume in "${UAP_SMPP_VOLUMES[@]}"; do
  uap_remove_owned_volume "$UAP_SMPP_PROJECT" "$uap_volume"
done

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  clean complete passed 0 clean
