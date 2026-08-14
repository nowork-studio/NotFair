---
name: paid-ads-integrations
description: Discover, connect, and verify NotFair paid-ad integrations and their actual capabilities. Use when asked to connect an ad account, configure an ads MCP, check available tools, troubleshoot access, or determine whether NotFair can read or change a platform.
argument-hint: "<platform or connection issue>"
---

# Paid Ads Integrations

Read `../shared/operating-contract.md`. Treat tool discovery as the source of truth; product documentation describes intent, not the current session's authorization.

## Verify before promising

1. Inspect the available tool list. On the universal NotFair MCP, call `listConnectedPlatforms` first. Use the Google or Meta shared preamble when that surface is requested; for X Ads and LinkedIn Ads, resolve the platform-prefixed tools and require a harmless account/setup read before claiming access.
2. Confirm OAuth/account access with a harmless account-list or read operation when the connector exposes one.
3. Record the exact platform, selected account, accessible date range, and whether the surface is read-only or mutation-capable.
4. If authorization fails, state the error and give the documented connection path. Do not retry a destructive operation or fall back to another account.

## Capability map

| Platform | NotFair path | Safe response when unavailable |
|---|---|---|
| Google Ads | Universal NotFair MCP `google_ads_` tools; use the Google shared preamble | Connect/re-authenticate, then use the Google skills |
| Meta Ads | Universal NotFair MCP `meta_ads_` tools; use the Meta shared preamble | Connect/re-authenticate, then use the Meta skills |
| X Ads | Universal NotFair MCP `x_ads_` tools; resolve `~~x-ads` | Connect/re-authenticate, then use `/notfair:paid-ads-x` |
| LinkedIn Ads | Universal NotFair MCP `linkedin_ads_` tools; resolve `~~linkedin-ads` | Connect/re-authenticate, then use `/notfair:paid-ads-linkedin` |
| TikTok, Amazon, ChatGPT Ads | No first-party NotFair surface declared by this plugin | Request a verified connector or export; stay plan/review-only |

Never invent a router, endpoint, tool name, account ID, or platform capability. Quote prices, quotas, and platform eligibility only from current official documentation when a user asks; do not infer them from a plan or another connector.
