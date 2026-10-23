#!/usr/bin/env python3
"""Compatibility entry point for scripts/data/generate-secrets.py."""
import runpy
import sys
from pathlib import Path
print('Deprecated path: use scripts/data/generate-secrets.py', file=sys.stderr)
globals().update(runpy.run_path(str(Path(__file__).resolve().parents[0] / 'scripts/data/generate-secrets.py'), run_name=__name__))
