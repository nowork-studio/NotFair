import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  process.env.NOTFAIR_DATA_DIR = mkdtempSync(join(tmpdir(), "notfair-goal-groups-"));
});

import { getDb } from "./db";
import { createGoal, getGoal } from "./goals";
import {
  createGoalGroup,
  deleteGoalGroup,
  getGoalGroup,
  listGoalGroupMemberships,
  listGoalsInGroup,
  saveGoalGroup,
  setGoalGroupMembership,
} from "./goal-groups";

const PROJECT = "group-project";

beforeAll(() => {
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO projects (id, slug, display_name, created_at, harness_adapter) VALUES (?, ?, ?, ?, 'codex-local')",
  );
  insert.run("gp1", PROJECT, "Group project", new Date().toISOString());
  insert.run("gp2", "other-project", "Other project", new Date().toISOString());
});

describe("goal groups", () => {
  it("creates a group containing many goals", () => {
    const google = createGoal({ project_slug: PROJECT, agent_id: "google", statement: "Google errors" });
    const meta = createGoal({ project_slug: PROJECT, agent_id: "meta", statement: "Meta errors" });
    const group = createGoalGroup({
      project_slug: PROJECT,
      name: "Ads MCP reliability",
      description: "Keep every ads connection healthy.",
      goal_ids: [google.id, meta.id],
    });

    expect(listGoalsInGroup(group.id).map((goal) => goal.id)).toEqual([google.id, meta.id]);
    expect(listGoalGroupMemberships(PROJECT)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ goal_id: google.id, group_id: group.id }),
        expect.objectContaining({ goal_id: meta.id, group_id: group.id }),
      ]),
    );
  });

  it("moves a goal atomically when it joins another group", () => {
    const goal = createGoal({ project_slug: PROJECT, agent_id: "move-me", statement: "Move" });
    const first = createGoalGroup({ project_slug: PROJECT, name: "First", goal_ids: [goal.id] });
    const second = createGoalGroup({ project_slug: PROJECT, name: "Second" });

    setGoalGroupMembership(goal.id, second.id);
    expect(listGoalsInGroup(first.id)).toHaveLength(0);
    expect(listGoalsInGroup(second.id).map((item) => item.id)).toEqual([goal.id]);
  });

  it("saves metadata and replaces members in one transaction", () => {
    const one = createGoal({ project_slug: PROJECT, agent_id: "save-one", statement: "One" });
    const two = createGoal({ project_slug: PROJECT, agent_id: "save-two", statement: "Two" });
    const group = createGoalGroup({ project_slug: PROJECT, name: "Before", goal_ids: [one.id] });

    const saved = saveGoalGroup({
      id: group.id,
      name: "After",
      description: "Updated",
      goal_ids: [two.id],
    });
    expect(saved).toMatchObject({ name: "After", description: "Updated" });
    expect(listGoalsInGroup(group.id).map((goal) => goal.id)).toEqual([two.id]);
  });

  it("rejects cross-project membership", () => {
    const other = createGoal({
      project_slug: "other-project",
      agent_id: "other-goal",
      statement: "Other",
    });
    expect(() =>
      createGoalGroup({ project_slug: PROJECT, name: "Invalid", goal_ids: [other.id] }),
    ).toThrow(/same project/);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM goal_groups WHERE name = 'Invalid'").get())
      .toEqual({ n: 0 });
  });

  it("deleting a group ungroups goals without deleting them", () => {
    const goal = createGoal({ project_slug: PROJECT, agent_id: "survivor", statement: "Stay" });
    const group = createGoalGroup({ project_slug: PROJECT, name: "Temporary", goal_ids: [goal.id] });

    expect(deleteGoalGroup(group.id)).toBe(true);
    expect(getGoalGroup(group.id)).toBeNull();
    expect(getGoal(goal.id)).not.toBeNull();
    expect(listGoalGroupMemberships(PROJECT).some((member) => member.goal_id === goal.id)).toBe(false);
  });
});
