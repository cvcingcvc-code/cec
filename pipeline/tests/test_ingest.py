# Ingest-stage tests: id-dedupe across raw files (OPT 2026-10-21).
#
# Regression: a re-crawl wrote douban_<city>.json next to the tracked
# douban_<date>.json — byte-identical content, different filenames. Ingest
# used to collect BOTH copies, the duplicates flowed through the whole
# pipeline, and --apply-reviews (id-keyed) approved them twice: 16 douban
# dupes in the final approved dataset (2026-10-16 incident).
#
# Contract now: same id in two raw files collapses at ingest, first wins.

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from pipeline.ingest.json_source import ingest_raw, JsonSourceAdapter  # noqa: E402


def _write_raw(tmp, name, payload):
    with open(os.path.join(tmp, name), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)


def _event(eid, title="活动 A"):
    return {
        "id": eid,
        "title": title,
        "startDate": "2026-11-01",
        "startTime": "10:00",
        "address": "上海市杨浦区某路 1 号",
        "priceType": "free",
    }


class IngestIdDedupeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="gg-ingest-")
        self.tmp = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def test_identical_content_two_files_collapses_to_one(self):
        """The 2026-10-16 incident: same events, two filenames."""
        body = {"DEMO_DATA": False, "count": 2,
                "activities": [_event("douban_1"), _event("douban_2")]}
        _write_raw(self.tmp, "douban_2026-10-14.json", body)
        _write_raw(self.tmp, "douban_上海.json", body)
        acts = ingest_raw(self.tmp)
        self.assertEqual(len(acts), 2)
        self.assertEqual(len({a["id"] for a in acts}), 2)

    def test_first_occurrence_wins_with_stable_file_order(self):
        """File order is sorted; the first file's copy of an id wins."""
        first = {"DEMO_DATA": False, "count": 1,
                 "activities": [_event("douban_1", title="来自文件甲")]}
        second = {"DEMO_DATA": False, "count": 1,
                  "activities": [_event("douban_1", title="来自文件乙")]}
        _write_raw(self.tmp, "a_first.json", first)
        _write_raw(self.tmp, "b_second.json", second)
        acts = ingest_raw(self.tmp)
        self.assertEqual(len(acts), 1)
        self.assertEqual(acts[0]["title"], "来自文件甲")

    def test_distinct_events_across_files_all_survive(self):
        """Different ids across files are all kept — dedupe only hits ids."""
        _write_raw(self.tmp, "one.json",
                   {"DEMO_DATA": False, "count": 1, "activities": [_event("douban_1")]})
        _write_raw(self.tmp, "two.json",
                   {"DEMO_DATA": False, "count": 1, "activities": [_event("douban_2")]})
        acts = ingest_raw(self.tmp)
        self.assertEqual(len(acts), 2)

    def test_records_without_id_are_never_deduped(self):
        """A record with no id gets a content-hash id at to_raw_activity time;
        distinct records must never be dropped by the id gate."""
        a = _event("douban_1")
        del a["id"]
        b = _event("douban_1")
        del b["id"]
        b["title"] = "另一个活动"  # different content -> different hash id
        _write_raw(self.tmp, "x.json",
                   {"DEMO_DATA": False, "count": 2, "activities": [a, b]})
        acts = ingest_raw(self.tmp)
        self.assertEqual(len(acts), 2)
        self.assertEqual(len({act["id"] for act in acts}), 2)

    def test_ingested_records_keep_status_and_stamp(self):
        _write_raw(self.tmp, "one.json",
                   {"DEMO_DATA": False, "count": 1, "activities": [_event("douban_1")]})
        acts = ingest_raw(self.tmp, collected_at="2026-10-21T00:00:00")
        self.assertEqual(acts[0]["status"], "raw")
        self.assertEqual(acts[0]["collectedAt"], "2026-10-21T00:00:00")

    def test_real_crawl_dataset_through_adapter_is_stable(self):
        """The real tracked douban raw file ingests to its full 40 rows."""
        raw_path = REPO_ROOT / "pipeline" / "data" / "raw" / "douban_2026-10-14.json"
        if not raw_path.exists():
            self.skipTest("tracked douban raw file not present")
        acts = ingest_raw(str(raw_path.parent))
        douban = [a for a in acts if a["id"].startswith("douban_")]
        self.assertEqual(len(douban), 40)
        self.assertEqual(len({a["id"] for a in douban}), 40)


class JsonSourceAdapterTests(unittest.TestCase):
    def test_fetch_reads_all_json_files_sorted(self):
        with tempfile.TemporaryDirectory(prefix="gg-src-") as tmp:
            _write_raw(tmp, "b.json", {"activities": [_event("x2")]})
            _write_raw(tmp, "a.json", {"activities": [_event("x1")]})
            labels = [label for label, _ in JsonSourceAdapter(tmp).fetch()]
            self.assertEqual(labels, ["a", "b"])

    def test_parse_rejects_non_dict_items(self):
        payload = ("f", {"activities": [_event("x1"), "not-a-dict", 42]})
        items = JsonSourceAdapter("/unused").parse(payload)
        self.assertEqual(len(items), 1)


if __name__ == "__main__":
    unittest.main()
