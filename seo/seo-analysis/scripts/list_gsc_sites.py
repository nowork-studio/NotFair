#!/usr/bin/env python3
"""List all Google Search Console properties for the authenticated account."""

import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error

from _gcloud import adc_access_token, gcloud_run
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
        result = adc_access_token()
    except FileNotFoundError:
        print("ERROR: gcloud not found. Install it and authenticate:", file=sys.stderr)
        print("  https://cloud.google.com/sdk/docs/install", file=sys.stderr)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("ERROR: gcloud timed out after 15s. Check your network or gcloud installation.", file=sys.stderr)
        sys.exit(1)
    if result.returncode != 0:
        print("ERROR: Could not get access token. Run:", file=sys.stderr)
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


def list_sites(token):
    url = "https://searchconsole.googleapis.com/webmasters/v3/sites"
    headers = {"Authorization": f"Bearer {token}"}
    quota_project = get_quota_project()
    if quota_project:
        headers["x-goog-user-project"] = quota_project
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get("siteEntry", [])
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else "(no body)"
        print(f"ERROR {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"ERROR: Network failure: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    token = get_access_token()
    sites = list_sites(token)

    if not sites:
        print("No Search Console properties found for this account.")
        print("Make sure you're logged in with the right Google account.")
        sys.exit(0)

    print(f"Found {len(sites)} Search Console properties:\n")
    for i, site in enumerate(sites, 1):
        ptype = "Domain" if site["siteUrl"].startswith("sc-domain:") else "URL-prefix"
        level = site.get("permissionLevel", "unknown")
        print(f"  {i}. {site['siteUrl']}")
        print(f"     Type: {ptype} | Permission: {level}")

    # Also output as JSON for machine parsing
    sites_path = os.path.join(tempfile.gettempdir(), f"gsc_sites_{portable_uid()}.json")
    secure_write_json(sites_path, sites)
    print(f"\n(Full list saved to {sites_path})")


if __name__ == "__main__":
    main()
