#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if (($# < 1 || $# > 2)) || [[ ! "$1" =~ ^(start|restart|status|stop)$ ]] ||
  { (($# == 2)) && { [[ ! "$1" =~ ^(start|restart)$ ]] || [[ ! "$2" =~ ^(YES|NO)$ ]]; }; }; then
  echo "UAP_DEBUG_COMMAND_INVALID: expected start|restart [YES|NO] or status|stop" >&2
  exit 64
fi

script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$script_directory/common.sh"
source "$script_directory/debug-common.sh"

UGV_DEBUG_PUBLIC_HOST="$(uap_debug_profile public-host)"
export UGV_DEBUG_PUBLIC_HOST
if [[ "$1" == "status" ]]; then
  uap_debug_status
  exit 0
fi

uap_require_local_tools
uap_initialize_state >/dev/null
exec 9>"$UAP_STATE_ROOT/debug-command.lock"
flock -n 9 || { echo UGV_DEBUG_COMMAND_ALREADY_RUNNING >&2; exit 73; }
if [[ "$1" == "stop" ]]; then
  # No down -v, volume removal, qualification, or business task is part of debugging.
  uap_debug_supervisor stop
  uap_debug_smpp stop "${UAP_SMPP_SERVICES[@]}"
  uap_debug_telemetry stop "${UAP_DEBUG_TELEMETRY_SERVICES[@]}"
  if [[ -f "$UGV_DEBUG_STATE_ROOT/sdar-telemetry/compose.env" ]]; then
    uap_debug_sdar_telemetry stop "${UAP_DEBUG_SDAR_TELEMETRY_SERVICES[@]}"
  fi
  if [[ -f "$UGV_DEBUG_STATE_ROOT/benchmark/reader.json" ]]; then
    uap_debug_benchmark stop "${UAP_DEBUG_BENCHMARK_SERVICES[@]}"
  fi
  uap_sdar_compose stop "${UAP_SDAR_SERVICES[@]}"
  exit 0
fi

uap_debug_mode="${2:-YES}"
uap_debug_simulation_id="${UGV_SIMULATION_RUN_ID:-$(uap_existing_simulation_run_id)}"
if [[ "$uap_debug_mode" == YES ]]; then
  uap_debug_authorize "$uap_debug_simulation_id" >/dev/null
fi
uap_debug_stage=configuration
uap_debug_log=''
uap_debug_host_started=0
uap_debug_finish() {
  local result="$?"
  trap '' INT TERM
  trap - EXIT
  if ((result != 0)); then
    if ((uap_debug_host_started == 1)); then
      if ! uap_debug_supervisor restart-server --side-effects NO; then
        # Ownership-checked stop is safer than leaving an uncertain YES process.
        uap_debug_supervisor stop || result=70
      fi
    fi
    echo "UGV_DEBUG_FAILED stage=$uap_debug_stage exit=$result log=$uap_debug_log (data retained)" >&2
  fi
  exit "$result"
}
trap uap_debug_finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
uap_debug_step() {
  uap_debug_stage="$1"; shift
  uap_debug_log="$(mktemp "$UAP_STATE_ROOT/logs/debug-$uap_debug_stage-XXXXXXXX.log")"
  echo "[ugv:debug] $uap_debug_stage"
  "$@" >"$uap_debug_log" 2>&1
}

echo 'WARNING: trusted LAN development, anonymous management; default final side-effects=YES.'
uap_debug_step configuration uap_debug_profile configure
uap_debug_step sdar-telemetry-configuration uap_debug_sdar_telemetry_config configure
uap_debug_step benchmark-configuration uap_debug_benchmark_config
uap_debug_step shared-network uap_debug_network
uap_debug_step sdar-infrastructure uap_sdar_compose up -d --wait "${UAP_SDAR_SERVICES[@]}"
uap_debug_step smpp-infrastructure uap_debug_smpp up -d --wait \
  ugv-agent-profile-adapter-postgres ugv-agent-profile-runtime-postgres ugv-agent-profile-pms-postgres
uap_debug_step telemetry-build uap_debug_telemetry build telemetry-processor query-api
uap_debug_step telemetry-infrastructure uap_debug_telemetry up -d --wait clickhouse
uap_debug_step telemetry-migrations uap_debug_telemetry run --rm --no-deps telemetry-migrate
uap_debug_reload=()
if [[ "$1" == restart ]]; then uap_debug_reload=(--force-recreate); fi
uap_debug_step sdar-telemetry-build uap_debug_sdar_telemetry build control-migrate
uap_debug_step sdar-telemetry-infrastructure uap_debug_sdar_telemetry up -d --wait control-postgres
uap_debug_step sdar-telemetry-migrations uap_debug_sdar_telemetry run --rm --no-deps control-migrate
uap_debug_step external-warehouse-additive-migration uap_debug_sdar_telemetry run --rm --no-deps warehouse-migrate
uap_debug_step provider-v2-migration uap_debug_sdar_telemetry run --rm --no-deps provider-migrate
uap_debug_step external-warehouse-contract uap_debug_sdar_telemetry run --rm --no-deps warehouse-preflight
uap_debug_step provider-v2-origin uap_debug_sdar_telemetry run --rm --no-deps provider-bootstrap
uap_debug_step benchmark-build uap_debug_benchmark build bootstrap
uap_debug_step benchmark-infrastructure uap_debug_benchmark up -d --wait postgres
uap_debug_step benchmark-warehouse-access uap_debug_benchmark run --rm --no-deps warehouse-provision
uap_debug_step benchmark-registration-origin uap_debug_benchmark run --rm --no-deps bootstrap
uap_debug_step telemetry-start uap_debug_telemetry up -d --no-deps --wait "${uap_debug_reload[@]}" \
  telemetry-processor otel-collector query-api
uap_debug_step sdar-telemetry-start uap_debug_sdar_telemetry up -d --no-deps --wait "${uap_debug_reload[@]}" \
  ingestion-gateway telemetry-worker query-api admin-api domain-projection-worker
uap_debug_step domain-projection-activation uap_debug_sdar_telemetry run --rm --no-deps debug-bootstrap
uap_debug_step smpp-build uap_debug_smpp build "${UAP_DEBUG_SMPP_APPS[@]}"
uap_debug_step smpp-adapter-start uap_debug_smpp up -d --wait "${uap_debug_reload[@]}" \
  ugv-agent-profile-pms-api ugv-agent-profile-adapter
uap_debug_step provider-catalog uap_debug_wait_provider
uap_debug_step smpp-start uap_debug_smpp up -d --no-deps --wait "${uap_debug_reload[@]}" \
  ugv-agent-profile-runtime ugv-agent-profile-pms-worker
uap_debug_step pms-registration uap_debug_seed

if [[ "$1" == "restart" ]]; then
  uap_debug_step sdar-stop uap_debug_supervisor stop
fi
uap_debug_host_started=1
uap_debug_step sdar-start uap_debug_supervisor start
# A repeated successful start in YES need not restart a running Task's process.
uap_debug_already_yes=0
if [[ "$1" == start && "$uap_debug_mode" == YES ]] &&
  node -e 'const fs=require("node:fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(v.status==="already_running"&&v.sideEffects==="YES"?0:1)' "$uap_debug_log"; then
  uap_debug_already_yes=1
else
  uap_debug_step sdar-no uap_debug_supervisor restart-server --side-effects NO
fi
uap_debug_step missing-authority uap_debug_authority
uap_debug_step public-card uap_debug_profile wait-card
uap_debug_step incremental-evidence uap_debug_sdar_telemetry_config evidence
uap_debug_step benchmark-start uap_debug_benchmark up -d --no-deps --wait "${uap_debug_reload[@]}" \
  api reconciler evaluation-worker benchmark-worker projector
uap_debug_step benchmark-projection-scope-recovery uap_debug_benchmark run --rm --no-deps recover-meta-scope
if [[ "$uap_debug_mode" == "YES" && "$uap_debug_already_yes" == 0 ]]; then
  uap_debug_step enable-requested-mode uap_debug_supervisor restart-server --side-effects YES \
    --simulation-run-id "$uap_debug_simulation_id" \
    --acknowledge I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS
fi
uap_debug_stage=ready
uap_debug_status
