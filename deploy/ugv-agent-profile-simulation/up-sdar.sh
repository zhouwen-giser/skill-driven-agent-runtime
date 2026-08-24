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
      if ! uap_scan_host_process_logs stored-log-files; then
        uap_exit=2
      fi
      uap_sdar_compose down --volumes >/dev/null 2>&1 || true
    fi
    node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
      sdar-up "$uap_stage" failed "$uap_exit" up-sdar >/dev/null 2>&1 || true
  fi
  exit "$uap_exit"
}
uap_install_abort_traps uap_abort

uap_require_local_tools
uap_initialize_state >/dev/null
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" environment
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" baseline-local
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" baseline-remote
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/check-fixed-ports.mjs" --sdar-and-host
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/check-clean-start.mjs" --sdar
uap_render_root="$UAP_STATE_ROOT/rendered"
mkdir -p "$uap_render_root"
chmod 0700 "$uap_render_root"
uap_smpp_ps --format json >"$uap_render_root/smpp-ps.json"
chmod 0600 "$uap_render_root/smpp-ps.json"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-running-stack.mjs" \
  --smpp-ps "$uap_render_root/smpp-ps.json"

uap_stage="compose-render"
uap_smpp_config --format json >"$uap_render_root/smpp.json"
uap_sdar_config --format json >"$uap_render_root/sdar.json"
chmod 0600 "$uap_render_root/smpp.json" "$uap_render_root/sdar.json"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" compose \
  --smpp-json "$uap_render_root/smpp.json" \
  --sdar-json "$uap_render_root/sdar.json"

uap_stage="service-start"
uap_started="true"
uap_sdar_up --detach --build --wait --wait-timeout 300

uap_stage="live-network-exposure"
uap_assert_sdar_live_exposure

uap_stage="host-processes"
uap_supervisor start
uap_scan_host_process_logs
uap_capture_and_scan_sdar_runtime
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/model-invocation-audit.mjs" baseline

uap_stage="complete"
uap_clear_abort_traps
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  sdar-up complete passed 0 up-sdar
