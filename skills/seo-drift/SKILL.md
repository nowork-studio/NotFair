---
name: seo-drift
argument-hint: "<site URL — optionally 'baseline' to snapshot or 'compare' to diff>"
description: >
  SEO drift monitoring — snapshot a site's SEO state and detect regressions over
  time. Captures a baseline (rankings/positions, indexed page count, titles & meta
  descriptions, canonical/robots directives, schema presence, key on-page
  elements) and on later runs diffs against it to surface what changed: ranking
  drops, pages that fell out of the index, titles/metas that were accidentally
  overwritten (a CMS/redeploy classic), canonicals or noindex flipped, schema that
  disappeared. Use this skill when the user wants to monitor SEO over time, catch
  regressions after a site change / migration / redeploy, set a baseline, diff
  against a previous state, or asks "what changed on my site's SEO" or "did my
  redesign break SEO". Trigger on: "SEO drift", "SEO monitoring", "track SEO over
  time", "did my site change break SEO", "after migration SEO", "SEO regression",
  "baseline my SEO", "compare SEO to last month", "my titles changed", "pages fell
  out of the index". For a one-time full audit use /seo-analysis.
---

# Canonical NotFair workflow

Read [`../../seo/seo-drift/SKILL.md`](../../seo/seo-drift/SKILL.md) completely, then follow it as the active workflow. Resolve every relative reference from that file against `../../seo/seo-drift/`.
