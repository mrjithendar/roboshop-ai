#!/usr/bin/env python3
"""Compatibility entry point for scripts/maintenance/squash-history.py."""
import runpy
import sys
from pathlib import Path
print('Deprecated path: use scripts/maintenance/squash-history.py', file=sys.stderr)
globals().update(runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/maintenance/squash-history.py'), run_name=__name__))
