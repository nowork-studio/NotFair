import { getProject } from "@/server/db/projects";
import { listProjectMcpTokens } from "@/server/mcp/tokens";
import { readProjectBrief } from "@/server/onboarding/project-brief";
import type { Goal } from "@/server/db/goals";
import { streamAgentTurn } from "./tick";

/**
 * The intake kickoff: fired the moment a goal agent is created, so the
 * user lands in a chat where the agent is ALREADY working on their
 * ambition — no dead air, no "say hi to get started". Runs on a fresh
 * chat session (UUID label) that the chat index picks up as the latest
 * thread; the user watches it stream live and joins in.
 */

export function buildIntakeKickoffMessage(input: {
  goal: Goal;
  connectedMcpKeys: string[];
  hasSharedContext: boolean;
  /** Platform focus the user picked at creation ("SEO / organic search —
   *  measure via the notfair-googlesearchconsole MCP"). Optional. */
  focus?: string | null;
}): string {
  const { goal, connectedMcpKeys, hasSharedContext, focus } = input;
  return `[INTAKE] The user just created you for this ambition:

> ${goal.statement}
${focus ? `\nThe user tagged this goal's focus: ${focus}. Explore and measure on that platform unless the statement clearly says otherwise.\n` : ""}
Connected data sources: ${
    connectedMcpKeys.length > 0
      ? connectedMcpKeys.join(", ")
      : "NONE — nothing is measurable yet; say so plainly and point the user at the Connections page."
  }
${hasSharedContext ? "" : "\nNo shared workspace context exists yet — bootstrap it (intake protocol step 0) before or while you author the metric.\n"}
Follow the intake protocol from your identity. Work NOW, don't just
greet: acknowledge the ambition in one sentence, ask only what's truly
blocking (if anything), then explore the data, author + TEST the metric
query, verify it via propose_goal_metric, and report the measured
baseline with a suggested target, cadence, and spend envelope. End by
asking the user to confirm (they'll press START on your Goal tab after
you record their agreement via propose_target).`;
}

/** Fire-and-forget from goal creation. The goal screen's embedded chat
 *  streams it live — one conversation per goal, on the "main" session. */
export async function runGoalIntake(
  goal: Goal,
  opts?: { focus?: string | null },
): Promise<void> {
  const project = getProject(goal.project_slug);
  if (!project) {
    console.error(`[goal-intake] project not found: ${goal.project_slug}`);
    return;
  }
  const connectedMcpKeys = listProjectMcpTokens(goal.project_slug).map(
    (t) => t.server_name,
  );
  const brief = await readProjectBrief(goal.project_slug).catch(() => null);
  const message = buildIntakeKickoffMessage({
    goal,
    connectedMcpKeys,
    hasSharedContext: Boolean(brief?.trim()),
    focus: opts?.focus,
  });
  try {
    await streamAgentTurn({
      projectSlug: project.slug,
      harnessAdapter: project.harness_adapter,
      agentId: goal.agent_id,
      // One conversation per goal.
      sessionLabel: "main",
      message,
      source: "goal-intake",
    });
  } catch (err) {
    console.error("[goal-intake] intake turn failed:", err);
  }
}
