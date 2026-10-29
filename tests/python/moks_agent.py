"""Import the Moks agent beside the gateway: both services ship a module named `catalogue`."""
import importlib
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def import_agent():
    gateway = importlib.import_module("catalogue")
    spec = importlib.util.spec_from_file_location("moks_catalogue", ROOT / "services/moks/lib/catalogue.py")
    moks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(moks)
    sys.modules["catalogue"] = moks  # Only while the agent binds its imports.
    try:
        return importlib.import_module("agent")
    finally:
        sys.modules["catalogue"] = gateway
