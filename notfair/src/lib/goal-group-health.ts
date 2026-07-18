import { type GoalStatus, type MetricDirection } from "@/server/db/goals";

export type GoalGroupHealth =
  | "healthy"
  | "attention"
  | "waiting"
  | "paused"
  | "closed";

export type GoalHealthInput = {
  status: GoalStatus;
  current_value: number | null;
  target_value: number | null;
  metric_direction: MetricDirection | null;
};

export function goalGroupHealth(goal: GoalHealthInput): GoalGroupHealth {
  if (goal.status === "achieved") return "healthy";
  if (goal.status === "failed") return "attention";
  if (goal.status === "killed") return "closed";
  if (goal.status === "paused") return "paused";
  if (goal.status !== "active") return "waiting";
  if (goal.current_value === null || goal.target_value === null) return "waiting";
  const met =
    goal.metric_direction === "decrease"
      ? goal.current_value <= goal.target_value
      : goal.current_value >= goal.target_value;
  return met ? "healthy" : "attention";
}

export function countGoalGroupHealth(goals: GoalHealthInput[]) {
  return goals.reduce(
    (counts, goal) => {
      counts[goalGroupHealth(goal)] += 1;
      return counts;
    },
    { healthy: 0, attention: 0, waiting: 0, paused: 0, closed: 0 },
  );
}
