import sys
import unittest
from pathlib import Path

BIN_DIR = Path(__file__).resolve().parents[1] / "bin"
if str(BIN_DIR) not in sys.path:
    sys.path.insert(0, str(BIN_DIR))

import weekly_review


class WeeklyReviewScoringTest(unittest.TestCase):
    def base_analysis(self) -> dict:
        return {
            "site": "sc-domain:example.com",
            "period": {"start": "2026-04-01", "end": "2026-04-28", "days": 28},
            "summary": {"clicks": 2000, "impressions": 200000, "ctr": 1.0, "position": 8.0},
            "branded_split": {
                "branded": {"clicks": 800, "impressions": 10000},
                "non_branded": {"clicks": 350, "impressions": 20000},
            },
            "comparison": {"declining_pages": [], "declining_queries": []},
            "ctr_gaps_by_page": [],
            "ctr_opportunities": [],
            "cannibalization": [],
        }

    def test_high_impression_ctr_gap_beats_low_volume_utm_drop(self) -> None:
        analysis = self.base_analysis()
        analysis["comparison"]["declining_pages"] = [
            {
                "page": "https://www.example.com/?utm_source=google_map",
                "clicks_now": 3,
                "clicks_prev": 13,
                "change_pct": -76.9,
            }
        ]
        analysis["ctr_gaps_by_page"] = [
            {
                "query": "dog boarding cost",
                "page": "https://www.example.com/blog/dog-boarding-cost",
                "clicks": 2,
                "impressions": 1681,
                "ctr": 0.12,
                "position": 2.8,
            }
        ]

        payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None)
        top_action = payload["action_plan"]["actions"][0]
        issues = payload["audit"]["issues"]

        self.assertEqual(top_action["type"], "meta_tags")
        self.assertEqual(top_action["target"], "https://www.example.com/blog/dog-boarding-cost")
        self.assertGreater(issues[0]["priority_score"], issues[1]["priority_score"])
        self.assertIn("score_components", issues[0])
        self.assertEqual(payload["queue_items"][0]["type"], "action_proposal")
        self.assertEqual(payload["queue_items"][0]["status"], "pending_approval")
        self.assertNotIn("due_at", payload["queue_items"][0])

    def test_tracking_url_decline_keeps_raw_target_but_canonicalizes_action_target(self) -> None:
        issue = weekly_review.decline_issue(
            {
                "page": "https://www.example.com/?utm_source=google_map&utm_medium=business_profile",
                "clicks_now": 3,
                "clicks_prev": 13,
                "change_pct": -76.9,
            }
        )

        self.assertEqual(issue["recommended_action_type"], "canonical_or_tracking_investigation")
        self.assertEqual(issue["raw_target"], "https://www.example.com/?utm_source=google_map&utm_medium=business_profile")
        self.assertEqual(issue["target"], "https://www.example.com/")
        self.assertLess(issue["score_components"]["url_quality_score"], 1.0)
        self.assertTrue(any("tracking" in note for note in issue["operator_judgment_notes"]))

    def test_absolute_loss_decline_beats_tiny_percent_drop(self) -> None:
        analysis = self.base_analysis()
        analysis["comparison"]["declining_pages"] = [
            {
                "page": "https://www.example.com/?utm_source=google_map",
                "clicks_now": 3,
                "clicks_prev": 13,
                "change_pct": -76.9,
            },
            {
                "page": "https://www.example.com/blog/dog-sitting-costs",
                "clicks_now": 58,
                "clicks_prev": 103,
                "change_pct": -43.7,
            },
        ]

        payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None)
        top_action = payload["action_plan"]["actions"][0]

        self.assertEqual(top_action["target"], "https://www.example.com/blog/dog-sitting-costs")
        self.assertEqual(top_action["type"], "page_improvement")
        self.assertIn("45", top_action["expected_impact"])


if __name__ == "__main__":
    unittest.main()
