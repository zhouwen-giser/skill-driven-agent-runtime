#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"

uap_stage="pms-seed"
uap_record_failure() {
  local uap_exit="$1"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
    smpp-seed "$uap_stage" failed "$uap_exit" seed-smpp >/dev/null 2>&1 || true
}
trap 'uap_record_failure "$?"' ERR

uap_initialize_state >/dev/null
uap_seed_script="$uap_repo_root/scripts/ugv-agent-profile-simulation/pms-profile-seed.mjs"
if [[ ! -f "$uap_seed_script" ]]; then
  echo "UAP_OFFICIAL_PMS_SEED_MISSING" >&2
  exit 2
fi

uap_seed_log="$(mktemp "$UAP_STATE_ROOT/logs/pms-seed-$(uap_run_id)-XXXXXXXX.jsonl")"
chmod 0600 "$uap_seed_log"
set +e
uap_smpp_compose run --rm --no-deps \
  --volume "$uap_seed_script:/app/pms-seed.mjs:ro" \
  --env PMS_SEED_API_BASE_URL=http://pms-api:8090/ \
  --env PMS_SEED_ACTOR_ID=uap-p3-b01-bootstrap \
  --env PMS_SEED_ENVIRONMENT=simulation \
  --env PMS_SEED_PROVIDER_ID=isr.vehicle.ugv.ugv1 \
  --env PMS_SEED_RESOURCE_ID=vehicle:ugv1 \
  --env PMS_SEED_ADAPTER_ENDPOINT=ugv-agent-profile-adapter:7010 \
  --env PMS_SEED_DEPLOYMENT_ID=uap-p3-b01-runtime \
  --env PMS_SEED_INSTANCE_ID=uap-p3-b01-runtime-1 \
  --env PMS_SEED_RUNTIME_VERSION=2.0.0-rc.1 \
  --env PMS_SEED_RUNTIME_CONTROL_ENDPOINT=http://ugv-agent-profile-runtime:8080/ \
  --env PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT=http://127.0.0.1:19131/ \
  --env PMS_SEED_RUNTIME_PUBLISHED_PORT=19131 \
  --env PMS_SEED_WAIT_TIMEOUT_MS=180000 \
  --env PMS_SEED_POLL_INTERVAL_MS=2000 \
  --env PMS_SEED_DATABASE_URL_FILE=/run/uap-pms/pms-database-url \
  --env PMS_SEED_PACKAGE_ROOT=/app \
  ugv-agent-profile-pms-worker node /app/pms-seed.mjs >"$uap_seed_log" 2>&1
uap_seed_exit="$?"
set -e
chmod 0600 "$uap_seed_log"
uap_scan_exit=0
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" private-log \
  --file "$uap_seed_log" || uap_scan_exit="$?"
if ((uap_scan_exit != 0)); then
  exit "$uap_scan_exit"
fi
if ((uap_seed_exit != 0)); then
  exit "$uap_seed_exit"
fi

node "$uap_repo_root/scripts/ugv-agent-profile-simulation/project-pms-seed-report.mjs" \
  "$uap_seed_log" "$UAP_REPORT_ROOT/pms-seed.redacted.json"
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" artifacts \
  --file "$UAP_REPORT_ROOT/pms-seed.redacted.json"

uap_stage="complete"
trap - ERR
node "$uap_repo_root/scripts/ugv-agent-profile-simulation/record-attempt.mjs" \
  smpp-seed complete passed 0 seed-smpp
