#!/usr/bin/env bash
# Private tools for the runner owner; never overwrite /usr/bin/python3 or system pip.
set +x
set -euo pipefail
umask 077
[[ $# == 1 && -d $1 ]] || { echo 'Usage: install-tools.sh EXISTING_RUNNER_DIR' >&2; exit 1; }
[[ $(uname -s) == Linux ]] || { echo 'Linux is required.' >&2; exit 1; }
case $(uname -m) in
  x86_64) aws_arch=x86_64 ;;
  aarch64|arm64) aws_arch=aarch64 ;;
  *) echo 'Unsupported architecture' >&2; exit 1 ;;
esac
runner_tools=$(cd -- "$1" && pwd -P)/.tools
mkdir -p "$runner_tools/bin"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fetch() { curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 600 "$@"; }
# Refresh uv so its managed-Python catalogue includes the latest stable CPython.
# Official installer handles architecture and verifies its downloaded release archive.
fetch https://astral.sh/uv/install.sh -o "$work/uv-install.sh"
UV_UNMANAGED_INSTALL="$runner_tools/bin" sh "$work/uv-install.sh"
export PATH="$runner_tools/bin:$PATH"
export UV_PYTHON_INSTALL_DIR="$runner_tools/interpreters"
export UV_PYTHON_BIN_DIR="$runner_tools/bin"
"$runner_tools/bin/uv" python install 3 --reinstall
# This environment belongs only to setup/workflow tooling. Refresh Python + pip
# without touching registration, source checkouts, or project virtual environments.
"$runner_tools/bin/uv" venv --managed-python --python 3 --seed --clear "$runner_tools/python"
"$runner_tools/python/bin/python" -m pip install --upgrade pip

# AWS CLI v2 official Linux bundle, independent of the Python environment above.
fetch "https://awscli.amazonaws.com/awscli-exe-linux-$aws_arch.zip" -o "$work/aws.zip"
unzip -q "$work/aws.zip" -d "$work"
args=(--install-dir "$runner_tools/aws-cli" --bin-dir "$runner_tools/bin")
[[ ! -d "$runner_tools/aws-cli/v2" ]] || args+=(--update)
"$work/aws/install" "${args[@]}"
"$runner_tools/python/bin/python" --version
"$runner_tools/python/bin/python" -m pip --version
"$runner_tools/bin/aws" --version

# Persist tool precedence for interactive Bash and login shells, even if later
# registration fails. A child setup process cannot alter its parent's PATH.
printf 'export PATH=%q:%q:"$PATH"\n' "$runner_tools/python/bin" "$runner_tools/bin" > "$runner_tools/env.sh"
login_file="$HOME/.profile"
if [[ -f "$HOME/.bash_profile" ]]; then login_file="$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then login_file="$HOME/.bash_login"; fi
for profile in "$HOME/.bashrc" "$login_file"; do
  # Replace only our own line; keep all unrelated user shell configuration.
  touch "$profile"
  sed -i '/# roboshop-runner-tools$/d' "$profile"
  printf '\n. %q # roboshop-runner-tools\n' "$runner_tools/env.sh" >> "$profile"
done
printf 'For this already-open shell, run: source %q; hash -r\n' "$runner_tools/env.sh"
