"""
Unit tests for seo-analysis/scripts/analyze_gsc.py

Tests the pure logic functions — no GSC API calls, no gcloud needed.
These run instantly and catch bugs in the data processing pipeline.

Run: pytest test/unit/test_analyze_gsc.py -v
"""

import importlib.util
import json
import os
import sys
import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

# Load analyze_gsc.py as a module without executing main()
_SCRIPTS_DIR = os.path.join(
    os.path.dirname(__file__), '..', '..', 'seo', 'seo-analysis', 'scripts'
)
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
_SCRIPT_PATH = os.path.join(_SCRIPTS_DIR, 'analyze_gsc.py')
spec = importlib.util.spec_from_file_location('analyze_gsc', _SCRIPT_PATH)
gsc = importlib.util.module_from_spec(spec)
# Don't run __main__ block
spec.loader.exec_module(gsc)


class TestDateRange(unittest.TestCase):
    """date_range() returns the correct window with the 3-day GSC lag."""

    def test_returns_two_strings(self):
        start, end = gsc.date_range(90)
        self.assertIsInstance(start, str)
        self.assertIsInstance(end, str)

    def test_end_is_three_days_ago(self):
        _, end = gsc.date_range(90)
        expected_end = (date.today() - timedelta(days=3)).isoformat()
        self.assertEqual(end, expected_end)

    def test_start_is_days_before_end(self):
        start, end = gsc.date_range(90)
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
        delta = end_d - start_d
        self.assertEqual(delta.days, 90)

    def test_28_day_window(self):
        start, end = gsc.date_range(28)
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
        self.assertEqual((end_d - start_d).days, 28)

    def test_custom_lag(self):
        # With days_ago_end=7, end should be 7 days ago
        _, end = gsc.date_range(90, days_ago_end=7)
        expected = (date.today() - timedelta(days=7)).isoformat()
        self.assertEqual(end, expected)


class TestPositionBuckets(unittest.TestCase):
    """Position bucket assignment must be correct at all boundary values."""

    def _make_row(self, query, position, clicks=100, impressions=1000):
        return {
            'keys': [query],
            'position': position,
            'clicks': clicks,
            'impressions': impressions,
            'ctr': clicks / impressions,
        }

    def _run_buckets(self, rows):
        token = 'fake-token'
        mock_data = {'rows': rows}

        with patch.object(gsc, 'gsc_query', return_value=mock_data):
            return gsc.pull_position_buckets(token, 'sc-domain:test.com', '2025-01-01', '2025-03-31')

    def test_position_1_goes_to_1_3(self):
        buckets = self._run_buckets([self._make_row('q1', 1.0)])
        self.assertEqual(len(buckets['1-3']), 1)
        self.assertEqual(buckets['1-3'][0]['query'], 'q1')

    def test_position_3_goes_to_1_3(self):
        buckets = self._run_buckets([self._make_row('q3', 3.0)])
        self.assertEqual(len(buckets['1-3']), 1)

    def test_position_3_point_9_goes_to_4_10(self):
        # 3.9 average > 3, so it's in the 4-10 bucket
        buckets = self._run_buckets([self._make_row('q4', 3.9)])
        self.assertEqual(len(buckets['4-10']), 1)
        self.assertEqual(len(buckets['1-3']), 0)

    def test_position_4_goes_to_4_10(self):
        buckets = self._run_buckets([self._make_row('q5', 4.0)])
        self.assertEqual(len(buckets['4-10']), 1)

    def test_position_10_goes_to_4_10(self):
        buckets = self._run_buckets([self._make_row('q10', 10.0)])
        self.assertEqual(len(buckets['4-10']), 1)

    def test_position_10_point_1_goes_to_11_20(self):
        buckets = self._run_buckets([self._make_row('q11', 10.1)])
        self.assertEqual(len(buckets['11-20']), 1)
        self.assertEqual(len(buckets['4-10']), 0)

    def test_position_20_goes_to_11_20(self):
        buckets = self._run_buckets([self._make_row('q20', 20.0)])
        self.assertEqual(len(buckets['11-20']), 1)

    def test_position_21_goes_to_21_plus(self):
        buckets = self._run_buckets([self._make_row('q21', 21.0)])
        self.assertEqual(len(buckets['21+']), 1)

    def test_position_50_goes_to_21_plus(self):
        buckets = self._run_buckets([self._make_row('q50', 50.0)])
        self.assertEqual(len(buckets['21+']), 1)

    def test_mixed_positions_distributed_correctly(self):
        rows = [
            self._make_row('a', 1.5),   # 1-3
            self._make_row('b', 3.5),   # 4-10
            self._make_row('c', 7.2),   # 4-10
            self._make_row('d', 15.0),  # 11-20
            self._make_row('e', 25.0),  # 21+
        ]
        buckets = self._run_buckets(rows)
        self.assertEqual(len(buckets['1-3']), 1)
        self.assertEqual(len(buckets['4-10']), 2)
        self.assertEqual(len(buckets['11-20']), 1)
        self.assertEqual(len(buckets['21+']), 1)

    def test_empty_input_returns_empty_buckets(self):
        buckets = self._run_buckets([])
        for bucket in buckets.values():
            self.assertEqual(len(bucket), 0)

    def test_bucket_entries_have_correct_fields(self):
        buckets = self._run_buckets([self._make_row('test', 5.0, clicks=50, impressions=500)])
        entry = buckets['4-10'][0]
        self.assertIn('query', entry)
        self.assertIn('clicks', entry)
        self.assertIn('impressions', entry)
        self.assertIn('ctr', entry)
        self.assertIn('position', entry)
        self.assertEqual(entry['query'], 'test')
        self.assertEqual(entry['clicks'], 50)

    def test_ctr_is_rounded_to_2_decimals(self):
        # ctr = 50/500 = 0.1 = 10.0%
        buckets = self._run_buckets([self._make_row('ctr-test', 5.0, clicks=50, impressions=500)])
        entry = buckets['4-10'][0]
        self.assertEqual(entry['ctr'], 10.0)


class TestCtrOpportunities(unittest.TestCase):
    """CTR opportunity filtering: impressions > 500, ctr < 3.0%, position ≤ 20."""

    def _make_query(self, impressions, ctr, position):
        return {
            'query': f'q-{impressions}-{ctr}-{position}',
            'clicks': int(impressions * ctr / 100),
            'impressions': impressions,
            'ctr': ctr,
            'position': position,
        }

    def _get_opportunities(self, queries):
        """Replicate the CTR opportunity filtering logic from analyze_gsc.main()."""
        return [
            q for q in queries
            if q['impressions'] > 500 and q['ctr'] < 3.0 and q['position'] <= 20
        ]

    def test_qualifies_when_all_criteria_met(self):
        q = self._make_query(impressions=1000, ctr=2.5, position=8)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 1)

    def test_excluded_when_impressions_too_low(self):
        q = self._make_query(impressions=400, ctr=2.5, position=8)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 0)

    def test_excluded_when_ctr_too_high(self):
        q = self._make_query(impressions=1000, ctr=3.5, position=8)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 0)

    def test_excluded_when_position_too_deep(self):
        q = self._make_query(impressions=1000, ctr=2.5, position=21)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 0)

    def test_boundary_impressions_501(self):
        q = self._make_query(impressions=501, ctr=2.5, position=8)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 1)

    def test_boundary_impressions_500_excluded(self):
        q = self._make_query(impressions=500, ctr=2.5, position=8)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 0)

    def test_boundary_position_20_included(self):
        q = self._make_query(impressions=1000, ctr=2.5, position=20)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 1)

    def test_boundary_ctr_exactly_3_excluded(self):
        q = self._make_query(impressions=1000, ctr=3.0, position=8)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 0)

    def test_ctr_2_99_included(self):
        q = self._make_query(impressions=1000, ctr=2.99, position=8)
        opps = self._get_opportunities([q])
        self.assertEqual(len(opps), 1)


class TestPeriodComparison(unittest.TestCase):
    """Period comparison drop detection thresholds."""

    def _make_row(self, key, clicks):
        return {'keys': [key], 'clicks': clicks, 'impressions': clicks * 10,
                'ctr': 0.1, 'position': 5.0}

    def _run_comparison(self, curr_pages, prev_pages, curr_queries, prev_queries):
        """Patch gsc_query to return controlled data, run pull_period_comparison."""
        call_count = {'n': 0}

        def fake_query(token, site, body):
            n = call_count['n']
            call_count['n'] += 1
            # Calls: curr_pages, prev_pages, curr_queries, prev_queries
            if n == 0: return {'rows': [self._make_row(k, v) for k, v in curr_pages.items()]}
            if n == 1: return {'rows': [self._make_row(k, v) for k, v in prev_pages.items()]}
            if n == 2: return {'rows': [self._make_row(k, v) for k, v in curr_queries.items()]}
            if n == 3: return {'rows': [self._make_row(k, v) for k, v in prev_queries.items()]}
            return {'rows': []}

        with patch.object(gsc, 'gsc_query', side_effect=fake_query):
            return gsc.pull_period_comparison('fake-token', 'sc-domain:test.com', 28)

    def test_page_drop_above_20pct_flagged(self):
        result = self._run_comparison(
            curr_pages={'/blog/post': 50},
            prev_pages={'/blog/post': 100},  # -50% drop
            curr_queries={},
            prev_queries={},
        )
        self.assertEqual(len(result['declining_pages']), 1)
        self.assertEqual(result['declining_pages'][0]['page'], '/blog/post')

    def test_page_drop_below_20pct_not_flagged(self):
        result = self._run_comparison(
            curr_pages={'/blog/post': 85},
            prev_pages={'/blog/post': 100},  # -15% drop (< 20% threshold)
            curr_queries={},
            prev_queries={},
        )
        self.assertEqual(len(result['declining_pages']), 0)

    def test_page_with_low_previous_clicks_not_flagged(self):
        # prev_clicks must be > 10 to be flagged (avoids noise from low-traffic pages)
        result = self._run_comparison(
            curr_pages={'/low-traffic': 3},
            prev_pages={'/low-traffic': 8},  # -62.5% but prev < 10
            curr_queries={},
            prev_queries={},
        )
        self.assertEqual(len(result['declining_pages']), 0)

    def test_query_drop_above_25pct_flagged(self):
        result = self._run_comparison(
            curr_pages={},
            prev_pages={},
            curr_queries={'keyword phrase': 30},
            prev_queries={'keyword phrase': 60},  # -50% drop
        )
        self.assertEqual(len(result['declining_queries']), 1)

    def test_query_drop_at_25pct_not_flagged(self):
        result = self._run_comparison(
            curr_pages={},
            prev_pages={},
            curr_queries={'keyword phrase': 75},
            prev_queries={'keyword phrase': 100},  # exactly -25%
        )
        # -25% is not strictly < -25%, so should not be flagged
        self.assertEqual(len(result['declining_queries']), 0)

    def test_query_drop_below_threshold_not_flagged(self):
        result = self._run_comparison(
            curr_pages={},
            prev_pages={},
            curr_queries={'keyword phrase': 90},
            prev_queries={'keyword phrase': 100},  # -10% drop
        )
        self.assertEqual(len(result['declining_queries']), 0)

    def test_query_min_previous_clicks(self):
        # prev_clicks must be > 5 to be flagged
        result = self._run_comparison(
            curr_pages={},
            prev_pages={},
            curr_queries={'rare query': 1},
            prev_queries={'rare query': 4},  # -75% but prev ≤ 5
        )
        self.assertEqual(len(result['declining_queries']), 0)

    def test_drop_pct_is_negative(self):
        result = self._run_comparison(
            curr_pages={'/page': 40},
            prev_pages={'/page': 100},
            curr_queries={},
            prev_queries={},
        )
        self.assertLess(result['declining_pages'][0]['change_pct'], 0)

    def test_result_sorted_by_absolute_click_loss_first(self):
        result = self._run_comparison(
            curr_pages={'/tiny-percent-drop': 3, '/bigger-loss': 58},
            prev_pages={'/tiny-percent-drop': 13, '/bigger-loss': 103},
            curr_queries={},
            prev_queries={},
        )
        pages = result['declining_pages']
        self.assertEqual(pages[0]['page'], '/bigger-loss')
        self.assertEqual(pages[0]['absolute_click_loss'], 45)
        self.assertEqual(pages[1]['absolute_click_loss'], 10)

    def test_period_comparison_includes_richer_metadata(self):
        result = self._run_comparison(
            curr_pages={'/page': 40},
            prev_pages={'/page': 100},
            curr_queries={'keyword': 30},
            prev_queries={'keyword': 60},
        )
        page = result['declining_pages'][0]
        self.assertEqual(page['click_delta'], -60)
        self.assertEqual(page['absolute_click_loss'], 60)
        self.assertIn('impressions_now', page)
        self.assertIn('ctr_now', page)
        self.assertIn('position_now', page)
        query = result['declining_queries'][0]
        self.assertEqual(query['click_delta'], -30)
        self.assertEqual(query['absolute_click_loss'], 30)


class TestGscQueryErrorHandling(unittest.TestCase):
    """gsc_query() returns empty rows on HTTP errors instead of crashing."""

    def test_http_error_returns_empty_rows(self):
        import urllib.error
        with patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError(
            url='https://api.google.com', code=403, msg='Forbidden', hdrs=None, fp=None  # type: ignore
        )):
            result = gsc.gsc_query('fake-token', 'sc-domain:test.com', {'dimensions': ['query']})
            self.assertEqual(result, {'rows': []})

    def test_url_error_returns_empty_rows(self):
        import urllib.error
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('Network unreachable')):
            result = gsc.gsc_query('fake-token', 'sc-domain:test.com', {'dimensions': ['query']})
            self.assertEqual(result, {'rows': []})

    def test_network_exception_returns_empty_rows(self):
        mock_session = MagicMock()
        mock_session.post.side_effect = Exception("Network unreachable")
        result = gsc.gsc_query(mock_session, 'sc-domain:test.com', {'dimensions': ['query']})
        self.assertEqual(result, {'rows': []})

    def test_successful_response_parsed_correctly(self):
        mock_body = json.dumps({
            'rows': [
                {'keys': ['test query'], 'clicks': 100, 'impressions': 1000, 'ctr': 0.1, 'position': 5.0}
            ]
        }).encode()

        mock_resp = MagicMock()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_resp.read.return_value = mock_body

        with patch('urllib.request.urlopen', return_value=mock_resp):
            result = gsc.gsc_query('fake-token', 'sc-domain:test.com', {'dimensions': ['query']})

        self.assertEqual(len(result['rows']), 1)
        self.assertEqual(result['rows'][0]['keys'][0], 'test query')


class TestTopQueriesFormatting(unittest.TestCase):
    """pull_top_queries() formats API response correctly."""

    def test_rounds_position_to_one_decimal(self):
        mock_data = {'rows': [
            {'keys': ['test'], 'clicks': 50, 'impressions': 500, 'ctr': 0.1234, 'position': 4.567}
        ]}
        with patch.object(gsc, 'gsc_query', return_value=mock_data):
            result = gsc.pull_top_queries('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')

        self.assertEqual(result[0]['position'], 4.6)

    def test_converts_ctr_to_percentage(self):
        mock_data = {'rows': [
            {'keys': ['test'], 'clicks': 100, 'impressions': 1000, 'ctr': 0.1, 'position': 3.0}
        ]}
        with patch.object(gsc, 'gsc_query', return_value=mock_data):
            result = gsc.pull_top_queries('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')

        # ctr 0.1 → 10.0%
        self.assertEqual(result[0]['ctr'], 10.0)

    def test_empty_response_returns_empty_list(self):
        with patch.object(gsc, 'gsc_query', return_value={'rows': []}):
            result = gsc.pull_top_queries('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(result, [])

    def test_missing_rows_returns_empty_list(self):
        with patch.object(gsc, 'gsc_query', return_value={}):
            result = gsc.pull_top_queries('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(result, [])


class TestGetAccessToken(unittest.TestCase):
    """get_access_token() wraps gcloud and exits cleanly on failure."""

    def test_returns_token_on_success(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = 'ya29.my-token\n'
        with patch('subprocess.run', return_value=mock_result):
            token = gsc.get_access_token()
        self.assertEqual(token, 'ya29.my-token')

    def test_exits_when_gcloud_not_found(self):
        with patch('subprocess.run', side_effect=FileNotFoundError):
            with self.assertRaises(SystemExit):
                gsc.get_access_token()

    def test_exits_when_gcloud_returns_nonzero(self):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ''
        with patch('subprocess.run', return_value=mock_result):
            with self.assertRaises(SystemExit):
                gsc.get_access_token()

    def test_exits_when_gcloud_times_out(self):
        import subprocess as sp
        with patch('subprocess.run', side_effect=sp.TimeoutExpired(cmd='gcloud', timeout=15)):
            with self.assertRaises(SystemExit):
                gsc.get_access_token()

    def test_exits_when_token_is_empty(self):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '   \n'  # whitespace only
        with patch('subprocess.run', return_value=mock_result):
            with self.assertRaises(SystemExit):
                gsc.get_access_token()


class TestDeriveCannibalization(unittest.TestCase):
    """derive_cannibalization() finds queries where multiple pages compete."""

    def _make_row(self, query, page, clicks, impressions, ctr=0.05, position=8.0):
        return {'keys': [query, page], 'clicks': clicks, 'impressions': impressions,
                'ctr': ctr, 'position': position}

    def test_single_page_per_query_not_flagged(self):
        rows = [self._make_row('seo tips', '/blog/seo', 100, 1000)]
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(len(result), 0)

    def test_two_pages_same_query_flagged(self):
        rows = [
            self._make_row('seo tips', '/blog/seo', 100, 1000),
            self._make_row('seo tips', '/guide/seo', 50, 800),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['query'], 'seo tips')

    def test_competing_pages_sorted_by_position_asc(self):
        rows = [
            self._make_row('seo tips', '/blog/seo', 30, 500, position=8.0),
            self._make_row('seo tips', '/guide/seo', 100, 800, position=3.0),
        ]
        result = gsc.derive_cannibalization(rows)
        pages = result[0]['competing_pages']
        self.assertEqual(pages[0]['page'], '/guide/seo')  # best position first
        self.assertEqual(pages[1]['page'], '/blog/seo')

    def test_total_impressions_and_clicks_summed(self):
        rows = [
            self._make_row('keyword', '/a', 80, 900),
            self._make_row('keyword', '/b', 40, 600),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(result[0]['total_impressions'], 1500)
        self.assertEqual(result[0]['total_clicks'], 120)

    def test_min_impressions_filter(self):
        rows = [
            self._make_row('rare query', '/a', 5, 40),
            self._make_row('rare query', '/b', 3, 30),
        ]
        # total impressions = 70, below default min of 100
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(len(result), 0)

    def test_min_impressions_at_boundary_included(self):
        rows = [
            self._make_row('edge query', '/a', 5, 60),
            self._make_row('edge query', '/b', 3, 40),
        ]
        # total = 100, exactly at min_impressions threshold
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(len(result), 1)

    def test_results_sorted_by_total_impressions_desc(self):
        rows = [
            self._make_row('small', '/a', 10, 200),
            self._make_row('small', '/b', 5, 150),
            self._make_row('large', '/x', 50, 800),
            self._make_row('large', '/y', 30, 600),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertGreater(result[0]['total_impressions'], result[1]['total_impressions'])

    def test_results_capped_at_30(self):
        rows = []
        for i in range(35):
            rows.append(self._make_row(f'query-{i}', '/a', 50, 300))
            rows.append(self._make_row(f'query-{i}', '/b', 30, 200))
        result = gsc.derive_cannibalization(rows)
        self.assertLessEqual(len(result), 30)

    def test_empty_rows_returns_empty(self):
        self.assertEqual(gsc.derive_cannibalization([]), [])

    def test_competing_pages_have_correct_fields(self):
        rows = [
            self._make_row('test', '/a', 100, 1000, ctr=0.1, position=5.2),
            self._make_row('test', '/b', 50, 800, ctr=0.06, position=9.1),
        ]
        result = gsc.derive_cannibalization(rows)
        page = result[0]['competing_pages'][0]
        self.assertIn('page', page)
        self.assertIn('clicks', page)
        self.assertIn('impressions', page)
        self.assertIn('ctr', page)
        self.assertIn('position', page)
        self.assertEqual(page['ctr'], round(0.1 * 100, 2))

    def test_winner_page_is_best_position(self):
        rows = [
            self._make_row('keyword', '/a', 50, 500, position=8.0),
            self._make_row('keyword', '/b', 20, 400, position=3.0),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(result[0]['winner_page'], '/b')  # /b has position 3.0

    def test_winner_tiebreaker_is_most_clicks(self):
        rows = [
            self._make_row('keyword', '/a', 80, 500, position=5.0),
            self._make_row('keyword', '/b', 30, 400, position=5.0),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(result[0]['winner_page'], '/a')  # same position, /a has more clicks

    def test_loser_pages_excludes_winner(self):
        rows = [
            self._make_row('kw', '/winner', 100, 800, position=2.0),
            self._make_row('kw', '/loser1', 40, 400, position=7.0),
            self._make_row('kw', '/loser2', 20, 300, position=9.0),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertEqual(result[0]['winner_page'], '/winner')
        self.assertIn('/loser1', result[0]['loser_pages'])
        self.assertIn('/loser2', result[0]['loser_pages'])
        self.assertNotIn('/winner', result[0]['loser_pages'])

    def test_domination_flag_when_all_top5_close_positions(self):
        rows = [
            self._make_row('brand query', '/a', 100, 800, position=2.0),
            self._make_row('brand query', '/b', 80, 600, position=3.5),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertIn('domination', result[0]['recommended_action'])

    def test_consolidate_recommended_when_positions_spread(self):
        rows = [
            self._make_row('keyword', '/a', 100, 800, position=2.0),
            self._make_row('keyword', '/b', 30, 500, position=9.0),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertIn('consolidate', result[0]['recommended_action'])

    def test_winner_reason_shows_position_when_positions_differ(self):
        rows = [
            self._make_row('kw', '/a', 100, 800, position=3.0),
            self._make_row('kw', '/b', 50, 600, position=7.0),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertIn('winner_reason', result[0])
        self.assertIn('3.0', result[0]['winner_reason'])
        self.assertIn('position', result[0]['winner_reason'])

    def test_winner_reason_shows_clicks_when_positions_tied(self):
        rows = [
            self._make_row('kw', '/a', 100, 800, position=5.0),
            self._make_row('kw', '/b', 40, 600, position=5.0),
        ]
        result = gsc.derive_cannibalization(rows)
        self.assertIn('clicks', result[0]['winner_reason'])
        self.assertIn('100', result[0]['winner_reason'])


class TestDeriveCtrGapsByPage(unittest.TestCase):
    """derive_ctr_gaps_by_page() finds high-impression, low-CTR query+page pairs."""

    def _make_row(self, query, page, impressions, ctr_decimal, position):
        return {'keys': [query, page], 'clicks': int(impressions * ctr_decimal),
                'impressions': impressions, 'ctr': ctr_decimal, 'position': position}

    def test_qualifies_when_all_criteria_met(self):
        rows = [self._make_row('best seo tool', '/tools', 500, 0.02, 8)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['query'], 'best seo tool')
        self.assertEqual(result[0]['page'], '/tools')

    def test_excluded_when_impressions_below_min(self):
        rows = [self._make_row('low traffic', '/page', 100, 0.02, 8)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(len(result), 0)

    def test_excluded_when_ctr_above_max(self):
        rows = [self._make_row('good ctr', '/page', 500, 0.05, 8)]
        # ctr_pct = 5.0, max is 3.0
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(len(result), 0)

    def test_excluded_when_position_too_deep(self):
        rows = [self._make_row('deep ranking', '/page', 500, 0.02, 21)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(len(result), 0)

    def test_boundary_impressions_200_included(self):
        rows = [self._make_row('edge', '/page', 200, 0.02, 8)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(len(result), 1)

    def test_boundary_impressions_199_excluded(self):
        rows = [self._make_row('edge', '/page', 199, 0.02, 8)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(len(result), 0)

    def test_boundary_position_20_included(self):
        rows = [self._make_row('edge position', '/page', 500, 0.02, 20)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(len(result), 1)

    def test_ctr_stored_as_percentage(self):
        rows = [self._make_row('test', '/page', 500, 0.02, 8)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        # 0.02 decimal → 2.0% stored
        self.assertAlmostEqual(result[0]['ctr'], 2.0, places=1)

    def test_sorted_by_impressions_desc(self):
        rows = [
            self._make_row('q1', '/a', 300, 0.02, 8),
            self._make_row('q2', '/b', 1000, 0.01, 5),
        ]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertGreater(result[0]['impressions'], result[1]['impressions'])

    def test_results_capped_at_25(self):
        rows = [self._make_row(f'q{i}', f'/page-{i}', 500, 0.02, 8) for i in range(30)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertLessEqual(len(result), 25)

    def test_empty_rows_returns_empty(self):
        self.assertEqual(gsc.derive_ctr_gaps_by_page([]), [])

    def test_output_includes_page_field(self):
        rows = [self._make_row('kw', '/landing', 500, 0.02, 8)]
        result = gsc.derive_ctr_gaps_by_page(rows)
        self.assertEqual(result[0]['page'], '/landing')


class TestPullCountrySplit(unittest.TestCase):
    """pull_country_split() returns rows with CTR and position fields."""

    def test_formats_rows_correctly(self):
        mock_data = {'rows': [
            {'keys': ['usa'], 'clicks': 500, 'impressions': 5000, 'ctr': 0.1, 'position': 4.2}
        ]}
        with patch.object(gsc, 'gsc_query', return_value=mock_data):
            result = gsc.pull_country_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['country'], 'usa')
        self.assertEqual(result[0]['ctr'], 10.0)
        self.assertEqual(result[0]['position'], 4.2)

    def test_empty_response_returns_empty_list(self):
        with patch.object(gsc, 'gsc_query', return_value={'rows': []}):
            result = gsc.pull_country_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(result, [])

    def test_ctr_converted_to_percentage(self):
        mock_data = {'rows': [
            {'keys': ['gbr'], 'clicks': 100, 'impressions': 1000, 'ctr': 0.05, 'position': 7.0}
        ]}
        with patch.object(gsc, 'gsc_query', return_value=mock_data):
            result = gsc.pull_country_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(result[0]['ctr'], 5.0)


class TestPullSearchTypeSplit(unittest.TestCase):
    """pull_search_type_split() only includes search types with clicks > 0."""

    def test_excludes_zero_click_types(self):
        def fake_query(token, site, body):
            stype = body.get('type', 'web')
            if stype == 'web':
                return {'rows': [{'clicks': 1000, 'impressions': 50000, 'ctr': 0.02, 'position': 5.0}]}
            return {'rows': [{}]}  # empty rows → clicks defaults to 0

        with patch.object(gsc, 'gsc_query', side_effect=fake_query):
            result = gsc.pull_search_type_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['type'], 'web')

    def test_includes_discover_when_traffic_exists(self):
        def fake_query(token, site, body):
            stype = body.get('type', 'web')
            if stype == 'discover':
                return {'rows': [{'clicks': 500, 'impressions': 20000, 'ctr': 0.025, 'position': 0.0}]}
            return {'rows': [{}]}

        with patch.object(gsc, 'gsc_query', side_effect=fake_query):
            result = gsc.pull_search_type_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['type'], 'discover')

    def test_sorted_by_clicks_desc(self):
        def fake_query(token, site, body):
            stype = body.get('type', 'web')
            if stype == 'web':
                return {'rows': [{'clicks': 5000, 'impressions': 100000, 'ctr': 0.05, 'position': 4.0}]}
            if stype == 'image':
                return {'rows': [{'clicks': 1000, 'impressions': 20000, 'ctr': 0.05, 'position': 3.0}]}
            return {'rows': [{}]}

        with patch.object(gsc, 'gsc_query', side_effect=fake_query):
            result = gsc.pull_search_type_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(result[0]['type'], 'web')  # web has more clicks
        self.assertGreater(result[0]['clicks'], result[1]['clicks'])

    def test_all_zero_returns_empty_list(self):
        with patch.object(gsc, 'gsc_query', return_value={'rows': [{}]}):
            result = gsc.pull_search_type_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(result, [])

    def test_ctr_converted_to_percentage(self):
        def fake_query(token, site, body):
            if body.get('type') == 'web':
                return {'rows': [{'clicks': 100, 'impressions': 1000, 'ctr': 0.1, 'position': 5.0}]}
            return {'rows': [{}]}

        with patch.object(gsc, 'gsc_query', side_effect=fake_query):
            result = gsc.pull_search_type_split('token', 'sc-domain:test.com', '2025-01-01', '2025-03-31')
        self.assertEqual(result[0]['ctr'], 10.0)


class TestClassifyBranded(unittest.TestCase):
    """classify_branded() detects brand terms case-insensitively."""

    def test_exact_match(self):
        self.assertTrue(gsc.classify_branded('acme pricing', ['acme']))

    def test_case_insensitive(self):
        self.assertTrue(gsc.classify_branded('Acme Corp pricing', ['acme']))

    def test_brand_uppercase_term(self):
        self.assertTrue(gsc.classify_branded('acmecorp review', ['AcmeCorp']))

    def test_non_branded_query(self):
        self.assertFalse(gsc.classify_branded('best seo tools', ['acme']))

    def test_empty_brand_terms_returns_false(self):
        self.assertFalse(gsc.classify_branded('acme pricing', []))

    def test_none_brand_terms_returns_false(self):
        self.assertFalse(gsc.classify_branded('acme pricing', None))

    def test_multiple_brand_terms_any_match(self):
        self.assertTrue(gsc.classify_branded('toprank seo tool', ['acme', 'toprank']))

    def test_multiple_brand_terms_none_match(self):
        self.assertFalse(gsc.classify_branded('best content marketing', ['acme', 'toprank']))

    def test_partial_word_match(self):
        # "acmecorp" contains "acme" — should match
        self.assertTrue(gsc.classify_branded('acmecorp login', ['acme']))


class TestDeriveBrandedSplit(unittest.TestCase):
    """derive_branded_split() aggregates qp_rows into branded vs non-branded segments."""

    def _make_row(self, query, page, clicks, impressions, position=5.0):
        return {'keys': [query, page], 'clicks': clicks, 'impressions': impressions,
                'ctr': clicks / impressions, 'position': position}

    def test_returns_none_when_no_brand_terms(self):
        rows = [self._make_row('acme pricing', '/pricing', 100, 1000)]
        self.assertIsNone(gsc.derive_branded_split(rows, []))

    def test_returns_none_when_brand_terms_is_none(self):
        rows = [self._make_row('acme pricing', '/pricing', 100, 1000)]
        self.assertIsNone(gsc.derive_branded_split(rows, None))

    def test_splits_into_branded_and_non_branded(self):
        rows = [
            self._make_row('acme pricing', '/pricing', 100, 1000),
            self._make_row('seo tools', '/blog', 50, 800),
        ]
        result = gsc.derive_branded_split(rows, ['acme'])
        self.assertEqual(result['branded']['clicks'], 100)
        self.assertEqual(result['non_branded']['clicks'], 50)

    def test_branded_impressions_correct(self):
        rows = [
            self._make_row('acme login', '/login', 200, 2000),
            self._make_row('acme pricing', '/pricing', 100, 1000),
        ]
        result = gsc.derive_branded_split(rows, ['acme'])
        self.assertEqual(result['branded']['impressions'], 3000)

    def test_query_count_correct(self):
        rows = [
            self._make_row('acme tool', '/a', 50, 500),
            self._make_row('generic query', '/b', 30, 300),
            self._make_row('another generic', '/c', 20, 200),
        ]
        result = gsc.derive_branded_split(rows, ['acme'])
        self.assertEqual(result['branded']['query_count'], 1)
        self.assertEqual(result['non_branded']['query_count'], 2)

    def test_same_query_multiple_pages_deduped(self):
        # Same query on two pages → only 1 unique query, but clicks/impressions summed
        rows = [
            self._make_row('acme tool', '/a', 50, 500),
            self._make_row('acme tool', '/b', 30, 300),
        ]
        result = gsc.derive_branded_split(rows, ['acme'])
        self.assertEqual(result['branded']['query_count'], 1)
        self.assertEqual(result['branded']['clicks'], 80)

    def test_empty_segment_returns_zero_stats(self):
        rows = [self._make_row('generic query', '/page', 100, 1000)]
        result = gsc.derive_branded_split(rows, ['acme'])
        self.assertEqual(result['branded']['clicks'], 0)
        self.assertEqual(result['branded']['query_count'], 0)
        self.assertEqual(result['branded']['top_queries'], [])

    def test_top_queries_sorted_by_impressions(self):
        rows = [
            self._make_row('acme cheap', '/a', 10, 200),
            self._make_row('acme popular', '/b', 50, 5000),
        ]
        result = gsc.derive_branded_split(rows, ['acme'])
        top = result['branded']['top_queries']
        self.assertEqual(top[0]['query'], 'acme popular')

    def test_ctr_computed_correctly(self):
        # 200 clicks / 1000 impressions = 20.0%
        rows = [self._make_row('acme', '/home', 200, 1000)]
        result = gsc.derive_branded_split(rows, ['acme'])
        self.assertAlmostEqual(result['branded']['ctr'], 20.0, places=1)


class TestClusterPageGroups(unittest.TestCase):
    """cluster_page_groups() groups pages by URL path pattern."""

    def _make_page(self, page, clicks, impressions, position=5.0):
        return {'page': page, 'clicks': clicks, 'impressions': impressions,
                'ctr': round(clicks / impressions * 100, 2), 'position': position}

    def test_blog_pages_grouped(self):
        pages = [self._make_page('https://example.com/blog/post-1', 100, 1000)]
        result = gsc.cluster_page_groups(pages)
        blog = next((g for g in result if g['group'] == 'blog'), None)
        self.assertIsNotNone(blog)
        self.assertEqual(blog['clicks'], 100)

    def test_products_pages_grouped(self):
        pages = [self._make_page('/products/widget', 50, 500)]
        result = gsc.cluster_page_groups(pages)
        products = next((g for g in result if g['group'] == 'products'), None)
        self.assertIsNotNone(products)

    def test_unmatched_pages_go_to_other(self):
        pages = [self._make_page('/custom-path/something', 20, 200)]
        result = gsc.cluster_page_groups(pages)
        other = next((g for g in result if g['group'] == 'other'), None)
        self.assertIsNotNone(other)
        self.assertEqual(other['clicks'], 20)

    def test_multiple_pages_same_group_aggregated(self):
        pages = [
            self._make_page('/blog/post-1', 100, 1000),
            self._make_page('/blog/post-2', 80, 800),
        ]
        result = gsc.cluster_page_groups(pages)
        blog = next((g for g in result if g['group'] == 'blog'), None)
        self.assertEqual(blog['clicks'], 180)
        self.assertEqual(blog['page_count'], 2)

    def test_sorted_by_clicks_desc(self):
        pages = [
            self._make_page('/blog/post', 50, 500),
            self._make_page('/products/item', 300, 3000),
        ]
        result = gsc.cluster_page_groups(pages)
        self.assertGreater(result[0]['clicks'], result[1]['clicks'])

    def test_empty_groups_not_returned(self):
        pages = [self._make_page('/blog/post', 100, 1000)]
        result = gsc.cluster_page_groups(pages)
        groups_with_pages = [g for g in result if g['page_count'] > 0]
        self.assertEqual(len(result), len(groups_with_pages))

    def test_empty_pages_returns_empty(self):
        self.assertEqual(gsc.cluster_page_groups([]), [])

    def test_ctr_computed_correctly(self):
        # 100 clicks / 1000 impressions = 10%
        pages = [self._make_page('/blog/post', 100, 1000)]
        result = gsc.cluster_page_groups(pages)
        blog = next(g for g in result if g['group'] == 'blog')
        self.assertAlmostEqual(blog['ctr'], 10.0, places=1)

    def test_position_is_weighted_average(self):
        # Two blog posts: position 2.0 with 1000 imps, position 8.0 with 1000 imps → avg 5.0
        pages = [
            self._make_page('/blog/a', 100, 1000, position=2.0),
            self._make_page('/blog/b', 80, 1000, position=8.0),
        ]
        result = gsc.cluster_page_groups(pages)
        blog = next(g for g in result if g['group'] == 'blog')
        self.assertAlmostEqual(blog['position'], 5.0, places=1)

    def test_first_matching_group_wins(self):
        # /blog/products/ could match both 'blog' and 'products' — first pattern wins
        pages = [self._make_page('/blog/products/item', 100, 1000)]
        result = gsc.cluster_page_groups(pages)
        matched_groups = [g['group'] for g in result if g['page_count'] > 0]
        # Should only be in one group
        self.assertEqual(len([g for g in result if g['page_count'] > 0 and g['group'] in ('blog', 'products')]), 1)

    def test_custom_groups_override_defaults(self):
        custom = [("guides", r"/guide/")]
        pages = [self._make_page('/guide/seo-basics', 100, 1000)]
        result = gsc.cluster_page_groups(pages, groups=custom)
        guides = next((g for g in result if g['group'] == 'guides'), None)
        self.assertIsNotNone(guides)


if __name__ == '__main__':
    unittest.main()
