#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="read-only-qualification"
uap_record_failure() {
  local uap_exit="$1"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
    smpp-qualification "$uap_stage" failed "$uap_exit" qualify-smpp >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

uap_initialize_state >/dev/null
uap_render_root="$UAP_STATE_ROOT/rendered"
mkdir -p "$uap_render_root"
chmod 0700 "$uap_render_root"
uap_smpp_config --format json >"$uap_render_root/smpp.json"
uap_sdar_compose config --format json "${UAP_SDAR_SERVICES[@]}" >"$uap_render_root/sdar.json"
uap_smpp_ps --format json >"$uap_render_root/smpp-ps.json"
chmod 0600 "$uap_render_root/smpp.json" "$uap_render_root/sdar.json" "$uap_render_root/smpp-ps.json"

node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" compose \
  --smpp-json "$uap_render_root/smpp.json" \
  --sdar-json "$uap_render_root/sdar.json"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/qualify-smpp-readonly.mjs" \
  --ps-json "$uap_render_root/smpp-ps.json"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" artifacts \
  --file "$UAP_REPORT_ROOT/smpp-readonly-qualification.redacted.json"

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  smpp-qualification complete passed 0 qualify-smpp
