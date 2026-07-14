import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getProject } from "@/server/db/projects";
import { listProjectAgents } from "@/server/agent-meta";
import {
  getGoalForAgent,
  getLatestGoalForAgent,
  listMetricSnapshots,
  type Goal,
} from "@/server/db/goals";
import { listProjectMcpTokens } from "@/server/mcp/tokens";
import { listPrsAwaitingReview } from "@/server/db/goal-prs";
import { listOpenSuggestions } from "@/server/db/suggestions";
import {
  listSuggestionRuns,
  maybeAutoGenerate,
} from "@/server/suggestions/engine";
import { projectHref } from "@/lib/project-href";
import { colorForAgentSlug } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";
import { NewGoalForm } from "@/components/new-goal-form";
import { goalLabel } from "@/lib/goal-label";
import { formatMetric } from "@/lib/format-metric";
import { GoalSparkline } from "@/components/goal-sparkline";
import {
  GoalSuggestionCard,
  RetryAnalysisButton,
} from "@/components/goal-suggestions";
import { GoalAutoRefresh } from "@/components/goal-auto-refresh";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<Goal["status"], string> = {
  intake: "defining the goal",
  proposed: "awaiting your target",
  active: "loop running",
  paused: "paused",
  achieved: "achieved",
  failed: "failed",
  killed: "closed",
};

/**
 * Project root = the goals index. Agent = goal: each row is an agent and
 * the goal it owns. Minting a new agent is the only creation flow — the
 * goal itself gets defined in that agent's chat.
 */
export default async function ProjectGoalsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project: slug } = await params;
  const project = getProject(slug);
  if (!project || project.archived_at) notFound();

  const agents = await listProjectAgents(slug);
  const rows = agents.map((a) => {
    const goal = getGoalForAgent(a.agent_id) ?? getLatestGoalForAgent(a.agent_id);
    const snapshots = goal ? listMetricSnapshots(goal.id, 120) : [];
    // 7-day delta: latest vs the closest snapshot at least 7 days old
    // (else the earliest we have).
    let delta: number | null = null;
    if (goal && snapshots.length >= 2) {
      const latest = snapshots[snapshots.length - 1]!;
      const cutoff = Date.parse(latest.created_at) - 7 * 86_400_000;
      const past =
        [...snapshots].reverse().find((sn) => Date.parse(sn.created_at) <= cutoff) ??
        snapshots[0]!;
      delta = latest.value - past.value;
    }
    return { agent: a, goal, snapshots, delta };
  });
  const connectedMcpKeys = listProjectMcpTokens(slug).map((t) => t.server_name);
  const connectedCount = connectedMcpKeys.length;
  // Goals with a PR sitting on the user's side of the net — surfaced as a
  // badge on the row so review requests are visible from the index.
  const goalIdsAwaitingPrReview = new Set(
    listPrsAwaitingReview(slug).map((pr) => pr.goal_id),
  );

  // Account analysis → suggested goals. First index visit after a connect
  // (or after a restart dropped a run) kicks the audit in the background;
  // the page then live-refreshes until the cards land.
  maybeAutoGenerate(slug);
  const suggestions = listOpenSuggestions(slug);
  const suggestionRuns = listSuggestionRuns(slug);
  const analyzing = suggestionRuns.filter((r) => r.status === "running");
  const failedRuns = suggestionRuns.filter((r) => r.status === "failed");

  return (
    <div className="ns-app-wide">
      <header className="ns-page-head">
        <div className="ns-page-head-stack">
          <h1 className="ns-page-title">{project.display_name}</h1>
          <p className="ns-page-sub">
            State a goal. It gets measured, you press START, the loop runs.
          </p>
        </div>
      </header>

      <div className="mb-6">
        <NewGoalForm projectSlug={slug} connectedMcpKeys={connectedMcpKeys} />
      </div>

      {connectedCount === 0 && (
        <Link
          href={projectHref(slug, "/connections")}
          className="mb-6 block rounded-[14px] bg-[hsl(var(--notfair-accent)/0.08)] px-4 py-3 text-[13px]"
        >
          No data sources connected yet — connect Google Ads, Meta Ads, or Search
          Console so your agents can measure anything. Connect →
        </Link>
      )}

      {(analyzing.length > 0 || suggestions.length > 0 || failedRuns.length > 0) && (
        <section className="mb-6">
          <h2 className="m-0 mb-2 text-[12px] font-medium uppercase tracking-wide text-[hsl(var(--notfair-ink-4))]">
            Suggested from your account
          </h2>
          <div className="flex flex-col gap-3">
            {analyzing.map((run) => (
              <div
                key={run.source_key}
                className="ns-card flex items-center gap-2.5 p-4 text-[13px] text-[hsl(var(--notfair-ink-3))]"
              >
                <span
                  className="size-2 animate-pulse rounded-full bg-[hsl(var(--notfair-accent))]"
                  aria-hidden
                />
                Analyzing your {run.label} account for goal ideas…
              </div>
            ))}
            {suggestions.map((s) => (
              <GoalSuggestionCard key={s.id} suggestion={s} projectSlug={slug} />
            ))}
            {failedRuns.map((run) => (
              <div
                key={run.source_key}
                className="ns-card flex items-center justify-between gap-3 p-4 text-[12.5px] text-[hsl(var(--notfair-ink-3))]"
              >
                <span>
                  Couldn&rsquo;t analyze your {run.label} account
                  {run.error ? ` — ${run.error}` : "."}
                </span>
                <RetryAnalysisButton projectSlug={slug} />
              </div>
            ))}
          </div>
          {analyzing.length > 0 && <GoalAutoRefresh intervalMs={2500} />}
        </section>
      )}

      {rows.length === 0 ? (
        <div className="ns-empty">
          <p className="ns-empty-title">No goals yet.</p>
          <p className="ns-empty-sub">
            State an ambition above and an agent takes it from there.
          </p>
        </div>
      ) : (
        <ol className="ns-group">
          {rows.map(({ agent, goal, snapshots, delta }) => {
            const color = colorForAgentSlug(agent.slug);
            const deltaGood =
              goal && delta !== null
                ? goal.metric_direction === "decrease"
                  ? delta <= 0
                  : delta >= 0
                : null;
            return (
              <li key={agent.agent_id}>
                <Link
                  href={projectHref(slug, `/goals/${agent.slug}`)}
                  className="ns-row-button"
                >
                  <span className="ns-glyph" aria-hidden>
                    <span className={cn("size-2.5 rounded-full", color.dot)} />
                  </span>
                  <span className="ns-row-body">
                    <span className="ns-row-title-row">
                      <span className="ns-row-title">{goal ? goalLabel(goal) : agent.name}</span>
                      {goal && <span className="ns-tag">{STATUS_LABEL[goal.status]}</span>}
                      {goal && goalIdsAwaitingPrReview.has(goal.id) && (
                        <span className="ns-tag-accent">PR needs your review</span>
                      )}
                    </span>
                    <span className="ns-row-desc block">
                      {goal?.statement?.trim()
                        ? goal.statement
                        : "Getting started — the agent is working on it."}
                    </span>
                    {goal?.status === "active" &&
                      goal.current_value !== null &&
                      goal.target_value !== null && (
                        <span className="ns-row-desc block tabular-nums">
                          {goal.metric_name}: {formatMetric(goal.current_value)} → target {formatMetric(goal.target_value)}
                        </span>
                      )}
                  </span>
                  <span className="ns-row-meta items-center gap-3">
                    {goal && snapshots.length >= 2 && (
                      <span className="hidden w-28 sm:block" aria-hidden>
                        <GoalSparkline
                          values={snapshots.map((sn) => sn.value)}
                          target={goal.target_value}
                          direction={goal.metric_direction}
                          width={112}
                          height={28}
                        />
                      </span>
                    )}
                    {delta !== null && (
                      <span
                        className={
                          "text-[11.5px] tabular-nums " +
                          (deltaGood
                            ? "text-[hsl(var(--notfair-accent))]"
                            : "text-[hsl(0_60%_55%)]")
                        }
                        title="Change over the last 7 days"
                      >
                        {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}{" "}
                        {Math.abs(delta) >= 1000
                          ? `${(Math.abs(delta) / 1000).toFixed(1)}k`
                          : Number.isInteger(delta)
                            ? Math.abs(delta)
                            : Math.abs(delta).toFixed(2)}{" "}
                        /7d
                      </span>
                    )}
                    <MessageSquare className="size-4 text-[hsl(var(--notfair-ink-4))]" />
                    <span className="chev" aria-hidden>
                      ›
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
