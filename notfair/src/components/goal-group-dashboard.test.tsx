// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GoalGroupDashboard, type GoalGroupDashboardGoal } from "./goal-group-dashboard";

function goal(overrides: Partial<GoalGroupDashboardGoal>): GoalGroupDashboardGoal {
  return {
    id: "g1",
    href: "/project/goals/goal-1",
    label: "Google Ads errors <2%",
    statement: "Keep errors low",
    status: "active",
    status_reason: null,
    metric_name: "Authenticated tool-call error rate",
    current_value: 1.77,
    target_value: 2,
    metric_direction: "decrease",
    cadence_cron: "0 * * * *",
    last_tick_at: "2026-07-17T20:00:00.000Z",
    next_tick_at: "2026-07-17T22:00:00.000Z",
    tick_count: 5,
    snapshots: [2.4, 1.9, 1.77],
    ...overrides,
  };
}

describe("GoalGroupDashboard", () => {
  it("shows every member metric with its own target and health", () => {
    render(
      <GoalGroupDashboard
        name="Ads MCP reliability"
        description="Keep ads connections healthy."
        allGoalsHref="/project/goals"
        goals={[
          goal({ id: "google" }),
          goal({
            id: "meta",
            href: "/project/goals/goal-2",
            label: "Meta MCP errors <5%",
            current_value: 29.75,
            target_value: 5,
            snapshots: [8, 12, 29.75],
          }),
        ]}
        activity={[]}
      />,
    );

    expect(screen.getByText("1 healthy")).toBeTruthy();
    expect(screen.getByText("1 needs attention")).toBeTruthy();
    const google = screen.getByRole("link", { name: /Google Ads errors/ });
    const meta = screen.getByRole("link", { name: /Meta MCP errors/ });
    expect(within(google).getByText("1.77")).toBeTruthy();
    expect(within(google).getByText("≤ 2")).toBeTruthy();
    expect(within(meta).getByText("29.75")).toBeTruthy();
    expect(within(meta).getByText("≤ 5")).toBeTruthy();
  });

  it("provides an actionable empty state", () => {
    render(
      <GoalGroupDashboard
        name="Empty"
        description=""
        allGoalsHref="/project/goals"
        goals={[]}
        activity={[]}
        actions={<button>Manage group</button>}
      />,
    );
    expect(screen.getByText("This group is ready for goals.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage group" })).toBeTruthy();
  });
});
