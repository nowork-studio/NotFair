import { describe, expect, it } from "vitest";

import {
  getOrchestrationSkill,
  ORCHESTRATION_SKILL,
} from "./orchestration-skill";

describe("ORCHESTRATION_SKILL", () => {
  it("getOrchestrationSkill() returns the exported constant verbatim (pure)", () => {
    expect(getOrchestrationSkill()).toBe(ORCHESTRATION_SKILL);
  });

  it("calling getOrchestrationSkill() multiple times returns the same string (cacheable / pure)", () => {
    expect(getOrchestrationSkill()).toBe(getOrchestrationSkill());
  });

  it("teaches the MCP tool surface (writing tools)", () => {
    const s = getOrchestrationSkill();
    for (const tool of [
      "create_task",
      "submit_task_status",
      "request_approval",
      "add_task_comment",
      "ask_user_question",
      "update_task",
      "cancel_task",
    ]) {
      expect(s).toContain(tool);
    }
  });

  it("teaches the read / context-reanchor tools", () => {
    const s = getOrchestrationSkill();
    for (const tool of [
      "get_task",
      "list_my_tasks",
      "list_tasks",
      "get_project",
      "list_task_comments",
      "get_approval",
      "list_my_approvals",
      "list_pending_approvals",
      "list_approvals_for_task",
    ]) {
      expect(s).toContain(tool);
    }
  });

  it("teaches the enum-discovery tools so agents don't guess", () => {
    const s = getOrchestrationSkill();
    expect(s).toContain("list_task_statuses");
    expect(s).toContain("list_approval_action_types");
    expect(s).toContain("list_project_agents");
  });

  it("forbids pseudo-XML pseudo-blocks (the rule that fixed the closed/done drift bug)", () => {
    const s = getOrchestrationSkill();
    expect(s).toMatch(/NEVER through pseudo-XML/);
    expect(s).toContain("`<create_task>`");
    expect(s).toContain("`<task_status>`");
  });

  it("documents the cannot-close-with-pending-approval invariant", () => {
    const s = getOrchestrationSkill();
    expect(s).toMatch(/can NOT close a task.*pending approval/i);
  });

  it("teaches the schedule_recurring_work MCP tool, not the dead openclaw CLI", () => {
    const s = getOrchestrationSkill();
    expect(s).toContain("schedule_recurring_work");
    expect(s).toContain("cron_expr");
    expect(s).toContain("project_slug");
    expect(s).toContain("agent_id");
    // Regression: previous skill told agents to shell out to a CLI that
    // doesn't exist anymore. That made agents hallucinate cron creation
    // success without ever persisting a row to scheduled_jobs.
    expect(s).not.toContain("openclaw cron add");
  });

  it("documents propose-then-call flow for recurring schedules after one-time approvals", () => {
    const s = getOrchestrationSkill();
    expect(s).toMatch(/propose ONE schedule per turn/);
    // The pseudo-XML <propose_cron> sentinel block was removed when the
    // dead openclaw CLI was retired; agents now propose in prose and
    // call schedule_recurring_work on confirmation.
    expect(s).not.toContain("<propose_cron>");
  });

  it("teaches the workspace browser tool inventory", () => {
    const s = getOrchestrationSkill();
    for (const tool of [
      "browser_status",
      "browser_tabs",
      "browser_open",
      "browser_close",
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_press",
      "browser_scroll",
      "browser_back",
    ]) {
      expect(s).toContain(tool);
    }
  });

  it("tells agents they CANNOT stop the workspace browser (multi-agent safety)", () => {
    const s = getOrchestrationSkill();
    expect(s).toMatch(/cannot stop/i);
    expect(s).not.toContain("browser_shutdown");
  });

  it("teaches the snapshot → act → snapshot discipline (stale refs are the #1 browser bug)", () => {
    const s = getOrchestrationSkill();
    expect(s).toMatch(/snapshot AGAIN/i);
    expect(s).toMatch(/[Ss]tale refs/);
  });

  it("teaches agents to use agent_id as their browser tab label", () => {
    const s = getOrchestrationSkill();
    expect(s).toMatch(/label.*agent_id/i);
  });

  it("teaches agents to report login/captcha/2FA as blockers via submit_task_status", () => {
    const s = getOrchestrationSkill();
    expect(s).toMatch(/captcha|2FA|login wall/i);
    expect(s).toMatch(/submit_task_status.*blocked/);
  });

  it("includes a 'Your role:' section selector so role-specific content sits ABOVE", () => {
    // The skill should sound like a how-to manual, NOT contain role
    // declarations like "You are the CMO" / "You are a worker" — those
    // live in CMO_ROLE / SPECIALIST_ROLE, not here.
    const s = getOrchestrationSkill();
    expect(s).not.toMatch(/^You are the CMO/m);
    expect(s).not.toMatch(/^You are a specialist worker/m);
  });
});
