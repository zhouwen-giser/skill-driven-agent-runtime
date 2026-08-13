#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "${script_directory}/../.." && pwd -P)"

cd -- "${repository_root}"
exec node scripts/sdar-ugv-smpp/driver-command.mjs bootstrap
