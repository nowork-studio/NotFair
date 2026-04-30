#!/usr/bin/env python3
"""
Pull and analyze Google Search Console data.
Outputs structured JSON for the seo-analysis skill to process.

Usage:
  python3 analyze_gsc.py --site "sc-domain:example.com" --days 90
  python3 analyze_gsc.py --site "https://example.com/" --days 28
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

from _uid import portable_uid, secure_write_json


DEFAULT_PAGE_GROUPS = [
    ("blog",         r"/blog/"),
    ("products",     r"/product"),
    ("locations",    r"/location"),
    ("services",     r"/service"),
    ("pricing",      r"/pricing"),
    ("docs",         r"/docs?/"),
    ("about",        r"/about"),
    ("faq",          r"/faq"),
    ("landing",      r"/lp/"),
    ("case-studies", r"/case-studi"),
]


def get_quota_project():
    """Return the quota_project_id from the ADC JSON file, or None."""
    adc_dir = os.environ.get("CLOUDSDK_CONFIG") or os.path.join(
        os.path.expanduser("~"), ".config", "gcloud"
    )
    adc_path = os.path.join(adc_dir, "application_default_credentials.json")
    try:
        with open(adc_path) as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data.get("quota_project_id") or None
    except (OSError, ValueError):
        pass
    return None


def get_access_token():
    try:
        result = subprocess.run(
            ["gcloud", "auth", "application-default", "print-access-token"],
            capture_output=True, text=True, timeout=15
        )
    except FileNotFoundError:
        print("ERROR: gcloud not found. Install it and authenticate:", file=sys.stderr)
        print("  https://cloud.google.com/sdk/docs/install", file=sys.stderr)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("ERROR: gcloud timed out after 15s. Check your network or gcloud installation.", file=sys.stderr)
        sys.exit(1)
    if result.returncode != 0:
        print("ERROR: Not authenticated. Run:", file=sys.stderr)
        print("  gcloud auth application-default login \\", file=sys.stderr)
        print("    --scopes=https://www.googleapis.com/auth/webmasters,"
              "https://www.googleapis.com/auth/webmasters.readonly", file=sys.stderr)
        sys.exit(1)
    token = result.stdout.strip()
    if not token:
        print("ERROR: gcloud returned an empty token. Re-authenticate:", file=sys.stderr)
        print("  gcloud auth application-default login \\", file=sys.stderr)
        print("    --scopes=https://www.googleapis.com/auth/webmasters,"
              "https://www.googleapis.com/auth/webmasters.readonly", file=sys.stderr)
        sys.exit(1)
    return token


def gsc_query(token, site_url, body):
    """Call the Search Analytics query endpoint."""
    encoded = urllib.parse.quote(site_url, safe="")
    url = f"https://searchconsole.googleapis.com/webmasters/v3/sites/{encoded}/searchAnalytics/query"
    data = json.dumps(body).encode()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    quota_project = get_quota_project()
    if quota_project:
        headers["x-goog-user-project"] = quota_project
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else "(no body)"
        print(f"GSC API error {e.code}: {err_body}", file=sys.stderr)
        return {"rows": []}
    except urllib.error.URLError as e:
        print(f"GSC API network error: {e.reason}", file=sys.stderr)
        return {"rows": []}


def date_range(days_ago_start, days_ago_end=3):
    """Return (start, end) date strings. GSC data typically lags ~3 days."""
    end = date.today() - timedelta(days=days_ago_end)
    start = end - timedelta(days=days_ago_start)
    return start.isoformat(), end.isoformat()


def pull_top_queries(token, site, start, end, row_limit=50):
    body = {
        "startDate": start, "endDate": end,
        "dimensions": ["query"],
        "rowLimit": row_limit,
        "orderBy": [{"fieldName": "impressions", "sortOrder": "DESCENDING"}]
    }
    data = gsc_query(token, site, body)
    rows = []
    for r in data.get("rows", []):
        rows.append({
            "query": r["keys"][0],
            "clicks": r["clicks"],
            "impressions": r["impressions"],
            "ctr": round(r["ctr"] * 100, 2),
            "position": round(r["position"], 1)
        })
    return rows


def pull_top_pages(token, site, start, end, row_limit=50):
    body = {
        "startDate": start, "endDate": end,
        "dimensions": ["page"],
        "rowLimit": row_limit,
        "orderBy": [{"fieldName": "clicks", "sortOrder": "DESCENDING"}]
    }
    data = gsc_query(token, site, body)
    rows = []
    for r in data.get("rows", []):
        rows.append({
            "page": r["keys"][0],
            "clicks": r["clicks"],
            "impressions": r["impressions"],
            "ctr": round(r["ctr"] * 100, 2),
            "position": round(r["position"], 1)
        })
    return rows


def pull_position_buckets(token, site, start, end):
    """Queries by position bucket: 1-3 (winners), 4-10 (low-hanging fruit), 11-20 (almost there), 21+."""
    body = {
        "startDate": start, "endDate": end,
        "dimensions": ["query"],
        "rowLimit": 1000,
        "orderBy": [{"fieldName": "impressions", "sortOrder": "DESCENDING"}]
    }
    data = gsc_query(token, site, body)
    buckets = {"1-3": [], "4-10": [], "11-20": [], "21+": []}
    for r in data.get("rows", []):
        pos = r["position"]
        entry = {
            "query": r["keys"][0],
            "clicks": r["clicks"],
            "impressions": r["impressions"],
            "ctr": round(r["ctr"] * 100, 2),
            "position": round(pos, 1)
        }
        if pos <= 3:
            buckets["1-3"].append(entry)
        elif pos <= 10:
            buckets["4-10"].append(entry)
        elif pos <= 20:
            buckets["11-20"].append(entry)
        else:
            buckets["21+"].append(entry)
    return buckets


def pull_period_comparison(token, site, days):
    """Compare current period vs prior period to find declines."""
    end_curr = date.today() - timedelta(days=3)
    start_curr = end_curr - timedelta(days=days)
    end_prev = start_curr - timedelta(days=1)
    start_prev = end_prev - timedelta(days=days)

    def fetch(start, end, dim):
        body = {
            "startDate": start.isoformat(), "endDate": end.isoformat(),
            "dimensions": [dim], "rowLimit": 200,
            "orderBy": [{"fieldName": "clicks", "sortOrder": "DESCENDING"}]
        }
        data = gsc_query(token, site, body)
        return {r["keys"][0]: r for r in data.get("rows", [])}

    # Pages comparison
    curr_pages = fetch(start_curr, end_curr, "page")
    prev_pages = fetch(start_prev, end_prev, "page")

    page_changes = []
    for page, curr in curr_pages.items():
        if page in prev_pages:
            prev = prev_pages[page]
            delta = curr["clicks"] - prev["clicks"]
            pct = round((delta / max(prev["clicks"], 1)) * 100, 1)
            if pct < -20 and prev["clicks"] > 10:  # Only flag meaningful drops
                page_changes.append({
                    "page": page,
                    "clicks_now": curr["clicks"],
                    "clicks_prev": prev["clicks"],
                    "click_delta": delta,
                    "absolute_click_loss": abs(delta),
                    "change_pct": pct,
                    "impressions_now": curr.get("impressions", 0),
                    "impressions_prev": prev.get("impressions", 0),
                    "impression_delta": curr.get("impressions", 0) - prev.get("impressions", 0),
                    "ctr_now": round(curr.get("ctr", 0) * 100, 2),
                    "ctr_prev": round(prev.get("ctr", 0) * 100, 2),
                    "position_now": round(curr.get("position", 0), 1),
                    "position_prev": round(prev.get("position", 0), 1),
                })
    page_changes.sort(key=lambda x: (-x.get("absolute_click_loss", 0), x["change_pct"]))

    # Queries comparison
    curr_q = fetch(start_curr, end_curr, "query")
    prev_q = fetch(start_prev, end_prev, "query")

    query_changes = []
    for q, curr in curr_q.items():
        if q in prev_q:
            prev = prev_q[q]
            delta = curr["clicks"] - prev["clicks"]
            pct = round((delta / max(prev["clicks"], 1)) * 100, 1)
            if pct < -25 and prev["clicks"] > 5:
                query_changes.append({
                    "query": q,
                    "clicks_now": curr["clicks"],
                    "clicks_prev": prev["clicks"],
                    "click_delta": delta,
                    "absolute_click_loss": abs(delta),
                    "change_pct": pct,
                    "impressions_now": curr.get("impressions", 0),
                    "impressions_prev": prev.get("impressions", 0),
                    "impression_delta": curr.get("impressions", 0) - prev.get("impressions", 0),
                    "ctr_now": round(curr.get("ctr", 0) * 100, 2),
                    "ctr_prev": round(prev.get("ctr", 0) * 100, 2),
                    "position_now": round(curr.get("position", 0), 1),
                    "position_prev": round(prev.get("position", 0), 1),
                })
    query_changes.sort(key=lambda x: (-x.get("absolute_click_loss", 0), x["change_pct"]))

    return {
        "period": f"{start_curr.isoformat()} to {end_curr.isoformat()}",
        "prior_period": f"{start_prev.isoformat()} to {end_prev.isoformat()}",
        "declining_pages": page_changes[:20],
        "declining_queries": query_changes[:20]
    }


def pull_summary(token, site, start, end):
    """Overall totals."""
    body = {"startDate": start, "endDate": end, "dimensions": []}
    data = gsc_query(token, site, body)
    rows = data.get("rows", [{}])
    r = rows[0] if rows else {}
    return {
        "clicks": r.get("clicks", 0),
        "impressions": r.get("impressions", 0),
        "ctr": round(r.get("ctr", 0) * 100, 2),
        "position": round(r.get("position", 0), 1)
    }


def pull_device_split(token, site, start, end):
    body = {
        "startDate": start, "endDate": end,
        "dimensions": ["device"],
        "rowLimit": 10
    }
    data = gsc_query(token, site, body)
    return [
        {"device": r["keys"][0], "clicks": r["clicks"], "impressions": r["impressions"],
         "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)}
        for r in data.get("rows", [])
    ]


def pull_country_split(token, site, start, end, row_limit=20):
    """Top countries by clicks. Surfaces geo opportunities and region-specific problems."""
    body = {
        "startDate": start, "endDate": end,
        "dimensions": ["country"],
        "rowLimit": row_limit,
        "orderBy": [{"fieldName": "clicks", "sortOrder": "DESCENDING"}]
    }
    data = gsc_query(token, site, body)
    return [
        {"country": r["keys"][0], "clicks": r["clicks"], "impressions": r["impressions"],
         "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)}
        for r in data.get("rows", [])
    ]


def pull_search_type_split(token, site, start, end):
    """Breakdown by search type: web, image, video, news, discover, googleNews.
    Many sites have Discover or image traffic they don't know about."""
    search_types = ["web", "image", "video", "news", "discover", "googleNews"]
    results = []
    for stype in search_types:
        body = {
            "startDate": start, "endDate": end,
            "dimensions": [],
            "type": stype
        }
        data = gsc_query(token, site, body)
        rows = data.get("rows", [{}])
        r = rows[0] if rows else {}
        clicks = r.get("clicks", 0)
        if clicks > 0:
            results.append({
                "type": stype,
                "clicks": clicks,
                "impressions": r.get("impressions", 0),
                "ctr": round(r.get("ctr", 0) * 100, 2),
                "position": round(r.get("position", 0), 1)
            })
    results.sort(key=lambda x: x["clicks"], reverse=True)
    return results


def pull_query_page_rows(token, site, start, end, row_limit=2000):
    """Pull [query, page] dimension data in one call. Expensive — reused for both
    cannibalization detection and page-level CTR gap analysis."""
    body = {
        "startDate": start, "endDate": end,
        "dimensions": ["query", "page"],
        "rowLimit": row_limit,
        "orderBy": [{"fieldName": "impressions", "sortOrder": "DESCENDING"}]
    }
    data = gsc_query(token, site, body)
    return data.get("rows", [])


def _cannibalization_winner(pages):
    """Pick the canonical winner page. Primary: best (lowest) position. Tiebreaker: most clicks."""
    return min(pages, key=lambda p: (p["position"], -p["clicks"]))


def derive_cannibalization(rows, min_impressions=100):
    """Find queries where multiple pages compete for the same keyword.
    Returns structured winner/loser scoring and recommended action.
    Input: raw rows from pull_query_page_rows."""
    query_pages = {}
    for r in rows:
        query, page = r["keys"]
        if query not in query_pages:
            query_pages[query] = []
        query_pages[query].append({
            "page": page,
            "clicks": r["clicks"],
            "impressions": r["impressions"],
            "ctr": round(r["ctr"] * 100, 2),
            "position": round(r["position"], 1)
        })

    cannibalized = []
    for query, pages in query_pages.items():
        if len(pages) > 1:
            total_impressions = sum(p["impressions"] for p in pages)
            if total_impressions >= min_impressions:
                winner = _cannibalization_winner(pages)
                winner_page = winner["page"]
                loser_pages = [p["page"] for p in pages if p["page"] != winner_page]

                # Possible SERP domination: all pages in top 5, positions within 2 of each other
                positions = [p["position"] for p in pages]
                is_domination = max(positions) <= 5 and (max(positions) - min(positions)) <= 2.0
                action = ("monitor: possible SERP domination"
                          if is_domination else
                          "consolidate: 301 redirect losers to winner or add canonical")

                # Determine the actual deciding factor for the winner reason
                all_same_position = all(p["position"] == winner["position"] for p in pages)
                winner_reason = (f"most clicks ({winner['clicks']})" if all_same_position
                                 else f"best position ({winner['position']})")

                cannibalized.append({
                    "query": query,
                    "winner_page": winner_page,
                    "winner_reason": winner_reason,
                    "loser_pages": loser_pages,
                    "recommended_action": action,
                    "competing_pages": sorted(pages, key=lambda x: x["position"]),
                    "total_impressions": total_impressions,
                    "total_clicks": sum(p["clicks"] for p in pages)
                })

    cannibalized.sort(key=lambda x: x["total_impressions"], reverse=True)
    return cannibalized[:30]


def derive_ctr_gaps_by_page(rows, min_impressions=200, max_ctr=3.0, max_position=20):
    """High-impression, low-CTR at query+page level — pinpoints exactly which page
    to rewrite the title/meta for. Input: raw rows from pull_query_page_rows."""
    gaps = []
    for r in rows:
        ctr_pct = r["ctr"] * 100
        if r["impressions"] >= min_impressions and ctr_pct < max_ctr and r["position"] <= max_position:
            gaps.append({
                "query": r["keys"][0],
                "page": r["keys"][1],
                "clicks": r["clicks"],
                "impressions": r["impressions"],
                "ctr": round(ctr_pct, 2),
                "position": round(r["position"], 1)
            })
    gaps.sort(key=lambda x: x["impressions"], reverse=True)
    return gaps[:25]


def classify_branded(query, brand_terms):
    """Return True if query contains any brand term (case-insensitive substring match)."""
    if not brand_terms:
        return False
    q = query.lower()
    return any(term.lower() in q for term in brand_terms)


def derive_branded_split(rows, brand_terms):
    """Split query+page traffic into branded vs non-branded segments.
    Input: raw rows from pull_query_page_rows. Returns None if no brand_terms provided."""
    if not brand_terms:
        return None

    # Aggregate per unique query (qp_rows can have multiple rows per query across pages)
    query_stats = {}
    for r in rows:
        query = r["keys"][0]
        imp = r["impressions"]
        if query not in query_stats:
            query_stats[query] = {
                "clicks": 0, "impressions": 0, "weighted_pos": 0.0,
                "branded": classify_branded(query, brand_terms)
            }
        query_stats[query]["clicks"] += r["clicks"]
        query_stats[query]["impressions"] += imp
        query_stats[query]["weighted_pos"] += r["position"] * imp

    branded, non_branded = [], []
    for query, s in query_stats.items():
        imp = s["impressions"]
        pos = round(s["weighted_pos"] / imp, 1) if imp > 0 else 0.0
        ctr = round(s["clicks"] / imp * 100, 2) if imp > 0 else 0.0
        entry = {"query": query, "clicks": s["clicks"], "impressions": imp,
                 "ctr": ctr, "position": pos}
        (branded if s["branded"] else non_branded).append(entry)

    def summarize(query_list):
        if not query_list:
            return {"clicks": 0, "impressions": 0, "ctr": 0.0, "position": 0.0,
                    "query_count": 0, "top_queries": []}
        total_clicks = sum(q["clicks"] for q in query_list)
        total_imp = sum(q["impressions"] for q in query_list)
        ctr = round(total_clicks / total_imp * 100, 2) if total_imp > 0 else 0.0
        weighted_pos = sum(q["position"] * q["impressions"] for q in query_list)
        pos = round(weighted_pos / total_imp, 1) if total_imp > 0 else 0.0
        top = sorted(query_list, key=lambda x: x["impressions"], reverse=True)[:20]
        return {"clicks": total_clicks, "impressions": total_imp, "ctr": ctr,
                "position": pos, "query_count": len(query_list), "top_queries": top}

    return {"branded": summarize(branded), "non_branded": summarize(non_branded)}


def _url_path(url):
    """Extract lowercase path from a full URL or path string."""
    try:
        path = urllib.parse.urlparse(url).path
    except Exception:
        path = url
    return path.rstrip("/").lower() or "/"


def cluster_page_groups(pages, groups=None):
    """Group pages by URL path pattern. Returns per-group aggregate stats sorted by clicks.
    pages: list of dicts with 'page', 'clicks', 'impressions', 'ctr', 'position' keys."""
    patterns = groups or DEFAULT_PAGE_GROUPS
    buckets = {name: {"clicks": 0, "impressions": 0, "pos_weighted": 0.0, "count": 0}
               for name, _ in patterns}
    buckets["other"] = {"clicks": 0, "impressions": 0, "pos_weighted": 0.0, "count": 0}

    for p in pages:
        path = _url_path(p["page"])
        group = "other"
        for name, pattern in patterns:
            if re.search(pattern, path):
                group = name
                break
        imp = p["impressions"]
        buckets[group]["clicks"] += p["clicks"]
        buckets[group]["impressions"] += imp
        buckets[group]["pos_weighted"] += p["position"] * imp
        buckets[group]["count"] += 1

    results = []
    for name, b in buckets.items():
        if b["count"] == 0:
            continue
        imp = b["impressions"]
        ctr = round(b["clicks"] / imp * 100, 2) if imp > 0 else 0.0
        pos = round(b["pos_weighted"] / imp, 1) if imp > 0 else 0.0
        results.append({"group": name, "page_count": b["count"],
                        "clicks": b["clicks"], "impressions": imp, "ctr": ctr, "position": pos})

    results.sort(key=lambda x: x["clicks"], reverse=True)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True, help="GSC property URL")
    parser.add_argument("--days", type=int, default=90, help="Days of data to pull")
    parser.add_argument("--brand-terms", default="",
                        help="Comma-separated brand names for branded vs non-branded split, e.g. 'Acme,AcmeCorp'")
    _default_out = os.path.join(tempfile.gettempdir(), f"gsc_analysis_{portable_uid()}.json")
    parser.add_argument("--output", default=_default_out, help="Output file")
    args = parser.parse_args()
    brand_terms = [t.strip() for t in args.brand_terms.split(",") if t.strip()]

    print(f"Pulling {args.days} days of GSC data for: {args.site}", file=sys.stderr)

    token = get_access_token()
    start, end = date_range(args.days)

    # All GSC calls are independent — run them concurrently to cut wall-clock
    # time from ~9 sequential round-trips down to the slowest single call.
    tasks = {
        "summary":    lambda: pull_summary(token, args.site, start, end),
        "queries":    lambda: pull_top_queries(token, args.site, start, end),
        "pages":      lambda: pull_top_pages(token, args.site, start, end),
        "buckets":    lambda: pull_position_buckets(token, args.site, start, end),
        "comparison": lambda: pull_period_comparison(token, args.site, 28),
        "devices":    lambda: pull_device_split(token, args.site, start, end),
        "countries":  lambda: pull_country_split(token, args.site, start, end),
        "search_types": lambda: pull_search_type_split(token, args.site, start, end),
        "qp_rows":    lambda: pull_query_page_rows(token, args.site, start, end),
    }

    results = {}
    print(f"Fetching {len(tasks)} data sets in parallel...", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = {pool.submit(fn): name for name, fn in tasks.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                results[name] = future.result()
                print(f"  ✓ {name}", file=sys.stderr)
            except Exception as exc:
                print(f"  ✗ {name}: {exc}", file=sys.stderr)
                results[name] = {}

    summary    = results["summary"]
    queries    = results["queries"]
    pages      = results["pages"]
    buckets    = results["buckets"]
    comparison = results["comparison"]
    devices    = results["devices"]
    countries  = results["countries"]
    search_types = results["search_types"]
    qp_rows    = results["qp_rows"]

    cannibalization   = derive_cannibalization(qp_rows)
    ctr_gaps_by_page  = derive_ctr_gaps_by_page(qp_rows)

    # High-impression, low-CTR queries (query-level, for quick title/snippet targeting)
    ctr_opportunities = [
        q for q in queries
        if q["impressions"] > 500 and q["ctr"] < 3.0 and q["position"] <= 20
    ]
    ctr_opportunities.sort(key=lambda x: x["impressions"], reverse=True)

    print("Deriving branded/non-branded split...", file=sys.stderr)
    branded_split = derive_branded_split(qp_rows, brand_terms)

    print("Clustering pages by section...", file=sys.stderr)
    page_groups = cluster_page_groups(pages)

    result = {
        "site": args.site,
        "period": {"start": start, "end": end, "days": args.days},
        "summary": summary,
        "top_queries": queries[:30],
        "top_pages": pages[:30],
        "position_buckets": {
            k: sorted(v, key=lambda x: x["impressions"], reverse=True)[:20]
            for k, v in buckets.items()
        },
        "ctr_opportunities": ctr_opportunities[:20],
        "ctr_gaps_by_page": ctr_gaps_by_page,
        "cannibalization": cannibalization,
        "comparison": comparison,
        "device_split": devices,
        "country_split": countries,
        "search_type_split": search_types,
        "branded_split": branded_split,
        "page_groups": page_groups
    }

    secure_write_json(args.output, result)

    print(f"\nDone. Results saved to {args.output}", file=sys.stderr)
    print(f"\nSummary: {summary['clicks']:,} clicks | {summary['impressions']:,} impressions | "
          f"CTR {summary['ctr']}% | Avg position {summary['position']}", file=sys.stderr)
    if cannibalization:
        print(f"Cannibalization: {len(cannibalization)} queries with competing pages found", file=sys.stderr)
    if search_types:
        type_summary = ", ".join(f"{t['type']}={t['clicks']:,}" for t in search_types)
        print(f"Search types: {type_summary}", file=sys.stderr)


if __name__ == "__main__":
    main()
