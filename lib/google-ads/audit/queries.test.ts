import { describe, expect, it } from "vitest";
import {
  queryAccountInfo,
  queryCampaigns,
  queryGeoTargeting,
  queryKeywords,
  queryQualityScores,
  querySearchTerms,
  queryConvertingSearchTerms,
  queryZeroConversionKeywords,
  queryAds,
  queryAdGroups,
  queryConversionActions,
  queryConversionActionPerformance,
  queryAudienceSegmentCheck,
  queryDevicePerformance,
  queryNegativeKeywords,
  queryNetworkSegmentation,
  queryRecommendations,
  queryBillingSetups,
  queryCampaignAssets,
  queryAdGroupAssets,
  querySharedNegativeKeywordLists,
  querySharedNegativeKeywordMembers,
  queryPausedCampaigns,
  queryCustomerManagerLinks,
  queryLandingPages,
  queryChangeEvents,
  queryDailyCampaignMetrics,
} from "./queries";

// Snapshot each query's exact text so deliberate changes are reviewed
// explicitly and accidental edits fail CI.

describe("audit queries", () => {
  it("queryAccountInfo — matches snapshot", () => {
    expect(queryAccountInfo()).toMatchSnapshot();
  });

  it("queryCampaigns — substitutes date range", () => {
    expect(queryCampaigns("2026-01-01", "2026-01-30")).toMatchSnapshot();
  });

  it("queryGeoTargeting — matches snapshot", () => {
    expect(queryGeoTargeting()).toMatchSnapshot();
  });

  it("queryKeywords — date range + LIMIT 2000", () => {
    const q = queryKeywords("2026-01-01", "2026-01-30");
    expect(q).toMatchSnapshot();
    expect(q).toContain("LIMIT 2000");
    // keyword_view returns positives AND ad-group negatives — the audit must filter
    // to positives or it surfaces negatives as zombie keywords. See
    // docs/ads-api-landmines.md.
    expect(q).toContain("ad_group_criterion.negative = FALSE");
    // Current-state filters on every level — stops yesterday's paused entities from
    // re-surfacing as today's recommendation candidates. GAQL dimensions reflect
    // query-time state even on a historical metric window.
    expect(q).toContain("campaign.status = 'ENABLED'");
    expect(q).toContain("ad_group.status = 'ENABLED'");
    expect(q).toContain("ad_group_criterion.status = 'ENABLED'");
  });

  it("queryQualityScores — matches snapshot", () => {
    expect(queryQualityScores()).toMatchSnapshot();
  });

  it("querySearchTerms — date range + LIMIT 2000", () => {
    const q = querySearchTerms("2026-01-01", "2026-01-30");
    expect(q).toMatchSnapshot();
    expect(q).toContain("LIMIT 2000");
    // Current-state filters — search_term_view exposes no criterion-level status
    // so we filter as deep as the resource allows; the rest is closed by the
    // per-row recentChange annotation built from change_event.
    expect(q).toContain("campaign.status = 'ENABLED'");
    expect(q).toContain("ad_group.status = 'ENABLED'");
  });

  it("queryConvertingSearchTerms — LIMIT 500, conversions > 0", () => {
    const q = queryConvertingSearchTerms("2026-01-01", "2026-01-30");
    expect(q).toMatchSnapshot();
    expect(q).toContain("metrics.conversions > 0");
    expect(q).toContain("LIMIT 500");
    // Mining for positives only matters on still-serving ad groups.
    expect(q).toContain("campaign.status = 'ENABLED'");
    expect(q).toContain("ad_group.status = 'ENABLED'");
  });

  it("queryZeroConversionKeywords — LIMIT 500, conversions = 0", () => {
    const q = queryZeroConversionKeywords("2026-01-01", "2026-01-30");
    expect(q).toMatchSnapshot();
    expect(q).toContain("metrics.conversions = 0");
    expect(q).toContain("LIMIT 500");
    // Without this predicate every ad-group negative would match conversions=0
    // (negatives block serving so accumulate 0 of every metric by definition).
    expect(q).toContain("ad_group_criterion.negative = FALSE");
    // The criterion-level filter is the critical fix for the stale-recommendation
    // loop: a keyword paused yesterday in a still-active campaign used to keep
    // surfacing every day until its 30-day window of spend rolled off.
    expect(q).toContain("campaign.status = 'ENABLED'");
    expect(q).toContain("ad_group.status = 'ENABLED'");
    expect(q).toContain("ad_group_criterion.status = 'ENABLED'");
  });

  it("queryAds — date range + LIMIT 1000", () => {
    expect(queryAds("2026-01-01", "2026-01-30")).toMatchSnapshot();
  });

  it("queryAdGroups — LIMIT 1000", () => {
    const q = queryAdGroups();
    expect(q).toMatchSnapshot();
    expect(q).toContain("LIMIT 1000");
  });

  it("queryConversionActions — ORDER BY name", () => {
    expect(queryConversionActions()).toMatchSnapshot();
  });

  it("queryConversionActionPerformance — safe conversion segment metrics only", () => {
    const q = queryConversionActionPerformance("2026-01-01", "2026-01-30");
    expect(q).toMatchSnapshot();
    expect(q).toContain("2026-01-01");
    expect(q).toContain("2026-01-30");
    expect(q).toContain("segments.conversion_action_name");
    expect(q).toContain("metrics.conversions");
    expect(q).not.toContain("metrics.cost_micros");
    expect(q).not.toContain("metrics.clicks");
  });

  it("queryAudienceSegmentCheck — LIMIT 1 (existence check only)", () => {
    const q = queryAudienceSegmentCheck();
    expect(q).toMatchSnapshot();
    expect(q).toContain("LIMIT 1");
  });

  it("queryDevicePerformance — date range", () => {
    expect(queryDevicePerformance("2026-01-01", "2026-01-30")).toMatchSnapshot();
  });

  it("queryNegativeKeywords — filters to negative = TRUE", () => {
    const q = queryNegativeKeywords();
    expect(q).toMatchSnapshot();
    expect(q).toContain("negative = TRUE");
  });

  it("queryNetworkSegmentation — date range", () => {
    expect(queryNetworkSegmentation("2026-01-01", "2026-01-30")).toMatchSnapshot();
  });

  it("queryRecommendations — conservative recommendation overview", () => {
    const q = queryRecommendations();
    expect(q).toMatchSnapshot();
    expect(q).toContain("FROM recommendation");
    expect(q).not.toContain("base_metrics");
  });

  it("queryBillingSetups — avoids non-portable payment-account info fields", () => {
    const q = queryBillingSetups();
    expect(q).toMatchSnapshot();
    expect(q).toContain("FROM billing_setup");
    expect(q).not.toContain("payments_account_info");
  });

  it("queryCampaignAssets — matches snapshot", () => {
    expect(queryCampaignAssets()).toMatchSnapshot();
  });

  it("queryAdGroupAssets — matches snapshot", () => {
    expect(queryAdGroupAssets()).toMatchSnapshot();
  });

  it("querySharedNegativeKeywordLists — filters shared negative lists", () => {
    const q = querySharedNegativeKeywordLists();
    expect(q).toMatchSnapshot();
    expect(q).toContain("shared_set.type = 'NEGATIVE_KEYWORDS'");
  });

  it("querySharedNegativeKeywordMembers — reads shared negative keywords", () => {
    const q = querySharedNegativeKeywordMembers();
    expect(q).toMatchSnapshot();
    expect(q).toContain("FROM shared_criterion");
  });

  it("queryPausedCampaigns — exposes paused campaigns", () => {
    const q = queryPausedCampaigns();
    expect(q).toMatchSnapshot();
    expect(q).toContain("campaign.status = 'PAUSED'");
  });

  it("queryCustomerManagerLinks — exposes manager access", () => {
    const q = queryCustomerManagerLinks();
    expect(q).toMatchSnapshot();
    expect(q).toContain("FROM customer_manager_link");
  });

  it("queryLandingPages — LIMIT 200", () => {
    const q = queryLandingPages("2026-01-01", "2026-01-30");
    expect(q).toMatchSnapshot();
    expect(q).toContain("LIMIT 200");
  });

  it("queryChangeEvents — uses >= / <= (BETWEEN not supported), ORDER BY DESC, LIMIT 500", () => {
    const q = queryChangeEvents("2099-01-01", "2099-01-30");
    expect(q).toMatchSnapshot();
    expect(q).toContain("change_event.change_date_time >= '2099-01-01 00:00:00'");
    expect(q).toContain("change_event.change_date_time <= '2099-01-30 23:59:59'");
    expect(q).toContain("ORDER BY change_event.change_date_time DESC");
    expect(q).toContain("LIMIT 500");
    expect(q).not.toContain("LIMIT 10000");
    expect(q).not.toContain("BETWEEN");
  });

  it("queryChangeEvents — clamps old starts to Google's rolling 30-day window", () => {
    const q = queryChangeEvents("2026-01-01", "2099-01-30");
    expect(q).not.toContain("change_event.change_date_time >= '2026-01-01 00:00:00'");
    expect(q).toMatch(/change_event\.change_date_time >= '\d{4}-\d{2}-\d{2} 00:00:00'/);
  });

  it("queryDailyCampaignMetrics — date range", () => {
    expect(queryDailyCampaignMetrics("2026-01-01", "2026-01-30")).toMatchSnapshot();
  });
});
