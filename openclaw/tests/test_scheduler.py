import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

BIN_DIR = Path(__file__).resolve().parents[1] / "bin"
if str(BIN_DIR) not in sys.path:
    sys.path.insert(0, str(BIN_DIR))

import run_scheduler
from runtime import bootstrap_workspace, load_json, reconcile_schedule_from_queue, save_json, upsert_schedule_items


class OpenClawSchedulerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.previous_home = os.environ.get("TOPRANK_OPENCLAW_HOME")
        os.environ["TOPRANK_OPENCLAW_HOME"] = str(self.root)
        bootstrap_workspace(self.root)

    def tearDown(self) -> None:
        if self.previous_home is None:
            os.environ.pop("TOPRANK_OPENCLAW_HOME", None)
        else:
            os.environ["TOPRANK_OPENCLAW_HOME"] = self.previous_home
        self.tempdir.cleanup()

    def write_queue_item(self, site_id: str, item: dict) -> Path:
        queue_path = self.root / "sites" / site_id / "queue" / f"{item['item_id']}.json"
        save_json(queue_path, {"site_id": site_id, **item})
        return queue_path

    def run_scheduler(self, *args: str) -> dict:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = run_scheduler.main(["run_scheduler.py", *args])
        self.assertEqual(code, 0)
        return json.loads(output.getvalue())

    def test_upsert_schedule_items_uses_site_and_item_id(self) -> None:
        upsert_schedule_items(
            [
                {"site_id": "a.com", "item_id": "same", "type": "feedback_check", "status": "pending", "due_at": "2026-01-01T00:00:00Z"},
                {"site_id": "b.com", "item_id": "same", "type": "feedback_check", "status": "pending", "due_at": "2026-01-01T00:00:00Z"},
            ],
            self.root,
        )

        schedule = load_json(self.root / "schedule.json", {})
        self.assertEqual(len(schedule["upcoming"]), 2)
        self.assertEqual({item["site_id"] for item in schedule["upcoming"]}, {"a.com", "b.com"})

    def test_reconcile_restores_pending_queue_item_missing_from_schedule(self) -> None:
        self.write_queue_item(
            "example.com",
            {
                "item_id": "orphaned_followup",
                "type": "feedback_check",
                "status": "pending",
                "due_at": "2026-01-01T00:00:00Z",
            },
        )

        schedule, restored = reconcile_schedule_from_queue(self.root)

        self.assertEqual(len(restored), 1)
        self.assertEqual(schedule["upcoming"][0]["item_id"], "orphaned_followup")

    def test_scheduler_accepts_naive_due_timestamps(self) -> None:
        self.write_queue_item(
            "example.com",
            {
                "item_id": "naive_due_followup",
                "type": "feedback_check",
                "status": "pending",
                "due_at": "2026-01-01T00:00:00",
                "primary_metric": "organic_clicks_7d",
                "baseline_metrics": {"organic_clicks_7d": 10.0},
            },
        )

        result = self.run_scheduler("--dry-run", "--as-of", "2026-01-02T00:00:00Z")

        self.assertEqual(result["manual_attention"][0]["item_id"], "naive_due_followup")

    def test_inconclusive_feedback_is_not_marked_done(self) -> None:
        queue_path = self.write_queue_item(
            "example.com",
            {
                "item_id": "missing_metrics_followup",
                "type": "feedback_check",
                "status": "pending",
                "due_at": "2026-01-01T00:00:00Z",
                "primary_metric": "organic_clicks_7d",
                "baseline_metrics": {"organic_clicks_7d": 10.0},
            },
        )

        result = self.run_scheduler("--as-of", "2026-01-02T00:00:00Z")
        queue_item = load_json(queue_path, {})
        schedule = load_json(self.root / "schedule.json", {})

        self.assertEqual(result["processed"], [])
        self.assertEqual(result["manual_attention"][0]["item_id"], "missing_metrics_followup")
        self.assertIn("missing metric data", result["manual_attention"][0]["reason"])
        self.assertEqual(queue_item["status"], "ready_for_attention")
        self.assertEqual(schedule["upcoming"][0]["status"], "ready_for_attention")
        self.assertFalse((self.root / "sites" / "example.com" / "feedback" / "missing_metrics_followup.json").exists())

    def test_dry_run_reports_inconclusive_feedback_as_manual_attention(self) -> None:
        queue_path = self.write_queue_item(
            "example.com",
            {
                "item_id": "dry_run_missing_metrics",
                "type": "feedback_check",
                "status": "pending",
                "due_at": "2026-01-01T00:00:00Z",
                "primary_metric": "organic_clicks_7d",
                "baseline_metrics": {"organic_clicks_7d": 10.0},
            },
        )

        result = self.run_scheduler("--dry-run", "--as-of", "2026-01-02T00:00:00Z")
        queue_item = load_json(queue_path, {})

        self.assertEqual(result["processed"], [])
        self.assertEqual(result["manual_attention"][0]["item_id"], "dry_run_missing_metrics")
        self.assertTrue(result["manual_attention"][0]["dry_run"])
        self.assertEqual(queue_item["status"], "pending")

    def test_feedback_with_observed_metrics_is_processed(self) -> None:
        queue_path = self.write_queue_item(
            "example.com",
            {
                "item_id": "scored_followup",
                "type": "feedback_check",
                "status": "pending",
                "due_at": "2026-01-01T00:00:00Z",
                "notes": "Re-check organic clicks.",
                "action_type": "page_improvement",
                "primary_metric": "organic_clicks_7d",
                "primary_direction": "higher_better",
                "success_threshold_pct": 0.1,
                "baseline_metrics": {"organic_clicks_7d": 10.0},
                "observed_metrics": {"organic_clicks_7d": 12.0},
                "guardrail_metrics": [],
            },
        )

        result = self.run_scheduler("--as-of", "2026-01-02T00:00:00Z")
        queue_item = load_json(queue_path, {})
        feedback = load_json(self.root / "sites" / "example.com" / "feedback" / "scored_followup.json", {})

        self.assertEqual(result["manual_attention"], [])
        self.assertEqual(result["processed"][0]["outcome"], "win")
        self.assertEqual(queue_item["status"], "done")
        self.assertEqual(feedback["status"], "win")


if __name__ == "__main__":
    unittest.main()
