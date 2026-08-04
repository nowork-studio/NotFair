---
name: google-ads-assets
description: Plan, validate, and safely publish Google Ads assets, including sitelinks, callouts, structured snippets, image assets, and Performance Max asset briefs. Use when asked for Google Ads assets, ad extensions, sitelinks, callouts, snippets, image assets, Performance Max assets, PMax creative, or an asset audit.
argument-hint: "<campaign, asset group, or 'build an asset brief'>"
---

# Google Ads Asset Planner

Turn approved business evidence into an asset manifest that can be reviewed and, only where the connected MCP supports it, published safely.

## Setup

Read and follow `../shared/preamble.md` and `../shared/analysis-principles.md`. Read `{data_dir}/business-context.json` and `{data_dir}/personas/{accountId}.json` before proposing assets. If either is missing or stale, hand off to `/google-ads-audit`; an ungrounded asset pack is generic inventory.

Read `../shared/policy-registry.json` before PMax or policy-sensitive work. If its PMax entry is stale, verify the relevant Google policy or platform requirement before stating a current rule.

## Build from evidence, not filler

Pull the existing campaign, ad group, and asset coverage with `runScript` before recommending new assets. Use search terms, converting ads, landing-page content, approved offers, and customer language as source material. Do not infer ratings, pricing, guarantees, availability, or product attributes.

For each proposed asset, produce this reviewable manifest:

| Field | Required content |
|---|---|
| Asset family | Callout, sitelink, structured snippet, image, or PMax brief |
| Scope | Account, campaign, ad group, or named PMax asset group |
| Concept ID | Persona × motivation × angle |
| Copy or creative direction | Exact approved text, or a production-ready visual brief |
| Evidence and claim status | Source for every factual claim; mark unsupported claims `needs_substantiation` |
| Landing destination | Final URL and message-match note when applicable |
| Status | `ready_for_review`, `blocked`, or `approved_to_publish` |

Keep the brief deliberately varied: each concept should test a different motivation or visual hook, not a cosmetic rewrite. Ask for missing proof instead of inventing it.

## Platform-aware execution

- Validate copy and destination fields against the current connected tool metadata before creating anything. Do not trust memorized limits or silently truncate assets.
- Only create/link callouts, sitelinks, structured snippets, or image assets after the user approves the exact manifest. Use dedicated mutation tools, record the returned `changeId`, and read back the resulting entity.
- Verify image ownership, landing-page rights, and policy-sensitive claims before an image asset is uploaded. A generated image is a production input, not proof that the claim in it is allowed.
- The current NotFair MCP surface can create/link supported asset-library types and can enable or pause PMax asset groups. It does **not** establish that it can compose or edit a PMax asset group. Check `tools/list` before promising that operation; otherwise deliver the PMax brief for completion in Google Ads.

## PMax brief

For a PMax request, produce a cross-placement production brief rather than a generic list of slogans:

1. State the product or feed scope, conversion goal, audience signal, and landing destination.
2. Provide 3–5 concept cards, each with a visual hook, on-screen message, proof source, CTA, and placement-safe adaptation notes.
3. Identify the missing inputs explicitly: approved logo, image/video source files, feed readiness, rights, or substantiation.
4. Keep Search RSA language complementary to PMax text assets; avoid duplicating the same promise without a reason.
5. Flag PMax/Search overlap and brand-exclusion questions for `/google-ads` before scaling.

## Guardrails

1. Never publish an unsupported claim, a destination you did not validate, or an asset with unknown rights.
2. Never call a production brief an uploaded asset. Separate `ready_for_review` from `published`.
3. Confirm scope and exact asset count before every write; mutations must be reversible through `undoChange` where supported.
4. Defer bid, budget, keyword, and campaign-structure changes to `/google-ads`; defer RSA testing to `/google-ads-copy`.
