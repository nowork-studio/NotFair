import { describe, expect, it, vi, beforeEach } from "vitest";

const getTaskMock = vi.fn();
const updateTaskMock = vi.fn();
// Dependent-propagation helpers (handlers.ts calls these on every `done`
// transition). Default: no dependents — empty list keeps the propagation
// branch a no-op for the bulk of submit_task_status tests.
const listTasksBlockedByMock = vi.fn((..._a: unknown[]): unknown[] => []);
const clearBlockerAndPromoteMock = vi.fn(
  (..._a: unknown[]): unknown => null,
);
vi.mock("@/server/db/tasks", () => ({
  getTask: (...a: unknown[]) => getTaskMock(...a),
  updateTask: (...a: unknown[]) => updateTaskMock(...a),
  listTasksBlockedBy: (...a: unknown[]) => listTasksBlockedByMock(...a),
  clearBlockerAndPromote: (...a: unknown[]) => clearBlockerAndPromoteMock(...a),
  // The rest of tasks.ts isn't called from handlers under test here, but
  // ESM requires the module to expose any named import handlers.ts uses.
  // Safe stubs — they'd throw if accidentally invoked, surfacing the gap.
  createTask: () => {
    throw new Error("createTask not mocked");
  },
  listTasks: () => [],
  listTasksByAgent: () => [],
  markTaskBlocked: () => null,
  unblockTask: () => null,
}));

const logAgentActionMock = vi.fn();
vi.mock("@/server/db/agent-actions", () => ({
  logAgentAction: (...a: unknown[]) => logAgentActionMock(...a),
}));

import { handleJsonRpc, type JsonRpcRequest } from "./jsonrpc";
import { TOOLS } from "./tools";

const ORCHESTRATION_SERVER = {
  name: "notfair-orchestration",
  version: "0.2.0",
  tools: TOOLS,
};

beforeEach(() => {
  vi.clearAllMocks();
});

function call(req: JsonRpcRequest) {
  return handleJsonRpc(req, ORCHESTRATION_SERVER);
}

describe("handleJsonRpc — initialize", () => {
  it("returns protocolVersion + serverInfo + tools capability", async () => {
    const r = await call({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(r).not.toBeNull();
    if (!r || "error" in r) throw new Error("expected ok result");
    const result = r.result as {
      protocolVersion: string;
      serverInfo: { name: string };
      capabilities: { tools: object };
    };
    expect(result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.serverInfo.name).toBe("notfair-orchestration");
    expect(result.capabilities.tools).toEqual({});
  });

  it("notifications (id null) return null with no response body", async () => {
    const r = await call({
      jsonrpc: "2.0",
      id: null,
      method: "notifications/initialized",
    });
    expect(r).toBeNull();
  });
});

describe("handleJsonRpc — tools/list", () => {
  it("includes submit_task_status with the right enum + required fields", async () => {
    const r = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    if (!r || "error" in r) throw new Error("expected ok result");
    const { tools } = r.result as {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: {
          properties: Record<string, { type: string; enum?: string[] }>;
          required: string[];
        };
      }>;
    };
    const submit = tools.find((t) => t.name === "submit_task_status")!;
    expect(submit).toBeDefined();
    expect(submit.inputSchema.properties.task_id.type).toBe("string");
    expect(submit.inputSchema.properties.status.enum).toEqual([
      "working",
      "done",
      "blocked",
      "failed",
    ]);
    // summary is optional → not in required
    expect(submit.inputSchema.required).toEqual(
      expect.arrayContaining(["task_id", "status"]),
    );
    expect(submit.inputSchema.required).not.toContain("summary");
  });
});

describe("handleJsonRpc — tools/call submit_task_status", () => {
  it("rejects an invalid status value with isError content (no JSON-RPC error)", async () => {
    const r = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "submit_task_status",
        arguments: {
          project_slug: "demo",
          agent_id: "demo-google-ads",
          task_id: "t1",
          status: "closed",
        },
      },
    });
    if (!r || "error" in r) throw new Error("expected ok envelope");
    const result = r.result as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Invalid arguments/);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("updates the task and logs an action on valid `done` status", async () => {
    getTaskMock.mockReturnValue({
      id: "t-uuid",
      display_id: "demo-1",
      project_slug: "demo",
      agent_id: "demo-google-ads",
      status: "working",
    });
    const r = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "submit_task_status",
        arguments: {
          project_slug: "demo",
          agent_id: "demo-google-ads",
          task_id: "demo-1",
          status: "done",
          summary: "shipped the change",
        },
      },
    });
    if (!r || "error" in r) throw new Error("expected ok envelope");
    const result = r.result as { isError: boolean };
    expect(result.isError).toBe(false);
    expect(updateTaskMock).toHaveBeenCalledWith(
      "t-uuid",
      expect.objectContaining({
        status: "done",
        result: { summary: "shipped the change" },
      }),
    );
    expect(logAgentActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "task_done",
        task_id: "t-uuid",
      }),
    );
  });

  it("maps status=blocked to TaskStatus blocked (not running)", async () => {
    getTaskMock.mockReturnValue({
      id: "t1",
      display_id: "x-1",
      project_slug: "x",
      agent_id: "x-agent",
      status: "working",
    });
    await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "submit_task_status",
        arguments: {
          project_slug: "x",
          agent_id: "x-agent",
          task_id: "t1",
          status: "blocked",
        },
      },
    });
    expect(updateTaskMock).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ status: "blocked" }),
    );
  });

  it("maps status=failed and stores summary in error_message", async () => {
    getTaskMock.mockReturnValue({
      id: "t1",
      display_id: "x-1",
      project_slug: "x",
      agent_id: "x-agent",
      status: "working",
    });
    await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "submit_task_status",
        arguments: {
          project_slug: "x",
          agent_id: "x-agent",
          task_id: "t1",
          status: "failed",
          summary: "MCP returned 401",
        },
      },
    });
    expect(updateTaskMock).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: "failed",
        error_message: "MCP returned 401",
      }),
    );
  });

  it("returns isError when task_id is unknown", async () => {
    getTaskMock.mockReturnValue(null);
    const r = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "submit_task_status",
        arguments: {
          project_slug: "x",
          agent_id: "x-agent",
          task_id: "missing",
          status: "done",
          summary: "x",
        },
      },
    });
    if (!r || "error" in r) throw new Error("expected ok envelope");
    const result = r.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Unknown task_id/);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("returns isError when project_slug doesn't match the task's (cross-project guard)", async () => {
    getTaskMock.mockReturnValue({
      id: "t1",
      display_id: "x-1",
      project_slug: "demo",
      agent_id: "demo-google-ads",
      status: "working",
    });
    const r = await call({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: {
        name: "submit_task_status",
        arguments: {
          project_slug: "evil-other",
          agent_id: "demo-google-ads",
          task_id: "t1",
          status: "done",
          summary: "x",
        },
      },
    });
    if (!r || "error" in r) throw new Error("expected ok envelope");
    const result = r.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Cross-project/);
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("is a no-op on terminal tasks (already succeeded/failed/cancelled)", async () => {
    getTaskMock.mockReturnValue({
      id: "t1",
      display_id: "x-1",
      project_slug: "x",
      agent_id: "x-agent",
      status: "done",
    });
    const r = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "submit_task_status",
        arguments: {
          project_slug: "x",
          agent_id: "x-agent",
          task_id: "t1",
          status: "done",
        },
      },
    });
    if (!r || "error" in r) throw new Error("expected ok envelope");
    const result = r.result as { isError: boolean };
    expect(result.isError).toBe(false);
    // Terminal status is preserved — no DB write happens.
    expect(updateTaskMock).not.toHaveBeenCalled();
  });

  it("returns Method-not-found for unknown tools", async () => {
    const r = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "wat", arguments: {} },
    });
    if (!r || "error" in r) {
      expect(r?.error?.code).toBe(-32601);
      return;
    }
    throw new Error("expected error envelope");
  });

  it("returns Method-not-found for unknown methods", async () => {
    const r = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "wat/nope",
    });
    if (!r || "error" in r) {
      expect(r?.error?.code).toBe(-32601);
      return;
    }
    throw new Error("expected error envelope");
  });
});
