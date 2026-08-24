#!/usr/bin/env bash
set -euo pipefail

uap_deploy_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
uap_repo_root="$(CDPATH= cd -- "$uap_deploy_dir/../.." && pwd)"
uap_workspace_root="$(CDPATH= cd -- "$uap_repo_root/.." && pwd)"
uap_smpp_root="$uap_workspace_root/sdar-mcp-provider-platform"

readonly uap_deploy_dir uap_repo_root uap_workspace_root uap_smpp_root
readonly UAP_SMPP_EXPECTED_HEAD="b5f3ba2076468695c781bea1e5e6d3045e60f70e"
readonly UAP_SMPP_PROJECT="sdar-uap-p3-b01-smpp"
readonly UAP_SMPP_PROFILE="ugv-agent-profile-simulation"
readonly UAP_SDAR_PROJECT="sdar-uap-p3-b01-sdar"
readonly UAP_STATE_ROOT="/tmp/sdar-uap-p3-b01-$(id -u)"
readonly UAP_PMS_STATE_ROOT="$UAP_STATE_ROOT/pms"
readonly UAP_PROCESS_MANIFEST="$UAP_STATE_ROOT/processes.json"
readonly UAP_HOST_PROCESS_COUNT=3
readonly UAP_REPORT_ROOT="$uap_repo_root/reports/ugv-agent-profile-simulation"
readonly UAP_ATTEMPT_ROOT="$UAP_REPORT_ROOT/attempts"

readonly UAP_SMPP_SERVICES=(
  ugv-agent-profile-adapter-postgres
  ugv-agent-profile-runtime-postgres
  ugv-agent-profile-pms-postgres
  ugv-agent-profile-pms-api
  ugv-agent-profile-adapter
  ugv-agent-profile-runtime
  ugv-agent-profile-pms-worker
)

readonly UAP_SDAR_SERVICES=(uap-sdar-postgres uap-control-postgres uap-redis)
readonly UAP_SMPP_VOLUMES=(
  sdar-uap-p3-b01-smpp-adapter-postgres-data
  sdar-uap-p3-b01-smpp-runtime-postgres-data
  sdar-uap-p3-b01-smpp-adapter-state
  sdar-uap-p3-b01-smpp-pms-postgres-data
  sdar-uap-p3-b01-smpp-pms-worker-state
)
readonly UAP_SDAR_VOLUMES=(
  sdar-uap-p3-b01-runtime-postgres-data
  sdar-uap-p3-b01-control-postgres-data
  sdar-uap-p3-b01-redis-data
)

uap_install_abort_traps() {
  local handler="$1"
  if [[ ! "$handler" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    echo "UAP_ABORT_HANDLER_INVALID" >&2
    return 2
  fi
  trap "$handler \"\$?\"" ERR
  trap "$handler 130" INT
  trap "$handler 143" TERM
}

uap_clear_abort_traps() {
  trap - ERR INT TERM
}

uap_require_local_tools() {
  local tool
  for tool in git node pnpm docker curl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "UAP_REQUIRED_TOOL_MISSING: $tool" >&2
      return 2
    fi
  done
  if ! docker compose version >/dev/null 2>&1; then
    echo "UAP_DOCKER_COMPOSE_REQUIRED" >&2
    return 2
  fi
}

uap_initialize_state() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/initialize-state.mjs"
}

uap_run_id() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/initialize-state.mjs" --print-run-id
}

uap_simulation_run_id() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/initialize-state.mjs" --print-simulation-run-id
}

uap_existing_simulation_run_id() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/initialize-state.mjs" \
    --print-existing-simulation-run-id
}

uap_authorize_b02_simulation_run_id() {
  if (($# != 1)); then
    echo "UAP_B02_SIMULATION_ID_REQUIRED" >&2
    return 64
  fi
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/b02-attempt-identity.mjs" \
    authorize "$1"
}

uap_authority_simulation_run_id() {
  local simulation_id="${UGV_SIMULATION_RUN_ID:-}"
  if [[ -z "$simulation_id" ]]; then
    simulation_id="$(uap_simulation_run_id)"
  fi
  uap_authorize_b02_simulation_run_id "$simulation_id" >/dev/null
  printf '%s\n' "$simulation_id"
}

uap_smpp_compose() {
  env \
    UAP_PMS_STATE_ROOT="$UAP_PMS_STATE_ROOT" \
    UGV_AGENT_PROFILE_ADAPTER_PORT=17031 \
    UGV_AGENT_PROFILE_RUNTIME_PORT=19131 \
    UGV_AGENT_PROFILE_IMAGE_TAG=uap-p3-b01 \
    docker compose \
    --env-file /dev/null \
    --project-directory "$uap_smpp_root" \
    --project-name "$UAP_SMPP_PROJECT" \
    -f "$uap_smpp_root/compose.yaml" \
    -f "$uap_smpp_root/compose.ugv-agent-profile-simulation.yaml" \
    -f "$uap_deploy_dir/compose.smpp-pms.yaml" \
    --profile "$UAP_SMPP_PROFILE" \
    "$@"
}

uap_smpp_config() {
  uap_smpp_compose config "$@" "${UAP_SMPP_SERVICES[@]}"
}

uap_smpp_up() {
  uap_smpp_compose up "$@" "${UAP_SMPP_SERVICES[@]}"
}

uap_smpp_ps() {
  uap_smpp_compose ps "$@" "${UAP_SMPP_SERVICES[@]}"
}

uap_smpp_logs() {
  uap_smpp_compose logs "$@" "${UAP_SMPP_SERVICES[@]}"
}

uap_sdar_compose() {
  docker compose \
    --env-file /dev/null \
    --project-directory "$uap_repo_root" \
    --project-name "$UAP_SDAR_PROJECT" \
    -f "$uap_deploy_dir/compose.sdar.yaml" \
    "$@"
}

uap_sdar_config() {
  uap_sdar_compose config "$@" "${UAP_SDAR_SERVICES[@]}"
}

uap_sdar_up() {
  uap_sdar_compose up "$@" "${UAP_SDAR_SERVICES[@]}"
}

uap_sdar_ps() {
  uap_sdar_compose ps "$@" "${UAP_SDAR_SERVICES[@]}"
}

uap_sdar_logs() {
  uap_sdar_compose logs "$@" "${UAP_SDAR_SERVICES[@]}"
}

uap_supervisor() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/host-process-supervisor.mjs" "$@"
}

uap_docker() {
  command docker "$@"
}

uap_capture_project_inventory() {
  local project="$1"
  local output_file="$2"
  local -a container_ids=()
  if ! uap_read_command_lines container_ids uap_docker ps -a \
    --filter "label=com.docker.compose.project=$project" --format '{{.ID}}'; then
    echo "UAP_PROJECT_INVENTORY_FAILED" >&2
    return 2
  fi
  if ((${#container_ids[@]} == 0)); then
    printf '[]\n' >"$output_file"
  elif ! uap_docker inspect -- "${container_ids[@]}" >"$output_file"; then
    echo "UAP_PROJECT_INVENTORY_INSPECTION_FAILED" >&2
    return 2
  fi
  chmod 0600 "$output_file"
}

uap_assert_owned_project_closure() {
  local render_root="$UAP_STATE_ROOT/rendered"
  mkdir -p "$render_root"
  chmod 0700 "$render_root"
  uap_capture_project_inventory "$UAP_SMPP_PROJECT" "$render_root/smpp-project-inspect.json"
  uap_capture_project_inventory "$UAP_SDAR_PROJECT" "$render_root/sdar-project-inspect.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-running-stack.mjs" \
    --mode closure \
    --smpp-project-inspect "$render_root/smpp-project-inspect.json" \
    --sdar-project-inspect "$render_root/sdar-project-inspect.json"
}

uap_assert_owned_stack_running() {
  local render_root="$UAP_STATE_ROOT/rendered"
  mkdir -p "$render_root"
  chmod 0700 "$render_root"
  uap_capture_project_inventory "$UAP_SMPP_PROJECT" "$render_root/smpp-project-inspect.json"
  uap_capture_project_inventory "$UAP_SDAR_PROJECT" "$render_root/sdar-project-inspect.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-running-stack.mjs" \
    --mode running \
    --smpp-project-inspect "$render_root/smpp-project-inspect.json" \
    --sdar-project-inspect "$render_root/sdar-project-inspect.json"
  uap_smpp_ps --format json >"$render_root/smpp-ps.json"
  uap_sdar_ps --format json >"$render_root/sdar-ps.json"
  chmod 0600 "$render_root/smpp-ps.json" "$render_root/sdar-ps.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-running-stack.mjs" \
    --smpp-ps "$render_root/smpp-ps.json" \
    --sdar-ps "$render_root/sdar-ps.json"
  if ! uap_supervisor status >"$render_root/supervisor-status.json"; then
    echo "UAP_SUPERVISOR_STATUS_FAILED" >&2
    return 2
  fi
  chmod 0600 "$render_root/supervisor-status.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-running-stack.mjs" \
    --supervisor-status "$render_root/supervisor-status.json"
}

uap_assert_smpp_live_exposure() {
  local render_root="$UAP_STATE_ROOT/rendered"
  mkdir -p "$render_root"
  chmod 0700 "$render_root"
  uap_capture_project_inventory "$UAP_SMPP_PROJECT" "$render_root/smpp-live-inspect.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-running-stack.mjs" \
    --smpp-runtime-inspect "$render_root/smpp-live-inspect.json"
}

uap_assert_sdar_live_exposure() {
  local render_root="$UAP_STATE_ROOT/rendered"
  mkdir -p "$render_root"
  chmod 0700 "$render_root"
  uap_capture_project_inventory "$UAP_SDAR_PROJECT" "$render_root/sdar-live-inspect.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-running-stack.mjs" \
    --sdar-runtime-inspect "$render_root/sdar-live-inspect.json"
}

uap_scan_host_process_logs() {
  local supervisor_command="${1:-log-files}"
  local active_output stored_output
  local -a active_log_files=()
  local -a log_files=()
  local log_file
  if [[ "$supervisor_command" != "log-files" && "$supervisor_command" != "stored-log-files" ]]; then
    echo "UAP_HOST_LOG_COMMAND_INVALID" >&2
    return 2
  fi
  if [[ "$supervisor_command" == "log-files" ]]; then
    if ! active_output="$(uap_supervisor log-files)"; then
      return 2
    fi
    while IFS= read -r log_file; do
      [[ -n "$log_file" ]] && active_log_files+=("$log_file")
    done <<<"$active_output"
    if ((${#active_log_files[@]} != UAP_HOST_PROCESS_COUNT)); then
      echo "UAP_HOST_LOG_CLOSURE_INVALID" >&2
      return 2
    fi
  fi
  if ! stored_output="$(uap_supervisor stored-log-files)"; then
    return 2
  fi
  while IFS= read -r log_file; do
    [[ -n "$log_file" ]] && log_files+=("$log_file")
  done <<<"$stored_output"
  if [[ "$supervisor_command" == "log-files" ]]; then
    local active_file observed
    for active_file in "${active_log_files[@]}"; do
      observed="false"
      for log_file in "${log_files[@]}"; do
        [[ "$log_file" == "$active_file" ]] && observed="true"
      done
      if [[ "$observed" != "true" ]]; then
        echo "UAP_HOST_LOG_CLOSURE_INVALID" >&2
        return 2
      fi
    done
  fi
  for log_file in "${log_files[@]}"; do
    node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" private-log \
      --file "$log_file"
  done
}

uap_read_command_lines() {
  local destination_name="$1"
  shift
  local output
  local line
  local -n destination="$destination_name"
  if ! output="$("$@")"; then
    return 2
  fi
  destination=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && destination+=("$line")
  done <<<"$output"
  return 0
}

uap_capture_and_scan_smpp_runtime() {
  local render_root="$UAP_STATE_ROOT/rendered"
  local -a smpp_ids=()
  mkdir -p "$render_root"
  chmod 0700 "$render_root"
  uap_read_command_lines smpp_ids uap_smpp_ps --quiet
  if ((${#smpp_ids[@]} != ${#UAP_SMPP_SERVICES[@]})); then
    echo "UAP_SMPP_INSPECT_CLOSURE_INVALID" >&2
    return 2
  fi
  docker inspect -- "${smpp_ids[@]}" >"$render_root/smpp-inspect.json"
  uap_smpp_logs --no-color >"$render_root/smpp.log" 2>&1
  chmod 0600 "$render_root/smpp-inspect.json" "$render_root/smpp.log"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" runtime-material \
    --file "$render_root/smpp-inspect.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" private-log \
    --file "$render_root/smpp.log"
}

uap_capture_and_scan_sdar_runtime() {
  local render_root="$UAP_STATE_ROOT/rendered"
  local -a sdar_ids=()
  mkdir -p "$render_root"
  chmod 0700 "$render_root"
  uap_read_command_lines sdar_ids uap_sdar_ps --quiet
  if ((${#sdar_ids[@]} != ${#UAP_SDAR_SERVICES[@]})); then
    echo "UAP_SDAR_INSPECT_CLOSURE_INVALID" >&2
    return 2
  fi
  docker inspect -- "${sdar_ids[@]}" >"$render_root/sdar-inspect.json"
  uap_sdar_logs --no-color >"$render_root/sdar.log" 2>&1
  chmod 0600 "$render_root/sdar-inspect.json" "$render_root/sdar.log"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" runtime-material \
    --file "$render_root/sdar-inspect.json"
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" private-log \
    --file "$render_root/sdar.log"
}

uap_remove_owned_volume() {
  local project="$1"
  local volume="$2"
  local observed_project
  local -a inventory=()
  local observed_count=0
  local item
  if ! uap_read_command_lines inventory uap_docker volume ls --format '{{.Name}}'; then
    echo "UAP_VOLUME_INVENTORY_FAILED" >&2
    return 2
  fi
  for item in "${inventory[@]}"; do
    [[ "$item" == "$volume" ]] && observed_count=$((observed_count + 1))
  done
  if ((observed_count == 0)); then
    return 0
  fi
  if ((observed_count != 1)); then
    echo "UAP_VOLUME_INVENTORY_INVALID" >&2
    return 2
  fi
  if ! observed_project="$(uap_docker volume inspect \
    --format '{{ index .Labels "com.docker.compose.project" }}' "$volume")"; then
    echo "UAP_VOLUME_INSPECTION_FAILED" >&2
    return 2
  fi
  if [[ "$observed_project" != "$project" ]]; then
    echo "UAP_VOLUME_OWNERSHIP_MISMATCH" >&2
    return 2
  fi
  uap_docker volume rm "$volume" >/dev/null
  inventory=()
  if ! uap_read_command_lines inventory uap_docker volume ls --format '{{.Name}}'; then
    echo "UAP_VOLUME_INVENTORY_FAILED" >&2
    return 2
  fi
  for item in "${inventory[@]}"; do
    if [[ "$item" == "$volume" ]]; then
      echo "UAP_VOLUME_REMOVAL_POSTCHECK_FAILED" >&2
      return 2
    fi
  done
}

uap_wait_http() {
  local url="$1"
  local attempts="${2:-90}"
  local count
  for ((count = 1; count <= attempts; count += 1)); do
    if curl --silent --show-error --fail --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "UAP_HTTP_READINESS_TIMEOUT" >&2
  return 2
}

uap_assert_smpp_read_only_baseline() {
  node "$uap_repo_root/scripts/ugv-agent-profile-simulation/validate-profile.mjs" baseline
}

uap_attempt_path() {
  local kind="$1"
  local run_id
  run_id="$(uap_run_id)"
  printf '%s/%s-%s.redacted.json\n' "$UAP_ATTEMPT_ROOT" "$kind" "$run_id"
}
