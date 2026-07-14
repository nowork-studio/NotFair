import { describe, expect, it } from "vitest";

import {
  GOAL_PLATFORMS,
  goalPlatformsForConnected,
} from "@/lib/goal-platforms";

describe("goalPlatformsForConnected", () => {
  it("returns nothing when nothing is connected", () => {
    expect(goalPlatformsForConnected([])).toEqual([]);
  });

  it("unlocks SEO when Search Console is connected", () => {
    const platforms = goalPlatformsForConnected([
      "notfair-googlesearchconsole",
    ]);
    expect(platforms.map((p) => p.key)).toEqual(["seo"]);
  });

  it("maps each connected MCP to its focus option, in registry order", () => {
    const platforms = goalPlatformsForConnected([
      "notfair-xads",
      "notfair-googleads",
      "notfair-googlesearchconsole",
    ]);
    expect(platforms.map((p) => p.key)).toEqual(["google-ads", "seo", "x-ads"]);
  });

  it("ignores MCPs without a goal-platform mapping", () => {
    expect(goalPlatformsForConnected(["stripe", "supabase"])).toEqual([]);
  });
});

describe("GOAL_PLATFORMS registry", () => {
  it("every entry is fully usable by the form and the intake kickoff", () => {
    for (const p of GOAL_PLATFORMS) {
      expect(p.key, p.mcp_key).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.focus).toContain(p.mcp_key);
      expect(p.placeholder).toBeTruthy();
      expect(p.examples.length).toBeGreaterThan(0);
    }
  });

  it("keys and mcp_keys are unique", () => {
    const keys = GOAL_PLATFORMS.map((p) => p.key);
    const mcpKeys = GOAL_PLATFORMS.map((p) => p.mcp_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(mcpKeys).size).toBe(mcpKeys.length);
  });
});
