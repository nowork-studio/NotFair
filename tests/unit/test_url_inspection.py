import importlib.util
import pathlib
import sys
import unittest


SCRIPT_PATH = pathlib.Path(__file__).resolve().parents[2] / "seo" / "seo-analysis" / "scripts" / "url_inspection.py"
SCRIPT_DIR = SCRIPT_PATH.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

spec = importlib.util.spec_from_file_location("url_inspection", SCRIPT_PATH)
url_inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(url_inspection)


class ParseInspectionResultTests(unittest.TestCase):
    def test_non_dict_response_returns_default_shape(self):
        parsed = url_inspection.parse_inspection_result([], "https://example.com/")

        self.assertEqual(parsed["url"], "https://example.com/")
        self.assertEqual(parsed["index_status"]["verdict"], "UNKNOWN")
        self.assertEqual(parsed["index_status"]["coverage_state"], "UNKNOWN")
        self.assertEqual(parsed["index_status"]["referring_sitemaps"], [])
        self.assertEqual(parsed["mobile_usability"]["verdict"], "VERDICT_UNSPECIFIED")
        self.assertEqual(parsed["mobile_usability"]["issues"], [])
        self.assertEqual(parsed["rich_results"]["verdict"], "VERDICT_UNSPECIFIED")
        self.assertEqual(parsed["rich_results"]["detected_items"], [])

    def test_malformed_nested_shapes_are_ignored_without_dropping_valid_items(self):
        raw = {
            "inspectionResult": {
                "indexStatusResult": "unexpected",
                "mobileUsabilityResult": {
                    "verdict": "MOBILE_FRIENDLY",
                    "issues": [None, {"issueType": "TEXT_TOO_SMALL"}, "bad"]
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
                                    "issues": [None, {"issueMessage": "Missing field"}, "bad"]
                                },
                                "bad"
                            ]
                        },
                        "bad"
                    ]
                }
            }
        }

        parsed = url_inspection.parse_inspection_result(raw, "https://example.com/page")

        self.assertEqual(parsed["index_status"]["verdict"], "UNKNOWN")
        self.assertEqual(parsed["mobile_usability"]["verdict"], "MOBILE_FRIENDLY")
        self.assertEqual(parsed["mobile_usability"]["issues"], ["TEXT_TOO_SMALL"])
        self.assertEqual(parsed["rich_results"]["verdict"], "PASS")
        self.assertEqual(
            parsed["rich_results"]["detected_items"],
            [{"name": "FAQ", "issues": ["Missing field"]}]
        )


if __name__ == "__main__":
    unittest.main()
