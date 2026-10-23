#!/usr/bin/env bash
# Consumes the centrally initialized Python/AWS installations. Private links and
# a runner venv isolate the service PATH without replacing system commands.
# Existing tool environments are reused rather than rebuilt during registration.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" centos || exit 1
# Prepare private runner links from initialized tooling; no downloads or host repair.
set -euo pipefail
case "${1:-}" in --help|-h) echo 'Usage: runner/install-tools.sh EXISTING_RUNNER_DIR'; echo 'First run ./init.sh --profile dev and ./init.sh --profile aws. Creates private runner links, not AWS credentials.'; exit 0;; esac
[[ $# == 1 && -d $1 ]] || { echo 'Usage: runner/install-tools.sh EXISTING_RUNNER_DIR' >&2; exit 2; }
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:$HOME/.local/bin"
aws_version=$(aws --version 2>/dev/null) || { echo 'Run ./init.sh --profile aws first.' >&2; exit 1; }
[[ "$aws_version" == aws-cli/2.* ]] || { echo 'AWS CLI v2 required; select the initialized command in PATH.' >&2; exit 1; }
python="$ROOT/.venv/bin/python"
[[ -x "$python" ]] || { echo 'Run ./init.sh --profile dev first.' >&2; exit 1; }
runner_tools="$(cd -- "$1" && pwd)/.tools"
mkdir -p "$runner_tools/bin"
# Existing private environments are preserved; never rebuild an active interpreter.
if [[ ! -e "$runner_tools/python" ]]; then "$python" -m venv "$runner_tools/python"; fi
"$runner_tools/python/bin/python" -m pip --version >/dev/null
if [[ ! -e "$runner_tools/bin/aws" && ! -L "$runner_tools/bin/aws" ]]; then
  ln -s "$(command -v aws)" "$runner_tools/bin/aws"
fi
"$runner_tools/bin/aws" --version | grep -q '^aws-cli/2\.'
printf 'export PATH=%q:%q:"$PATH"\n' "$runner_tools/python/bin" "$runner_tools/bin" > "$runner_tools/env.sh"
echo 'Private runner tools ready; no shell profile or system command was changed.'
