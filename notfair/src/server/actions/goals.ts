"use server";

import { revalidatePath } from "next/cache";
import {
  createGoal,
  getGoal,
  getGoalForAgent,
  setGoalStatus,
  startGoalLoop,
} from "@/server/db/goals";
import { getProject } from "@/server/db/projects";
import {
  goalAgentIdFor,
  goalAgentUrlSlug,
  provisionGoalAgent,
} from "@/server/goals/provision";
import { agentExistsOnDisk, listProjectAgents } from "@/server/agent-meta";
import { runGoalIntake } from "@/server/goals/intake";
import { runGoalTick } from "@/server/goals/tick";

export type GoalActionResult = {
  ok: boolean;
  error?: string;
  goal_id?: string;
  agent_slug?: string;
};

/** Next free sequential goal number for the project (goal-1, goal-2, …). */
async function nextGoalNumber(project_slug: string): Promise<number> {
  const agents = await listProjectAgents(project_slug);
  let max = 0;
  for (const a of agents) {
    const m = a.slug.match(/^goal-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  // Defensive: skip over any orphaned workspace dirs.
  while (await agentExistsOnDisk(goalAgentIdFor(project_slug, n))) n++;
  return n;
}

/**
 * Mint a new goal from an AMBITION. Goals are the identity — the agent
 * behind one is anonymous plumbing with a sequential id. The statement
 * seeds the goal row and an intake turn fires immediately, so the user
 * lands in a chat where the agent is already working out how to measure
 * it.
 */
export async function createGoalAgentAction(input: {
  project_slug: string;
  statement: string;
  /**
   * Platform focus picked in the creation form (a `GoalPlatform.focus`
   * line, e.g. "SEO / organic search — measure via the
   * notfair-googlesearchconsole MCP"). Threaded into the intake kickoff
   * only — the statement stays the user's words.
   */
  focus?: string | null;
}): Promise<GoalActionResult> {
  const project = getProject(input.project_slug);
  if (!project) return { ok: false, error: "Project not found." };

  const statement = input.statement.trim();
  if (!statement) return { ok: false, error: "Say what you want to achieve." };

  const n = await nextGoalNumber(project.slug);
  const agent_id = goalAgentIdFor(project.slug, n);
  const urlSlug = goalAgentUrlSlug(n);

  let goal;
  try {
    goal = createGoal({ project_slug: project.slug, agent_id, statement });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await provisionGoalAgent({ goal, urlSlug });
  } catch (err) {
    // Roll back so a broken provision doesn't strand a live goal row.
    setGoalStatus(goal.id, "killed", "provisioning failed");
    return {
      ok: false,
      error: `Agent provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // The agent starts working immediately; the goal screen's embedded
  // chat streams it live.
  void runGoalIntake(goal, { focus: input.focus }).catch((err) =>
    console.error("[goal-intake] kickoff failed:", err),
  );

  revalidatePath("/", "layout");
  return {
    ok: true,
    goal_id: goal.id,
    agent_slug: urlSlug,
  };
}

/**
 * The user's START click — the platform-enforced consent that begins the
 * loop. Fires the first tick immediately so the user watches it work
 * rather than waiting for tomorrow's heartbeat.
 */
export async function startGoalLoopAction(goal_id: string): Promise<GoalActionResult> {
  const goal = getGoal(goal_id);
  if (!goal) return { ok: false, error: "Goal not found." };
  if (goal.status !== "proposed" || goal.target_value === null) {
    return {
      ok: false,
      error: "The goal isn't ready to start — agree a target with the agent in chat first.",
    };
  }
  const started = startGoalLoop(goal_id);
  if (!started) return { ok: false, error: "Could not start the loop." };
  void runGoalTick(started, "manual").catch((err) =>
    console.error("[goal-tick] first tick failed:", err),
  );
  revalidatePath("/", "layout");
  return { ok: true, goal_id: started.id };
}

export async function pauseGoalAction(goal_id: string): Promise<GoalActionResult> {
  const goal = setGoalStatus(goal_id, "paused", "paused by user");
  if (!goal) return { ok: false, error: "Goal not found." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resumeGoalAction(goal_id: string): Promise<GoalActionResult> {
  const goal = getGoal(goal_id);
  if (!goal) return { ok: false, error: "Goal not found." };
  if (goal.status !== "paused") {
    return { ok: false, error: `Goal is ${goal.status}, not paused.` };
  }
  setGoalStatus(goal_id, "active", "resumed by user");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Close the goal. The agent stays (its chat history and workspace remain
 * browsable); a closed agent simply never ticks again. Deleting the agent
 * entirely happens in its Settings danger zone.
 */
export async function killGoalAction(
  goal_id: string,
  reason?: string,
): Promise<GoalActionResult> {
  const goal = setGoalStatus(goal_id, "killed", reason?.trim() || "closed by user");
  if (!goal) return { ok: false, error: "Goal not found." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Manual "Run tick now". Fire-and-forget; the diary shows the result. */
export async function runTickNowAction(goal_id: string): Promise<GoalActionResult> {
  const goal = getGoal(goal_id);
  if (!goal) return { ok: false, error: "Goal not found." };
  if (goal.status !== "active") {
    return { ok: false, error: `Goal is ${goal.status} — only active goals tick.` };
  }
  void runGoalTick(goal, "manual").catch((err) =>
    console.error("[goal-tick] manual tick failed:", err),
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The live goal for an agent, if any (server helper for pages). */
export async function getAgentGoalAction(agent_id: string) {
  return getGoalForAgent(agent_id);
}
