import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/server/db/projects";
import { resolveAgentBySlug } from "@/server/agent-meta";
import {
  getGoalForAgent,
  getLatestGoalForAgent,
  listGatedActions,
  listGoalActions,
  loggedSpendTotal,
  listActionsDueForReview,
  listGoalLearnings,
  listGoalTicks,
  listMetricSnapshots,
  isTargetMet,
  type Goal,
  type GoalTick,
} from "@/server/db/goals";
import {
  listSessionsForAgent,
  pickLatestChatSession,
} from "@/server/sessions/view";
import { readTranscriptTail } from "@/server/sessions/transcript-tail";
import { getMcpCatalog } from "@/server/mcp-catalog";
import { DEFAULT_HARNESS_ADAPTER, requireAdapter } from "@/server/adapters/registry";
import { projectHref } from "@/lib/project-href";
import { goalLabel } from "@/lib/goal-label";
import { formatMetric } from "@/lib/format-metric";
import { GoalMemoryDialog } from "@/components/goal-memory-dialog";
import { Markdown } from "@/components/markdown";
import { GoalContextDialog } from "@/components/goal-context-dialog";
import { cadenceLabel } from "@/lib/goal-cadence";
import { cn } from "@/lib/utils";
import { LiveTranscript } from "@/components/live-transcript";
import { GoalControls } from "@/components/goal-controls";
import { GoalStartButton } from "@/components/goal-start-button";
import { GoalAutoRefresh } from "@/components/goal-auto-refresh";
import { GoalProgressChart } from "@/components/goal-progress-chart";
import { GoalChecksStrip } from "@/components/goal-checks-strip";
import { listGoalPrs, type GoalPr } from "@/server/db/goal-prs";
import { maybeSyncGoalPrs } from "@/server/goals/pr-sync";
import { buildCheckSquares, currentStreak } from "@/lib/goal-streak";

export const dynamic = "force-dynamic";

function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}



const STATUS_CHIP: Record<Goal["status"], string> = {
  intake: "setting up",
  proposed: "ready to start",
  active: "running",
  paused: "paused",
  achieved: "achieved",
  failed: "failed",
  killed: "closed",
};

/**
 * THE goal screen — everything about one goal on a single page. Chat is
 * the primary surface (goals are defined and steered in conversation);
 * the right rail is the loop's state: plan/START, metric + sparkline,
 * tick diary, open actions, memory. No tabs, no thread management — one
 * goal, one conversation, one screen.
 */
export default async function GoalPage({
  params,
}: {
  params: Promise<{ agent: string; project: string }>;
}) {
  const { agent: agentSlug, project: slug } = await params;
  const project = getProject(slug);
  if (!project || project.archived_at) notFound();
  const resolved = await resolveAgentBySlug(slug, agentSlug);
  if (!resolved) notFound();

  const goal =
    getGoalForAgent(resolved.agent_id) ?? getLatestGoalForAgent(resolved.agent_id);
  if (!goal) notFound();

  // One conversation per goal: the newest chat-origin session (the intake
  // kickoff creates it), or "main" for a fresh fallback.
  const sessions = listSessionsForAgent(slug, resolved.agent_id);
  const threadId = pickLatestChatSession(sessions)?.sessionId ?? "main";
  const existing = sessions.find((s) => s.sessionId === threadId);
  const { events: initialEvents, cursor: initialCursor } = readTranscriptTail(
    slug,
    resolved.agent_id,
    threadId,
    0,
  );
  const modelOptions = await requireAdapter(
    project.harness_adapter ?? DEFAULT_HARNESS_ADAPTER,
  ).listModels();
  const mcpCatalog = getMcpCatalog(slug).map((m) => ({
    key: m.key,
    display_name: m.display_name,
    resource_url: m.resource_url,
  }));

  const live = goal.status === "intake" || goal.status === "proposed" || goal.status === "active" || goal.status === "paused";
  const learnings = listGoalLearnings(goal.id, 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Every pre-terminal state before START changes server-side via
          agent tool calls: intake verifies the metric (→ proposed), and a
          proposed goal's target lands via propose_target — which is what
          makes the START button appear. Without polling `proposed`, the
          user is told "press START" but the button never renders until a
          manual reload. */}
      {(goal.status === "intake" ||
        goal.status === "proposed" ||
        goal.status === "active") && <GoalAutoRefresh intervalMs={8000} />}

      {/* Header: the goal is the title. */}
      <header className="flex items-center gap-3 px-5 py-2.5">
        <span className="ns-tag-mono shrink-0">{STATUS_CHIP[goal.status]}</span>
        <h1 className="m-0 min-w-0 truncate text-[14px] font-semibold">
          {goalLabel(goal)}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <GoalContextDialog
            projectSlug={slug}
            agentId={resolved.agent_id}
            threadId={threadId}
            models={modelOptions.map((m) => ({
              value: m.value,
              label: m.label,
              context_window: m.context_window,
            }))}
          />
          <GoalMemoryDialog
            entries={learnings.map((l) => ({
              id: l.id,
              body: l.body,
              confidence: l.confidence,
              created_at: l.created_at,
            }))}
          />
          {live && (
            <GoalControls
              goalId={goal.id}
              status={goal.status as "intake" | "proposed" | "active" | "paused"}
            />
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Chat — the primary surface. */}
        <section className="flex min-w-0 flex-1 flex-col">
          <LiveTranscript
            key={threadId}
            projectSlug={slug}
            agentSlug={agentSlug}
            agentDisplayName={goalLabel(goal)}
            threadId={threadId}
            initialEvents={initialEvents}
            initialCursor={initialCursor}
            mcpCatalog={mcpCatalog}
            modelOptions={modelOptions}
          />
        </section>

        {/* Status rail — the loop's state at a glance. */}
        <aside className="w-[380px] shrink-0 overflow-y-auto bg-[hsl(var(--notfair-surface-2)/0.4)] px-4 py-4">
          <GoalRail slug={slug} agentSlug={agentSlug} goal={goal} />
        </aside>
      </div>
    </div>
  );
}

function GoalRail({
  slug,
  agentSlug,
  goal,
}: {
  slug: string;
  agentSlug: string;
  goal: Goal;
}) {
  const snapshots = listMetricSnapshots(goal.id, 400);
  const ticks = listGoalTicks(goal.id, 60);
  const dueActions = listActionsDueForReview(goal.id);
  const gatedActions = listGatedActions(goal.id);
  const allActions = listGoalActions(goal.id, 100);
  const targetMet = isTargetMet(goal);
  const tickRunning = ticks.some((t) => t.status === "running");
  // PRs the agent opened against the codebase. Kick a background GitHub
  // sync when rows look stale — the page's auto-refresh poll picks up the
  // fresh state a moment later without blocking this render.
  const prs = listGoalPrs(goal.id, 10);
  if (prs.some((pr) => pr.state === "open")) maybeSyncGoalPrs(goal.id);

  // Chart data — plain-JSON props for the client component.
  const chartPoints = snapshots.map((sn) => ({
    t: Date.parse(sn.created_at),
    v: sn.value,
    source: sn.source,
  }));
  const chartActions = allActions
    .filter((a) => a.kind === "mutation")
    .map((a) => ({
      t: Date.parse(a.created_at),
      kind: a.kind,
      label: a.description,
      expected: a.expected_effect,
      observed: a.observed_outcome,
      reviewUntil:
        a.status === "open" && a.review_after ? Date.parse(a.review_after) : null,
    }));
  const chartFailures = ticks
    .filter((t) => t.metric_error || t.status === "failed")
    .map((t) => ({
      t: Date.parse(t.started_at),
      error: t.metric_error ?? t.summary ?? "check failed",
    }));
  const mutationTicks = new Set(
    allActions.filter((a) => a.kind === "mutation").map((a) => a.tick_number),
  );
  const squares = buildCheckSquares(
    ticks
      .filter((t) => t.status !== "running" && t.trigger_kind !== "intake")
      .map((t) => ({
        tick_number: t.tick_number,
        started_at: t.started_at,
        metric_value: t.metric_value,
        status: t.status,
        acted: mutationTicks.has(t.tick_number),
      })),
    goal.target_value,
    goal.metric_direction,
  );
  const streak = currentStreak(squares);

  return (
    <div className="flex flex-col gap-5">
      {/* Statement */}
      <p className="m-0 text-[12.5px] leading-relaxed text-[hsl(var(--notfair-ink-3))]">
        “{goal.statement}”
      </p>

      {/* Lifecycle-specific card */}
      {goal.status === "intake" && (
        <RailCard>
          <p className="m-0 text-[12.5px] leading-relaxed">
            The agent is working out how to <b>measure</b> this — watch the
            chat. It will verify a metric, show you the baseline, and propose
            a plan. Nothing touches your account yet.
          </p>
        </RailCard>
      )}

      {goal.status === "proposed" && (
        <RailCard>
          {goal.target_value !== null ? (
            <>
              <p className="m-0 mb-3 text-[12.5px] leading-relaxed">
                Baseline <b className="tabular-nums">{formatMetric(goal.baseline_value)}</b>,
                verified against{" "}
                <span className="font-mono text-[11px]">{goal.metric_source_key}</span>.
                The plan is agreed — the loop starts when you press START, and
                the first check runs immediately.
              </p>
              <dl className="mb-3 grid grid-cols-2 gap-2 text-[12px]">
                <RailStat k="Target" v={`${formatMetric(goal.target_value)}${goal.mode === "maintain" ? " (hold)" : ""}`} />
                <RailStat k="Heartbeat" v={cadenceLabel(goal.cadence_cron)} />
                <RailStat k="Deadline" v={goal.deadline ? fmtDate(goal.deadline) : "none"} />
                <RailStat
                  k="Spend cap"
                  v={goal.spend_envelope_usd !== null ? `$${goal.spend_envelope_usd}` : "none"}
                />
              </dl>
              <GoalStartButton goalId={goal.id} />
            </>
          ) : (
            <p className="m-0 text-[12.5px] leading-relaxed">
              Metric verified — baseline{" "}
              <b className="tabular-nums">{formatMetric(goal.baseline_value)}</b>. Agree the
              target in chat and the START button appears here.
            </p>
          )}
        </RailCard>
      )}

      {(goal.status === "active" ||
        goal.status === "paused" ||
        goal.status === "achieved" ||
        goal.status === "failed" ||
        goal.status === "killed") && (
        <>
          <RailCard>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] text-[hsl(var(--notfair-ink-4))]">
                {goal.metric_name ?? "Metric"}
              </span>
              {targetMet && (
                <span className="ns-tag">
                  {goal.mode === "maintain" ? "holding" : "target met"}
                </span>
              )}
              {tickRunning && <span className="ns-tag">checking…</span>}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold tabular-nums">
                {formatMetric(goal.current_value)}
              </span>
              <span className="text-[11.5px] tabular-nums text-[hsl(var(--notfair-ink-4))]">
                target {formatMetric(goal.target_value)}
                {goal.mode === "maintain" ? " (hold)" : ""} · baseline {formatMetric(goal.baseline_value)}
              </span>
            </div>
            {goal.mode === "maintain" && (
              <div className="mt-3">
                <GoalChecksStrip squares={squares} streak={streak} />
              </div>
            )}
            <div className="mt-3">
              <GoalProgressChart
                points={chartPoints}
                actions={chartActions}
                failures={chartFailures}
                target={goal.target_value}
                baseline={goal.baseline_value}
                deadline={goal.deadline ? Date.parse(goal.deadline) : null}
              />
            </div>
            <p className="mt-1.5 mb-0 text-[11px] leading-relaxed text-[hsl(var(--notfair-ink-4))]">
              {cadenceLabel(goal.cadence_cron)} · next check{" "}
              {goal.status === "active" ? fmtDate(goal.next_tick_at) : "—"} ·{" "}
              {goal.tick_count} check{goal.tick_count === 1 ? "" : "s"} so far
              {goal.spend_envelope_usd !== null &&
                ` · spent $${loggedSpendTotal(goal.id)} of $${goal.spend_envelope_usd}`}
            </p>
            {goal.status_reason &&
              (goal.status === "achieved" || goal.status === "failed" || goal.status === "killed") && (
                <Markdown className="mt-2 text-[12px] leading-relaxed text-[hsl(var(--notfair-ink-3))] [&_p]:m-0">
                  {goal.status_reason}
                </Markdown>
              )}
          </RailCard>

          {(dueActions.length > 0 || gatedActions.length > 0) && (
            <div>
              <RailHeading>Open actions</RailHeading>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {dueActions.map((a) => (
                  <li key={a.id} className="text-[12px] leading-snug">
                    <span className="ns-tag">review due</span>{" "}
                    <Markdown className="inline text-[12px] text-[hsl(var(--notfair-ink-3))] [&_p]:m-0 [&_p]:inline">
                      {a.description}
                    </Markdown>
                  </li>
                ))}
                {gatedActions.map((a) => (
                  <li key={a.id} className="text-[12px] leading-snug">
                    <span className="ns-tag-mono">observing → {fmtDate(a.review_after)}</span>{" "}
                    <Markdown className="inline text-[12px] text-[hsl(var(--notfair-ink-3))] [&_p]:m-0 [&_p]:inline">
                      {a.description}
                    </Markdown>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {prs.length > 0 && (
            <div>
              <RailHeading>Pull requests</RailHeading>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {prs.map((pr) => (
                  <PrItem key={pr.id} pr={pr} />
                ))}
              </ul>
            </div>
          )}

          <div>
            <RailHeading>Checks</RailHeading>
            {ticks.length === 0 ? (
              <p className="m-0 text-[12px] text-[hsl(var(--notfair-ink-4))]">
                None yet — the first runs at {fmtDate(goal.next_tick_at)}.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {ticks.map((t) => (
                  <TickItem key={t.id} slug={slug} agentSlug={agentSlug} goal={goal} tick={t} />
                ))}
              </ul>
            )}
          </div>

        </>
      )}
    </div>
  );
}

function TickItem({
  slug,
  agentSlug,
  goal,
  tick,
}: {
  slug: string;
  agentSlug: string;
  goal: Goal;
  tick: GoalTick;
}) {
  const threadLabel = tick.trigger_kind === "intake" ? "main" : `tick-${tick.tick_number}`;
  return (
    <li className="text-[12px] leading-snug">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          Check {tick.tick_number}
          {tick.metric_value !== null && (
            <span className={cn("ml-1.5 tabular-nums font-normal text-[hsl(var(--notfair-ink-3))]")}>
              → {formatMetric(tick.metric_value)}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[10.5px] tabular-nums text-[hsl(var(--notfair-ink-4))]">
          {timeAgo(tick.started_at)}
        </span>
      </div>
      {tick.metric_error && (
        <p className="m-0 text-[11.5px] text-[hsl(0_72%_51%)]">{tick.metric_error}</p>
      )}
      <div className="line-clamp-2 text-[11.5px] text-[hsl(var(--notfair-ink-4))]">
        <Markdown className="text-[11.5px] text-[hsl(var(--notfair-ink-4))] [&_p]:m-0 [&_p]:inline [&_p+p]:before:content-['_']">
          {tick.status === "running"
            ? "running…"
            : tick.status === "failed"
              ? `failed: ${tick.summary ?? "(no detail)"}`
              : tick.summary ?? "(no summary)"}
        </Markdown>
      </div>
      {tick.session_id && tick.status !== "running" && (
        <Link
          href={projectHref(slug, `/goals/${agentSlug}/checks/${threadLabel}`)}
          className="ns-link text-[10.5px]"
        >
          details ›
        </Link>
      )}
    </li>
  );
}

function PrItem({ pr }: { pr: GoalPr }) {
  const needsReview =
    pr.state === "open" &&
    !pr.is_draft &&
    pr.review_decision !== "CHANGES_REQUESTED";
  return (
    <li className="text-[12px] leading-snug">
      <div className="flex items-baseline justify-between gap-2">
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="ns-link min-w-0 truncate font-medium"
        >
          {pr.title}
        </a>
        <span className="shrink-0 text-[10.5px] tabular-nums text-[hsl(var(--notfair-ink-4))]">
          {timeAgo(pr.created_at)}
        </span>
      </div>
      <p className="m-0 mt-0.5 flex flex-wrap items-center gap-1.5">
        {pr.state === "merged" ? (
          <span className="ns-tag">merged</span>
        ) : pr.state === "closed" ? (
          <span className="ns-tag-red">closed unmerged</span>
        ) : pr.is_draft ? (
          <span className="ns-tag">draft</span>
        ) : pr.review_decision === "CHANGES_REQUESTED" ? (
          <span className="ns-tag-amber">changes requested — agent's turn</span>
        ) : (
          <span className="ns-tag-accent">needs your review</span>
        )}
        {pr.comment_count > 0 && (
          <span className="text-[11px] text-[hsl(var(--notfair-ink-4))]">
            {pr.comment_count} comment{pr.comment_count === 1 ? "" : "s"}
          </span>
        )}
        {pr.branch && <span className="ns-tag-mono">{pr.branch}</span>}
      </p>
      {pr.sync_error && (
        <p className="m-0 mt-0.5 text-[11px] text-[hsl(var(--notfair-warn))]">
          sync failed: {pr.sync_error}
        </p>
      )}
    </li>
  );
}

function RailCard({ children }: { children: React.ReactNode }) {
  return <div className="ns-card p-3.5">{children}</div>;
}

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--notfair-ink-4))]">
      {children}
    </p>
  );
}

function RailStat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[hsl(var(--notfair-ink-4))]">{k}</dt>
      <dd className="m-0 font-medium tabular-nums">{v}</dd>
    </div>
  );
}
