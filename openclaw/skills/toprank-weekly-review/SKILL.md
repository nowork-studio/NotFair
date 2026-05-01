---
name: toprank-weekly-review
description: Run a weekly SEO review for one registered website, write audit artifacts, and choose the next best safe action.
metadata: { "openclaw": { "emoji": "📈", "homepage": "https://github.com/nowork-studio/toprank", "requires": { "bins": ["python3"] } } }
---

# Toprank Weekly Review

1. Read `{baseDir}/../../shared/adapter-rules.md`.
2. Read `{baseDir}/../../shared/artifact-contract.md`.
3. Read `{baseDir}/../../shared/policy.md`.
4. Read `{baseDir}/../../shared/recommendation-quality.md`.
5. Read `{baseDir}/../../../seo/shared/seo-best-practices.md` and use its MECE lanes to explain why the top action is the right kind of SEO work.
6. Resolve the target `site_id`; if no site was specified and multiple sites are active, run portfolio review first or ask the user which site to review.
7. Read and follow the canonical Toprank skill at `{baseDir}/../../../seo/seo-analysis/SKILL.md`.
8. Prefer the automated runner:
   - `python3 {baseDir}/../../bin/weekly_review.py <site_id-or-url>`
   - add `--gsc-property` if the site profile does not already contain one
   - add `--analysis-file` when testing against a saved GSC analysis JSON fixture
9. The runner will generate and persist the review artifacts automatically, including automatic deep-dive diagnostics for the top CTR/snippet/content opportunity when applicable.
10. Verify that the run wrote `audit.json`, `action-plan.json`, and `verification.json`, refreshed `latest-state.json`, and created queue items. The top proposal should include `best_practice_alignment` plus `deep_dive` with SERP, current snippet, above-the-fold, and zero-click checks before approval.
11. If runner stdout includes `user_message`, use it as the user-facing summary. If it includes `business_context_request`, explicitly ask those questions in chat; do not just report artifact paths or say business context is incomplete.
12. If the next action requires editing a site repo, CMS, publishing content, or opening a PR, stop and ask for approval before doing it. Missing business context blocks approval/editing, not investigation.

## Wrapper job

Use this as the default weekly loop for a single site.

Your job:
- load the site profile, goals, and latest state,
- run a fresh review using the canonical SEO analysis skill,
- identify the top three issues,
- prioritize exactly one next best action,
- write `audit.json`, `action-plan.json`, and `verification.json`.

When possible, also create a queue item for a 14-day or 28-day follow-up check.
