import { getProject } from "@/server/db/projects";
import { requireAdapter } from "@/server/adapters/registry";
import { workspaceDirFor } from "@/server/agents/provisioning";
import {
  appendTranscriptEvent,
  getOrCreateSession,
  touchSession,
} from "@/server/sessions";
import {
  attachTickSession,
  createGoalTick,
  dueGoals,
  finishGoalTick,
  getGoal,
  getLastFinishedTick,
  isPastDeadline,
  isTargetMet,
  listActionsDueForReview,
  listGatedActions,
  listGatedActionsForOtherAgents,
  listGoalLearnings,
  loggedSpendTotal,
  markGoalTicked,
  recordMetricSnapshot,
  setNextTickAt,
  type Goal,
  type GoalAction,
  type GoalLearning,
  type GoalTick,
  type GoalTickTrigger,
} from "@/server/db/goals";
import { listGoalPrs, type GoalPr } from "@/server/db/goal-prs";
import { syncGoalPrs } from "./pr-sync";
import { measureGoalMetric, type MetricMeasurement } from "./metric";

/**
 * The goal loop's tick runner — one OODA iteration per invocation.
 *
 * A tick: measure the metric mechanically (agent never self-reports) →
 * snapshot → compose the tick brief from DB state → run one adapter turn →
 * record the diary row. Heartbeats are driven by goals.next_tick_at via
 * the shared 30s scheduler interval; manual runs and approval wake-ups
 * call runGoalTick directly.
 */

const MAX_SUMMARY = 4000;

/** In-process re-entrancy guard: one running tick per goal. */
const runningTicks = new Set<string>();

export type TickContext = {
  goal: Goal;
  tickNumber: number;
  nowIso: string;
  measurement: MetricMeasurement;
  targetMet: boolean | null;
  pastDeadline: boolean;
  actionsDueForReview: GoalAction[];
  gatedActions: GoalAction[];
  gatedByOthers: Array<GoalAction & { agent_id: string }>;
  loggedSpendUsd: number;
  recentLearnings: GoalLearning[];
  lastTick: GoalTick | null;
  /** PRs this goal opened against the codebase, freshly synced from GitHub. */
  pullRequests: GoalPr[];
  /** Extra leading section, e.g. an approval decision on wake-up. */
  extraContext?: string;
};

function fmtValue(v: number | null): string {
  return v === null ? "—" : String(v);
}

/** One line of live PR state for the tick brief. */
export function describePrForBrief(pr: GoalPr): string {
  const bits: string[] = [`[${pr.state.toUpperCase()}]`];
  if (pr.state === "open") {
    if (pr.is_draft) bits.push("(draft)");
    if (pr.review_decision === "CHANGES_REQUESTED") {
      bits.push("CHANGES REQUESTED by the user");
    } else if (pr.review_decision === "APPROVED") {
      bits.push("approved, awaiting merge");
    } else {
      bits.push("awaiting the user's review");
    }
    if (pr.comment_count > 0) bits.push(`${pr.comment_count} comment(s)/review(s)`);
  } else if (pr.state === "merged") {
    bits.push(`merged ${pr.merged_at ?? ""}`.trim());
  } else {
    bits.push("closed WITHOUT merge");
  }
  if (pr.sync_error) bits.push(`(last sync failed: ${pr.sync_error})`);
  return `${pr.title} — ${pr.url} — ${bits.join(", ")}${pr.action_id ? ` — linked action ${pr.action_id}` : ""}`;
}

function daysUntil(deadline: string, nowIso: string): number {
  return Math.ceil(
    (new Date(deadline).getTime() - new Date(nowIso).getTime()) / 86_400_000,
  );
}

/**
 * Compose the tick brief. Pure — everything volatile the agent needs is
 * injected here so the turn is self-sufficient even after the agent's
 * context has rotated. Kept scannable: the agent's protocol lives in its
 * identity; this message carries only the live state.
 */
export function buildTickMessage(ctx: TickContext): string {
  const { goal } = ctx;
  const lines: string[] = [];

  lines.push(`[TICK] Goal heartbeat #${ctx.tickNumber} — ${ctx.nowIso}`);
  lines.push("");

  if (ctx.extraContext) {
    lines.push(ctx.extraContext.trim());
    lines.push("");
  }

  lines.push("## Metric (measured by the platform just now)");
  if (ctx.measurement.ok) {
    lines.push(`- ${goal.metric_name ?? "metric"}: **${ctx.measurement.value}**`);
  } else {
    lines.push(`- MEASUREMENT FAILED: ${ctx.measurement.error}`);
    lines.push(
      "- Diagnose before anything else. If the query is broken, fix your approach; if the connection/token is broken, call update_goal_status with status=paused and a reason quoting this error so the user can reconnect.",
    );
  }
  lines.push(
    `- Baseline: ${fmtValue(goal.baseline_value)} | Target: ${fmtValue(goal.target_value)} (${goal.metric_direction ?? "?"})`,
  );
  lines.push("");

  lines.push("## Stop-condition flags");
  if (goal.mode === "maintain") {
    lines.push(
      `- holding_at_target: ${ctx.targetMet === null ? "unknown" : ctx.targetMet} — MAINTAIN goal: target met is the steady state, NOT a reason to close. Watch for drift; act only when the number leaves target.`,
    );
  } else {
    lines.push(`- target_met: ${ctx.targetMet === null ? "unknown" : ctx.targetMet}`);
  }
  if (goal.deadline) {
    const d = daysUntil(goal.deadline, ctx.nowIso);
    lines.push(
      `- deadline: ${goal.deadline} (${ctx.pastDeadline ? "PASSED" : `${d} day${d === 1 ? "" : "s"} left`})`,
    );
  } else {
    lines.push("- deadline: none");
  }
  lines.push(
    goal.spend_envelope_usd !== null
      ? `- spend: $${ctx.loggedSpendUsd} logged of $${goal.spend_envelope_usd} envelope — a hard ceiling. Log spend_usd on every spend-committing action; if the right move would cross the ceiling, don't act — suggest amend_goal to the user in your summary.`
      : "- spend envelope: none set — treat any NEW incremental spend as out of bounds until the user sets one (they can, via amend_goal in chat).",
  );
  if ((ctx.targetMet && goal.mode !== "maintain") || ctx.pastDeadline) {
    lines.push(
      "- A stop condition looks met. Verify against the measured metric and close the goal with update_goal_status before doing anything else.",
    );
  }
  lines.push("");

  lines.push("## Actions due for review (score these FIRST via review_goal_action)");
  if (ctx.actionsDueForReview.length === 0) {
    lines.push("- none");
  } else {
    for (const a of ctx.actionsDueForReview.slice(0, 10)) {
      lines.push(
        `- [${a.id}] ${a.description} — expected: ${a.expected_effect} (review was due ${a.review_after})`,
      );
    }
  }
  lines.push("");

  lines.push("## Actions still gated (their resources are UNTOUCHABLE)");
  if (ctx.gatedActions.length === 0) {
    lines.push("- none");
  } else {
    for (const a of ctx.gatedActions.slice(0, 10)) {
      const resources = JSON.parse(a.resources_touched_json || "[]") as string[];
      lines.push(
        `- [${a.id}] ${a.description} — resources: ${resources.join(", ") || "(unspecified)"} — until ${a.review_after}`,
      );
    }
  }
  lines.push("");

  if (ctx.gatedByOthers.length > 0) {
    lines.push(
      "## Gated by OTHER agents in this workspace (equally untouchable)",
    );
    for (const a of ctx.gatedByOthers.slice(0, 10)) {
      const resources = JSON.parse(a.resources_touched_json || "[]") as string[];
      lines.push(
        `- (${a.agent_id}) ${a.description} — resources: ${resources.join(", ") || "(unspecified)"} — until ${a.review_after}`,
      );
    }
    lines.push("");
  }

  if (ctx.pullRequests.length > 0) {
    lines.push("## Your pull requests (state synced from GitHub just now)");
    for (const pr of ctx.pullRequests.slice(0, 6)) {
      lines.push(`- ${describePrForBrief(pr)}`);
    }
    lines.push(
      "- PR rules: the user merges, never you. CHANGES_REQUESTED → address the review comments this tick and push to the same branch. Open + unreviewed → nudge the user in your diary, don't duplicate the work. Merged → the change is live; its observation window runs from the merge. Closed unmerged → treat as rejected: review the linked action with that outcome and learn from it.",
    );
    lines.push("");
  }

  lines.push("## Recent learnings");
  if (ctx.recentLearnings.length === 0) {
    lines.push("- none yet — use search_learnings for older ones once they exist");
  } else {
    for (const l of ctx.recentLearnings.slice(0, 8)) {
      lines.push(`- (${l.confidence}) ${l.body}`);
    }
  }
  lines.push("");

  if (ctx.lastTick) {
    lines.push(
      `## Last tick\n#${ctx.lastTick.tick_number} (${ctx.lastTick.status}): ${ctx.lastTick.summary ?? "(no summary)"}`,
    );
    lines.push("");
  }

  lines.push(
    "Follow the tick protocol from your identity: review first → check stop conditions → respect the gate → at most ONE meaningful move (log it before executing) → end with a short diary line.",
  );

  return lines.join("\n");
}

/**
 * Run one tick for a goal. Fire-and-forget safe: never throws; every
 * failure lands on the goal_ticks row so the diary shows it.
 */
export async function runGoalTick(
  goalRef: Goal | string,
  trigger: GoalTickTrigger,
  opts: { extraContext?: string } = {},
): Promise<void> {
  const goalId = typeof goalRef === "string" ? goalRef : goalRef.id;
  // Re-read: the caller's snapshot may be stale (paused/killed since).
  const goal = getGoal(goalId);
  if (!goal || goal.status !== "active") return;
  if (runningTicks.has(goal.id)) {
    console.warn(`[goal-tick] tick already running for goal ${goal.id}; skipping`);
    return;
  }
  runningTicks.add(goal.id);
  try {
    await runGoalTickInner(goal, trigger, opts);
  } catch (err) {
    console.error(`[goal-tick] tick failed for goal ${goal.id}:`, err);
  } finally {
    runningTicks.delete(goal.id);
  }
}

async function runGoalTickInner(
  goal: Goal,
  trigger: GoalTickTrigger,
  opts: { extraContext?: string },
): Promise<void> {
  const project = getProject(goal.project_slug);
  if (!project) {
    console.error(`[goal-tick] project not found: ${goal.project_slug}`);
    return;
  }

  // Advance the heartbeat immediately (double-fire guard) and claim the
  // tick number.
  const tickNumber = markGoalTicked(goal.id);
  const nowIso = new Date().toISOString();

  // Ground truth first: the platform measures, not the agent — and PR
  // state comes from GitHub, not from what the agent remembers.
  const measurement = await measureGoalMetric(goal);
  if (measurement.ok) {
    recordMetricSnapshot(goal.id, measurement.value, "tick");
  }
  await syncGoalPrs(goal.id);
  const freshGoal = getGoal(goal.id)!;

  const tick = createGoalTick({
    goal_id: goal.id,
    tick_number: tickNumber,
    trigger_kind: trigger,
    metric_value: measurement.ok ? measurement.value : null,
    metric_error: measurement.ok ? null : measurement.error,
  });

  const message = buildTickMessage({
    goal: freshGoal,
    tickNumber,
    nowIso,
    measurement,
    targetMet: isTargetMet(freshGoal),
    pastDeadline: isPastDeadline(freshGoal, nowIso),
    actionsDueForReview: listActionsDueForReview(goal.id, nowIso),
    gatedActions: listGatedActions(goal.id, nowIso),
    gatedByOthers: listGatedActionsForOtherAgents(goal.project_slug, goal.id, nowIso),
    loggedSpendUsd: loggedSpendTotal(goal.id),
    recentLearnings: listGoalLearnings(goal.id, 8),
    lastTick: getLastFinishedTick(goal.id),
    pullRequests: listGoalPrs(goal.id, 6),
    extraContext: opts.extraContext,
  });

  try {
    const { sessionId, summary } = await streamAgentTurn({
      projectSlug: project.slug,
      harnessAdapter: project.harness_adapter,
      agentId: goal.agent_id,
      sessionLabel: `tick-${tickNumber}`,
      message,
      source: "goal-tick",
    });
    attachTickSession(tick.id, sessionId);
    finishGoalTick(tick.id, "done", summary);
    smartSleep(goal.id);
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    finishGoalTick(tick.id, "failed", messageText);
  }
}

/**
 * Smart sleep: when the tick ends with no reviews pending and every open
 * mutation still inside its observation window, the next heartbeat is
 * pushed to the earliest review date — waking an LLM daily to conclude
 * "nothing to do until Jul 16" burns tokens for nothing. Never moves the
 * heartbeat earlier than the cron already scheduled, never past the
 * deadline, and the user's "Run tick now" always works regardless.
 */
function smartSleep(goalId: string): void {
  const goal = getGoal(goalId);
  if (!goal || goal.status !== "active" || !goal.next_tick_at) return;
  const nowIso = new Date().toISOString();
  if (listActionsDueForReview(goal.id, nowIso).length > 0) return;
  // An open PR means external state can flip any day (review comments,
  // merge) and the agent must react on cadence — never oversleep it.
  if (listGoalPrs(goal.id, 10).some((pr) => pr.state === "open")) return;
  const gated = listGatedActions(goal.id, nowIso);
  if (gated.length === 0) return;
  const earliestReview = gated
    .map((a) => a.review_after!)
    .sort()[0]!;
  if (earliestReview <= goal.next_tick_at) return;
  const capped =
    goal.deadline && goal.deadline < earliestReview ? goal.deadline : earliestReview;
  setNextTickAt(goal.id, capped);
}

/**
 * Heartbeat sweep — called from the shared scheduler interval. Ticks run
 * sequentially (there's only ever one live goal per project today, and
 * sequential keeps SQLite + subprocess pressure sane).
 */
export async function runDueGoalTicks(): Promise<void> {
  const due = dueGoals();
  for (const goal of due) {
    await runGoalTick(goal, "heartbeat");
  }
}

/**
 * Run one full agent turn server-side and persist the transcript — the
 * same inline pattern as scheduler dispatchJob / task kickoff. Returns the
 * session id (for the tick diary link) and a truncated summary.
 */
export async function streamAgentTurn(input: {
  projectSlug: string;
  harnessAdapter: "claude-code-local" | "codex-local";
  agentId: string;
  sessionLabel: string;
  message: string;
  source: string;
}): Promise<{ sessionId: string; summary: string | null }> {
  const adapter = requireAdapter(input.harnessAdapter);
  const session = getOrCreateSession({
    project_slug: input.projectSlug,
    agent_id: input.agentId,
    label: input.sessionLabel,
    harness_adapter: input.harnessAdapter,
  });
  appendTranscriptEvent(session.id, "user", { text: input.message, source: input.source });

  let finalText: string | null = null;
  let deltaBuffer = "";
  const errors: { message: string; transient: boolean }[] = [];

  for await (const evt of adapter.execute({
    projectSlug: input.projectSlug,
    agentId: input.agentId,
    workspaceDir: workspaceDirFor(input.agentId),
    message: input.message,
    threadId: session.id,
    harnessSessionId: session.harness_session_id,
  })) {
    if (evt.kind === "session") {
      touchSession(session.id, evt.harnessSessionId);
      continue;
    }
    appendTranscriptEvent(session.id, evt.kind, evt);
    if (evt.kind === "final") {
      finalText = evt.text;
    } else if (evt.kind === "delta" && deltaBuffer.length < MAX_SUMMARY) {
      deltaBuffer += evt.text;
    } else if (evt.kind === "error") {
      errors.push({ message: evt.message, transient: evt.transient ?? false });
    }
  }
  touchSession(session.id);

  if (finalText === null && errors.length > 0) {
    const terminal = [...errors].reverse().find((e) => !e.transient);
    throw new Error((terminal ?? errors[errors.length - 1]!).message);
  }

  const raw = (finalText ?? deltaBuffer).trim();
  const summary = raw
    ? raw.length > MAX_SUMMARY
      ? `${raw.slice(0, MAX_SUMMARY)}…`
      : raw
    : null;
  return { sessionId: session.id, summary };
}
