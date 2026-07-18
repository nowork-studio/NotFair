import { notFound } from "next/navigation";
import { getProject } from "@/server/db/projects";
import {
  getGoalGroup,
  listGoalGroupMemberships,
  listGoalGroups,
  listGoalsInGroup,
} from "@/server/db/goal-groups";
import { listGoals, listGoalTicks, listMetricSnapshots } from "@/server/db/goals";
import { listProjectAgents } from "@/server/agent-meta";
import { goalLabel } from "@/lib/goal-label";
import { projectHref } from "@/lib/project-href";
import { GoalGroupEditor, type GoalGroupEditorGoal } from "@/components/goal-group-editor";
import {
  GoalGroupDashboard,
  type GoalGroupActivity,
  type GoalGroupDashboardGoal,
} from "@/components/goal-group-dashboard";
import { GoalAutoRefresh } from "@/components/goal-auto-refresh";

export const dynamic = "force-dynamic";

export default async function GoalGroupPage({
  params,
}: {
  params: Promise<{ project: string; group: string }>;
}) {
  const { project: slug, group: groupId } = await params;
  const project = getProject(slug);
  const group = getGoalGroup(groupId);
  if (!project || project.archived_at || !group || group.project_slug !== slug) notFound();

  const agents = await listProjectAgents(slug);
  const agentById = new Map(agents.map((agent) => [agent.agent_id, agent]));
  const members = listGoalsInGroup(group.id);
  const dashboardGoals = members.flatMap<GoalGroupDashboardGoal>((goal) => {
    const agent = agentById.get(goal.agent_id);
    if (!agent) return [];
    return [{
      id: goal.id,
      href: projectHref(slug, `/goals/${agent.slug}`),
      label: goalLabel(goal),
      statement: goal.statement,
      status: goal.status,
      status_reason: goal.status_reason,
      metric_name: goal.metric_name,
      current_value: goal.current_value,
      target_value: goal.target_value,
      metric_direction: goal.metric_direction,
      cadence_cron: goal.cadence_cron,
      last_tick_at: goal.last_tick_at,
      next_tick_at: goal.next_tick_at,
      tick_count: goal.tick_count,
      snapshots: listMetricSnapshots(goal.id, 120).map((snapshot) => snapshot.value),
    }];
  });

  const dashboardById = new Map(dashboardGoals.map((goal) => [goal.id, goal]));
  const activity = members
    .flatMap<GoalGroupActivity>((goal) => {
      const display = dashboardById.get(goal.id);
      if (!display) return [];
      return listGoalTicks(goal.id, 8).map((tick) => ({
        id: tick.id,
        goal_id: goal.id,
        goal_href: display.href,
        goal_label: display.label,
        tick_number: tick.tick_number,
        status: tick.status,
        metric_value: tick.metric_value,
        metric_error: tick.metric_error,
        summary: tick.summary,
        started_at: tick.started_at,
      }));
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 20);

  const groups = listGoalGroups(slug);
  const groupById = new Map(groups.map((item) => [item.id, item.name]));
  const membershipByGoal = new Map(
    listGoalGroupMemberships(slug).map((membership) => [membership.goal_id, membership.group_id]),
  );
  const editorGoals: GoalGroupEditorGoal[] = listGoals(slug).map((goal) => {
    const currentGroupId = membershipByGoal.get(goal.id) ?? null;
    return {
      id: goal.id,
      label: goalLabel(goal),
      status: goal.status,
      current_group_id: currentGroupId,
      current_group_name: currentGroupId ? groupById.get(currentGroupId) ?? null : null,
    };
  });

  return (
    <>
      {dashboardGoals.some((goal) => goal.status === "active") && (
        <GoalAutoRefresh intervalMs={60_000} />
      )}
      <GoalGroupDashboard
        name={group.name}
        description={group.description}
        allGoalsHref={projectHref(slug, "/goals")}
        goals={dashboardGoals}
        activity={activity}
        actions={
          <GoalGroupEditor
            projectSlug={slug}
            goals={editorGoals}
            group={{ id: group.id, name: group.name, description: group.description }}
          />
        }
      />
    </>
  );
}
