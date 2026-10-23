#!/usr/bin/env python3
"""Compatibility entry point for scripts/test/evaluate.py."""
import runpy
import sys
from pathlib import Path
print('Deprecated path: use scripts/test/evaluate.py', file=sys.stderr)
globals().update(runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/test/evaluate.py'), run_name=__name__))
