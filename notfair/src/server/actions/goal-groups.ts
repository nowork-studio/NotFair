"use server";

import { revalidatePath } from "next/cache";
import {
  createGoalGroup,
  deleteGoalGroup,
  getGoalGroup,
  saveGoalGroup,
} from "@/server/db/goal-groups";
import { getProject } from "@/server/db/projects";

export type GoalGroupActionResult = {
  ok: boolean;
  error?: string;
  group_id?: string;
};

function cleanFields(name: string, description?: string):
  | { name: string; description: string }
  | { error: string } {
  const cleanName = name.trim();
  const cleanDescription = description?.trim() ?? "";
  if (!cleanName) return { error: "Group name can't be empty." };
  if (cleanName.length > 80) return { error: "Group name must be 80 characters or fewer." };
  if (cleanDescription.length > 240) {
    return { error: "Description must be 240 characters or fewer." };
  }
  return { name: cleanName, description: cleanDescription };
}

function messageForError(error: unknown): string {
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    return "A group with that name already exists in this project.";
  }
  return error instanceof Error ? error.message : String(error);
}

export async function createGoalGroupAction(input: {
  project_slug: string;
  name: string;
  description?: string;
  goal_ids?: string[];
}): Promise<GoalGroupActionResult> {
  if (!getProject(input.project_slug)) return { ok: false, error: "Project not found." };
  const fields = cleanFields(input.name, input.description);
  if ("error" in fields) return { ok: false, error: fields.error };
  try {
    const group = createGoalGroup({
      project_slug: input.project_slug,
      ...fields,
      goal_ids: input.goal_ids ?? [],
    });
    revalidatePath("/", "layout");
    return { ok: true, group_id: group.id };
  } catch (error) {
    return { ok: false, error: messageForError(error) };
  }
}

export async function saveGoalGroupAction(input: {
  group_id: string;
  name: string;
  description?: string;
  goal_ids: string[];
}): Promise<GoalGroupActionResult> {
  if (!getGoalGroup(input.group_id)) return { ok: false, error: "Goal group not found." };
  const fields = cleanFields(input.name, input.description);
  if ("error" in fields) return { ok: false, error: fields.error };
  try {
    const group = saveGoalGroup({
      id: input.group_id,
      ...fields,
      goal_ids: input.goal_ids,
    });
    if (!group) return { ok: false, error: "Goal group not found." };
    revalidatePath("/", "layout");
    return { ok: true, group_id: group.id };
  } catch (error) {
    return { ok: false, error: messageForError(error) };
  }
}

export async function deleteGoalGroupAction(groupId: string): Promise<GoalGroupActionResult> {
  if (!deleteGoalGroup(groupId)) return { ok: false, error: "Goal group not found." };
  revalidatePath("/", "layout");
  return { ok: true };
}
