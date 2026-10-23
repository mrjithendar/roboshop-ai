#!/usr/bin/env python3
"""Compatibility entry point for scripts/maintenance/reset-test-checkout.py."""
import runpy
import sys
from pathlib import Path
print('Deprecated path: use scripts/maintenance/reset-test-checkout.py', file=sys.stderr)
globals().update(runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/maintenance/reset-test-checkout.py'), run_name=__name__))
