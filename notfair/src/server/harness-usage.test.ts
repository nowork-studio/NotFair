import { describe, expect, it } from "vitest";

import {
  normalizeCodexRateLimits,
  parseCodexLoginStatus,
} from "@/server/harness-usage";

describe("Codex harness usage normalization", () => {
  it("keeps a valid single weekly window instead of treating it as signed out", () => {
    expect(
      normalizeCodexRateLimits({
        primary_window: {
          used_percent: 8,
          limit_window_seconds: 604_800,
          reset_at: 1_784_487_546,
        },
        secondary_window: null,
      }),
    ).toEqual([
      {
        label: "Weekly",
        used_percent: 8,
        limit_window_seconds: 604_800,
        reset_at: 1_784_487_546,
      },
    ]);
  });

  it("recognizes the CLI's supported login status messages", () => {
    expect(parseCodexLoginStatus("Logged in using ChatGPT\n")).toBe("chatgpt");
    expect(parseCodexLoginStatus("Logged in using an API key\n")).toBe("api-key");
    expect(parseCodexLoginStatus("Not logged in\n")).toBe("signed-out");
  });
});
