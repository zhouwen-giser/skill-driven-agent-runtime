#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_requested_side_effects="${ALLOW_UGV_SIMULATION_SIDE_EFFECTS:-}"
uap_requested_simulation_id="${UGV_SIMULATION_RUN_ID:-}"
if [[ "$uap_requested_side_effects" != "YES" ]]; then
  echo "UAP_B02_EXPLICIT_SIDE_EFFECT_AUTHORIZATION_REQUIRED" >&2
  exit 64
fi
if [[ ! "$uap_requested_simulation_id" =~ ^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$ ]]; then
  echo "UAP_B02_SIMULATION_ID_REQUIRED" >&2
  exit 64
fi
readonly uap_requested_side_effects uap_requested_simulation_id

uap_stage="initialize"
uap_yes_entered="false"
uap_main_complete="false"

if ! uap_simulation_id="$(
  uap_authorize_b02_simulation_run_id "$uap_requested_simulation_id"
)"; then
  echo "UAP_B02_SIMULATION_ID_NOT_AUTHORIZED" >&2
  exit 64
fi
if [[ "$uap_requested_simulation_id" != "$uap_simulation_id" ]]; then
  echo "UAP_B02_SIMULATION_ID_MISMATCH" >&2
  exit 64
fi
uap_run_hash="$(printf '%s' "$uap_simulation_id" | sha256sum | awk '{print $1}')"
readonly uap_simulation_id uap_run_hash
readonly uap_driver="$uap_repo_root/apps/node-control-acceptance/src/ugv-agent-profile-a2a-move-driver.ts"
readonly uap_source_recovery_runner="$uap_repo_root/scripts/ugv-agent-profile-simulation/recover-b02-source-authority.mjs"
readonly uap_tsx="$uap_repo_root/node_modules/tsx/dist/cli.mjs"

export UGV_SIMULATION_RUN_ID="$uap_requested_simulation_id"
export UGV_B02_A2A_IDEMPOTENCY_KEY="uap-p3-b02-a2a-$uap_run_hash"
export UGV_B02_TARGET_LONGITUDE="106.81344630"
export UGV_B02_TARGET_LATITUDE="29.72034353"
export SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL="http://127.0.0.1:10998"
export SDAR_NODE_CONTROL_BASE_URL="http://127.0.0.1:10091"
export SDAR_RUNTIME_CONTROL_SERVICE_TOKEN_FILE="$UAP_STATE_ROOT/runtime-control-service.token"
export SDAR_CONTROL_API_TOKEN_FILE="$UAP_STATE_ROOT/control-api.token"

uap_stage="validate-local-environment"
uap_require_local_tools
for uap_tool in sha256sum awk mktemp flock; do
  if ! command -v "$uap_tool" >/dev/null 2>&1; then
    echo "UAP_REQUIRED_TOOL_MISSING: $uap_tool" >&2
    exit 2
  fi
done
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" environment
uap_assert_owned_stack_running
uap_assert_smpp_live_exposure
uap_assert_sdar_live_exposure

uap_lock_root="$UAP_STATE_ROOT/b02/locks"
mkdir -p "$uap_lock_root"
chmod 0700 "$uap_lock_root"
uap_lock_file="$uap_lock_root/$uap_run_hash.lock"
exec {uap_lock_fd}>"$uap_lock_file"
chmod 0600 "$uap_lock_file"
if ! flock -n "$uap_lock_fd"; then
  echo "UAP_B02_SIMULATION_ALREADY_RUNNING" >&2
  exit 75
fi
readonly uap_lock_root uap_lock_file uap_lock_fd

uap_b02_private_parent="$UAP_STATE_ROOT/b02"
uap_b02_private_root="$uap_b02_private_parent/$uap_simulation_id"
readonly uap_b02_private_parent uap_b02_private_root
if [[ -e "$uap_b02_private_root" || -L "$uap_b02_private_root" ]]; then
  echo "UAP_B02_RUN_ALREADY_ATTEMPTED" >&2
  exit 73
fi
readonly uap_pre_status_file="$uap_b02_private_root/supervisor-pre.json"
readonly uap_execution_status_file="$uap_b02_private_root/supervisor-execution.json"
readonly uap_final_status_file="$uap_b02_private_root/supervisor-final.json"
readonly uap_pre_ledger_file="$uap_b02_private_root/provider-ledger-pre.json"
readonly uap_post_ledger_file="$uap_b02_private_root/provider-ledger-post.json"
readonly uap_prepared_file="$uap_b02_private_root/prepared.json"
readonly uap_private_report_file="$uap_b02_private_root/report-private.json"
readonly uap_authority_gate_file="$uap_b02_private_root/authority-gate.json"
readonly uap_source_recovery_report_file="$UAP_STATE_ROOT/b02/source-recovery-reports/$uap_simulation_id.json"
readonly uap_public_report_file="$UAP_REPORT_ROOT/uap-p3-b02-verification.json"

export UGV_B02_POST_LEDGER_FILE="$uap_post_ledger_file"
export UGV_B02_PREPARED_FILE="$uap_prepared_file"
export UGV_B02_PRIVATE_REPORT_FILE="$uap_private_report_file"
export SDAR_UAP_PROFILE_A2A_BASE_URL="http://127.0.0.1:10999"
export SDAR_GOVERNED_CONTROL_BEARER_TOKEN_FILE="$UAP_STATE_ROOT/governed-control.token"

uap_preflight_staging_root="$UAP_STATE_ROOT/b02/preflight-staging"
mkdir -p "$uap_preflight_staging_root"
chmod 0700 "$uap_preflight_staging_root"
uap_preflight_candidate_root="$(
  mktemp -d "$uap_preflight_staging_root/$uap_run_hash.XXXXXXXX"
)"
readonly uap_preflight_staging_root uap_preflight_candidate_root
readonly uap_preflight_smpp_config="$uap_preflight_candidate_root/smpp-config.json"
readonly uap_preflight_sdar_config="$uap_preflight_candidate_root/sdar-config.json"
readonly uap_preflight_smpp_ps="$uap_preflight_candidate_root/smpp-ps.json"
readonly uap_pre_ledger_candidate="$uap_preflight_candidate_root/provider-ledger-pre.json"
uap_authority_gate_candidate=""

uap_cleanup_b02_pre_run() {
  local original_exit="$1"
  trap - EXIT
  set +e
  rm -f -- \
    "$uap_preflight_smpp_config" \
    "$uap_preflight_sdar_config" \
    "$uap_preflight_smpp_ps" \
    "$uap_pre_ledger_candidate"
  if [[ -n "$uap_authority_gate_candidate" ]]; then
    rm -f -- "$uap_authority_gate_candidate"
  fi
  rmdir -- "$uap_preflight_candidate_root" >/dev/null 2>&1
  exit "$original_exit"
}
trap 'uap_cleanup_b02_pre_run "$?"' EXIT

uap_stage="provider-read-only-qualification"
uap_render_root="$UAP_STATE_ROOT/rendered"
mkdir -p "$uap_render_root"
chmod 0700 "$uap_render_root"
uap_smpp_config --format json >"$uap_preflight_smpp_config"
uap_sdar_compose config --format json "${UAP_SDAR_SERVICES[@]}" \
  >"$uap_preflight_sdar_config"
uap_smpp_ps --format json >"$uap_preflight_smpp_ps"
chmod 0600 \
  "$uap_preflight_smpp_config" \
  "$uap_preflight_sdar_config" \
  "$uap_preflight_smpp_ps"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" compose \
  --smpp-json "$uap_preflight_smpp_config" \
  --sdar-json "$uap_preflight_sdar_config"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/qualify-smpp-readonly.mjs" \
  --ps-json "$uap_preflight_smpp_ps" --existing-state-only

uap_stage="capture-clean-pre-ledger"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/provider-ledger.mjs" \
  capture "$uap_pre_ledger_candidate"
export UGV_B02_PRE_LEDGER_FILE="$uap_pre_ledger_candidate"

uap_stage="validate-clean-pre-ledger"
node "$uap_tsx" "$uap_driver" preflight
rm -f -- \
  "$uap_preflight_smpp_config" \
  "$uap_preflight_sdar_config" \
  "$uap_preflight_smpp_ps"

uap_record_b02_failure() {
  local failed_stage="$1"
  local failed_exit="$2"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-b02-failure.mjs" \
    record "$failed_stage" "$failed_exit" "$uap_yes_entered" "$uap_final_status_file" \
    "$uap_simulation_id" \
    >/dev/null 2>&1 || true
}

uap_finalize_b02() {
  local original_exit="$1"
  local failed_stage="$uap_stage"
  local final_exit="$original_exit"
  local restore_command_exit=0
  local restore_state_exit=0
  local verification_exit=0

  trap '' INT TERM
  trap - EXIT ERR
  set +e

  uap_stage="restore-no"
  uap_supervisor restart-server --side-effects NO
  restore_command_exit=$?
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/b02-supervisor-state.mjs" \
    capture NO "$uap_final_status_file"
  restore_state_exit=$?

  if ((restore_command_exit != 0 || restore_state_exit != 0)); then
    failed_stage="restore-no"
    final_exit=70
  elif ((original_exit == 0)) && [[ "$uap_main_complete" == "true" ]]; then
    uap_stage="post-restore-log-scan"
    uap_scan_host_process_logs
    verification_exit=$?
    if ((verification_exit == 0)); then
      uap_stage="post-restore-smpp-scan"
      uap_capture_and_scan_smpp_runtime
      verification_exit=$?
    fi
    if ((verification_exit == 0)); then
      uap_stage="post-restore-sdar-scan"
      uap_capture_and_scan_sdar_runtime
      verification_exit=$?
    fi
    if ((verification_exit == 0)); then
      uap_stage="validate-private-report"
      node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" \
        private-log --file "$uap_private_report_file"
      verification_exit=$?
    fi
    if ((verification_exit == 0)); then
      uap_stage="validate-source-recovery-report"
      node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" \
        private-log --file "$uap_source_recovery_report_file"
      verification_exit=$?
    fi
    if ((verification_exit == 0)); then
      uap_stage="validate-authority-gate-report"
      node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" \
        private-log --file "$uap_authority_gate_file"
      verification_exit=$?
    fi
    if ((verification_exit == 0)); then
      uap_stage="publish-canonical-report"
      node "$uap_repo_root/scripts/ugv-agent-profile-simulation/project-a2a-move-report.mjs" \
        "$uap_private_report_file" \
        "$uap_pre_status_file" \
        "$uap_execution_status_file" \
        "$uap_final_status_file" \
        "$uap_source_recovery_report_file" \
        "$uap_authority_gate_file" \
        "$uap_public_report_file" \
        >/dev/null
      verification_exit=$?
    fi
    if ((verification_exit != 0)); then
      failed_stage="$uap_stage"
      final_exit=71
    else
      final_exit=0
    fi
  elif ((final_exit == 0)); then
    failed_stage="incomplete"
    final_exit=72
  fi

  if ((final_exit != 0)); then
    uap_record_b02_failure "$failed_stage" "$final_exit"
  fi
  exit "$final_exit"
}

uap_pending_signal_exit=0
uap_pending_signal_stage=""
uap_capture_pending_b02_signal() {
  if ((uap_pending_signal_exit == 0)); then
    uap_pending_signal_exit="$1"
    uap_pending_signal_stage="$uap_stage"
  fi
}

uap_stage="create-official-run"
trap 'uap_capture_pending_b02_signal 130' INT
trap 'uap_capture_pending_b02_signal 143' TERM
mkdir -p "$uap_b02_private_parent"
chmod 0700 "$uap_b02_private_parent"
if ! mkdir -m 0700 "$uap_b02_private_root"; then
  echo "UAP_B02_RUN_ALREADY_ATTEMPTED" >&2
  exit 73
fi

trap 'uap_finalize_b02 "$?"' EXIT

if mv -- "$uap_pre_ledger_candidate" "$uap_pre_ledger_file"; then
  :
else
  uap_pre_ledger_seal_exit="$?"
  trap - EXIT
  if rmdir -- "$uap_b02_private_root"; then
    trap 'uap_cleanup_b02_pre_run "$?"' EXIT
    exit "$uap_pre_ledger_seal_exit"
  fi
  if mv -- "$uap_pre_ledger_candidate" "$uap_pre_ledger_file"; then
    export UGV_B02_PRE_LEDGER_FILE="$uap_pre_ledger_file"
    trap 'uap_finalize_b02 "$?"' EXIT
    echo "UAP_B02_EMPTY_RUN_ROLLBACK_FAILED_EVIDENCE_SEALED" >&2
    exit 76
  fi
  trap 'uap_finalize_b02 "$?"' EXIT
  echo "UAP_B02_PRE_LEDGER_SEAL_HARD_BLOCKED" >&2
  exit 77
fi
export UGV_B02_PRE_LEDGER_FILE="$uap_pre_ledger_file"
if ! rmdir -- "$uap_preflight_candidate_root"; then
  echo "UAP_B02_PREFLIGHT_STAGING_CLEANUP_DEFERRED" >&2
fi

trap 'exit 130' INT
trap 'exit 143' TERM
if ((uap_pending_signal_exit != 0)); then
  uap_stage="$uap_pending_signal_stage"
  exit "$uap_pending_signal_exit"
fi

uap_stage="recover-source-under-no"
env -u ALLOW_UGV_SIMULATION_SIDE_EFFECTS \
  UGV_B02_SOURCE_RECOVERY_ATTEMPT_ID="$uap_simulation_id" \
  SMPP_SDAR_SOURCE_ID="smpp-source-ugv1-uap-p3-b01" \
  SMPP_ENVIRONMENT="simulation" \
  SMPP_SDAR_REGISTRY_ENDPOINT="http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest" \
  SMPP_REGISTRY_CREDENTIAL_REF="unauthenticated://none" \
  SMPP_SNAPSHOT_TTL_SECONDS="300" \
  SMPP_UGV_EXTERNAL_PROVIDER_ID="isr.vehicle.ugv.ugv1" \
  SMPP_UGV_EXTERNAL_SERVER_ID="uap-p3-b01-runtime-1" \
  SDAR_UGV_LOCAL_SERVER_ID="ugv-smpp-uap-p3-b01" \
  SDAR_UGV_BINDING_ID="ugv-smpp-uap-p3-b01-binding" \
  pnpm exec tsx "$uap_source_recovery_runner"

uap_stage="authority-runway-gate"
uap_authority_gate_staging_root="$UAP_STATE_ROOT/b02/authority-gate-staging"
mkdir -p "$uap_authority_gate_staging_root"
chmod 0700 "$uap_authority_gate_staging_root"
uap_authority_gate_candidate="$(
  mktemp "$uap_authority_gate_staging_root/$uap_run_hash.XXXXXXXX"
)"
readonly uap_authority_gate_staging_root uap_authority_gate_candidate
if node "$uap_tsx" "$uap_driver" authority-gate >"$uap_authority_gate_candidate"; then
  if [[ ! -s "$uap_authority_gate_candidate" ]]; then
    rm -f -- "$uap_authority_gate_candidate"
    echo "UAP_B02_AUTHORITY_GATE_REPORT_EMPTY" >&2
    exit 74
  fi
else
  uap_authority_gate_exit="$?"
  rm -f -- "$uap_authority_gate_candidate"
  exit "$uap_authority_gate_exit"
fi

uap_stage="seal-authority-runway-gate"
if mv -- "$uap_authority_gate_candidate" "$uap_authority_gate_file"; then
  :
else
  uap_authority_gate_seal_exit="$?"
  rm -f -- "$uap_authority_gate_candidate"
  exit "$uap_authority_gate_seal_exit"
fi

uap_stage="preflight-no"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/b02-supervisor-state.mjs" \
  capture NO "$uap_pre_status_file"
uap_assert_owned_stack_running
uap_assert_smpp_live_exposure
uap_assert_sdar_live_exposure

uap_stage="enable-server-side-effects"
uap_supervisor restart-server \
  --side-effects YES \
  --simulation-run-id "$uap_simulation_id" \
  --acknowledge I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS
uap_yes_entered="true"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/b02-supervisor-state.mjs" \
  capture YES "$uap_execution_status_file"

uap_stage="prepare-unique-admission"
node "$uap_tsx" "$uap_driver" prepare

uap_stage="confirm-and-observe"
node "$uap_tsx" "$uap_driver" observe

uap_main_complete="true"
uap_stage="execution-complete"
