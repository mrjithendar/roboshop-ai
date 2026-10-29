"""Regression gate: every moks-eval-v1 case and structured check must pass (offline, no model)."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import run


class EvaluationGate(unittest.TestCase):
    def test_all_cases_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "results.json"
            with contextlib.redirect_stdout(io.StringIO()), unittest.mock.patch.object(sys, "argv", ["run.py", "--output", str(output)]):
                run.main()
            results = json.loads(output.read_text())
        failed = [c["id"] for c in results["cases"] if not c["passed"] or not all(c["structured"].values())]
        self.assertEqual(failed, [])
        self.assertGreaterEqual(results["summary"]["cases"], 30)


if __name__ == "__main__":
    unittest.main()
