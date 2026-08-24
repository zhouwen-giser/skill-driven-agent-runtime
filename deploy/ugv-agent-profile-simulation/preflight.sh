#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="started"
uap_record_failure() {
  local uap_exit="$1"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
    preflight "$uap_stage" failed "$uap_exit" preflight >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

uap_require_local_tools
uap_initialize_state >/dev/null

uap_stage="environment"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" environment

uap_stage="local-baseline"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" baseline-local

uap_stage="remote-baseline"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" baseline-remote

uap_stage="ports"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/check-fixed-ports.mjs"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/check-clean-start.mjs"

uap_stage="compose-render"
uap_render_root="$UAP_STATE_ROOT/rendered"
mkdir -p "$uap_render_root"
chmod 0700 "$uap_render_root"
uap_smpp_config --format json >"$uap_render_root/smpp.json"
uap_sdar_compose config --format json "${UAP_SDAR_SERVICES[@]}" >"$uap_render_root/sdar.json"
chmod 0600 "$uap_render_root/smpp.json" "$uap_render_root/sdar.json"

uap_stage="compose-validation"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" compose \
  --smpp-json "$uap_render_root/smpp.json" \
  --sdar-json "$uap_render_root/sdar.json"

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  preflight complete passed 0 preflight
