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

if [[ "$1" == "status" || "$1" == "stop" ]]; then
  uap_supervisor "$1"
  exit 0
fi

uap_debug_mode="${2:-YES}"
if [[ "$uap_debug_mode" == "YES" ]]; then
  uap_debug_simulation_id="${UGV_SIMULATION_RUN_ID:-}"
  if [[ -z "$uap_debug_simulation_id" ]]; then
    uap_debug_simulation_id="$(uap_existing_simulation_run_id)"
  fi
  # Validate before stopping any process; the supervisor revalidates before YES.
  uap_authorize_b02_simulation_run_id "$uap_debug_simulation_id" >/dev/null
fi

if [[ "$1" == "restart" ]]; then
  # A same-mode restart-server NO is intentionally a no-op. Reload all three
  # source processes through the existing ownership-checked stop/start boundary.
  uap_supervisor stop
fi
uap_supervisor start
if [[ "$uap_debug_mode" == "YES" ]]; then
  uap_supervisor restart-server --side-effects YES \
    --simulation-run-id "$uap_debug_simulation_id" \
    --acknowledge I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS
else
  uap_supervisor restart-server --side-effects NO
fi
