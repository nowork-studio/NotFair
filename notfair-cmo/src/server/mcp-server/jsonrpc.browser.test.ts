import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The browser MCP server hits the live browser/session modules, so mock
// them out — these tests only verify wiring (right server name, right
// tools, isolation from orchestration).
vi.mock("@/server/browser/session", () => ({
  getOrLaunchBrowser: vi.fn(async () => ({ projectSlug: "acme" })),
  getSessionStatus: vi.fn(() => ({
    projectSlug: "acme",
    running: false,
    cdpPort: 19042,
    userDataDir: "/tmp/profile",
    idleTimeoutMs: 300_000,
  })),
}));

vi.mock("@/server/browser/tabs", () => ({
  openTab: vi.fn(async () => ({ id: "t1", label: "t1", url: "about:blank", title: "" })),
  listTabs: vi.fn(async () => []),
  closeTab: vi.fn(async () => false),
  getTab: vi.fn(async () => null),
}));

vi.mock("@/server/browser/actions", () => ({
  navigate: vi.fn(),
  snapshot: vi.fn(),
  click: vi.fn(),
  type: vi.fn(),
  press: vi.fn(),
  scroll: vi.fn(),
  back: vi.fn(),
}));

import { BROWSER_TOOLS } from "./browser-tools";
import { handleJsonRpc } from "./jsonrpc";
import { TOOLS as ORCHESTRATION_TOOLS } from "./tools";

const BROWSER_SERVER = {
  name: "notfair-browser",
  version: "0.1.0",
  tools: BROWSER_TOOLS,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe("notfair-browser MCP server", () => {
  it("identifies itself as notfair-browser on initialize", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      BROWSER_SERVER,
    );
    const result = (r as { result: { serverInfo: { name: string } } }).result;
    expect(result.serverInfo.name).toBe("notfair-browser");
  });

  it("tools/list returns only browser_* tools", async () => {
    const r = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      BROWSER_SERVER,
    );
    const tools = (r as { result: { tools: Array<{ name: string }> } }).result.tools;
    const names = tools.map((t) => t.name).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.startsWith("browser_"))).toBe(true);
  });

  it("orchestration registry does NOT contain browser_* tools (the split is real)", () => {
    const orchestrationNames = ORCHESTRATION_TOOLS.map((t) => t.name);
    expect(orchestrationNames.some((n) => n.startsWith("browser_"))).toBe(false);
  });

  it("browser registry does NOT contain orchestration tools (isolated surfaces)", () => {
    const browserNames = BROWSER_TOOLS.map((t) => t.name);
    expect(browserNames).not.toContain("submit_task_status");
    expect(browserNames).not.toContain("create_task");
    expect(browserNames).not.toContain("request_approval");
  });

  it("tools/call rejects orchestration tool names on the browser server", async () => {
    const r = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "submit_task_status", arguments: {} },
      },
      BROWSER_SERVER,
    );
    const err = (r as { error?: { code: number; message: string } }).error;
    expect(err?.code).toBe(-32601);
    expect(err?.message).toMatch(/Unknown tool/);
  });

  it("tools/call accepts a browser_* tool name", async () => {
    const r = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "browser_status", arguments: { project_slug: "acme" } },
      },
      BROWSER_SERVER,
    );
    const result = (r as { result: { isError?: boolean } }).result;
    expect(result.isError).toBe(false);
  });
});
