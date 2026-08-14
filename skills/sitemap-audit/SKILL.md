---
name: sitemap-audit
argument-hint: "<website URL or sitemap URL, e.g. https://example.com or https://example.com/sitemap.xml>"
description: >
  XML sitemap audit — find and fix the sitemap problems that quietly waste crawl
  budget and slow indexing. Discovers the sitemap (robots.txt, /sitemap.xml,
  sitemap index), validates structure and size limits, and cross-checks the URLs
  it lists against reality: non-200 / redirected / noindex / canonicalized-away
  URLs that shouldn't be in a sitemap, plus indexable pages that are missing from
  it. Reviews lastmod accuracy, sitemap-index organization, and robots.txt
  reference. Use this skill whenever the user asks about sitemaps, sitemap errors
  in Search Console, "sitemap couldn't fetch / has errors", crawl budget, pages
  not getting indexed, or whether their sitemap is clean. Trigger on: "sitemap",
  "sitemap.xml", "XML sitemap", "sitemap errors", "sitemap audit", "couldn't
  fetch sitemap", "crawl budget", "pages not indexed sitemap", "sitemap index",
  "lastmod", "robots.txt sitemap", or any sitemap/crawl-coverage question. For a
  full-site SEO audit use /seo-analysis; for broken links use /broken-link-checker.
---

# Canonical NotFair workflow

Read [`../../seo/sitemap-audit/SKILL.md`](../../seo/sitemap-audit/SKILL.md) completely, then follow it as the active workflow. Resolve every relative reference from that file against `../../seo/sitemap-audit/`.
