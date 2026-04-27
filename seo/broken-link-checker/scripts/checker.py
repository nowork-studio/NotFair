#!/usr/bin/env python3
"""
Broken Link Checker for Toprank.
Crawls a website starting from a given URL and identifies broken links (HTTP 4xx/5xx).

Usage:
  python3 checker.py --url https://example.com --max-pages 50
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque
from html.parser import HTMLParser


class LinkParser(HTMLParser):
    def __init__(self, base_url):
        super().__init__()
        self.base_url = base_url
        self.links = set()

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            for attr, value in attrs:
                if attr == 'href':
                    # Use urljoin to handle relative links and then urldefrag to remove fragments
                    url = urllib.parse.urljoin(self.base_url, value)
                    url = urllib.parse.urldefrag(url)[0]
                    if url.startswith('http'):
                        self.links.add(url)


def check_url(url, timeout=10):
    """Checks a URL and returns (status_code, error_msg)."""
    headers = {'User-Agent': 'ToprankBrokenLinkChecker/1.0'}

    # Try HEAD first for efficiency
    req = urllib.request.Request(url, method='HEAD', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.getcode(), None
    except urllib.error.HTTPError as e:
        # Many servers block HEAD, fall back to GET for accuracy
        if e.code in (403, 405, 501):
            req = urllib.request.Request(url, method='GET', headers=headers)
            try:
                # We only need the headers/status, so we don't read the body here
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    return response.getcode(), None
            except urllib.error.HTTPError as e2:
                return e2.code, str(e2.reason)
            except Exception as e2:
                return None, str(e2)
        return e.code, str(e.reason)
    except urllib.error.URLError as e:
        return None, str(e.reason)
    except Exception as e:
        return None, str(e)


def crawl(start_url, max_pages=50):
    parsed_start = urllib.parse.urlparse(start_url)
    domain = parsed_start.netloc

    # Robots.txt check
    rp = urllib.robotparser.RobotFileParser()
    try:
        rp.set_url(urllib.parse.urljoin(start_url, '/robots.txt'))
        rp.read()
    except Exception as e:
        print(f"Warning: Could not read robots.txt: {e}", file=sys.stderr)
        # Default to allowing if robots.txt is missing or unreachable
        rp = None

    visited = set()
    queue = deque([start_url])
    broken_links = []
    pages_crawled = 0

    print(f"Starting crawl of {start_url} (limit: {max_pages} pages)...", file=sys.stderr)

    while queue and pages_crawled < max_pages:
        current_url = queue.popleft()
        if current_url in visited:
            continue

        # Check robots.txt Disallow
        if rp and not rp.can_fetch("ToprankBrokenLinkChecker/1.0", current_url):
            print(f"Skipping (blocked by robots.txt): {current_url}", file=sys.stderr)
            continue

        visited.add(current_url)
        pages_crawled += 1

        print(f"[{pages_crawled}/{max_pages}] Checking: {current_url}", file=sys.stderr)

        try:
            req = urllib.request.Request(current_url, headers={'User-Agent': 'ToprankBrokenLinkChecker/1.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                status = response.getcode()
                if status >= 400:
                    broken_links.append({"url": current_url, "status": status, "reason": "Page itself is broken"})
                    continue

                content_type = response.headers.get('Content-Type', '')
                if 'text/html' not in content_type:
                    continue

                html = response.read().decode('utf-8', errors='ignore')
                parser = LinkParser(current_url)
                parser.feed(html)

                found_links = list(parser.links)
                with ThreadPoolExecutor(max_workers=5) as executor:
                    future_to_url = {executor.submit(check_url, link): link for link in found_links}
                    for future in as_completed(future_to_url):
                        link = future_to_url[future]
                        try:
                            link_status, reason = future.result()
                        except Exception as e:
                            link_status, reason = None, str(e)

                        if link_status is None or link_status >= 400:
                            broken_links.append({
                                "source": current_url,
                                "target": link,
                                "status": link_status,
                                "reason": reason
                            })

                        # Add internal links to queue
                        if urllib.parse.urlparse(link).netloc == domain and link not in visited:
                            queue.append(link)

        except Exception as e:
            print(f"Error crawling {current_url}: {e}", file=sys.stderr)
            broken_links.append({"url": current_url, "status": None, "reason": str(e)})

    return broken_links


def main():
    parser = argparse.ArgumentParser(description="Broken Link Checker")
    parser.add_argument("--url", required=True, help="Starting URL")
    parser.add_argument("--max-pages", type=int, default=50, help="Maximum pages to crawl")
    parser.add_argument("--output", help="Output JSON file")

    args = parser.parse_args()

    broken = crawl(args.url, args.max_pages)

    result = {
        "start_url": args.url,
        "max_pages": args.max_pages,
        "broken_links_count": len(broken),
        "broken_links": broken
    }

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(result, f, indent=2)
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
