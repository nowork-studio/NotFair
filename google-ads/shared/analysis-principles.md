# Analysis Principles

These principles apply to every Google Ads skill. The references in each skill provide domain knowledge to draw from — these principles govern how you reason and what crosses the bar to land in front of the user.

## Evidence is the bar

Every claim or recommendation must cite specific data **from this account**:

- Name the entity (campaign, ad group, keyword, search term, asset).
- Cite the dollar amount, the metric value, and the time window.
- If you don't have the data to support a claim, pull it before making the claim. "Industry typically shows X" is not evidence — find the matching number in this account or drop the claim.
- When recommending an action, separately show the data that *would falsify* the recommendation if it existed. ("This keyword has 0 conversions in 47 clicks over 30 days, against an account-average CVR of 4.2% — expected ~2 conversions, observed 0.")
- "Looks low" / "seems high" / "could be improved" without a number is a draft, not a finding. Pull the number or cut the bullet.

When the data is too thin to support a recommendation, say so explicitly and propose what would need to be true for the recommendation to hold. Don't paper over uncertainty.

## High-level approach (you decide the specifics)

Trust your own diagnostic judgment on tool sequencing, GAQL shape, and which surfaces to correlate. You know how to use `runScript` + `ads.gaqlParallel` to fan out, and the MCP server's playbooks (`adsagent://playbooks/*`) give you battle-tested starting queries. Lean on them; deviate when the question warrants. The references in each skill are calibration data when you need an anchor — not mandatory reading or decision trees to follow step by step.

What does need to be true on every analysis:

1. **Pull broad first, narrow in script.** One wide `runScript` fan-out beats five narrow round trips. Filter, rank, and aggregate inside the sandbox; return summarized JSON.
2. **Correlate, don't isolate.** A keyword's CPA is not a finding by itself; tie it to QS components, search terms, ad copy, landing page, and impression-share context before you call something a problem.
3. **Verify before mutating.** Read the current value; show the proposed value; show the expected impact in dollars when computable. Get a yes, then write.

## Guardrails (do not violate)

- **STOP if conversion tracking is broken.** If conversion tracking is misconfigured, missing, or in a clearly broken state, every downstream optimization is built on lies. Surface this first; recommend pausing spend until it is fixed; do not build optimization plans on top of unreliable measurement.
- **Never pause a Tier 1 (core business) keyword on short-window data.** A keyword that names what the business sells — confirmed against campaign/ad-group naming, ad copy, and landing pages — does not get paused for two bad weeks. Diagnose root cause (QS subcomponents, match-type, landing page, intent mismatch) instead.
- **Statistical significance gate.** Before any conversion-based decision, check whether the keyword has accumulated enough clicks for the account's CVR to predict conversions ≥ 3. If not, the sample is insufficient — say so and skip the conversion-based decision.
- **Reads correlate, writes commit.** Read-only analysis goes through `runScript` with `ads.gaql`/`ads.gaqlParallel`. Mutations go through dedicated write tools — never wrap a write in `runScript`.
- **Server-side limits are real.** Bid changes >25% per call and budget changes >50% per call are rejected by the server. Don't try to bypass them; split the change across days or ask the user.
- **Every write is undoable for 7 days** via `undoChange` and the returned `changeId`. Tell the user, and log the change per `manage/references/change-tracking.md`.
- **`moveKeywords` defaults to PHRASE match** and does not inherit from the source — always pass `matchType` explicitly so exact-match keywords don't silently downgrade.
- **Confirm before any bulk write.** Bulk operations (`bulkAddKeywords`, `bulkPauseKeywords`, `bulkUpdateBids`) touch many entities; show the count, the breakdown, and the dollar impact before executing.

## When you're unsure

- Surface uncertainty in the report. Better to say "thin data" than to invent a verdict.
- Ask the user one targeted question if it would change the recommendation materially. Don't ask for context the data already gives you.
- If a recommendation depends on business context (margin, AOV, peak season, competitive set) and that context is missing or stale, name what's missing and offer `/google-ads-audit` to populate it.
