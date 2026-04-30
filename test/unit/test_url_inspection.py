"""
Unit tests for seo-analysis/scripts/url_inspection.py

Tests the pure logic functions — no GSC API calls, no gcloud needed.
Run: pytest test/unit/test_url_inspection.py -v
"""

import importlib.util
import os
import sys
import unittest

# Load url_inspection.py as a module without executing main()
_SCRIPTS_DIR = os.path.join(
    os.path.dirname(__file__), '..', '..', 'seo', 'seo-analysis', 'scripts'
)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
_SCRIPT_PATH = os.path.join(_SCRIPTS_DIR, 'url_inspection.py')
spec = importlib.util.spec_from_file_location('url_inspection', _SCRIPT_PATH)
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


class TestNormalizeSiteUrlForInspection(unittest.TestCase):
    """normalize_site_url_for_inspection() resolves paths to absolute URLs."""

    def test_absolute_url_returned_unchanged(self):
        result = ui.normalize_site_url_for_inspection("sc-domain:example.com", "https://example.com/page")
        self.assertEqual(result, "https://example.com/page")

    def test_absolute_http_url_returned_unchanged(self):
        result = ui.normalize_site_url_for_inspection("sc-domain:example.com", "http://example.com/page")
        self.assertEqual(result, "http://example.com/page")

    def test_path_resolved_against_sc_domain(self):
        result = ui.normalize_site_url_for_inspection("sc-domain:example.com", "/pricing")
        self.assertEqual(result, "https://example.com/pricing")

    def test_path_resolved_against_sc_domain_with_trailing_slash(self):
        result = ui.normalize_site_url_for_inspection("sc-domain:example.com/", "/blog")
        self.assertEqual(result, "https://example.com/blog")

    def test_path_resolved_against_url_prefix_property(self):
        result = ui.normalize_site_url_for_inspection("https://example.com/", "/features")
        self.assertEqual(result, "https://example.com/features")

    def test_path_resolved_against_url_prefix_without_trailing_slash(self):
        result = ui.normalize_site_url_for_inspection("https://example.com", "/about")
        self.assertEqual(result, "https://example.com/about")

    def test_root_path_resolved_against_sc_domain(self):
        result = ui.normalize_site_url_for_inspection("sc-domain:example.com", "/")
        self.assertEqual(result, "https://example.com/")


class TestParseInspectionResult(unittest.TestCase):
    """parse_inspection_result() extracts structured data from the raw API response."""

    def _minimal_raw(self, **overrides):
        """Build a minimal valid API response."""
        data = {
            "inspectionResult": {
                "indexStatusResult": {
                    "verdict": "PASS",
                    "coverageState": "Submitted and indexed",
                    "lastCrawlTime": "2026-03-01T10:00:00Z",
                    "crawledAs": "DESKTOP",
                    "pageFetchState": "SUCCESSFUL",
                    "robotsTxtState": "ALLOWED",
                    "indexingState": "INDEXING_ALLOWED",
                    "referringSitemaps": ["https://example.com/sitemap.xml"],
                    "googleCanonical": "https://example.com/page",
                    "userDeclaredCanonical": "https://example.com/page",
                },
                "mobileUsabilityResult": {
                    "verdict": "MOBILE_FRIENDLY",
                    "issues": [],
                },
                "richResultsResult": {
                    "verdict": "VERDICT_UNSPECIFIED",
                    "detectedItems": [],
                },
            }
        }
        data["inspectionResult"]["indexStatusResult"].update(overrides)
        return data

    def test_parses_full_response(self):
        raw = self._minimal_raw()
        result = ui.parse_inspection_result(raw, "https://example.com/page")
        self.assertEqual(result["url"], "https://example.com/page")
        self.assertEqual(result["index_status"]["verdict"], "PASS")
        self.assertEqual(result["index_status"]["coverage_state"], "Submitted and indexed")
        self.assertEqual(result["index_status"]["last_crawl_time"], "2026-03-01T10:00:00Z")
        self.assertEqual(result["mobile_usability"]["verdict"], "MOBILE_FRIENDLY")
        self.assertEqual(result["mobile_usability"]["issues"], [])
        self.assertEqual(result["rich_results"]["verdict"], "VERDICT_UNSPECIFIED")

    def test_empty_raw_returns_unknowns(self):
        result = ui.parse_inspection_result({}, "https://example.com/page")
        self.assertEqual(result["url"], "https://example.com/page")
        self.assertEqual(result["index_status"]["verdict"], "UNKNOWN")
        self.assertEqual(result["index_status"]["coverage_state"], "UNKNOWN")
        self.assertIsNone(result["index_status"]["last_crawl_time"])
        self.assertEqual(result["mobile_usability"]["verdict"], "VERDICT_UNSPECIFIED")
        self.assertEqual(result["rich_results"]["verdict"], "VERDICT_UNSPECIFIED")

    def test_mobile_issues_extracted(self):
        raw = self._minimal_raw()
        raw["inspectionResult"]["mobileUsabilityResult"] = {
            "verdict": "MOBILE_UNFRIENDLY",
            "issues": [{"issueType": "USES_INCOMPATIBLE_PLUGINS"}, {"issueType": "SMALL_FONT_SIZE"}],
        }
        result = ui.parse_inspection_result(raw, "https://example.com/page")
        self.assertEqual(result["mobile_usability"]["verdict"], "MOBILE_UNFRIENDLY")
        self.assertEqual(result["mobile_usability"]["issues"], ["USES_INCOMPATIBLE_PLUGINS", "SMALL_FONT_SIZE"])

    def test_rich_result_items_extracted(self):
        raw = self._minimal_raw()
        raw["inspectionResult"]["richResultsResult"] = {
            "verdict": "PASS",
            "detectedItems": [
                {
                    "items": [
                        {"name": "FAQ schema", "issues": [{"issueMessage": "Missing required field"}]}
                    ]
                }
            ],
        }
        result = ui.parse_inspection_result(raw, "https://example.com/page")
        self.assertEqual(result["rich_results"]["verdict"], "PASS")
        self.assertEqual(len(result["rich_results"]["detected_items"]), 1)
        self.assertEqual(result["rich_results"]["detected_items"][0]["name"], "FAQ schema")
        self.assertEqual(result["rich_results"]["detected_items"][0]["issues"], ["Missing required field"])

    def test_no_referring_sitemaps_returns_empty_list(self):
        raw = self._minimal_raw()
        del raw["inspectionResult"]["indexStatusResult"]["referringSitemaps"]
        result = ui.parse_inspection_result(raw, "https://example.com/page")
        self.assertEqual(result["index_status"]["referring_sitemaps"], [])

    def test_non_dict_response_returns_default_shape(self):
        result = ui.parse_inspection_result([], "https://example.com/")

        self.assertEqual(result["url"], "https://example.com/")
        self.assertEqual(result["index_status"]["verdict"], "UNKNOWN")
        self.assertEqual(result["index_status"]["coverage_state"], "UNKNOWN")
        self.assertEqual(result["index_status"]["referring_sitemaps"], [])
        self.assertEqual(result["mobile_usability"]["verdict"], "VERDICT_UNSPECIFIED")
        self.assertEqual(result["mobile_usability"]["issues"], [])
        self.assertEqual(result["rich_results"]["verdict"], "VERDICT_UNSPECIFIED")
        self.assertEqual(result["rich_results"]["detected_items"], [])

    def test_malformed_nested_shapes_are_ignored_without_dropping_valid_items(self):
        raw = {
            "inspectionResult": {
                "indexStatusResult": "unexpected",
                "mobileUsabilityResult": {
                    "verdict": "MOBILE_FRIENDLY",
                    "issues": [None, {"issueType": "TEXT_TOO_SMALL"}, "bad"],
                },
                "richResultsResult": {
                    "verdict": "PASS",
                    "detectedItems": [
                        None,
                        {
                            "items": [
                                None,
                                {
                                    "name": "FAQ",
                                    "issues": [None, {"issueMessage": "Missing field"}, "bad"],
                                },
                                "bad",
                            ]
                        },
                        "bad",
                    ],
                },
            }
        }

        result = ui.parse_inspection_result(raw, "https://example.com/page")

        self.assertEqual(result["index_status"]["verdict"], "UNKNOWN")
        self.assertEqual(result["mobile_usability"]["verdict"], "MOBILE_FRIENDLY")
        self.assertEqual(result["mobile_usability"]["issues"], ["TEXT_TOO_SMALL"])
        self.assertEqual(result["rich_results"]["verdict"], "PASS")
        self.assertEqual(
            result["rich_results"]["detected_items"],
            [{"name": "FAQ", "issues": ["Missing field"]}],
        )


class TestSummarizeFindings(unittest.TestCase):
    """summarize_findings() aggregates inspection results into high-level counts."""

    def _result(self, verdict="PASS", mobile_verdict="MOBILE_FRIENDLY", rich_verdict="VERDICT_UNSPECIFIED",
                referring_sitemaps=None, last_crawl=None):
        return {
            "url": "https://example.com/page",
            "index_status": {
                "verdict": verdict,
                "referring_sitemaps": referring_sitemaps if referring_sitemaps is not None else ["https://example.com/sitemap.xml"],
                "last_crawl_time": last_crawl,
            },
            "mobile_usability": {"verdict": mobile_verdict},
            "rich_results": {"verdict": rich_verdict},
        }

    def test_empty_results(self):
        summary = ui.summarize_findings([])
        self.assertEqual(summary["total_urls_inspected"], 0)
        self.assertEqual(summary["not_indexed_count"], 0)
        self.assertEqual(summary["mobile_issues_count"], 0)
        self.assertEqual(summary["stale_crawl_count"], 0)

    def test_pass_verdict_not_counted_as_not_indexed(self):
        summary = ui.summarize_findings([self._result(verdict="PASS")])
        self.assertEqual(summary["not_indexed_count"], 0)

    def test_neutral_verdict_not_counted_as_not_indexed(self):
        summary = ui.summarize_findings([self._result(verdict="NEUTRAL")])
        self.assertEqual(summary["not_indexed_count"], 0)

    def test_fail_verdict_counted_as_not_indexed(self):
        summary = ui.summarize_findings([self._result(verdict="FAIL")])
        self.assertEqual(summary["not_indexed_count"], 1)

    def test_verdict_unspecified_not_counted_as_not_indexed(self):
        # VERDICT_UNSPECIFIED is excluded — not a definitive not-indexed signal
        summary = ui.summarize_findings([self._result(verdict="VERDICT_UNSPECIFIED")])
        self.assertEqual(summary["not_indexed_count"], 0)

    def test_mobile_unfriendly_counted(self):
        summary = ui.summarize_findings([self._result(mobile_verdict="MOBILE_UNFRIENDLY")])
        self.assertEqual(summary["mobile_issues_count"], 1)

    def test_mobile_friendly_not_counted(self):
        summary = ui.summarize_findings([self._result(mobile_verdict="MOBILE_FRIENDLY")])
        self.assertEqual(summary["mobile_issues_count"], 0)

    def test_rich_fail_counted(self):
        summary = ui.summarize_findings([self._result(rich_verdict="FAIL")])
        self.assertEqual(summary["rich_result_errors_count"], 1)

    def test_no_sitemap_counted(self):
        summary = ui.summarize_findings([self._result(referring_sitemaps=[])])
        self.assertEqual(summary["no_sitemap_count"], 1)

    def test_stale_crawl_over_60_days(self):
        import datetime
        stale_date = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=61)).isoformat()
        summary = ui.summarize_findings([self._result(last_crawl=stale_date)])
        self.assertEqual(summary["stale_crawl_count"], 1)

    def test_recent_crawl_not_flagged(self):
        import datetime
        recent_date = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)).isoformat()
        summary = ui.summarize_findings([self._result(last_crawl=recent_date)])
        self.assertEqual(summary["stale_crawl_count"], 0)

    def test_malformed_crawl_time_does_not_raise(self):
        summary = ui.summarize_findings([self._result(last_crawl="not-a-date")])
        self.assertEqual(summary["stale_crawl_count"], 0)

    def test_crawl_exactly_60_days_not_flagged(self):
        import datetime
        boundary = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=60)).isoformat()
        summary = ui.summarize_findings([self._result(last_crawl=boundary)])
        # 60 days is NOT > 60, so should not be flagged
        self.assertEqual(summary["stale_crawl_count"], 0)


if __name__ == "__main__":
    unittest.main()
