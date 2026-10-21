#!/usr/bin/env python3
"""Preview or squash a GitHub branch into one identical-tree baseline.

Preview: python3 scripts/squash-history.py
Execute: python3 scripts/squash-history.py --apply
Requires: git, authenticated gh CLI, repository administration permissions.

This intentionally supports our simple repository ruleset (deletion + force-push
protection). It refuses other effective rules instead of disabling unknown rules.
It never deletes the original-history backup. No credentials are stored here.
"""
import argparse
import copy
import datetime
import json
import pathlib
import re
import signal
import subprocess
import time


def run(*args, input=None, timeout=120):
    """Pass arguments directly, never interpolate repository names into a shell."""
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def api(endpoint, method="GET", body=None):
    args = ["gh", "api", endpoint, "--method", method]
    if body is not None:
        args += ["--input", "-"]
    result = run(*args, input=json.dumps(body) if body is not None else None, timeout=30)
    return json.loads(result) if result else None


def require(condition, message):
    # Do not use assert for operational checks: python -O disables assertions.
    if not condition:
        raise RuntimeError(message)


def remote_head(branch):
    output = run("git", "ls-remote", "--heads", "origin", f"refs/heads/{branch}")
    require(bool(output), "Remote branch does not exist")
    return output.split()[0]


def restore(endpoint, original):
    """Retry restoration after transient failures, and verify the saved settings."""
    for attempt in range(3):
        try:
            api(endpoint, "PUT", original)
            actual = api(endpoint)
            require(all(actual.get(k) == v for k, v in original.items()), "Protection verification failed")
            print("Original branch protection restored and verified.", flush=True)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Actually back up, rewrite, push and restore protection")
    parser.add_argument("--repo", default="mrjithendar/roboshop-ai", help="GitHub owner/repository")
    parser.add_argument("--branch", default="master", help="Existing branch to squash")
    parser.add_argument("--message", default="Establish RobotShop AI platform baseline", help="New baseline commit title")
    args = parser.parse_args()
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo), "Invalid repository name")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", args.branch), "Invalid branch name")
    run("git", "check-ref-format", f"refs/heads/{args.branch}")
    # Verify origin explicitly. Otherwise gh could change protection on a different
    # repository from the one receiving the git push.
    remote = run("git", "remote", "get-url", "--push", "origin").removesuffix(".git")
    require(remote in (f"https://github.com/{args.repo}", f"git@github.com:{args.repo}",
                       f"ssh://git@github.com/{args.repo}"), "origin does not match --repo")
    require(run("git", "branch", "--show-current") == args.branch, "Check out the target branch first")
    old = run("git", "rev-parse", args.branch)
    require(remote_head(args.branch) == old, "Local and remote tips differ; reconcile before squashing")
    count = int(run("git", "rev-list", "--count", old))
    print(f"Repository: {args.repo}\nBranch: {args.branch}\nCurrent tip: {old}\nCommits: {count}")
    print(f"Proposed title: {args.message}\nFiles will be preserved exactly.")
    if not args.apply:
        print("Preview only: no commits, backup refs, GitHub settings or files changed. Use --apply to execute.")
        return
    require(not run("git", "status", "--porcelain"), "Commit/stash all changes, including this script, first")
    require(count > 1, "Already one commit; nothing to squash")

    base = f"repos/{args.repo}"
    rules = api(f"{base}/rules/branches/{args.branch}")
    require(all(r['type'] in ('deletion', 'non_fast_forward') for r in rules),
            "Additional rules apply; manual review required")
    blockers = {r['ruleset_id'] for r in rules if r['type'] == 'non_fast_forward'}
    require(len(blockers) == 1, "Expected exactly one force-push ruleset; manual review required")
    endpoint = f"{base}/rulesets/{blockers.pop()}"
    full = api(endpoint)
    require(full['source_type'] == 'Repository' and full['source'] == args.repo,
            "Organization/inherited rules cannot be changed by this script")
    original = {k: full[k] for k in ('name', 'target', 'enforcement', 'bypass_actors', 'conditions', 'rules')}
    require(original['target'] == 'branch' and original['enforcement'] == 'active', "Unexpected ruleset")
    require({r['type'] for r in original['rules']} == {'deletion', 'non_fast_forward'}, "Unexpected ruleset rules")

    # A branch preserves the old commits in this clone; a self-contained bundle
    # also allows recovery in a fresh clone. Both are created BEFORE any rewrite.
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    folder = pathlib.Path(run('git', 'rev-parse', '--absolute-git-dir')) / 'history-backups' / stamp
    folder.mkdir(parents=True)
    backup = f"backup/{args.branch}-before-squash-{stamp}"
    run('git', 'branch', backup, old)
    run('git', 'bundle', 'create', str(folder / 'history.bundle'), backup)
    run('git', 'bundle', 'verify', str(folder / 'history.bundle'))
    (folder / 'ruleset.json').write_text(json.dumps(original, indent=2) + '\n')

    # Git commits point to trees (snapshots). Reuse the EXACT old tree and omit
    # commit-tree's -p parent option: this creates one root commit, with no file edits.
    tree = run('git', 'rev-parse', old + '^{tree}')
    new = run('git', 'commit-tree', tree, input=args.message + '\n\nPreserve the file tree from ' + old + '.\n')
    run('git', 'branch', 'review/clean-baseline-' + stamp, new)
    require(run('git', 'rev-parse', new + '^{tree}') == tree, 'Tree mismatch')
    require(run('git', 'rev-list', '--count', new) == '1', 'Baseline is not a root commit')
    require(not run('git', 'diff', old, new, '--'), 'Unexpected file changes')
    recovery = {'repository': args.repo, 'branch': args.branch, 'old': old, 'new': new,
                'ruleset_endpoint': endpoint, 'backup_branch': backup}
    (folder / 'recovery.json').write_text(json.dumps(recovery, indent=2) + '\n')
    print(f"Verified baseline {new}; backups: {folder}", flush=True)

    # The original rule protects ALL branches. A temporary guard retains its
    # force-push restriction everywhere except the target while we relax the
    # original rule. Deletion protection remains active throughout.
    guard = copy.deepcopy(original)
    guard['name'] = 'temporary-history-rewrite-' + stamp
    guard['rules'] = [{'type': 'non_fast_forward'}]
    guard['conditions']['ref_name']['exclude'].append(f'refs/heads/{args.branch}')
    temporary = api(base + '/rulesets', 'POST', guard)
    recovery['temporary_ruleset_id'] = temporary['id']
    try:
        (folder / 'recovery.json').write_text(json.dumps(recovery, indent=2) + '\n')
        relaxed = copy.deepcopy(original)
        relaxed['rules'] = [r for r in original['rules'] if r['type'] != 'non_fast_forward']
        api(endpoint, 'PUT', relaxed)
        # An EXPLICIT lease refuses to overwrite commits pushed since our check.
        # Never use plain --force here. Even if the network times out after a
        # successful push, finally restores protection before we do anything else.
        run('git', 'push', f'--force-with-lease=refs/heads/{args.branch}:{old}',
            'origin', f'{new}:refs/heads/{args.branch}')
    finally:
        # If restoration fails, leave the temporary guard in place and print the
        # recovery location. Never report success or remove the guard prematurely.
        try:
            restore(endpoint, original)
        except BaseException:
            print(f"URGENT: verify/restore GitHub protection using {folder}/ruleset.json; temporary guard {temporary['id']} retained.", flush=True)
            raise
        api(base + '/rulesets/' + str(temporary['id']), 'DELETE')

    require(remote_head(args.branch) == new, 'Remote verification failed; inspect before retrying')
    # Compare-and-swap moves local master only if it still points at the old tip.
    # No reset --hard is needed because the index/worktree tree did not change.
    run('git', 'update-ref', '-m', 'Squash to identical-tree baseline', f'refs/heads/{args.branch}', new, old)
    print(f"Done: local and remote {args.branch} now contain one baseline commit. Backup: {backup}")


if __name__ == '__main__':
    # SIGINT already raises KeyboardInterrupt. Convert SIGTERM too, so normal
    # termination enters finally. SIGKILL/power loss cannot run cleanup: see docs.
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        raise SystemExit(f"Stopped: {error}. If a push was attempted, check remote history and saved recovery files before retrying.")
