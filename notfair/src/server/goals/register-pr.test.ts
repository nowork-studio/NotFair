import { beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so it runs before static imports evaluate db.ts (which captures
// NOTFAIR_DATA_DIR at import time) — see goal-prs.test.ts.
vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  process.env.NOTFAIR_DATA_DIR = mkdtempSync(join(tmpdir(), "notfair-regpr-"));
});

// The handler pulls the live GitHub state right after registering; keep
// the network out of the test.
vi.mock("@/server/goals/pr-sync", () => ({
  syncGoalPrs: vi.fn().mockResolvedValue(undefined),
  maybeSyncGoalPrs: vi.fn(),
}));

import { handleRegisterPullRequest } from "@/server/goals/handlers";
import { getDb } from "@/server/db/db";
import { createGoal } from "@/server/db/goals";
import { listGoalPrs } from "@/server/db/goal-prs";

const SLUG = "proj";
let goalId: string;
const ctx = { project_slug: SLUG, agent_id: "agent-1" };

beforeAll(() => {
  getDb()
    .prepare(
      "INSERT INTO projects (id, slug, display_name, created_at, harness_adapter) VALUES ('p1', ?, 'Proj', ?, 'codex-local')",
    )
    .run(SLUG, new Date().toISOString());
  goalId = createGoal({
    project_slug: SLUG,
    agent_id: "agent-1",
    statement: "Grow organic clicks",
  }).id;
});

describe("handleRegisterPullRequest", () => {
  it("rejects non-GitHub-PR urls", async () => {
    for (const url of [
      "https://github.com/acme/site",
      "https://gitlab.com/acme/site/-/merge_requests/1",
      "http://github.com/acme/site/pull/1",
      "not a url",
    ]) {
      const r = await handleRegisterPullRequest(
        { goal_id: goalId, url, title: "t" },
        ctx,
      );
      expect(r.ok, url).toBe(false);
    }
  });

  it("rejects another agent's goal", async () => {
    const r = await handleRegisterPullRequest(
      {
        goal_id: goalId,
        url: "https://github.com/acme/site/pull/1",
        title: "t",
      },
      { project_slug: SLUG, agent_id: "someone-else" },
    );
    expect(r.ok).toBe(false);
  });

  it("registers once and is idempotent per url", async () => {
    const url = "https://github.com/acme/site/pull/42";
    const first = await handleRegisterPullRequest(
      { goal_id: goalId, url, title: "Improve /pricing meta", branch: "notfair/pricing" },
      ctx,
    );
    expect(first.ok).toBe(true);
    const second = await handleRegisterPullRequest(
      { goal_id: goalId, url: `${url}/`, title: "dup" },
      ctx,
    );
    expect(second.ok).toBe(true);
    const rows = listGoalPrs(goalId).filter((p) => p.url === url);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Improve /pricing meta");
  });

  it("rejects an action_id that belongs to a different goal", async () => {
    const r = await handleRegisterPullRequest(
      {
        goal_id: goalId,
        url: "https://github.com/acme/site/pull/43",
        title: "t",
        action_id: "not-a-real-action",
      },
      ctx,
    );
    expect(r.ok).toBe(false);
  });
});
