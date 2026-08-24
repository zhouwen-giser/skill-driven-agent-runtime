#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="verification"
uap_record_failure() {
  local uap_exit="$1"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
    verify "$uap_stage" failed "$uap_exit" verify >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

uap_initialize_state >/dev/null
uap_assert_owned_stack_running
"$script_directory/readiness.sh"
"$script_directory/qualify-smpp.sh"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/model-invocation-audit.mjs" final
uap_scan_host_process_logs
uap_capture_and_scan_smpp_runtime
uap_capture_and_scan_sdar_runtime
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" artifacts \
  --file "$UAP_REPORT_ROOT/pms-seed.redacted.json" \
  --file "$UAP_REPORT_ROOT/smpp-readonly-qualification.redacted.json" \
  --file "$UAP_REPORT_ROOT/authority-bootstrap.redacted.json" \
  --file "$UAP_REPORT_ROOT/authority-readiness.redacted.json" \
  --file "$UAP_REPORT_ROOT/model-invocation-baseline.redacted.json" \
  --file "$UAP_REPORT_ROOT/model-invocation-final.redacted.json"

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  verify complete passed 0 verify
