---
name: paid-ads-guide
description: Explain NotFair's paid-ads skills, installation, platform boundaries, account connections, and current product capabilities. Use for questions about how NotFair works, what it supports, how to install or connect it, plans or limits, or paid-media troubleshooting that is not an account-performance request.
argument-hint: "<installation, capability, connection, or product question>"
---

# NotFair Paid Ads Guide

Answer NotFair product questions from the repository documentation or current official NotFair documentation, never from stale memory. This skill explains the product; use `/notfair:paid-ads-integrations` for the current session's actual connector and account access.

## Answer from the right source

| Question | Source of truth |
|---|---|
| Plugin install, skill catalog, current documented connectors, and operating boundaries | Repository `README.md` and `AGENTS.md` |
| Current session's available tools, OAuth state, and selected accounts | `/notfair:paid-ads-integrations` plus the platform shared preamble |
| Product pricing, quotas, current eligibility, or platform policies | The current official page or platform documentation; do not quote a number from memory |
| A performance, campaign, or optimization question | Route to `/notfair:paid-ads`, `/notfair:google-ads`, or `/notfair:meta-ads` |

## Essential facts

NotFair supplies host-agnostic skills plus first-party MCP operating surfaces for Google Ads and Meta Ads. Google and Meta can use their dedicated NotFair workflows after OAuth connection. LinkedIn, TikTok, Amazon, and ChatGPT Ads skills are intentionally planning/review-first until the session has a verified connector; they are not a claim of publication access.

The goal-loop app makes an outcome measurable, verifies the baseline at the source, and revisits the metric on an approved cadence. The plugin is the hands-on companion for audits, briefs, and supported account operations. Explain the safety boundary plainly: an approved plan is not a live campaign, and a brief is not a published asset.

When installation is requested, direct the user to the README's plugin install steps. When a connector is missing or unauthorized, use the appropriate platform preamble and stop at the connection CTA rather than inventing a workaround.
