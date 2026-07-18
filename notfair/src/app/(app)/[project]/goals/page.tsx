import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getProject } from "@/server/db/projects";
import { listProjectAgents } from "@/server/agent-meta";
import { getPinnedGoalIds, listGoals } from "@/server/db/goals";
import { projectHref } from "@/lib/project-href";
import { goalLabel } from "@/lib/goal-label";
import { GoalsBoard, type BoardGoal } from "@/components/goals-board";
import {
  listGoalGroupMemberships,
  listGoalGroups,
  listGoalsInGroup,
} from "@/server/db/goal-groups";
import { countGoalGroupHealth } from "@/lib/goal-group-health";
import { GoalGroupsOverview, type GoalGroupOverviewRow } from "@/components/goal-groups-overview";
import { GoalGroupEditor, type GoalGroupEditorGoal } from "@/components/goal-group-editor";

export const dynamic = "force-dynamic";

/**
 * The All-goals board: every goal in the workspace across its whole
 * lifecycle, one column per state. The sidebar rail only carries live
 * goals — this page is where closed goals (achieved, failed, or closed by
 * hand) remain browsable.
 */
export default async function AllGoalsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project: slug } = await params;
  const project = getProject(slug);
  if (!project || project.archived_at) notFound();

  const agents = await listProjectAgents(slug);
  const agentById = new Map(agents.map((a) => [a.agent_id, a]));
  const pinnedIds = getPinnedGoalIds(slug);
  const projectGoals = listGoals(slug);
  const groups = listGoalGroups(slug);
  const membershipByGoal = new Map(
    listGoalGroupMemberships(slug).map((membership) => [membership.goal_id, membership.group_id]),
  );
  const groupById = new Map(groups.map((group) => [group.id, group.name]));

  // Plain-JSON card props for the client board. Goals whose agent sidecar
  // is missing (half-deleted workspace) have no page to link to — skip.
  const goals = projectGoals.flatMap<BoardGoal>((g) => {
    const agent = agentById.get(g.agent_id);
    if (!agent) return [];
    return [
      {
        id: g.id,
        href: projectHref(slug, `/goals/${agent.slug}`),
        label: goalLabel(g),
        statement: g.statement,
        status: g.status,
        status_reason: g.status_reason,
        metric_name: g.metric_name,
        baseline_value: g.baseline_value,
        current_value: g.current_value,
        target_value: g.target_value,
        metric_direction: g.metric_direction,
        mode: g.mode,
        tick_count: g.tick_count,
        pinned: pinnedIds.has(g.id),
        created_at: g.created_at,
        updated_at: g.updated_at,
      },
    ];
  });

  const groupRows: GoalGroupOverviewRow[] = groups.map((group) => {
    const members = listGoalsInGroup(group.id);
    const counts = countGoalGroupHealth(members);
    return {
      id: group.id,
      href: projectHref(slug, `/groups/${group.id}`),
      name: group.name,
      description: group.description,
      goal_count: members.length,
      healthy_count: counts.healthy,
      attention_count: counts.attention,
      waiting_count: counts.waiting + counts.paused,
    };
  });
  const editorGoals: GoalGroupEditorGoal[] = projectGoals.map((goal) => {
    const groupId = membershipByGoal.get(goal.id) ?? null;
    return {
      id: goal.id,
      label: goalLabel(goal),
      status: goal.status,
      current_group_id: groupId,
      current_group_name: groupId ? groupById.get(groupId) ?? null : null,
    };
  });

  // Anchored to the viewport region (like the goal screen) so the column
  // strip scrolls inside the page instead of stretching SidebarInset — a
  // flex item with no min-width — and dragging the whole body sideways.
  return (
    <div className="absolute inset-0 flex flex-col overflow-y-auto px-7 pt-8 pb-4">
      <header className="ns-page-head shrink-0">
        <div className="ns-page-head-stack">
          <h1 className="ns-page-title">All goals</h1>
          <p className="ns-page-sub">
            Every goal in {project.display_name}, across its whole life —
            filter by status, click through for the full story.
          </p>
        </div>
        <div className="ns-page-actions">
          <GoalGroupEditor projectSlug={slug} goals={editorGoals} />
          <Link href={projectHref(slug, "")} className="ns-btn ns-btn-ghost shrink-0">
            <Plus className="size-3.5" />
            New goal
          </Link>
        </div>
      </header>

      <section className="mb-7" aria-labelledby="goal-groups-heading">
        <h2 id="goal-groups-heading" className="ns-h2 mt-0">
          <span>Groups</span>
          <span className="ns-h2-meta">Dashboards for related goals</span>
        </h2>
        <GoalGroupsOverview groups={groupRows} />
      </section>

      {goals.length === 0 ? (
        <div className="ns-card p-8 text-center">
          <p className="m-0 text-[13.5px] text-[hsl(var(--notfair-ink-3))]">
            No goals yet. State an ambition and NotFair will figure out how to
            measure and chase it.
          </p>
          <Link
            href={projectHref(slug, "")}
            className="ns-btn ns-btn-primary mt-4 inline-flex"
          >
            <Plus className="size-3.5" />
            Create your first goal
          </Link>
        </div>
      ) : (
        <GoalsBoard goals={goals} />
      )}
    </div>
  );
}
