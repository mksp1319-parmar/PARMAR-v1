import json
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_visual_acceptance import render_report


class VisualAcceptanceReportTests(unittest.TestCase):
    def test_failed_instrumentation_without_metadata_is_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            report = render_report(Path(directory), "phone", "FAIL")

        self.assertIn("**Overall: FAIL.**", report)

    def test_failed_instrumentation_without_screenshots_is_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact_directory = Path(directory)
            (artifact_directory / "evidence.json").write_text(
                json.dumps({"testStatus": "FAIL", "screenshots": []}),
                encoding="utf-8",
            )

            report = render_report(artifact_directory, "phone", "FAIL")

        self.assertIn("**Overall: FAIL.**", report)

    def test_success_without_screenshot_evidence_is_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact_directory = Path(directory)
            (artifact_directory / "evidence.json").write_text(
                json.dumps({"testStatus": "PASS", "screenshots": []}),
                encoding="utf-8",
            )

            report = render_report(artifact_directory, "phone", "PASS")

        self.assertIn("**Overall: FAIL.**", report)


if __name__ == "__main__":
    unittest.main()
