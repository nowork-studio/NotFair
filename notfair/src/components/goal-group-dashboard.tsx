import Link from "next/link";
import { Activity, ArrowLeft, Clock3 } from "lucide-react";
import { GoalSparkline } from "@/components/goal-sparkline";
import { formatMetric } from "@/lib/format-metric";
import { goalGroupHealth, countGoalGroupHealth } from "@/lib/goal-group-health";
import { cadenceLabel } from "@/lib/goal-cadence";
import { timeAgo, timeUntil } from "@/lib/time-ago";
import { cn } from "@/lib/utils";
import { type GoalStatus, type GoalTickStatus, type MetricDirection } from "@/server/db/goals";
import { type ReactNode } from "react";

export type GoalGroupDashboardGoal = {
  id: string;
  href: string;
  label: string;
  statement: string;
  status: GoalStatus;
  status_reason: string | null;
  metric_name: string | null;
  current_value: number | null;
  target_value: number | null;
  metric_direction: MetricDirection | null;
  cadence_cron: string;
  last_tick_at: string | null;
  next_tick_at: string | null;
  tick_count: number;
  snapshots: number[];
};

export type GoalGroupActivity = {
  id: string;
  goal_id: string;
  goal_href: string;
  goal_label: string;
  tick_number: number;
  status: GoalTickStatus;
  metric_value: number | null;
  metric_error: string | null;
  summary: string | null;
  started_at: string;
};

const HEALTH_COPY = {
  healthy: { label: "healthy", dot: "ns-dot-live", text: "text-[hsl(var(--notfair-accent))]" },
  attention: { label: "needs attention", dot: "ns-dot-err", text: "text-[hsl(var(--destructive))]" },
  waiting: { label: "waiting for data", dot: "ns-dot-warn", text: "text-[hsl(var(--notfair-warn))]" },
  paused: { label: "paused", dot: "ns-dot-mute", text: "text-[hsl(var(--notfair-ink-4))]" },
  closed: { label: "closed", dot: "ns-dot-mute", text: "text-[hsl(var(--notfair-ink-4))]" },
} as const;

function latestIso(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function earliestIso(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(0) ?? null;
}

function plainSummary(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function GoalGroupDashboard({
  name,
  description,
  allGoalsHref,
  goals,
  activity,
  actions,
}: {
  name: string;
  description: string;
  allGoalsHref: string;
  goals: GoalGroupDashboardGoal[];
  activity: GoalGroupActivity[];
  actions?: ReactNode;
}) {
  const counts = countGoalGroupHealth(goals);
  const latestCheck = latestIso(goals.map((goal) => goal.last_tick_at));
  const nextCheck = earliestIso(goals.map((goal) => goal.next_tick_at));

  return (
    <div className="ns-app-wide">
      <Link
        href={allGoalsHref}
        className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] text-[hsl(var(--notfair-ink-4))] hover:text-[hsl(var(--notfair-ink-2))]"
      >
        <ArrowLeft className="size-3.5" />
        All goals
      </Link>
      <header className="ns-page-head">
        <div className="ns-page-head-stack">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="ns-tag-mono">goal group</span>
            <span className="text-[11px] tabular-nums text-[hsl(var(--notfair-ink-4))]">
              {goals.length} goal{goals.length === 1 ? "" : "s"}
            </span>
          </div>
          <h1 className="ns-page-title">{name}</h1>
          <p className="ns-page-sub">{description || "A shared dashboard for related goals."}</p>
        </div>
        <div className="ns-page-actions">{actions}</div>
      </header>

      {goals.length === 0 ? (
        <div className="ns-empty">
          <p className="ns-empty-title">This group is ready for goals.</p>
          <p className="ns-empty-sub">
            Use Manage group to add existing goals. Their schedules and history stay unchanged.
          </p>
        </div>
      ) : (
        <>
          <section
            aria-label="Group health summary"
            className="mb-7 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-[hsl(var(--notfair-surface-2)/0.5)] px-4 py-3 text-[12px]"
          >
            {counts.healthy > 0 && (
              <span className="flex items-center gap-1.5 text-[hsl(var(--notfair-accent))]">
                <span className="ns-dot ns-dot-live" aria-hidden />
                {counts.healthy} healthy
              </span>
            )}
            {counts.attention > 0 && (
              <span className="flex items-center gap-1.5 text-[hsl(var(--destructive))]">
                <span className="ns-dot ns-dot-err" aria-hidden />
                {counts.attention} need{counts.attention === 1 ? "s" : ""} attention
              </span>
            )}
            {counts.waiting > 0 && <span className="text-[hsl(var(--notfair-ink-4))]">{counts.waiting} waiting for data</span>}
            {counts.paused > 0 && <span className="text-[hsl(var(--notfair-ink-4))]">{counts.paused} paused</span>}
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[10.5px] text-[hsl(var(--notfair-ink-4))]">
              <Clock3 className="size-3" />
              {latestCheck ? `last check ${timeAgo(latestCheck)}` : "no checks yet"}
              {nextCheck ? ` · next ${timeUntil(nextCheck)}` : ""}
            </span>
          </section>

          <section aria-labelledby="group-metrics-heading">
            <h2 id="group-metrics-heading" className="ns-h2">
              <span>Metrics</span>
              <span className="ns-h2-meta">Each goal keeps its own threshold</span>
            </h2>
            <ol className="ns-group">
              {goals.map((goal) => {
                const health = goalGroupHealth(goal);
                const healthCopy = HEALTH_COPY[health];
                const comparator = goal.metric_direction === "decrease" ? "≤" : "≥";
                return (
                  <li key={goal.id}>
                    <Link
                      href={goal.href}
                      className="grid min-h-[116px] grid-cols-1 items-center gap-4 px-4 py-4 transition-colors hover:bg-[hsl(var(--notfair-hover))] sm:grid-cols-[minmax(0,1.25fr)_150px_180px_auto]"
                    >
                      <span className="min-w-0">
                        <span className="mb-1 flex items-center gap-2">
                          <span className={cn("ns-dot", healthCopy.dot)} aria-hidden />
                          <span className="truncate text-[13.5px] font-medium">{goal.label}</span>
                        </span>
                        <span className="block truncate text-[11.5px] text-[hsl(var(--notfair-ink-4))]">
                          {goal.metric_name ?? "Metric is still being defined"}
                        </span>
                        <span className="mt-2 block font-mono text-[10.5px] text-[hsl(var(--notfair-ink-4))]">
                          {cadenceLabel(goal.cadence_cron)} · {goal.tick_count} check{goal.tick_count === 1 ? "" : "s"}
                        </span>
                      </span>

                      <span>
                        <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-[hsl(var(--notfair-ink-4))]">
                          current / target
                        </span>
                        <span className="mt-1 block text-[20px] font-semibold tabular-nums tracking-[-0.02em]">
                          {formatMetric(goal.current_value)}
                          <span className="ml-1.5 text-[12px] font-normal text-[hsl(var(--notfair-ink-4))]">
                            {goal.target_value === null ? "no target" : `${comparator} ${formatMetric(goal.target_value)}`}
                          </span>
                        </span>
                      </span>

                      <span className="hidden sm:block" aria-label={`${goal.label} metric history`}>
                        {goal.snapshots.length >= 2 ? (
                          <GoalSparkline
                            values={goal.snapshots}
                            target={goal.target_value}
                            direction={goal.metric_direction}
                            width={180}
                            height={44}
                          />
                        ) : (
                          <span className="text-[11px] text-[hsl(var(--notfair-ink-4))]">
                            History appears after 2 readings
                          </span>
                        )}
                      </span>

                      <span className={cn("justify-self-start whitespace-nowrap text-[11.5px] sm:justify-self-end", healthCopy.text)}>
                        {healthCopy.label} <span className="ml-1 text-[hsl(var(--notfair-ink-4))]">›</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="group-activity-heading">
            <h2 id="group-activity-heading" className="ns-h2">
              <span>Recent checks</span>
              <span className="ns-h2-meta">Across this group</span>
            </h2>
            {activity.length === 0 ? (
              <div className="rounded-xl bg-[hsl(var(--notfair-surface-2)/0.45)] px-4 py-5 text-[12.5px] text-[hsl(var(--notfair-ink-4))]">
                No checks yet. Activity appears here when a member goal runs its heartbeat.
              </div>
            ) : (
              <ol className="ns-group">
                {activity.map((item) => {
                  const failed = item.status === "failed" || Boolean(item.metric_error);
                  const running = item.status === "running";
                  return (
                    <li key={item.id}>
                      <Link href={item.goal_href} className="ns-row-button">
                        <span className="ns-glyph" aria-hidden>
                          <Activity className="size-4" />
                        </span>
                        <span className="ns-row-body min-w-0">
                          <span className="ns-row-title-row">
                            <span className="ns-row-title">{item.goal_label}</span>
                            <span className="ns-tag-mono">check {item.tick_number}</span>
                          </span>
                          <span className="ns-row-desc block truncate">
                            {plainSummary(item.metric_error || item.summary || (running ? "Check is running…" : "Metric recorded"))}
                          </span>
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px]">
                          {item.metric_value !== null && (
                            <span className="font-mono tabular-nums text-[hsl(var(--notfair-ink-3))]">
                              {formatMetric(item.metric_value)}
                            </span>
                          )}
                          <span
                            className={cn(
                              "flex items-center gap-1.5",
                              failed
                                ? "text-[hsl(var(--destructive))]"
                                : running
                                  ? "text-[hsl(var(--notfair-warn))]"
                                  : "text-[hsl(var(--notfair-accent))]",
                            )}
                          >
                            <span className={cn("ns-dot", failed ? "ns-dot-err" : running ? "ns-dot-warn" : "ns-dot-live")} aria-hidden />
                            {running ? "running" : failed ? "failed" : "done"}
                          </span>
                          <span className="font-mono text-[hsl(var(--notfair-ink-4))]">{timeAgo(item.started_at)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
