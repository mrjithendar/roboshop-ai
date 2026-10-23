#!/usr/bin/env bash
# Preview is the default. Deletion is limited to Dependabot-named branches
# without open PRs, then rechecked immediately before each delete. --apply plus
# the DELETE prompt is required; local forced deletion can discard branch commits.

# Validate the supported host before operational side effects.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/require-centos.sh"
roboshop_require_centos "${1:-}" || exit 1
set -euo pipefail

case "${1:---dry-run}" in
 --help|-h) echo 'Usage: scripts/maintenance/delete-branches.sh [--dry-run|--apply]'; echo 'Requires git and authenticated gh; scope: Dependabot branches without open PRs. Apply prompts DELETE.'; exit 0;;
 --dry-run|--apply) ;;
 *) echo 'Use --help.' >&2; exit 2;;
esac
[[ $# -le 1 ]] || exit 2
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
APPLY="${1:---dry-run}"

# Read open PRs from the repository associated with origin.
repo="$(gh repo view "$(git remote get-url origin)" \
  --json nameWithOwner --jq '.nameWithOwner')"

# Stop if querying PRs fails.
open_pr_branches="$(gh pr list \
  --repo "$repo" \
  --state open \
  --limit 10000 \
  --json headRefName \
  --jq '.[].headRefName')"

has_open_pr() {
  grep -Fxq -- "$1" <<< "$open_pr_branches"
}

remote_candidates=()
local_candidates=()

while IFS= read -r ref; do
  branch="${ref#refs/heads/}"
  [[ "$branch" == *dependabot* ]] || continue

  if has_open_pr "$branch"; then
    printf 'KEEP (open PR): %s\n' "$branch"
  else
    remote_candidates+=("$branch")
  fi
done < <(git ls-remote --heads origin | awk '{print $2}')

while IFS= read -r branch; do
  [[ "$branch" == *dependabot* ]] || continue
  has_open_pr "$branch" || local_candidates+=("$branch")
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)

for branch in "${remote_candidates[@]}"; do
  printf 'DELETE remote: %s\n' "$branch"
done

for branch in "${local_candidates[@]}"; do
  printf 'DELETE local:  %s\n' "$branch"
done

[[ "$APPLY" == --apply ]] || exit 0

printf '\nType DELETE to proceed: '
read -r confirmation
[[ "$confirmation" == "DELETE" ]] || exit 0

for branch in "${remote_candidates[@]}"; do
  # Recheck immediately before deletion in case a PR was opened.
  count="$(gh pr list --repo "$repo" --state open \
    --head "$branch" --json number --jq 'length')"

  if [[ "$count" != "0" ]]; then
    printf 'KEEP (open PR): %s\n' "$branch"
    continue
  fi

  git push origin --delete "$branch"
done

for branch in "${local_candidates[@]}"; do
  count="$(gh pr list --repo "$repo" --state open \
    --head "$branch" --json number --jq 'length')"

  [[ "$count" == "0" ]] || continue
  git branch -D -- "$branch"
done

git fetch origin --prune