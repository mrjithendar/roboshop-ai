#!/usr/bin/env bash
# Ten runner processes provide ten job slots. Keep the existing first runner.
set +x
set -euo pipefail
umask 077
count=${RUNNER_COUNT:-10}
[[ "$count" =~ ^[1-9][0-9]*$ ]] && (( count <= 20 )) || { echo 'RUNNER_COUNT must be 1–20.' >&2; exit 1; }
repo=${1:-mrjithendar/roboshop-ai}
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Repository must be OWNER/REPOSITORY.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
base=${RUNNER_DIR:-"$HOME/actions-runner"}
name=${RUNNER_NAME:-$(hostname)}
# Sequential installation avoids package-manager conflicts. Jobs run concurrently
# once the independent services are registered and started.
for ((slot=1; slot<=count; slot++)); do
  directory="$base"
  runner_name="$name"
  if (( slot > 1 )); then directory="$base-$slot"; runner_name="$name-$slot"; fi
  if [[ -f "$directory/.runner" ]]; then
    python3 - "$directory/.runner" "$repo" <<'PY'
import json, sys
from pathlib import Path
if json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig')).get('gitHubUrl', '').rstrip('/').lower() != ('https://github.com/' + sys.argv[2]).lower():
    raise SystemExit('Existing runner belongs to another repository; choose a different RUNNER_DIR.')
PY
    if [[ -f "$directory/.service" ]] && systemctl is-active --quiet "$(cat "$directory/.service")"; then
      echo "Slot $slot: existing service is active; leaving it untouched."
      continue
    fi
  fi
  RUNNER_DIR="$directory" RUNNER_NAME="$runner_name" bash "$script_dir/setup.sh" "$repo" "${2:-${RUNNER_SECRET_NAME:-mrjithendar-github-pat}}" "${3:-us-east-1}"
  # setup.sh can succeed with registration pending when AWS is unavailable.
  [[ -f "$directory/.runner" && -f "$directory/.service" ]] && systemctl is-active --quiet "$(cat "$directory/.service")" || {
    echo "Slot $slot is not active. Resolve setup/registration and rerun; completed slots are preserved." >&2
    exit 1
  }
done
echo "$count runner services are active locally. Confirm they show Online in GitHub Settings → Actions → Runners."
echo 'This creates job capacity, not parallel steps within a job. Lowering RUNNER_COUNT does not remove existing services.'
