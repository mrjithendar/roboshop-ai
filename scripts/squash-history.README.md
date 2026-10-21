# Squash GitHub history without changing files

`squash-history.py` documents and automates the procedure used for RoboShop.
It uses Python's standard library plus `git` and the authenticated GitHub CLI `gh`.
The account must have permission to edit repository rulesets and push the branch.

## Usage

From the repository root, preview first:

```sh
python3 scripts/squash-history.py
```

After committing this script and any other work, execute intentionally:

```sh
python3 scripts/squash-history.py --apply
```

Defaults are `mrjithendar/roboshop-ai`, `master`, and the baseline title
“Establish RoboShop AI platform baseline”. Override with `--repo`, `--branch`,
and `--message`. Local and remote tips must match. The script refuses to squash
an already single-commit branch. It does not commit uncommitted files for you.

## What happens

1. Check the remote URL, current branch, remote tip, clean worktree and ruleset.
2. Save the full old history in a local backup branch and verified Git bundle.
3. Save the original ruleset and recovery metadata under `.git/history-backups/`.
4. Call `git commit-tree` with the old tree and no parent. A tree identifies the
   exact repository snapshot; keeping its ID preserves all tracked content and modes.
5. Verify identical trees and a single root commit. Preserve a review branch.
6. Create a temporary guard protecting other branches from force-pushes, then
   temporarily remove only the original ruleset's force-push restriction. Deletion
   protection stays active. The script supports our simple repository ruleset only;
   unexpected or inherited effective rules require manual review.
7. Push the baseline with `--force-with-lease=refs/heads/master:<old-sha>`. GitHub
   rejects the push if someone advanced the branch after the initial check.
8. Restore and verify the original protection in `finally`, then delete the guard.
9. Verify GitHub's tip and atomically move local master from the expected old tip.
   There is no hard reset, file checkout, or backup deletion.

Do not edit the ruleset concurrently with the script. Changes during that brief
maintenance window could be overwritten when the saved settings are restored.
Other branches/tags are not rewritten. They and GitHub PR refs may still reference
old commits, so this cleans master history; it does not purge sensitive information
from GitHub. A force-push can also trigger CI for changed paths.

## Interrupted operation recovery

Normal exceptions, Ctrl-C and SIGTERM attempt restoration. SIGKILL, power loss or
network failure can prevent it. The original settings, both commit IDs, API endpoint,
and temporary guard ID are in the printed backup directory. If execution stops:

1. Inspect `recovery.json` and compare `git ls-remote --heads origin master` to its
   `old` and `new` values. A push can succeed even if its response is lost.
2. Restore the saved ruleset first (substitute the saved endpoint and file path):

   ```sh
   gh api repos/OWNER/REPO/rulesets/ID --method PUT --input /absolute/path/ruleset.json
   gh api repos/OWNER/REPO/rulesets/ID
   ```

3. After verifying original protection is active, delete the temporary guard using
   its saved ID: `gh api repos/OWNER/REPO/rulesets/TEMP_ID --method DELETE`.
   If guard creation timed out before its ID was saved, inspect repository rulesets
   for the name `temporary-history-rewrite-<backup timestamp>`; do not delete others.
4. If GitHub is at `new` and local master is still `old`, and the tree is unchanged,
   finish locally with `git update-ref refs/heads/master NEW_SHA OLD_SHA`.
   If the remote has another SHA, stop and reconcile rather than overriding it.

Never remove the temporary guard before restoring the original rule. Keep the
bundle somewhere durable outside the clone as well. To inspect the old history:

```sh
git bundle verify /absolute/path/history.bundle
git clone -b backup/BRANCH-before-squash-TIMESTAMP /absolute/path/history.bundle recovered-history
```

Existing collaborators should preserve their local work before resyncing or cloning
afresh. Restoring old history to GitHub would itself be another deliberate rewrite;
this script does not do that automatically.
