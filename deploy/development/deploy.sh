#!/usr/bin/env bash
set -Eeuo pipefail
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker Engine and Docker Compose v2 are required.' >&2
  exit 1
fi
# Run the deployment CLI using the same Node version as the application; no host Node needed.
if command -v node >/dev/null 2>&1 && node -e 'if(!require("node:util").parseEnv) process.exit(1)' >/dev/null 2>&1; then
  exec node -- "$script_dir/cli.mjs" "$@"
fi
repo_root="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
config_dir="$script_dir"
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[i]}" == '--env-file' && $((i+1)) -lt ${#args[@]} ]]; then
    config_dir="$(dirname -- "${args[i+1]}")"
    mkdir -p -- "$config_dir"
    config_dir="$(CDPATH= cd -- "$config_dir" && pwd)"
    args[i+1]="$config_dir/$(basename -- "${args[i+1]}")"
  fi
done
# Forward exported values by name, never by value on the command line. The CLI
# only consumes supported keys or keys declared in the chosen dotenv file.
environment_args=()
while IFS= read -r name; do
  case "$name" in PATH|HOME|HOSTNAME|PWD|SHLVL|_|DOCKER_*) continue ;; esac
  environment_args+=(--env "$name")
done < <(compgen -e)
docker build -q -t sdar-development-deployer:node22 -f "$script_dir/Dockerfile.deployer" "$repo_root" >/dev/null
exec docker run --rm --init \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$repo_root:$repo_root" -w "$repo_root" \
  -v "$config_dir:$config_dir" \
  "${environment_args[@]}" \
  sdar-development-deployer:node22 -- "$script_dir/cli.mjs" "${args[@]}"
