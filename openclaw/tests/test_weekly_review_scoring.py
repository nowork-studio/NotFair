import os
import sys
import tempfile
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
                "query": "roof repair cost",
                "page": "https://www.example.com/blog/roof-repair-cost",
                "clicks": 2,
                "impressions": 1681,
                "ctr": 0.12,
                "position": 2.8,
            }
        ]

        payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None)
        top_action = payload["action_plan"]["actions"][0]
        issues = payload["audit"]["issues"]

        self.assertEqual(top_action["type"], "snippet_content_packaging")
        self.assertEqual(top_action["target"], "https://www.example.com/blog/roof-repair-cost")
        self.assertIn("business_intent_score", top_action["score_components"])
        self.assertGreater(issues[0]["priority_score"], issues[1]["priority_score"])
        self.assertIn("score_components", issues[0])
        context_request = next(item for item in payload["queue_items"] if item["type"] == "business_context_request")
        proposal = next(item for item in payload["queue_items"] if item["type"] == "action_proposal")
        self.assertEqual(context_request["status"], "pending_input")
        self.assertTrue(context_request["business_context_questions"])
        self.assertEqual(proposal["status"], "pending_approval")
        self.assertIn("complete_business_context", proposal["approval_preconditions"])
        self.assertNotIn("due_at", proposal)

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
                "page": "https://www.example.com/blog/roof-repair-costs",
                "clicks_now": 58,
                "clicks_prev": 103,
                "change_pct": -43.7,
            },
        ]

        payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None)
        top_action = payload["action_plan"]["actions"][0]

        self.assertEqual(top_action["target"], "https://www.example.com/blog/roof-repair-costs")
        self.assertEqual(top_action["type"], "page_improvement")
        self.assertIn("45", top_action["expected_impact"])

    def test_local_commercial_ctr_gap_can_stay_metadata_action(self) -> None:
        issue = weekly_review.ctr_gap_issue(
            {
                "query": "roof repair near me",
                "page": "https://www.example.com/roof-repair",
                "clicks": 13,
                "impressions": 664,
                "ctr": 1.96,
                "position": 10.7,
            },
            [],
        )

        self.assertEqual(issue["recommended_action_type"], "meta_tags")
        self.assertEqual(issue["score_components"]["business_intent_score"], 1.0)
        self.assertFalse(any("metadata alone is unproven" in note for note in issue["operator_judgment_notes"]))

    def test_informational_ctr_gap_is_not_metadata_only(self) -> None:
        issue = weekly_review.ctr_gap_issue(
            {
                "query": "how much does roof repair cost",
                "page": "https://www.example.com/blog/roof-repair-cost",
                "clicks": 2,
                "impressions": 1681,
                "ctr": 0.12,
                "position": 2.8,
            },
            [],
        )

        self.assertEqual(issue["recommended_action_type"], "snippet_content_packaging")
        self.assertLess(issue["score_components"]["business_intent_score"], 1.0)
        self.assertTrue(any("metadata alone is unproven" in note for note in issue["operator_judgment_notes"]))

    def test_query_only_ctr_gap_is_mapping_not_metadata_action(self) -> None:
        issue = weekly_review.query_ctr_issue(
            {
                "query": "how much does roof repair cost",
                "clicks": 2,
                "impressions": 1804,
                "ctr": 0.11,
                "position": 3.5,
            },
            [],
        )

        self.assertEqual(issue["recommended_action_type"], "query_intent_mapping")
        self.assertIn("business_intent_score", issue["score_components"])
        self.assertTrue(any("concrete page" in note for note in issue["operator_judgment_notes"]))

    def test_business_context_reframes_national_cost_ctr_as_local_intent_ownership(self) -> None:
        analysis = self.base_analysis()
        analysis["ctr_gaps_by_page"] = [
            {
                "query": "how much does roof repair cost",
                "page": "https://www.example.com/blog/roof-repair-cost",
                "clicks": 2,
                "impressions": 1681,
                "ctr": 0.12,
                "position": 2.8,
            }
        ]
        business_context = {
            "target_customer_priority": {
                "primary": ["local homeowners"],
                "deprioritized": ["national informational readers outside service area"],
            },
            "booking_intent_hierarchy": {
                "highest_priority": ["emergency roof repair portland", "roof repair near me"],
                "supporting_only": ["how much does roof repair cost", "roof repair cost"],
            },
            "page_role_map": {
                "/blog/roof-repair-cost": "supporting informational page",
                "/blog/roof-repair-prices-portland": "local commercial-research page",
                "/emergency-roof-repair-portland": "transactional local landing page",
            },
        }

        payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None, business_context)
        top_action = payload["action_plan"]["actions"][0]
        proposal = next(item for item in payload["queue_items"] if item["type"] == "action_proposal")

        self.assertEqual(top_action["type"], "local_intent_ownership")
        self.assertEqual(top_action["target"], "https://www.example.com/blog/roof-repair-prices-portland")
        self.assertEqual(top_action["source_target"], "https://www.example.com/blog/roof-repair-cost")
        self.assertEqual(proposal["action_type"], "local_intent_ownership")
        self.assertIn("national_click_discount", proposal["score_components"])
        self.assertEqual(proposal["consolidation_targets"]["conversion_target"], "https://www.example.com/emergency-roof-repair-portland")
        self.assertTrue(any("national informational" in note for note in top_action["operator_judgment_notes"]))


    def test_priority_list_does_not_mean_national_is_deprioritized(self) -> None:
        issue = {
            "recommended_action_type": "snippet_content_packaging",
            "primary_query": "how much does roof repair cost",
            "target": "https://www.example.com/blog/roof-repair-cost",
            "canonical_target": "https://www.example.com/blog/roof-repair-cost",
            "priority_score": 0.6,
            "score_components": {},
            "operator_judgment_notes": [],
        }
        business_context = {
            "target_customer_priority": ["national customers", "local customers"],
            "booking_intent_hierarchy": {"supporting_only": ["how much does roof repair cost"]},
        }

        updated = weekly_review.apply_business_context_to_issue(issue, business_context, site_id="example.com")

        self.assertEqual(updated["recommended_action_type"], "snippet_content_packaging")
        self.assertNotIn("national_click_discount", updated.get("score_components", {}))

    def test_support_page_retargeting_without_national_deprioritization_keeps_score(self) -> None:
        issue = {
            "recommended_action_type": "snippet_content_packaging",
            "primary_query": "how much does roof repair cost",
            "target": "https://www.example.com/blog/roof-repair-cost",
            "canonical_target": "https://www.example.com/blog/roof-repair-cost",
            "priority_score": 0.6,
            "score_components": {},
            "operator_judgment_notes": [],
        }
        business_context = {
            "target_customer_priority": ["local homeowners", "researchers"],
            "booking_intent_hierarchy": {"supporting_only": ["how much does roof repair cost"]},
            "page_role_map": {
                "/blog/roof-repair-cost": "supporting informational page",
                "/roof-repair-prices": "local commercial-research page",
            },
        }

        updated = weekly_review.apply_business_context_to_issue(issue, business_context, site_id="example.com")

        self.assertEqual(updated["recommended_action_type"], "local_intent_ownership")
        self.assertEqual(updated["priority_score"], 0.6)
        self.assertNotIn("national_click_discount", updated.get("score_components", {}))
        self.assertFalse(any("national informational" in note for note in updated["operator_judgment_notes"]))

    def test_query_only_retargeting_uses_context_support_page_as_source(self) -> None:
        issue = {
            "recommended_action_type": "query_intent_mapping",
            "primary_query": "how much does roof repair cost",
            "priority_score": 0.6,
            "score_components": {},
            "operator_judgment_notes": [],
        }
        business_context = {
            "target_customer_priority": {"deprioritized": ["national informational readers outside service area"]},
            "booking_intent_hierarchy": {"supporting_only": ["how much does roof repair cost"]},
            "page_role_map": [
                {"path": "/blog/roof-repair-cost", "role": "supporting informational page"},
                {"path": "/roof-repair-prices", "role": "local commercial-research page"},
            ],
        }

        updated = weekly_review.apply_business_context_to_issue(issue, business_context, site_id="example.com")

        self.assertEqual(updated["recommended_action_type"], "local_intent_ownership")
        self.assertEqual(updated["source_target"], "https://www.example.com/blog/roof-repair-cost")
        self.assertEqual(updated["consolidation_targets"]["source_support_page"], "https://www.example.com/blog/roof-repair-cost")
        self.assertEqual(updated["target"], "https://www.example.com/roof-repair-prices")

    def test_live_fetch_headers_include_vercel_bypass_from_env(self) -> None:
        previous = os.environ.get("TOPRANK_VERCEL_PROTECTION_BYPASS")
        os.environ["TOPRANK_VERCEL_PROTECTION_BYPASS"] = "test-bypass-secret"
        try:
            headers = weekly_review.live_fetch_headers()
        finally:
            if previous is None:
                os.environ.pop("TOPRANK_VERCEL_PROTECTION_BYPASS", None)
            else:
                os.environ["TOPRANK_VERCEL_PROTECTION_BYPASS"] = previous

        self.assertEqual(headers["x-vercel-protection-bypass"], "test-bypass-secret")

    def test_live_fetch_headers_support_site_profile_header_env(self) -> None:
        previous = os.environ.get("CUSTOM_FETCH_TOKEN")
        os.environ["CUSTOM_FETCH_TOKEN"] = "custom-token"
        try:
            headers = weekly_review.live_fetch_headers({"live_fetch_header_env": {"x-custom-token": "CUSTOM_FETCH_TOKEN"}})
        finally:
            if previous is None:
                os.environ.pop("CUSTOM_FETCH_TOKEN", None)
            else:
                os.environ["CUSTOM_FETCH_TOKEN"] = previous

        self.assertEqual(headers["x-custom-token"], "custom-token")

    def test_national_click_discount_demotes_ranking_score_without_floor_boost(self) -> None:
        issue = {
            "recommended_action_type": "snippet_content_packaging",
            "primary_query": "how much does roof repair cost",
            "target": "https://www.example.com/blog/roof-repair-cost",
            "canonical_target": "https://www.example.com/blog/roof-repair-cost",
            "priority_score": 0.007,
            "score_components": {},
            "operator_judgment_notes": [],
        }
        business_context = {
            "target_customer_priority": {"deprioritized": ["national informational readers outside service area"]},
            "booking_intent_hierarchy": {"supporting_only": ["how much does roof repair cost"]},
            "page_role_map": {
                "/blog/roof-repair-cost": "supporting informational page",
                "/roof-repair-prices": "local commercial-research page",
            },
        }

        updated = weekly_review.apply_business_context_to_issue(issue, business_context, site_id="example.com")

        self.assertEqual(updated["recommended_action_type"], "local_intent_ownership")
        self.assertEqual(updated["score_components"]["national_click_discount"], 0.25)
        self.assertEqual(updated["priority_score"], 0.002)

    def test_discounted_support_query_does_not_outrank_local_candidate(self) -> None:
        candidates = [
            {
                "recommended_action_type": "snippet_content_packaging",
                "primary_query": "how much does roof repair cost",
                "target": "https://www.example.com/blog/roof-repair-cost",
                "canonical_target": "https://www.example.com/blog/roof-repair-cost",
                "priority_score": 0.8,
                "score_components": {},
                "operator_judgment_notes": [],
            },
            {
                "recommended_action_type": "meta_tags",
                "primary_query": "roof repair near me",
                "target": "https://www.example.com/roof-repair",
                "canonical_target": "https://www.example.com/roof-repair",
                "priority_score": 0.3,
                "score_components": {},
                "operator_judgment_notes": [],
            },
        ]
        business_context = {
            "target_customer_priority": {"deprioritized": ["national informational readers outside service area"]},
            "booking_intent_hierarchy": {
                "highest_priority": ["roof repair near me"],
                "supporting_only": ["how much does roof repair cost"],
            },
            "page_role_map": {
                "/blog/roof-repair-cost": "supporting informational page",
                "/roof-repair-prices": "local commercial-research page",
                "/roof-repair": "transactional local landing page",
            },
        }

        adjusted = weekly_review.dedupe_candidates(weekly_review.apply_business_context(candidates, business_context, site_id="example.com"))
        ranked = weekly_review.apply_prioritization(adjusted, {"priors": {}}, "non_brand_clicks_28d")

        self.assertEqual(ranked[0]["primary_query"], "roof repair near me")
        self.assertEqual(ranked[1]["recommended_action_type"], "local_intent_ownership")

    def test_retargeted_business_context_issues_are_deduped(self) -> None:
        candidates = [
            {
                "recommended_action_type": "snippet_content_packaging",
                "primary_query": "how much does roof repair cost",
                "target": "https://www.example.com/blog/roof-repair-cost",
                "canonical_target": "https://www.example.com/blog/roof-repair-cost",
                "priority_score": 0.6,
                "score_components": {},
                "operator_judgment_notes": [],
                "title": "Support query A",
            },
            {
                "recommended_action_type": "query_intent_mapping",
                "primary_query": "roof repair cost",
                "target": "https://www.example.com/blog/roof-repair-pricing",
                "canonical_target": "https://www.example.com/blog/roof-repair-pricing",
                "priority_score": 0.5,
                "score_components": {},
                "operator_judgment_notes": [],
                "title": "Support query B",
            },
        ]
        business_context = {
            "target_customer_priority": {"deprioritized": ["national informational readers outside service area"]},
            "booking_intent_hierarchy": {"supporting_only": ["how much does roof repair cost", "roof repair cost"]},
            "page_role_map": [
                {"path": "/blog/roof-repair-cost", "role": "supporting informational page"},
                {"path": "/blog/roof-repair-pricing", "role": "supporting informational page"},
                {"path": "/roof-repair-prices", "role": "local commercial-research page"},
            ],
        }

        adjusted = weekly_review.apply_business_context(candidates, business_context, site_id="example.com")
        deduped = weekly_review.dedupe_candidates(adjusted)

        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["canonical_target"], "https://www.example.com/roof-repair-prices")

    def test_action_proposal_includes_deep_dive_diagnostics_before_approval(self) -> None:
        analysis = self.base_analysis()
        analysis["ctr_gaps_by_page"] = [
            {
                "query": "how much does roof repair cost",
                "page": "https://www.example.com/blog/roof-repair-cost",
                "clicks": 2,
                "impressions": 1681,
                "ctr": 0.12,
                "position": 2.8,
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "content" / "blogs"
            source.mkdir(parents=True)
            (source / "roof-repair-cost.mdx").write_text(
                "---\n"
                "title: \"Roof Repair Cost in 2026\"\n"
                "description: \"Compare roof repair prices and hidden fees.\"\n"
                "---\n\n"
                "# Roof Repair Cost in 2026\n\n"
                "This guide explains fees first. Request a repair quote when ready.\n\n"
                "Prices are $55-$90 per project in the local market.\n",
                encoding="utf-8",
            )
            original = weekly_review.serp_snapshot_for_query
            weekly_review.serp_snapshot_for_query = lambda query, site_id, live=False: {
                "source": "test_serp",
                "status": "ok",
                "query": query,
                "results": [{"title": "Roof Repair Cost", "domain": "example.com", "snippet": "$55-$90 per project"}],
                "answer_like_serp": True,
            }
            try:
                payload = weekly_review.build_payload(
                    "example.com",
                    analysis,
                    {"priors": {}},
                    None,
                    site_profile={"source_roots": [str(root)]},
                    live_diagnostics=True,
                )
            finally:
                weekly_review.serp_snapshot_for_query = original

        proposal = next(item for item in payload["queue_items"] if item["type"] == "action_proposal")
        deep_dive = proposal["deep_dive"]
        self.assertEqual(deep_dive["status"], "completed")
        self.assertTrue(deep_dive["checks"]["serp_inspected"])
        self.assertTrue(deep_dive["checks"]["current_snippet_inspected"])
        self.assertTrue(deep_dive["checks"]["above_the_fold_inspected"])
        self.assertTrue(deep_dive["checks"]["zero_click_risk_accounted_for"])
        self.assertEqual(deep_dive["current_snippet"]["title"], "Roof Repair Cost in 2026")
        self.assertTrue(deep_dive["above_the_fold"]["has_fast_price_answer_above_fold"])
        self.assertIn("complete_business_context", proposal["approval_preconditions"])

    def test_action_proposal_surfaces_business_context_gaps(self) -> None:
        analysis = self.base_analysis()
        analysis["ctr_gaps_by_page"] = [
            {
                "query": "roof repair cost",
                "page": "https://www.example.com/blog/roof-repair-cost",
                "clicks": 2,
                "impressions": 1681,
                "ctr": 0.12,
                "position": 2.8,
            }
        ]

        payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None, {"business_name": "Example"})
        context_request = next(item for item in payload["queue_items"] if item["type"] == "business_context_request")
        queue_item = next(item for item in payload["queue_items"] if item["type"] == "action_proposal")
        context_check = next(check for check in payload["verification"]["checks"] if check["name"] == "business impact context")

        self.assertEqual(context_check["status"], "warning")
        self.assertEqual(context_request["status"], "pending_input")
        self.assertEqual(context_request["output_path"], "~/.toprank/business-context/example.com.json")
        self.assertLess(queue_item["business_context_score"], 0.75)
        self.assertIn("complete_business_context", queue_item["approval_preconditions"])
        self.assertTrue(any(gap["field"] == "service_value_weights" for gap in context_request["business_context_gaps"]))
        self.assertTrue(context_request["business_context_questions"])

    def test_action_proposal_includes_best_practice_alignment(self) -> None:
        analysis = self.base_analysis()
        analysis["ctr_gaps_by_page"] = [
            {
                "query": "roof repair cost",
                "page": "https://www.example.com/blog/roof-repair-cost",
                "clicks": 2,
                "impressions": 1681,
                "ctr": 0.12,
                "position": 2.8,
            }
        ]

        payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None)
        proposal = next(item for item in payload["queue_items"] if item["type"] == "action_proposal")
        action = payload["action_plan"]["actions"][0]
        check = next(item for item in payload["verification"]["checks"] if item["name"] == "best practice alignment")

        self.assertEqual(check["status"], "pass")
        self.assertEqual(proposal["best_practice_alignment"]["reference"], "seo/shared/seo-best-practices.md")
        self.assertEqual(action["best_practice_alignment"]["primary_area"], "on_page_relevance_serp_packaging")
        self.assertTrue(proposal["best_practice_alignment"]["resources"])

    def test_all_current_action_types_have_best_practice_mapping(self) -> None:
        expected_action_types = {
            "canonical_or_tracking_investigation",
            "query_intent_mapping",
            "local_intent_ownership",
            "content_refresh",
            "page_improvement",
            "meta_tags",
            "snippet_content_packaging",
            "internal_links",
            "manual_review",
        }

        self.assertEqual(set(weekly_review.ACTION_BEST_PRACTICE_AREAS), expected_action_types)
        for action_type, area in weekly_review.ACTION_BEST_PRACTICE_AREAS.items():
            with self.subTest(action_type=action_type):
                self.assertIn(area, weekly_review.SEO_BEST_PRACTICE_AREAS)
                alignment = weekly_review.best_practice_alignment_for_issue({"recommended_action_type": action_type})
                self.assertEqual(alignment["primary_area"], area)
                self.assertNotEqual(alignment["primary_area"], "unmapped")

    def test_unknown_action_type_warns_as_unmapped(self) -> None:
        alignment = weekly_review.best_practice_alignment_for_issue({"recommended_action_type": "core_web_vitals"})

        self.assertEqual(alignment["primary_area"], "unmapped")
        self.assertEqual(alignment["primary_area_label"], "Unmapped SEO action type")
        self.assertTrue(any("core_web_vitals" in note for note in alignment["notes"]))

        analysis = self.base_analysis()
        original = weekly_review.derive_candidate_issues
        weekly_review.derive_candidate_issues = lambda _analysis: [
            {
                "title": "Future action",
                "severity": "info",
                "confidence": 0.5,
                "evidence": ["synthetic"],
                "recommended_action_type": "core_web_vitals",
                "base_priority": 0.5,
                "priority_score": 0.5,
                "operator_judgment_notes": [],
                "score_components": {},
                "raw_target": None,
                "canonical_target": None,
            }
        ]
        try:
            payload = weekly_review.build_payload("example.com", analysis, {"priors": {}}, None)
        finally:
            weekly_review.derive_candidate_issues = original

        check = next(item for item in payload["verification"]["checks"] if item["name"] == "best practice alignment")
        action = payload["action_plan"]["actions"][0]
        self.assertEqual(check["status"], "warning")
        self.assertEqual(action["best_practice_alignment"]["primary_area"], "unmapped")


if __name__ == "__main__":
    unittest.main()
