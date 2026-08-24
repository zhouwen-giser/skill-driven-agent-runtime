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
    down "$uap_stage" failed "$uap_exit" down >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

uap_initialize_state >/dev/null
uap_assert_owned_project_closure
if [[ -f "$UAP_PROCESS_MANIFEST" && ! -L "$UAP_PROCESS_MANIFEST" ]]; then
  uap_scan_host_process_logs
fi
uap_supervisor stop
uap_scan_host_process_logs stored-log-files
uap_sdar_compose down
uap_smpp_compose down

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  down complete passed 0 down
