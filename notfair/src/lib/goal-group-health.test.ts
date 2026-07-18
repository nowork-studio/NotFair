import { describe, expect, it } from "vitest";
import { countGoalGroupHealth, goalGroupHealth } from "./goal-group-health";

const active = {
  status: "active" as const,
  target_value: 2,
  metric_direction: "decrease" as const,
};

describe("goalGroupHealth", () => {
  it("evaluates every goal against its own direction and threshold", () => {
    expect(goalGroupHealth({ ...active, current_value: 1.77 })).toBe("healthy");
    expect(goalGroupHealth({ ...active, current_value: 29.75, target_value: 5 })).toBe("attention");
    expect(
      goalGroupHealth({
        status: "active",
        current_value: 120,
        target_value: 100,
        metric_direction: "increase",
      }),
    ).toBe("healthy");
  });

  it("does not invent health when data is missing", () => {
    expect(goalGroupHealth({ ...active, current_value: null })).toBe("waiting");
  });

  it("counts health without averaging unrelated metrics", () => {
    expect(
      countGoalGroupHealth([
        { ...active, current_value: 1.77 },
        { ...active, current_value: 29.75, target_value: 5 },
      ]),
    ).toMatchObject({ healthy: 1, attention: 1 });
  });
});
