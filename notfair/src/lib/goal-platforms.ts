/**
 * Goal-platform registry: which "focus" options the goal-creation form
 * offers, derived from the MCPs the workspace has connected. Connecting
 * Search Console unlocks an SEO focus, Google Ads a paid-search focus,
 * and so on — the form shows only what's actually measurable, plus a
 * free-form "Other".
 *
 * Used by both goal-creation surfaces (the goals index and onboarding's
 * first-goal step) so the experience is identical. Pure data — safe to
 * import from client and server.
 */

export type GoalPlatform = {
  /** Stable id for the chip (also what tests key on). */
  key: string;
  /** MCP catalog key that unlocks this focus. */
  mcp_key: string;
  /** Chip label the user picks: "SEO", "Google Ads", … */
  label: string;
  /**
   * Focus line threaded into the intake kickoff so the agent explores
   * the right platform even when the statement itself is ambiguous.
   */
  focus: string;
  /** Textarea placeholder while this focus is selected. */
  placeholder: string;
  /** Tap-to-fill starter statements — static, digestible, per platform. */
  examples: string[];
};

export const GOAL_PLATFORMS: GoalPlatform[] = [
  {
    key: "google-ads",
    mcp_key: "notfair-googleads",
    label: "Google Ads",
    focus: "Google Ads (paid search) — measure via the notfair-googleads MCP",
    placeholder: 'e.g. "Cut our Google Ads CAC to $30"',
    examples: [
      "Cut wasted Google Ads spend to $0/week",
      "Get Google Ads CAC under $50",
      "Grow conversions from Google Ads 25% without raising spend",
    ],
  },
  {
    key: "meta-ads",
    mcp_key: "notfair-metaads",
    label: "Meta Ads",
    focus:
      "Meta Ads (Facebook + Instagram paid social) — measure via the notfair-metaads MCP",
    placeholder: 'e.g. "Get Meta Ads ROAS above 3x"',
    examples: [
      "Get Meta Ads ROAS above 3x",
      "Cut Meta Ads cost per lead under $25",
    ],
  },
  {
    key: "seo",
    mcp_key: "notfair-googlesearchconsole",
    label: "SEO",
    focus:
      "SEO / organic search — measure via the notfair-googlesearchconsole MCP",
    placeholder: 'e.g. "Grow organic clicks 30% in 90 days"',
    examples: [
      "Grow organic clicks 30% in 90 days",
      "Lift CTR on our top 20 queries above 4%",
      "Grow impressions for our money keywords 50%",
    ],
  },
  {
    key: "x-ads",
    mcp_key: "notfair-xads",
    label: "X Ads",
    focus: "X (Twitter) Ads — measure via the notfair-xads MCP",
    placeholder: 'e.g. "Keep X Ads CPM under $8"',
    examples: [
      "Keep X Ads CPM under $8 while holding impressions steady",
      "Grow X Ads engagement rate to 2%",
    ],
  },
  {
    key: "analytics",
    mcp_key: "notfair-googleanalytics",
    label: "Analytics",
    focus: "Site analytics (GA4) — measure via the notfair-googleanalytics MCP",
    placeholder: 'e.g. "Grow weekly sessions 20%"',
    examples: [
      "Grow weekly sessions 20%",
      "Lift signup conversion rate to 3%",
    ],
  },
];

/** The focus options a workspace has actually unlocked, in registry order. */
export function goalPlatformsForConnected(
  connectedMcpKeys: string[],
): GoalPlatform[] {
  const connected = new Set(connectedMcpKeys);
  return GOAL_PLATFORMS.filter((p) => connected.has(p.mcp_key));
}
