#!/usr/bin/env python3
"""Compatibility entry point for scripts/data/seed-minikube-demo.py."""
import runpy
import sys
from pathlib import Path
print('Deprecated path: use scripts/data/seed-minikube-demo.py', file=sys.stderr)
globals().update(runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/data/seed-minikube-demo.py'), run_name=__name__))
