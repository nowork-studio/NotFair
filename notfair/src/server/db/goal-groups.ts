import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { type Goal } from "./goals";

export type GoalGroup = {
  id: string;
  project_slug: string;
  name: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type GoalGroupMembership = {
  goal_id: string;
  group_id: string;
  created_at: string;
};

function now(): string {
  return new Date().toISOString();
}

function uniqueGoalIds(goalIds: string[]): string[] {
  return [...new Set(goalIds)];
}

function assertGoalsBelongToProject(projectSlug: string, goalIds: string[]): void {
  const ids = uniqueGoalIds(goalIds);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM goals
        WHERE project_slug = ? AND id IN (${placeholders})`,
    )
    .get(projectSlug, ...ids) as { count: number };
  if (row.count !== ids.length) {
    throw new Error("Every grouped goal must belong to the same project as the group.");
  }
}

function replaceMembers(group: GoalGroup, goalIds: string[]): void {
  const db = getDb();
  const ids = uniqueGoalIds(goalIds);
  assertGoalsBelongToProject(group.project_slug, ids);
  db.prepare("DELETE FROM goal_group_memberships WHERE group_id = ?").run(group.id);
  const insert = db.prepare(
    `INSERT INTO goal_group_memberships (goal_id, group_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(goal_id) DO UPDATE SET group_id = excluded.group_id, created_at = excluded.created_at`,
  );
  const ts = now();
  for (const goalId of ids) insert.run(goalId, group.id, ts);
}

export function createGoalGroup(input: {
  project_slug: string;
  name: string;
  description?: string;
  goal_ids?: string[];
}): GoalGroup {
  const db = getDb();
  const id = randomUUID();
  const ts = now();
  const run = db.transaction(() => {
    const sort = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM goal_groups WHERE project_slug = ?",
      )
      .get(input.project_slug) as { next: number };
    db.prepare(
      `INSERT INTO goal_groups
         (id, project_slug, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.project_slug,
      input.name,
      input.description ?? "",
      sort.next,
      ts,
      ts,
    );
    const group = getGoalGroup(id)!;
    replaceMembers(group, input.goal_ids ?? []);
    return group;
  });
  return run();
}

export function getGoalGroup(id: string): GoalGroup | null {
  const row = getDb().prepare("SELECT * FROM goal_groups WHERE id = ?").get(id);
  return (row as GoalGroup) ?? null;
}

export function listGoalGroups(projectSlug: string): GoalGroup[] {
  return getDb()
    .prepare(
      `SELECT * FROM goal_groups WHERE project_slug = ?
       ORDER BY sort_order ASC, created_at ASC, rowid ASC`,
    )
    .all(projectSlug) as GoalGroup[];
}

export function listGoalGroupMemberships(projectSlug: string): GoalGroupMembership[] {
  return getDb()
    .prepare(
      `SELECT m.* FROM goal_group_memberships m
       JOIN goal_groups gg ON gg.id = m.group_id
       WHERE gg.project_slug = ?
       ORDER BY m.created_at ASC`,
    )
    .all(projectSlug) as GoalGroupMembership[];
}

export function listGoalsInGroup(groupId: string): Goal[] {
  return getDb()
    .prepare(
      `SELECT g.* FROM goals g
       JOIN goal_group_memberships m ON m.goal_id = g.id
       WHERE m.group_id = ?
       ORDER BY g.created_at ASC, g.rowid ASC`,
    )
    .all(groupId) as Goal[];
}

export function saveGoalGroup(input: {
  id: string;
  name: string;
  description?: string;
  goal_ids: string[];
}): GoalGroup | null {
  const db = getDb();
  const run = db.transaction(() => {
    const current = getGoalGroup(input.id);
    if (!current) return null;
    db.prepare(
      "UPDATE goal_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?",
    ).run(input.name, input.description ?? "", now(), input.id);
    const updated = getGoalGroup(input.id)!;
    replaceMembers(updated, input.goal_ids);
    return updated;
  });
  return run();
}

export function setGoalGroupMembership(goalId: string, groupId: string | null): void {
  const db = getDb();
  if (groupId === null) {
    db.prepare("DELETE FROM goal_group_memberships WHERE goal_id = ?").run(goalId);
    return;
  }
  const group = getGoalGroup(groupId);
  if (!group) throw new Error("Goal group not found.");
  assertGoalsBelongToProject(group.project_slug, [goalId]);
  db.prepare(
    `INSERT INTO goal_group_memberships (goal_id, group_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(goal_id) DO UPDATE SET group_id = excluded.group_id, created_at = excluded.created_at`,
  ).run(goalId, groupId, now());
}

export function deleteGoalGroup(id: string): boolean {
  return getDb().prepare("DELETE FROM goal_groups WHERE id = ?").run(id).changes > 0;
}
