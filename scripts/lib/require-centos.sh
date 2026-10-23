#!/usr/bin/env bash
# Keep host policy in one place so setup, deployment and maintenance agree.
# Help bypasses the OS check because reading instructions must not require a
# supported server. No environment override bypasses the real host check.

# Shared host gate. Source before operational side effects; help stays portable.
roboshop_require_centos() {
  case "${1:-}" in --help|-h|help) return 0;; esac
  if [[ "$(uname -s)" != Linux || ! -r /etc/os-release ]]; then
    echo 'ERROR: Operational scripts require CentOS Stream 9 or 10 (x86_64/ARM64). No changes made.' >&2
    return 1
  fi
  local ID='' VERSION_ID='' NAME=''
  . /etc/os-release
  if [[ "$ID" != centos || "$NAME" != *Stream* || ! "$VERSION_ID" =~ ^(9|10)$ ]]; then
    echo 'ERROR: Only CentOS Stream 9/10 is supported; Ubuntu, Amazon Linux, RHEL derivatives and macOS are not supported.' >&2
    return 1
  fi
  case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) echo 'ERROR: x86_64 or ARM64 required.' >&2; return 1;; esac
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then roboshop_require_centos "$@"; fi
