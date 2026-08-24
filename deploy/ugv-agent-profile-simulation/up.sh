#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="started"
uap_started="false"
uap_failure_handled="false"
uap_abort() {
  local uap_exit="$1"
  trap - ERR INT TERM
  if [[ "$uap_failure_handled" == "false" ]]; then
    uap_failure_handled="true"
    if [[ "$uap_started" == "true" ]]; then
      uap_supervisor stop >/dev/null 2>&1 || true
      uap_sdar_compose down --volumes >/dev/null 2>&1 || true
      uap_smpp_compose down --volumes >/dev/null 2>&1 || true
    fi
    node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
      up "$uap_stage" failed "$uap_exit" up >/dev/null 2>&1 || true
  fi
  exit "$uap_exit"
}
uap_install_abort_traps uap_abort

uap_stage="service-start"
"$script_directory/up-smpp.sh"
uap_started="true"
"$script_directory/up-sdar.sh"

uap_stage="complete"
uap_clear_abort_traps
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  up complete passed 0 up
