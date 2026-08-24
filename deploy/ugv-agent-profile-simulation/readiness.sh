#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="readiness"
uap_record_failure() {
  local uap_exit="$1"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
    readiness "$uap_stage" failed "$uap_exit" readiness >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

uap_initialize_state >/dev/null
uap_assert_owned_stack_running
uap_authority_simulation_id="$(uap_authority_simulation_run_id)"
readonly uap_authority_simulation_id
uap_authority_root="$UAP_STATE_ROOT/authority"
mkdir -p "$uap_authority_root"
chmod 0700 "$uap_authority_root"
uap_authority_report="$uap_authority_root/readiness-report.json"
uap_authority_log="$(mktemp "$UAP_STATE_ROOT/logs/authority-readiness-XXXXXXXX.jsonl")"
chmod 0600 "$uap_authority_log"
uap_smpp_source_id="smpp-source-ugv1-uap-p3-b01"

set +e
SDAR_NODE_CONTROL_BASE_URL=http://127.0.0.1:10091 \
SDAR_CONTROL_API_TOKEN_FILE="$UAP_STATE_ROOT/control-api.token" \
SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL=http://127.0.0.1:10998 \
SDAR_UAP_PROFILE_A2A_BASE_URL=http://127.0.0.1:10999 \
SMPP_SDAR_SOURCE_ID="$uap_smpp_source_id" \
SMPP_ENVIRONMENT=simulation \
SMPP_SDAR_REGISTRY_ENDPOINT="http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/$uap_smpp_source_id/latest" \
SMPP_REGISTRY_CREDENTIAL_REF=unauthenticated://none \
SMPP_UGV_EXTERNAL_PROVIDER_ID=isr.vehicle.ugv.ugv1 \
SMPP_UGV_EXTERNAL_SERVER_ID=uap-p3-b01-runtime-1 \
SDAR_UGV_LOCAL_SERVER_ID=ugv-smpp-uap-p3-b01 \
SDAR_UGV_BINDING_ID=ugv-smpp-uap-p3-b01-binding \
SDAR_UGV_PROVIDER_DISPLAY_NAME='UGV Agent Profile external simulation' \
SMPP_UGV_RUNTIME_CREDENTIAL_REF=unauthenticated://none \
SDAR_UGV_BOOTSTRAP_RUN_ID="$(uap_run_id)" \
UGV_SIMULATION_RUN_ID="$uap_authority_simulation_id" \
SDAR_UAP_SKILL_PACKAGE_ROOT="$uap_repo_root/skills/embodied.move_to" \
SDAR_UAP_AUTHORITY_REPORT_FILE="$uap_authority_report" \
  "$uap_repo_root/node_modules/.bin/tsx" \
    "$uap_repo_root/apps/node-control-acceptance/src/ugv-agent-profile-authority-bootstrap-driver.ts" \
    readiness >"$uap_authority_log" 2>&1
uap_driver_exit="$?"
set -e
chmod 0600 "$uap_authority_log"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" private-log \
  --file "$uap_authority_log"
if ((uap_driver_exit != 0)); then
  exit "$uap_driver_exit"
fi
chmod 0600 "$uap_authority_report"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" private-log \
  --file "$uap_authority_report"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/project-authority-report.mjs" \
  readiness "$uap_authority_report" "$UAP_REPORT_ROOT/authority-readiness.redacted.json"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" artifacts \
  --file "$UAP_REPORT_ROOT/authority-readiness.redacted.json"
uap_scan_host_process_logs

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  readiness complete passed 0 readiness
