#!/usr/bin/env bash
# Sourced only by debug.sh. The acceptance deployment helpers remain unchanged.
uap_telemetry_root="$uap_workspace_root/smpp-telemetry-platform"
UGV_DEBUG_STATE_ROOT="$UAP_STATE_ROOT/debug"
export UGV_DEBUG_STATE_ROOT
readonly UAP_DEBUG_TELEMETRY_PROJECT=sdar-ugv-debug-telemetry
readonly UAP_DEBUG_TELEMETRY_SERVICES=(clickhouse telemetry-migrate telemetry-processor otel-collector query-api)
readonly UAP_DEBUG_SMPP_APPS=(ugv-agent-profile-pms-api ugv-agent-profile-adapter ugv-agent-profile-runtime ugv-agent-profile-pms-worker)

uap_debug_smpp() {
  env UAP_PMS_STATE_ROOT="$UAP_PMS_STATE_ROOT" UGV_AGENT_PROFILE_ADAPTER_PORT=17031 \
    UGV_AGENT_PROFILE_RUNTIME_PORT=19131 UGV_AGENT_PROFILE_IMAGE_TAG=uap-p3-b01 \
    docker compose --env-file /dev/null --project-directory "$uap_smpp_root" \
    --project-name "$UAP_SMPP_PROJECT" -f "$uap_smpp_root/compose.yaml" \
    -f "$uap_smpp_root/compose.ugv-agent-profile-simulation.yaml" \
    -f "$uap_deploy_dir/compose.smpp-pms.yaml" -f "$uap_deploy_dir/compose.debug.yaml" \
    --profile "$UAP_SMPP_PROFILE" "$@"
}

uap_debug_telemetry() {
  docker compose --env-file /dev/null --project-directory "$uap_telemetry_root" \
    --project-name "$UAP_DEBUG_TELEMETRY_PROJECT" \
    -f "$uap_telemetry_root/deploy/ugv-debug/compose.yaml" "$@"
}

uap_debug_supervisor() {
  uap_supervisor --development-public-host "$UGV_DEBUG_PUBLIC_HOST" "$@"
}

uap_debug_authorize() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/debug-identity.mjs" authorize "$1"
}

uap_debug_profile() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/debug-profile.mjs" "$@"
}

uap_debug_network() {
  local owner
  if owner="$(docker network inspect sdar-ugv-debug-observability --format '{{index .Labels "io.sdar.owner"}}' 2>/dev/null)"; then
    [[ "$owner" == ugv-debug ]] || { echo UGV_DEBUG_NETWORK_OWNERSHIP_CONFLICT >&2; return 1; }
  else
    docker network create --label io.sdar.owner=ugv-debug sdar-ugv-debug-observability
  fi
}

uap_debug_seed() {
  uap_debug_smpp run --rm --no-deps \
    --volume "$uap_repo_root/scripts/ugv-agent-profile-simulation/pms-profile-seed.mjs:/app/pms-seed.mjs:ro" \
    --env PMS_SEED_API_BASE_URL=http://pms-api:8090/ \
    --env PMS_SEED_ACTOR_ID=uap-p3-b01-bootstrap --env PMS_SEED_ENVIRONMENT=simulation \
    --env PMS_SEED_PROVIDER_ID=isr.vehicle.ugv.ugv1 --env PMS_SEED_RESOURCE_ID=vehicle:ugv1 \
    --env PMS_SEED_ADAPTER_ENDPOINT=ugv-agent-profile-adapter:7010 \
    --env PMS_SEED_DEPLOYMENT_ID=uap-p3-b01-runtime --env PMS_SEED_INSTANCE_ID=uap-p3-b01-runtime-1 \
    --env PMS_SEED_RUNTIME_VERSION=2.0.0-rc.1 \
    --env PMS_SEED_RUNTIME_CONTROL_ENDPOINT=http://ugv-agent-profile-runtime:8080/ \
    --env PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT=http://127.0.0.1:19131/ \
    --env PMS_SEED_RUNTIME_PUBLISHED_PORT=19131 --env PMS_SEED_WAIT_TIMEOUT_MS=180000 \
    --env PMS_SEED_POLL_INTERVAL_MS=2000 --env PMS_SEED_DATABASE_URL_FILE=/run/uap-pms/pms-database-url \
    --env PMS_SEED_PACKAGE_ROOT=/app ugv-agent-profile-pms-worker node /app/pms-seed.mjs
}

uap_debug_wait_provider() {
  uap_debug_smpp exec -T ugv-agent-profile-adapter node --input-type=module \
    <"$uap_repo_root/scripts/ugv-agent-profile-simulation/wait-debug-provider.mjs"
}

uap_debug_authority() {
  env SDAR_NODE_CONTROL_BASE_URL=http://127.0.0.1:10091 \
    SDAR_CONTROL_API_TOKEN_FILE="$UAP_STATE_ROOT/control-api.token" \
    SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL=http://127.0.0.1:10998 \
    SDAR_UAP_PROFILE_A2A_BASE_URL=http://127.0.0.1:10999 \
    SMPP_SDAR_SOURCE_ID=smpp-source-ugv1-uap-p3-b01 SMPP_ENVIRONMENT=simulation \
    SMPP_SDAR_REGISTRY_ENDPOINT=http://127.0.0.1:18092/api/v1/registry/simulation/consumers/sdar/v1/sources/smpp-source-ugv1-uap-p3-b01/latest \
    SMPP_REGISTRY_CREDENTIAL_REF=unauthenticated://none \
    SMPP_UGV_EXTERNAL_PROVIDER_ID=isr.vehicle.ugv.ugv1 SMPP_UGV_EXTERNAL_SERVER_ID=uap-p3-b01-runtime-1 \
    SDAR_UGV_LOCAL_SERVER_ID=ugv-smpp-uap-p3-b01 SDAR_UGV_BINDING_ID=ugv-smpp-uap-p3-b01-binding \
    SDAR_UGV_PROVIDER_DISPLAY_NAME='UGV Agent Profile external simulation' \
    SMPP_UGV_RUNTIME_CREDENTIAL_REF=unauthenticated://none SDAR_UGV_BOOTSTRAP_RUN_ID="$(uap_run_id)" \
    UGV_SIMULATION_RUN_ID="$uap_debug_simulation_id" \
    SDAR_UAP_SKILL_PACKAGE_ROOT="$uap_repo_root/skills/embodied.move_to" \
    "$uap_repo_root/node_modules/.bin/tsx" "$uap_repo_root/apps/node-control-acceptance/src/ugv-debug-bootstrap.ts"
}

uap_debug_status() {
  uap_debug_supervisor status
  uap_sdar_compose ps "${UAP_SDAR_SERVICES[@]}"
  uap_debug_smpp ps "${UAP_SMPP_SERVICES[@]}"
  uap_debug_telemetry ps "${UAP_DEBUG_TELEMETRY_SERVICES[@]}"
  uap_debug_profile status
}
