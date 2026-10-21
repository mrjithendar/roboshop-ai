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
# Reuse working private tools on registration retries. Never reset a healthy
# virtual environment just because GitHub rejected an unrelated credential.
export PATH="$runner_tools/bin:$PATH"
if ! "$runner_tools/python/bin/python" -c 'import sys; assert sys.version_info >= (3, 9)' >/dev/null 2>&1; then
  if ! "$runner_tools/bin/uv" --version >/dev/null 2>&1; then
    fetch https://astral.sh/uv/install.sh -o "$work/uv-install.sh"
    UV_UNMANAGED_INSTALL="$runner_tools/bin" sh "$work/uv-install.sh"
  fi
  export UV_PYTHON_INSTALL_DIR="$runner_tools/interpreters"
  export UV_PYTHON_BIN_DIR="$runner_tools/bin"
  "$runner_tools/bin/uv" python install 3
  "$runner_tools/bin/uv" venv --managed-python --python 3 --seed --clear "$runner_tools/python"
else
  echo 'Reusing installed Python.'
fi
if ! "$runner_tools/python/bin/python" -m pip --version >/dev/null 2>&1; then
  "$runner_tools/python/bin/python" -m ensurepip --upgrade
fi

# AWS CLI v2 is independent of Python; reject the unrelated pip package "aws".
if aws_version=$("$runner_tools/bin/aws" --version 2>/dev/null) && [[ $aws_version == aws-cli/2.* ]]; then
  echo 'Reusing installed AWS CLI v2.'
else
  fetch "https://awscli.amazonaws.com/awscli-exe-linux-$aws_arch.zip" -o "$work/aws.zip"
  unzip -q "$work/aws.zip" -d "$work"
  args=(--install-dir "$runner_tools/aws-cli" --bin-dir "$runner_tools/bin")
  [[ ! -d "$runner_tools/aws-cli/v2" ]] || args+=(--update)
  "$work/aws/install" "${args[@]}"
fi
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
