#!/usr/bin/env python3
"""Stage a reviewed patch in an isolated worktree; publishing is explicit and draft-only."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import uuid
p=argparse.ArgumentParser()
p.add_argument('--repository',required=True,help='Local checkout of the explicitly selected target repository')
p.add_argument('--patch',required=True,help='Human-reviewed unified diff; never execute downloaded content')
p.add_argument('--title',required=True)
p.add_argument('--body-file',required=True)
p.add_argument('--publish',action='store_true')
a=p.parse_args()
repo=Path(a.repository).resolve();patch=Path(a.patch).resolve();body=Path(a.body_file).resolve()
if not patch.is_file() or not body.is_file():raise SystemExit('Patch and PR body files are required')
branch='openclaw/proposal-'+uuid.uuid4().hex[:12]
work=Path(tempfile.mkdtemp(prefix='openclaw-pr-'))/'worktree'
def git(*args,where=repo):return subprocess.run(['git','-C',str(where),*args],check=True)
git('worktree','add','-b',branch,str(work),'HEAD')
git('apply','--check',str(patch),where=work)
git('apply','--index',str(patch),where=work)
git('diff','--cached','--stat',where=work)
print('Review the staged diff in:',work)
print('No publication or merge has occurred.')
if a.publish:
    expected='publish draft '+branch
    if input(f'After reviewing content and secret safety, type "{expected}": ')!=expected:raise SystemExit('Cancelled; worktree preserved')
    git('commit','-m',a.title,where=work)
    git('push','--set-upstream','origin',branch,where=work)
    subprocess.run(['gh','pr','create','--draft','--head',branch,'--title',a.title,'--body-file',str(body)],cwd=work,check=True)
