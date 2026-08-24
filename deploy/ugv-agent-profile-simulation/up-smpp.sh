#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="service-start"
uap_started="false"
uap_failure_handled="false"
uap_abort() {
  local uap_exit="$1"
  trap - ERR INT TERM
  if [[ "$uap_failure_handled" == "false" ]]; then
    uap_failure_handled="true"
    if [[ "$uap_started" == "true" ]]; then
      uap_smpp_compose down --volumes >/dev/null 2>&1 || true
    fi
    node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
      smpp-up "$uap_stage" failed "$uap_exit" up-smpp >/dev/null 2>&1 || true
  fi
  exit "$uap_exit"
}
uap_install_abort_traps uap_abort

"$script_directory/preflight.sh"
uap_initialize_state >/dev/null
uap_started="true"
uap_smpp_up --detach --build --wait --wait-timeout 300

uap_stage="live-network-exposure"
uap_assert_smpp_live_exposure

uap_stage="pms-seed"
"$script_directory/seed-smpp.sh"

uap_stage="read-only-qualification"
"$script_directory/qualify-smpp.sh"
uap_capture_and_scan_smpp_runtime

uap_stage="complete"
uap_clear_abort_traps
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  smpp-up complete passed 0 up-smpp
