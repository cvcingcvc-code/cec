# End-to-end pipeline tests: run the real CLI on the real demo raw data and
# verify the outputs are valid JSON / valid JS (PHASE 13 / PHASE 16 hooks).
#
# OPT (2026-10-21): the CLI runs against a SCRATCH data root (GORGON_DATA_ROOT
# / GORGON_OUTPUT_ROOT env overrides, read at pipeline.run import time). The
# demo raw inputs are copied into the scratch root first, so the suite
# exercises the identical code path WITHOUT rewriting the tracked
# pipeline/data/ dataset into demo seeds (which used to force a
# `git checkout --` after every test run).

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUN = str(REPO_ROOT / "pipeline" / "run.py")


class TestEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="gg-e2e-")
        tmp_root = Path(cls._tmp.name)
        # Scratch data root mirrors the on-disk layout of pipeline/data —
        # the demo raw inputs are the only thing the CLI needs to read.
        data_root = tmp_root / "data"
        (data_root / "raw").mkdir(parents=True)
        shutil.copytree(REPO_ROOT / "pipeline" / "data" / "raw",
                        data_root / "raw", dirs_exist_ok=True)
        # The tracked human_decisions.json is part of the real run; copy it
        # so the scratch run exercises the same review-merge path.
        decisions = REPO_ROOT / "pipeline" / "data" / "review" / "human_decisions.json"
        if decisions.exists():
            (data_root / "review").mkdir(parents=True, exist_ok=True)
            shutil.copy2(decisions, data_root / "review" / "human_decisions.json")
        cls.data_root = data_root
        cls.out_root = tmp_root / "out"
        cls.env = dict(os.environ,
                       GORGON_DATA_ROOT=str(data_root),
                       GORGON_OUTPUT_ROOT=str(cls.out_root))
        cls.proc = subprocess.run(
            [sys.executable, RUN],
            capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=120,
            env=cls.env,
        )

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_cli_exits_zero(self):
        self.assertEqual(self.proc.returncode, 0, self.proc.stderr)

    def test_report_shape(self):
        out = self.proc.stdout
        for marker in ("RAW:", "NORMALIZED:", "DUPLICATES:", "NEEDS REVIEW:", "APPROVED:"):
            self.assertIn(marker, out)

    def test_approved_output_valid_json(self):
        data = json.loads(
            (self.data_root / "approved" / "activities.json").read_text(encoding="utf-8")
        )
        self.assertTrue(data["DEMO_DATA"])
        self.assertIsInstance(data["activities"], list)
        self.assertGreater(len(data["activities"]), 0)

    def test_review_queue_valid_json(self):
        data = json.loads(
            (self.data_root / "review" / "review_queue.json").read_text(encoding="utf-8")
        )
        for entry in data["queue"]:
            self.assertIn("activity", entry)
            self.assertIn("reason", entry)
            self.assertIn("trustScore", entry)
            self.assertIn("duplicateCandidates", entry)

    def test_gorgon_export_valid_js(self):
        text = (self.out_root / "ui_kits/app/generated-data.js").read_text(encoding="utf-8")
        self.assertIn("window.GORGON_GENERATED_DATA", text)
        # The payload after the assignment must be a pure JSON array literal.
        body = text[text.index("["): text.rindex("]") + 1]
        records = json.loads(body)
        self.assertGreater(len(records), 0)
        for rec in records:
            self.assertIn("id", rec)
            self.assertIn("title", rec)
            self.assertIn("category", rec)
            self.assertIn("price", rec)


if __name__ == "__main__":
    unittest.main()
