/**
 * Playbooks shipped as MCP resources — canonical `runScript` recipes for the
 * most common user asks. Clients that surface resources to the model can fetch
 * these to shortcut the "what GAQL do I write" step.
 *
 * Markdown is inlined as TS string constants so the bundler picks it up
 * with zero configuration (no outputFileTracing tweaks, no webpack loader).
 * Backticks inside the markdown are escaped as `\`` in the template literals.
 */

export interface Playbook {
  /** Canonical MCP resource URI — `notfair://playbooks/<slug>`. */
  uri: string;
  /** Short human name surfaced in `resources/list`. */
  name: string;
  /** One-line hook shown in the resource list. */
  description: string;
  /** Full markdown content served at `resources/read`. */
  content: string;
}

const ANALYST_MINDSET = `## Mindset: act like a careful, meticulous data scientist

Act like a careful, meticulous data scientist. Stress-test and verify every recommendation so it is robust and bullet-proof. **One gold-level recommendation is 1000× better than smoke.**

Before you tell the user to do anything:

1. **Reproduce the number from a second angle.** If you cite a CPA, recompute it from a different surface (campaign-level vs. account-level) and confirm they agree.
2. **Check the sample size.** Don't recommend pausing a keyword off 4 clicks. State the n alongside the metric, and call out when n is too small to be conclusive.
3. **Rule out trivial explanations first.** Date-range artifacts, conversion-lag, currency/micros conversion, status filters (paused vs. enabled), tracking gaps. If any of these could explain the finding, say so before recommending action.
4. **Quantify the impact.** "Pause this keyword → save ~$X/mo at current run-rate" beats "this keyword looks bad."
5. **Prefer one thoroughly-validated recommendation over a long list of maybes.** If you can't defend it under scrutiny, drop it.

If you are not sure, say "not sure" and fetch one more query — never paper over uncertainty with confident-sounding prose.

`;

const AUDIT_ACCOUNT = `# Audit a Google Ads account with runScript

Use this when the user asks anything like "audit my account", "how is my Google Ads doing", "what's working and what's not", "find wasted spend", "what should I fix today". The answer is almost always a single \`runScript\` call that fans out GAQL queries in parallel.

## The one-call pattern

\`ads.gaqlParallel\` takes \`[{name, query, limit?}, ...]\` and returns
\`{ [name]: GaqlReport }\`. It fails the whole call if any subquery errors.
Only pass \`{ partial: true }\` when you explicitly want \`{ error }\` entries
mixed with successful reports. Destructure by name, read \`.rows\`.

\`\`\`js
const { start, end } = ads.helpers.getDateRange(30);
const r = await ads.gaqlParallel([
  // 1. Account performance by campaign
  { name: "campaigns", query: \`
    SELECT campaign.id, campaign.name, campaign.status,
           metrics.cost_micros, metrics.conversions, metrics.clicks,
           metrics.impressions, metrics.ctr, metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.cost_micros DESC\` },
  // 2. Search terms for wasted-spend detection. Status filters target the live config
  // so terms in ad groups the user paused yesterday don't re-surface today (see rule 6).
  { name: "searchTerms", query: \`
    SELECT search_term_view.search_term, campaign.name, ad_group.name,
           metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM search_term_view
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND metrics.clicks > 5
      ORDER BY metrics.cost_micros DESC\`, limit: 200 },
  // 3. Zero-conversion keywords burning spend.
  // ad_group_criterion.negative = FALSE: keyword_view returns positives AND
  // ad-group negatives; without this filter, every negative matches conversions=0.
  // The three-level status filter is the stale-loop fix (rule 6): a keyword paused
  // yesterday is excluded the next time the audit runs — its 30-day spend would
  // otherwise keep it in the top-waste list until the window rolls off.
  { name: "zeroConvKw", query: \`
    SELECT ad_group_criterion.keyword.text, campaign.name, ad_group.name,
           ad_group_criterion.negative,
           metrics.cost_micros, metrics.clicks,
           ad_group_criterion.quality_info.quality_score
      FROM keyword_view
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_criterion.status = 'ENABLED'
        AND ad_group_criterion.negative = FALSE
        AND metrics.conversions = 0
        AND metrics.cost_micros > 0
      ORDER BY metrics.cost_micros DESC\`, limit: 100 },
  // 4. Recent account changes (Google's change_event, capped at 30 days)
  { name: "changes", query: ads.queries.changeEvents(start, end), limit: 50 }
]);

const campaigns = r.campaigns.rows ?? [];
const searchTerms = r.searchTerms.rows ?? [];
const zeroConvKw = r.zeroConvKw.rows ?? [];
const changes = r.changes.rows ?? [];

// Compute account CPA and flag wasted spend at 2x that threshold
const toDollars = (micros) => (micros || 0) / 1_000_000;
const totalSpend = campaigns.reduce((s, row) => s + toDollars(row.metrics.cost_micros), 0);
const totalConv = campaigns.reduce((s, row) => s + (row.metrics.conversions || 0), 0);
const accountCpa = totalConv > 0 ? totalSpend / totalConv : null;
const threshold = accountCpa ? accountCpa * 2 : Infinity;

const wastedKeywords = zeroConvKw
  .filter(row => toDollars(row.metrics.cost_micros) > threshold)
  .slice(0, 10);
const wastedSearchTerms = searchTerms
  .filter(row => row.metrics.conversions === 0 && row.metrics.clicks >= 10)
  .slice(0, 10);

return {
  accountCpa,
  totalSpend,
  totalConversions: totalConv,
  campaigns: campaigns.slice(0, 20),
  wastedKeywords,
  wastedSearchTerms,
  recentChanges: changes.slice(0, 20),
};
\`\`\`

One tool call. ~4 upstream queries. Everything correlated in-script. The agent then narrates the findings with real numbers.

## Rules of thumb

1. **Always fan out with \`ads.gaqlParallel\`** when you need more than one surface. Sequential \`ads.gaql\` calls inside the same runScript are wasteful.
2. **Filter in-script, not with SELECT *** — GAQL doesn't support \`SELECT *\`. List the fields you actually need.
3. **Cast a wide net on the first call.** If the user says "audit my account", assume they also want to see wasted spend, recent changes, and quality-score laggards — correlating them is free once the queries have run.
4. **One \`runScript\` call per user question.** If you catch yourself about to call runScript a second time for a related surface, stop and combine them.
5. **Use \`LAST_N_DAYS\`, \`LAST_7_DAYS\`, \`LAST_30_DAYS\`, \`THIS_MONTH\`, etc.** — the date literal shorthand is faster to write and read than computing bounds.
6. **Filter on current state for "what should I fix today" questions.** GAQL joins historical metrics with point-in-time config dimensions, so \`campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND ad_group_criterion.status = 'ENABLED'\` excludes entities the user already paused or removed — even on a 30-day metric window. Without these filters, yesterday's paused keyword re-surfaces every day until its spend rolls off the window (stale-recommendation loop). **Drop these filters only for historical analysis** ("why did CPA spike", "what changed last week", "show me the regression"), where a paused entity is part of the answer.

## Before you query an unfamiliar resource

Call \`getResourceMetadata('<resource_name>')\` once to see valid fields — saves a round-trip on "unknown field" errors. \`listQueryableResources\` returns every resource you can query.

## For targeted asks

Even when the user asks something narrow like "show me CPA by campaign for last 30 days", still use \`runScript\` — it's ONE call, ONE GAQL query, and the response is typed JSON the agent can format however it wants. No bespoke point-query tool needed.
`;

const EXPLAIN_REGRESSION = `# Explain a metric regression with runScript

Use this when the user asks "why did my CPA go up", "what happened to conversions last week", "ROAS tanked, what broke", or any "X is worse than it was" pattern. One \`runScript\` call correlates the timeseries + change events + waste surfaces in a single pass.

## The one-call pattern

\`ads.gaqlParallel\` takes \`[{name, query, limit?}, ...]\` and returns
\`{ [name]: GaqlReport }\`. It fails the whole call if any subquery errors.
Only pass \`{ partial: true }\` when you explicitly want \`{ error }\` entries
mixed with successful reports. Destructure by name, read \`.rows\`.

\`\`\`js
const { start, end } = ads.helpers.getDateRange(30);
const r = await ads.gaqlParallel([
  // 1. Account-wide daily timeseries (the shape of the regression)
  { name: "daily", query: \`
    SELECT segments.date, metrics.cost_micros, metrics.conversions,
           metrics.clicks, metrics.impressions
      FROM customer
      WHERE segments.date DURING LAST_30_DAYS\` },
  // 2. Per-campaign daily timeseries (which campaign moved)
  { name: "byCampaign", query: \`
    SELECT campaign.id, campaign.name, segments.date,
           metrics.cost_micros, metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY segments.date DESC\` },
  // 3. Recent changes — what was edited around the regression window
  { name: "changes", query: ads.queries.changeEvents(start, end), limit: 50 },
  // 4. New wasted search terms that emerged in the window
  { name: "wastedTerms", query: \`
    SELECT search_term_view.search_term, campaign.name,
           metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM search_term_view
      WHERE segments.date DURING LAST_14_DAYS
        AND metrics.conversions = 0
        AND metrics.clicks >= 10
      ORDER BY metrics.cost_micros DESC\`, limit: 50 }
]);

const daily = r.daily.rows ?? [];
const byCampaign = r.byCampaign.rows ?? [];
const changes = r.changes.rows ?? [];
const wastedTerms = r.wastedTerms.rows ?? [];

const toDollars = (m) => (m || 0) / 1_000_000;

// Split the account timeseries into two halves and compare CPA
const sorted = daily.slice().sort((a, b) => a.segments.date.localeCompare(b.segments.date));
const mid = Math.floor(sorted.length / 2);
const older = sorted.slice(0, mid);
const newer = sorted.slice(mid);
const cpa = (rows) => {
  const spend = rows.reduce((s, row) => s + toDollars(row.metrics.cost_micros), 0);
  const conv = rows.reduce((s, row) => s + (row.metrics.conversions || 0), 0);
  return conv > 0 ? spend / conv : null;
};

return {
  cpaOlder: cpa(older),
  cpaNewer: cpa(newer),
  dailyCounts: { older: older.length, newer: newer.length },
  byCampaign, // Agent sorts these client-side by delta
  recentChanges: changes.slice(0, 25),
  emergentWasteTerms: wastedTerms,
};
\`\`\`

Then the agent answers: (1) when the shift happened, (2) which campaigns moved the most, (3) which changes correlate with the cliff date, (4) whether new wasted spend explains it. One call, ~4 queries, complete diagnosis.

## How to present the finding

Lead with **when** and **how much**, then **what changed**, then **next action**. Example: "CPA doubled on 2026-04-18, driven by Campaign Brand (80% of the delta). That day, the bidding strategy flipped from TARGET_CPA to MAXIMIZE_CONVERSIONS — user alice@example.com. Revert with \`updateCampaignBidding\`."

If no changes correlate with the cliff date, say so plainly: "No account edits correlate with the shift. Likely external — check competitor bids, seasonality, or landing-page issues."

## Don't

- Don't blame the first change you see. Always check correlation with the cliff date.
- Don't call \`runScript\` multiple times for related surfaces — the fan-out above already covers them. Combining them IS the point.
`;

const RUN_EXPERIMENT = `# Run a Google Ads experiment (drafts & trials)

Use this when the user asks anything like "A/B test these ads", "compare TARGET_CPA vs MAX_CONV", "run an experiment on this campaign", "test a new bidding strategy", "split traffic between control and treatment", or "graduate the trial". The lifecycle has **two halves**: a sequence of dedicated MCP tools for **mutating** the experiment state, and \`runScript\` for **reading** experiment data and analyzing performance.

Do not write GAQL to mutate experiments — Google's API uses dedicated services that the runScript sandbox cannot reach. Use the tools listed below.

## When NOT to start an experiment

1. Campaign has fewer than ~30 conversions per week. Stat-significance windows on Google's experiment platform are 14–28 days; with low conversion volume you'll never reach significance.
2. The base campaign is itself paused or has spent <$0 in the last 7 days.
3. The user wants to test a Performance Max or Demand Gen change. Those have separate experiment flows that we don't yet expose.

## Lifecycle (5 mutating tool calls + 2 read passes)

\`\`\`
createExperiment        →  step 1: Experiment row in SETUP state
addExperimentArms       →  step 2: 1 control + 1 treatment, traffic_split sums to 100
                              ↳ returns inDesignCampaigns[0] — the trial campaign
[apply mutation under test on the trial campaign]
                              ↳ updateCampaignBidding | updateAd | addKeyword | etc.
scheduleExperiment      →  step 3: starts forking (long-running)
listExperimentAsyncErrors  →  step 4: confirm forking succeeded
[wait ≥ 14 days, monitor with runScript]
endExperiment | promoteExperiment | graduateExperiment   →  step 5
\`\`\`

### Step 1 — createExperiment

Type \`SEARCH_CUSTOM\` for any test that mutates a single search campaign — covering ad copy, keywords, landing pages, AND RSA-asset-level A/B tests. Type \`SEARCH_AUTOMATED_BIDDING_STRATEGY\` to compare bidding strategies on the same base campaign. For RSA-asset-level tests specifically, prefer the \`createAdVariationExperiment\` shortcut described below, which bundles steps 1–4 (create + arms + find cloned RSA + patch assets) into one call.

> Note: the proto exposes \`AD_VARIATION\` as a separate type, but no Google sample demonstrates it through \`ExperimentService.MutateExperiments\`, and the Help-Center-doc behavior of the Ad Variations UI (cross-campaign find/replace) doesn't fit \`experiment_arm.campaigns\` (max length 1). Stick with \`SEARCH_CUSTOM\` and patch the cloned RSA — the convenience tool does this for you.

Suffix defaults to \`[experiment]\` and is appended to the trial campaign name. End date should be **at least 14 days** after start.

### Step 2 — addExperimentArms (one atomic call)

Both arms in a single call — Google rejects incremental adds because traffic_split must sum to exactly 100. Exactly one arm has \`control: true\` and references the existing campaign you're comparing against. The treatment arm has Google auto-spawn a trial campaign — its resource name comes back as \`inDesignCampaigns[0]\`.

\`\`\`
{ name: "control", control: true,  trafficSplit: 50, campaignId: "<base campaign id>" }
{ name: "treatment", control: false, trafficSplit: 50 }
\`\`\`

### Critical step between 2 and 3 — apply the mutation under test

Until you mutate the trial campaign, control and treatment are identical and the experiment is meaningless. Take \`inDesignCampaigns[0]\` from the addExperimentArms response and call the appropriate write tool ON THAT CAMPAIGN ID:

- **Bidding test:** \`updateCampaignBidding\` on the trial campaign with the new strategy/target.
- **Ad copy test:** \`createAd\` (new RSA on the trial) or \`updateAdAssets\`.
- **Keyword test:** \`addKeyword\` / \`pauseKeyword\` on the trial.
- **Landing page test:** \`updateAdFinalUrl\` on the trial's ads.

Skipping this is the #1 cause of "experiment ran but nothing changed."

### Step 3 — scheduleExperiment

Returns immediately with an LRO operation name. Google forks the in-design campaign into a real serving campaign over the next 30–120 seconds.

### Step 4 — listExperimentAsyncErrors

ALWAYS call this 30–60 seconds after scheduleExperiment (and after promoteExperiment). An empty errors array means the LRO succeeded. A non-empty array means forking failed — the most common causes are an invalid budget on the base campaign, a conflicting bidding strategy, or a missing conversion action. Errors here do NOT show up in the scheduleExperiment response.

### Step 5 — choose how to conclude

- **endExperiment** — stop without applying any changes (the test was inconclusive or you don't want the changes).
- **promoteExperiment** — copy the treatment changes back to the base campaign, then stop the trial. Long-running, follow up with \`listExperimentAsyncErrors\`.
- **graduateExperiment** — keep the trial running as a permanent standalone campaign with its own budget. Provide the budget resource name; the tool resolves the trial campaign automatically.

## RSA-asset A/B testing: \`createAdVariationExperiment\`

Use this when the user asks "test a new headline", "A/B test this ad copy", "try a different landing page on this RSA", "compare 'Buy now' vs 'Buy today'", etc. Internally this is a \`SEARCH_CUSTOM\` experiment whose treatment-arm clone gets its RSA assets patched — same backend mechanism as a campaign-level test, just targeting an ad rather than the campaign. The shortcut bundles steps 1–4 of the lifecycle:

\`\`\`
createAdVariationExperiment({
  name: "RSA call-to-action test",
  baseCampaignId: "12345",
  baseAdGroupId: "67890",
  baseAdId: "11111",
  // Provide at least one of: headlines, descriptions, finalUrl.
  // RSA assets are atomic — when patching copy, supply BOTH headlines AND descriptions.
  headlines: [{ text: "Book Today, Save 20%" }, { text: "Free Returns" }, { text: "Top-Rated 2026" }, ...],
  descriptions: [{ text: "Free shipping on every order over $50." }, { text: "30-day money-back guarantee." }],
  finalUrl: "https://example.com/lp/promo",
  treatmentTrafficSplit: 50,    // 1–99, default 50
  endDate: "2026-05-31",
})
\`\`\`

Returns \`{ experimentResourceName, trialCampaignId, trialAdGroupId, trialAdId, readyToSchedule, patches }\`. When \`readyToSchedule: true\`, call \`scheduleExperiment\` with the returned \`experimentResourceName\` and you're done.

If the shortcut fails partway (\`readyToSchedule: false\` with an \`experimentResourceName\` set), the experiment + arms exist but the asset patch didn't land. Recover by:
1. Re-applying the patch with \`updateAdAssets\` (or \`updateAdFinalUrl\`) on the returned \`trialAdGroupId\` + \`trialAdId\`, OR
2. Calling \`endExperiment\` to discard the experiment cleanly.

The shortcut requires the base ad to be a Responsive Search Ad. Other ad types (call-only, image, app) aren't supported.

### When the manual flow is better than the shortcut

Use the granular tools (createExperiment + addExperimentArms + updateAdAssets + scheduleExperiment) instead of the shortcut when:

- The base campaign has multiple RSAs in the same ad group with the same first headline (the shortcut's signature match is ambiguous and will refuse).
- You want to vary multiple ads in the trial campaign in different ways.
- You want to test something other than RSA assets within an AD_VARIATION experiment (e.g. expanded text changes, asset pinning shifts).

For the manual RSA-asset flow, follow the regular 5-step lifecycle with \`type: "SEARCH_CUSTOM"\`. Between steps 2 and 3, query the trial campaign to find the cloned RSA's ID:

\`\`\`js
// Find the cloned RSA in the trial campaign so you can patch it.
const trialId = "<from inDesignCampaigns[0]>";
const r = await ads.gaql(\`
  SELECT ad_group.id, ad_group.name,
         ad_group_ad.ad.id,
         ad_group_ad.ad.responsive_search_ad.headlines,
         ad_group_ad.ad.responsive_search_ad.descriptions
    FROM ad_group_ad
    WHERE campaign.id = \${trialId}
      AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
\`);
return r.rows;
\`\`\`

Then call \`updateAdAssets\` with the trial \`ad_group.id\` and \`ad_group_ad.ad.id\` and your replacement headlines/descriptions, followed by \`scheduleExperiment\`.

## Reading experiment data with runScript

\`runScript\` cannot mutate experiments, but it's the right tool for monitoring and final-call analysis. The \`experiment\` and \`experiment_arm\` resources are queryable; trial campaigns are normal \`campaign\` rows segmented by their resource name.

\`\`\`js
// List all experiments and their state
const r = await ads.gaqlParallel([
  { name: "experiments", query: \`
    SELECT experiment.resource_name, experiment.name, experiment.type,
           experiment.status, experiment.start_date, experiment.end_date,
           experiment.suffix
      FROM experiment
      ORDER BY experiment.start_date DESC\`, limit: 50 },
  { name: "arms", query: \`
    SELECT experiment_arm.resource_name, experiment_arm.experiment,
           experiment_arm.name, experiment_arm.control,
           experiment_arm.traffic_split,
           experiment_arm.campaigns,
           experiment_arm.in_design_campaigns
      FROM experiment_arm\` }
]);
return { experiments: r.experiments.rows, arms: r.arms.rows };
\`\`\`

To compare control vs. treatment performance, query the trial campaigns directly. Take the trial campaign IDs from \`experiment_arm.in_design_campaigns\` and the control's campaign IDs from \`experiment_arm.campaigns\`, then:

\`\`\`js
const r = await ads.gaqlParallel([
  { name: "perCampaign", query: \`
    SELECT campaign.id, campaign.name, segments.date,
           metrics.cost_micros, metrics.conversions,
           metrics.clicks, metrics.impressions
      FROM campaign
      WHERE campaign.id IN (<control_id>, <trial_id>)
        AND segments.date DURING LAST_14_DAYS
      ORDER BY segments.date\` }
]);

const rows = r.perCampaign.rows ?? [];
const byCampaign = new Map();
for (const row of rows) {
  const key = String(row.campaign.id);
  const acc = byCampaign.get(key) ?? { spend: 0, conv: 0, clicks: 0 };
  acc.spend += (row.metrics.cost_micros || 0) / 1_000_000;
  acc.conv  += row.metrics.conversions || 0;
  acc.clicks += row.metrics.clicks || 0;
  byCampaign.set(key, acc);
}

return [...byCampaign.entries()].map(([id, v]) => ({
  campaignId: id,
  spend: v.spend,
  conversions: v.conv,
  cpa: v.conv > 0 ? v.spend / v.conv : null,
  cpc: v.clicks > 0 ? v.spend / v.clicks : null,
}));
\`\`\`

## Decision rule for ending the experiment

Don't recommend promote/graduate until **all four** of these are true:

1. ≥ 14 days since scheduleExperiment.
2. ≥ 30 conversions on each arm (otherwise CPA noise dominates).
3. The CPA difference is ≥ 15% AND the lower-CPA arm also has ≥ the higher-CPA arm's conversion volume (so you're not just picking the arm that didn't spend).
4. \`listExperimentAsyncErrors\` returns no errors for the most recent operation.

If criteria 1–3 aren't met, recommend "wait — n more days OR n more conversions until decision." If criterion 4 fails, recommend re-creating the experiment after fixing the underlying campaign-config issue.

## Don't

- Don't try to mutate experiments via \`runScript\` / \`ads.gaql\`. The dedicated tools are required.
- Don't add arms incrementally. Both arms in one \`addExperimentArms\` call.
- Don't call \`scheduleExperiment\` before mutating the trial campaign — both arms will be identical and the test is meaningless.
- Don't skip \`listExperimentAsyncErrors\` after schedule/promote — async failures are silent in the LRO response.
- Don't confuse \`graduate\` (keep trial running standalone) with \`promote\` (copy changes back to base, stop trial). They're not interchangeable.
- For AD_VARIATION tests, don't pass \`headlines\` without \`descriptions\` (or vice versa) — Google replaces the full RSA asset set, and validation rejects partial patches with "RSA requires 3-15 headlines, 2-4 descriptions."
`;

export const PLAYBOOKS: readonly Playbook[] = [
  {
    uri: "notfair://playbooks/audit-account",
    name: "Audit a Google Ads account with runScript",
    description:
      "One runScript call that fans out 4 GAQL queries in parallel: campaigns, search terms, zero-conversion keywords, recent changes. Correlates them in-script to return a ranked audit.",
    content: ANALYST_MINDSET + AUDIT_ACCOUNT,
  },
  {
    uri: "notfair://playbooks/explain-regression",
    name: "Explain a metric regression with runScript",
    description:
      "One runScript call that correlates the timeseries, per-campaign breakdown, change events, and emergent wasted search terms. Answers 'why did CPA go up' in a single pass.",
    content: ANALYST_MINDSET + EXPLAIN_REGRESSION,
  },
  {
    uri: "notfair://playbooks/run-experiment",
    name: "Run a Google Ads experiment (drafts & trials)",
    description:
      "Five-step lifecycle for SEARCH_CUSTOM and SEARCH_AUTOMATED_BIDDING_STRATEGY experiments: createExperiment → addExperimentArms → mutate the trial → scheduleExperiment → listExperimentAsyncErrors → end | promote | graduate. Plus runScript queries to monitor and decide.",
    content: ANALYST_MINDSET + RUN_EXPERIMENT,
  },
];

/**
 * Legacy URI scheme served only for backward compat with toprank plugin
 * versions prior to v0.23.0, which referenced playbooks as
 * `adsagent://playbooks/<slug>`. Remove this alias once telemetry confirms
 * no clients are still issuing `resources/read` calls under the legacy scheme.
 */
const LEGACY_PLAYBOOK_PREFIX = "adsagent://playbooks/";
const CANONICAL_PLAYBOOK_PREFIX = "notfair://playbooks/";

/**
 * Look up a playbook by URI. Returns undefined if not found. Accepts both the
 * canonical `notfair://playbooks/<slug>` URI and the legacy
 * `adsagent://playbooks/<slug>` URI from pre-v0.23.0 toprank clients.
 */
export function findPlaybook(uri: string): Playbook | undefined {
  const normalized = uri.startsWith(LEGACY_PLAYBOOK_PREFIX)
    ? CANONICAL_PLAYBOOK_PREFIX + uri.slice(LEGACY_PLAYBOOK_PREFIX.length)
    : uri;
  return PLAYBOOKS.find((p) => p.uri === normalized);
}

/**
 * Legacy URI for a given playbook — the `adsagent://playbooks/<slug>` form
 * still used by pre-v0.23.0 toprank clients. Dual-registered at the resource
 * handler so `resources/read` works under either scheme during the transition.
 */
export function legacyUriFor(playbook: Playbook): string {
  return LEGACY_PLAYBOOK_PREFIX + playbook.uri.slice(CANONICAL_PLAYBOOK_PREFIX.length);
}
