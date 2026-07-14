import { describe, expect, it } from "vitest";

import { ghStateToPrState, parseGhPrView } from "@/server/goals/pr-sync";

describe("ghStateToPrState", () => {
  it("maps GitHub states, defaulting unknown to open", () => {
    expect(ghStateToPrState("OPEN")).toBe("open");
    expect(ghStateToPrState("MERGED")).toBe("merged");
    expect(ghStateToPrState("CLOSED")).toBe("closed");
    expect(ghStateToPrState("merged")).toBe("merged");
    expect(ghStateToPrState(undefined)).toBe("open");
    expect(ghStateToPrState("WEIRD")).toBe("open");
  });
});

describe("parseGhPrView", () => {
  it("parses a full gh pr view payload", () => {
    expect(
      parseGhPrView({
        state: "OPEN",
        title: "Improve /pricing meta",
        reviewDecision: "CHANGES_REQUESTED",
        isDraft: false,
        mergedAt: null,
        comments: [{}, {}],
        reviews: [{}],
      }),
    ).toEqual({
      state: "open",
      title: "Improve /pricing meta",
      review_decision: "CHANGES_REQUESTED",
      comment_count: 3,
      is_draft: false,
      merged_at: null,
    });
  });

  it("handles repos without required reviews (empty decision) and merges", () => {
    expect(
      parseGhPrView({
        state: "MERGED",
        title: "t",
        reviewDecision: "",
        isDraft: false,
        mergedAt: "2026-07-13T01:02:03Z",
        comments: [],
        reviews: [],
      }),
    ).toEqual({
      state: "merged",
      title: "t",
      review_decision: "",
      comment_count: 0,
      is_draft: false,
      merged_at: "2026-07-13T01:02:03Z",
    });
  });

  it("rejects non-object payloads", () => {
    expect(parseGhPrView(null)).toBeNull();
    expect(parseGhPrView("nope")).toBeNull();
  });
});
