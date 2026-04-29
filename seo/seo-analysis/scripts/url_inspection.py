#!/usr/bin/env python3
"""
Run the Google Search Console URL Inspection API on a list of URLs.
Outputs structured JSON for the seo-analysis skill to process.

The URL Inspection API returns per-page: indexing status, mobile usability verdict,
rich result status, last crawl time, referring sitemaps, and coverage state.

Required OAuth scope: https://www.googleapis.com/auth/webmasters
(Not just webmasters.readonly — URL Inspection requires the broader scope.)

Usage:
  python3 url_inspection.py --site "sc-domain:example.com" \
    --urls "https://example.com/,https://example.com/pricing"

  python3 url_inspection.py --site "https://example.com/" \
    --urls-file /tmp/urls.txt

  python3 url_inspection.py --site "sc-domain:example.com" \
    --urls "https://example.com/,https://example.com/blog" \
    --output /tmp/inspection_results.json
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

from _uid import portable_uid, secure_write_json


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
        print("ERROR: gcloud not found. Install it from https://cloud.google.com/sdk/docs/install",
              file=sys.stderr)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("ERROR: gcloud timed out after 15s.", file=sys.stderr)
        sys.exit(1)

    if result.returncode != 0:
        print("ERROR: Not authenticated. Run:", file=sys.stderr)
        print("  gcloud auth application-default login \\", file=sys.stderr)
        print("    --scopes=https://www.googleapis.com/auth/webmasters,"
              "https://www.googleapis.com/auth/webmasters.readonly", file=sys.stderr)
        sys.exit(1)

    token = result.stdout.strip()
    if not token:
        print("ERROR: gcloud returned an empty token.", file=sys.stderr)
        sys.exit(1)
    return token


def inspect_url(token, site_url, inspection_url):
    """Call the URL Inspection API for one URL. Returns the raw API response dict."""
    endpoint = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
    body = json.dumps({
        "inspectionUrl": inspection_url,
        "siteUrl": site_url
    }).encode()

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    quota_project = get_quota_project()
    if quota_project:
        headers["x-goog-user-project"] = quota_project
    req = urllib.request.Request(endpoint, data=body, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        if e.code == 403:
            return None, (
                f"403 Forbidden for {inspection_url}. "
                "The URL Inspection API requires the broader 'webmasters' OAuth scope "
                "(not just 'webmasters.readonly'). Re-authenticate with:\n"
                "  gcloud auth application-default login \\\n"
                "    --scopes=https://www.googleapis.com/auth/webmasters,"
                "https://www.googleapis.com/auth/webmasters.readonly"
            )
        return None, f"HTTP {e.code} for {inspection_url}: {err_body[:200]}"
    except urllib.error.URLError as e:
        return None, f"Network error for {inspection_url}: {e.reason}"


def normalize_site_url_for_inspection(site_url, url):
    """
    For domain properties (sc-domain:example.com), the inspectionUrl must be
    an absolute URL. For URL-prefix properties, it must start with the prefix.
    If the caller passes a path like '/pricing', resolve it against the site URL.
    """
    if url.startswith("http://") or url.startswith("https://"):
        return url

    # Strip the sc-domain: prefix to get the bare domain
    if site_url.startswith("sc-domain:"):
        domain = site_url[len("sc-domain:"):]
        return f"https://{domain.rstrip('/')}{url}"
    else:
        base = site_url.rstrip("/")
        return f"{base}{url}"


def _as_dict(value):
    return value if isinstance(value, dict) else {}


def _as_list(value):
    return value if isinstance(value, list) else []


def parse_inspection_result(raw, url):
    """Extract the fields we care about from the API response."""
    ir = _as_dict(_as_dict(raw).get("inspectionResult"))

    # Index status
    index_result = _as_dict(ir.get("indexStatusResult"))
    indexing_state = index_result.get("coverageState", "UNKNOWN")
    verdict = index_result.get("verdict", "UNKNOWN")
    last_crawl = index_result.get("lastCrawlTime", None)
    referring_sitemaps = _as_list(index_result.get("referringSitemaps"))
    crawled_as = index_result.get("crawledAs", None)
    google_canonical = index_result.get("googleCanonical", None)
    user_canonical = index_result.get("userDeclaredCanonical", None)
    page_fetch_state = index_result.get("pageFetchState", None)
    robots_txt_state = index_result.get("robotsTxtState", None)
    indexing_state_value = index_result.get("indexingState", None)

    # Mobile usability
    mobile_result = _as_dict(ir.get("mobileUsabilityResult"))
    mobile_verdict = mobile_result.get("verdict", "VERDICT_UNSPECIFIED")
    mobile_issues = [
        issue.get("issueType", "UNKNOWN")
        for issue in _as_list(mobile_result.get("issues"))
        if isinstance(issue, dict)
    ]

    # Rich results
    rich_result = _as_dict(ir.get("richResultsResult"))
    rich_verdict = rich_result.get("verdict", "VERDICT_UNSPECIFIED")
    rich_items = []
    for item in _as_list(rich_result.get("detectedItems")):
        if not isinstance(item, dict):
            continue
        for ri in _as_list(item.get("items")):
            if not isinstance(ri, dict):
                continue
            item_entry = {
                "name": ri.get("name", ""),
                "issues": [
                    issue.get("issueMessage", "")
                    for issue in _as_list(ri.get("issues"))
                    if isinstance(issue, dict)
                ]
            }
            rich_items.append(item_entry)

    return {
        "url": url,
        "index_status": {
            "verdict": verdict,
            "coverage_state": indexing_state,
            "last_crawl_time": last_crawl,
            "crawled_as": crawled_as,
            "indexing_state": indexing_state_value,
            "page_fetch_state": page_fetch_state,
            "robots_txt_state": robots_txt_state,
            "referring_sitemaps": referring_sitemaps,
            "google_canonical": google_canonical,
            "user_declared_canonical": user_canonical,
        },
        "mobile_usability": {
            "verdict": mobile_verdict,
            "issues": mobile_issues
        },
        "rich_results": {
            "verdict": rich_verdict,
            "detected_items": rich_items
        }
    }


def summarize_findings(results):
    """Produce a high-level summary flags for easy parsing by the skill."""
    not_indexed = [r for r in results if r.get("index_status", {}).get("verdict") not in ("PASS", "NEUTRAL", "VERDICT_UNSPECIFIED")]
    mobile_issues = [r for r in results if r.get("mobile_usability", {}).get("verdict") not in ("MOBILE_FRIENDLY", "VERDICT_UNSPECIFIED")]
    rich_errors = [r for r in results if r.get("rich_results", {}).get("verdict") == "FAIL"]
    no_sitemaps = [r for r in results if not r.get("index_status", {}).get("referring_sitemaps")]

    import datetime
    stale_crawl = []
    for r in results:
        lc = r.get("index_status", {}).get("last_crawl_time")
        if lc:
            try:
                crawl_dt = datetime.datetime.fromisoformat(lc.replace("Z", "+00:00"))
                now = datetime.datetime.now(datetime.timezone.utc)
                days_since = (now - crawl_dt).days
                if days_since > 60:
                    stale_crawl.append({
                        "url": r["url"],
                        "last_crawl_time": lc,
                        "days_since_crawl": days_since
                    })
            except (ValueError, TypeError):
                pass

    return {
        "total_urls_inspected": len(results),
        "not_indexed_count": len(not_indexed),
        "mobile_issues_count": len(mobile_issues),
        "rich_result_errors_count": len(rich_errors),
        "no_sitemap_count": len(no_sitemaps),
        "stale_crawl_count": len(stale_crawl),
        "not_indexed_urls": [r["url"] for r in not_indexed],
        "mobile_issue_urls": [r["url"] for r in mobile_issues],
        "rich_error_urls": [r["url"] for r in rich_errors],
        "stale_crawl_urls": stale_crawl
    }


def main():
    parser = argparse.ArgumentParser(
        description="Run GSC URL Inspection API on a list of URLs."
    )
    parser.add_argument("--site", required=True,
                        help="GSC property (sc-domain:example.com or https://example.com/)")
    parser.add_argument("--urls",
                        help="Comma-separated list of URLs to inspect")
    parser.add_argument("--urls-file",
                        help="File with one URL per line")
    parser.add_argument("--max-urls", type=int, default=5,
                        help="Maximum number of URLs to inspect (API limit: 2000/day). Default: 5")
    _default_out = os.path.join(tempfile.gettempdir(),
                                f"url_inspection_{portable_uid()}.json")
    parser.add_argument("--output", default=_default_out,
                        help="Output JSON file path")
    parser.add_argument("--delay", type=float, default=0.1,
                        help="Seconds between concurrent API calls to avoid rate limiting. Default: 0.1")
    parser.add_argument("--concurrency", type=int, default=3,
                        help="Number of concurrent URL inspections. Default: 3")
    args = parser.parse_args()

    # Collect URLs
    urls = []
    if args.urls:
        urls.extend([u.strip() for u in args.urls.split(",") if u.strip()])
    if args.urls_file:
        with open(args.urls_file) as f:
            urls.extend([line.strip() for line in f if line.strip()])

    if not urls:
        print("ERROR: Provide --urls or --urls-file", file=sys.stderr)
        sys.exit(1)

    # Deduplicate and cap
    seen = set()
    deduped = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    urls = deduped[:args.max_urls]

    if len(deduped) > args.max_urls:
        print(f"Note: Capped at {args.max_urls} URLs (had {len(deduped)}). "
              f"Pass --max-urls N to inspect more.", file=sys.stderr)

    print(f"Inspecting {len(urls)} URLs for site: {args.site} "
          f"(concurrency={args.concurrency})", file=sys.stderr)

    token = get_access_token()

    # Normalize all URLs upfront
    absolute_urls = [normalize_site_url_for_inspection(args.site, u) for u in urls]

    results = []
    errors = []
    abort_403 = False

    def _inspect_one(absolute_url):
        time.sleep(args.delay)  # small stagger to avoid thundering herd
        return absolute_url, inspect_url(token, args.site, absolute_url)

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(_inspect_one, url): url for url in absolute_urls}
        for future in as_completed(futures):
            try:
                absolute_url, (raw, error) = future.result()
            except Exception as exc:
                absolute_url = futures[future]
                print(f"  ERROR [{absolute_url}]: unexpected error: {exc}", file=sys.stderr)
                errors.append({"url": absolute_url, "error": str(exc)})
                continue
            if error:
                print(f"  ERROR [{absolute_url}]: {error[:80]}", file=sys.stderr)
                errors.append({"url": absolute_url, "error": error})
                if "403" in str(error):
                    abort_403 = True
            else:
                parsed = parse_inspection_result(raw, absolute_url)
                results.append(parsed)
                verdict = parsed.get("index_status", {}).get("verdict", "UNKNOWN")
                mobile = parsed.get("mobile_usability", {}).get("verdict", "VERDICT_UNSPECIFIED")
                print(f"  ✓ {absolute_url} — Index: {verdict} | Mobile: {mobile}",
                      file=sys.stderr)

    if abort_403:
        print("\nOne or more 403 errors — URL Inspection requires 'webmasters' scope.",
              file=sys.stderr)
        print("Re-authenticate with the broader scope and retry:", file=sys.stderr)
        print("  gcloud auth application-default login \\", file=sys.stderr)
        print("    --scopes=https://www.googleapis.com/auth/webmasters,"
              "https://www.googleapis.com/auth/webmasters.readonly", file=sys.stderr)

    summary = summarize_findings(results)

    output = {
        "site": args.site,
        "inspected_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "summary": summary,
        "results": results,
        "errors": errors
    }

    secure_write_json(args.output, output)

    print(f"\nDone. Results saved to {args.output}", file=sys.stderr)
    print(f"Summary: {summary['total_urls_inspected']} inspected | "
          f"{summary['not_indexed_count']} not indexed | "
          f"{summary['mobile_issues_count']} mobile issues | "
          f"{summary['rich_result_errors_count']} rich result errors | "
          f"{summary['stale_crawl_count']} stale crawl",
          file=sys.stderr)

    if errors:
        print(f"\n{len(errors)} URL(s) failed inspection:", file=sys.stderr)
        for e in errors:
            print(f"  {e['url']}: {e['error'][:100]}", file=sys.stderr)


if __name__ == "__main__":
    main()
