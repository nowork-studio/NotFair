import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock the browser modules wholesale — these tests verify schema
// parsing, error envelopes, and that the right action functions get
// invoked with the right arguments. Real Page / Browser behavior is
// covered by actions.test.ts and the E2E smoke test.

vi.mock("@/server/browser/session", () => ({
  getOrLaunchBrowser: vi.fn(async () => ({ projectSlug: "acme" })),
  getSessionStatus: vi.fn(() => ({
    projectSlug: "acme",
    running: true,
    cdpPort: 19042,
    userDataDir: "/tmp/profile",
    launchedAt: 1_000,
    uptimeMs: 5_000,
  })),
  stopBrowser: vi.fn(async () => {}),
}));

vi.mock("@/server/browser/tabs", () => ({
  openTab: vi.fn(async (_slug: string, opts: { label?: string; url?: string }) => ({
    id: opts.label ?? "t1",
    label: opts.label ?? "t1",
    url: opts.url ?? "about:blank",
    title: "",
  })),
  listTabs: vi.fn(async () => [
    { id: "greg", label: "greg", url: "https://example.com", title: "Example" },
  ]),
  closeTab: vi.fn(async (_slug: string, ref: string) => ref === "greg"),
  getTab: vi.fn(async (_slug: string, ref: string) =>
    ref === "greg" ? ({ __fakePage: true } as unknown as null) : null,
  ),
}));

vi.mock("@/server/browser/actions", () => ({
  navigate: vi.fn(async () => ({ url: "https://example.com", title: "Example" })),
  snapshot: vi.fn(async () => ({
    url: "https://example.com",
    title: "Example",
    elements: [
      { ref: "e1", role: "button", name: "Sign in" },
      { ref: "e2", role: "input", name: "Email", value: "" },
    ],
    text: "Sign in to your account",
  })),
  click: vi.fn(async () => {}),
  type: vi.fn(async () => {}),
  press: vi.fn(async () => {}),
  scroll: vi.fn(async () => {}),
  back: vi.fn(async () => {}),
}));

import { BROWSER_TOOLS } from "./browser-tools";
import * as session from "@/server/browser/session";
import * as tabs from "@/server/browser/tabs";
import * as actions from "@/server/browser/actions";

function tool(name: string) {
  const found = BROWSER_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`No tool named ${name}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Registry shape ─────────────────────────────────────────────────────

describe("BROWSER_TOOLS registry", () => {
  it("exposes exactly the 12 expected tools (status, tabs, open, close, navigate, snapshot, click, type, press, scroll, back, shutdown)", () => {
    expect(BROWSER_TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "browser_back",
        "browser_click",
        "browser_close",
        "browser_navigate",
        "browser_open",
        "browser_press",
        "browser_scroll",
        "browser_shutdown",
        "browser_snapshot",
        "browser_status",
        "browser_tabs",
        "browser_type",
      ].sort(),
    );
  });

  it("each tool ships a non-empty description and a zod inputSchema", () => {
    for (const t of BROWSER_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(typeof t.inputSchema.safeParse).toBe("function");
    }
  });
});

// ── browser_status ─────────────────────────────────────────────────────

describe("browser_status", () => {
  it("returns running status from getSessionStatus", async () => {
    const result = await tool("browser_status").handler({ project_slug: "acme" }, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.running).toBe(true);
      expect(payload.cdpPort).toBe(19042);
    }
    expect(session.getSessionStatus).toHaveBeenCalledWith("acme");
  });

  it("rejects missing project_slug", async () => {
    const result = await tool("browser_status").handler({}, {});
    expect(result.ok).toBe(false);
  });
});

// ── browser_tabs ───────────────────────────────────────────────────────

describe("browser_tabs", () => {
  it("returns the tab list from listTabs", async () => {
    const result = await tool("browser_tabs").handler({ project_slug: "acme" }, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe("greg");
    }
    expect(tabs.listTabs).toHaveBeenCalledWith("acme");
  });
});

// ── browser_open ───────────────────────────────────────────────────────

describe("browser_open", () => {
  it("launches the session and forwards label + url", async () => {
    const result = await tool("browser_open").handler(
      { project_slug: "acme", label: "greg", url: "https://example.com" },
      {},
    );
    expect(result.ok).toBe(true);
    expect(session.getOrLaunchBrowser).toHaveBeenCalledWith("acme");
    expect(tabs.openTab).toHaveBeenCalledWith("acme", {
      label: "greg",
      url: "https://example.com",
    });
  });

  it("rejects invalid url", async () => {
    const result = await tool("browser_open").handler(
      { project_slug: "acme", url: "not a url" },
      {},
    );
    expect(result.ok).toBe(false);
  });

  it("rejects invalid label format", async () => {
    const result = await tool("browser_open").handler(
      { project_slug: "acme", label: "bad label", url: "https://example.com" },
      {},
    );
    expect(result.ok).toBe(false);
  });
});

// ── browser_close ──────────────────────────────────────────────────────

describe("browser_close", () => {
  it("reports success when closeTab returns true", async () => {
    const result = await tool("browser_close").handler(
      { project_slug: "acme", target_id: "greg" },
      {},
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content[0]!.text).toMatch(/Closed tab/);
    }
  });

  it("reports no-op when closeTab returns false", async () => {
    const result = await tool("browser_close").handler(
      { project_slug: "acme", target_id: "missing" },
      {},
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content[0]!.text).toMatch(/No tab/);
    }
  });
});

// ── browser_navigate ───────────────────────────────────────────────────

describe("browser_navigate", () => {
  it("invokes actions.navigate on the resolved tab", async () => {
    const result = await tool("browser_navigate").handler(
      { project_slug: "acme", target_id: "greg", url: "https://example.com" },
      {},
    );
    expect(result.ok).toBe(true);
    expect(actions.navigate).toHaveBeenCalledOnce();
    expect((actions.navigate as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      url: "https://example.com",
    });
  });

  it("returns a clear error when the tab handle is unknown", async () => {
    const result = await tool("browser_navigate").handler(
      { project_slug: "acme", target_id: "ghost", url: "https://example.com" },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No tab "ghost"/);
  });
});

// ── browser_snapshot ───────────────────────────────────────────────────

describe("browser_snapshot", () => {
  it("returns the snapshot payload as JSON", async () => {
    const result = await tool("browser_snapshot").handler(
      { project_slug: "acme", target_id: "greg" },
      {},
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.elements).toHaveLength(2);
      expect(payload.elements[0].ref).toBe("e1");
    }
  });

  it("respects max_elements truncation", async () => {
    const result = await tool("browser_snapshot").handler(
      { project_slug: "acme", target_id: "greg", max_elements: 1 },
      {},
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.elements).toHaveLength(1);
    }
  });
});

// ── browser_click ──────────────────────────────────────────────────────

describe("browser_click", () => {
  it("forwards ref + button + modifiers to actions.click", async () => {
    const result = await tool("browser_click").handler(
      {
        project_slug: "acme",
        target_id: "greg",
        ref: "e2",
        button: "right",
        modifiers: ["Meta"],
        double_click: true,
      },
      {},
    );
    expect(result.ok).toBe(true);
    expect((actions.click as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      ref: "e2",
      button: "right",
      modifiers: ["Meta"],
      doubleClick: true,
    });
  });

  it("rejects refs that don't match e<number>", async () => {
    const result = await tool("browser_click").handler(
      { project_slug: "acme", target_id: "greg", ref: "weird" },
      {},
    );
    expect(result.ok).toBe(false);
  });
});

// ── browser_type ───────────────────────────────────────────────────────

describe("browser_type", () => {
  it("forwards text + submit + clear_first", async () => {
    const result = await tool("browser_type").handler(
      {
        project_slug: "acme",
        target_id: "greg",
        ref: "e2",
        text: "hello",
        submit: true,
        clear_first: false,
      },
      {},
    );
    expect(result.ok).toBe(true);
    expect((actions.type as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      ref: "e2",
      text: "hello",
      submit: true,
      clearFirst: false,
    });
  });
});

// ── browser_press ──────────────────────────────────────────────────────

describe("browser_press", () => {
  it("forwards key + optional ref", async () => {
    const result = await tool("browser_press").handler(
      { project_slug: "acme", target_id: "greg", key: "Tab", ref: "e1" },
      {},
    );
    expect(result.ok).toBe(true);
    expect((actions.press as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      key: "Tab",
      ref: "e1",
    });
  });
});

// ── browser_scroll ─────────────────────────────────────────────────────

describe("browser_scroll", () => {
  it("forwards direction + amount", async () => {
    const result = await tool("browser_scroll").handler(
      { project_slug: "acme", target_id: "greg", direction: "down", amount: 1000 },
      {},
    );
    expect(result.ok).toBe(true);
    expect((actions.scroll as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      direction: "down",
      amount: 1000,
    });
  });

  it("rejects invalid direction", async () => {
    const result = await tool("browser_scroll").handler(
      { project_slug: "acme", target_id: "greg", direction: "diagonal" },
      {},
    );
    expect(result.ok).toBe(false);
  });
});

// ── browser_back / browser_shutdown ────────────────────────────────────

describe("browser_back", () => {
  it("invokes actions.back", async () => {
    const result = await tool("browser_back").handler(
      { project_slug: "acme", target_id: "greg" },
      {},
    );
    expect(result.ok).toBe(true);
    expect(actions.back).toHaveBeenCalledOnce();
  });
});

describe("browser_shutdown", () => {
  it("calls stopBrowser and reports success", async () => {
    const result = await tool("browser_shutdown").handler({ project_slug: "acme" }, {});
    expect(result.ok).toBe(true);
    expect(session.stopBrowser).toHaveBeenCalledWith("acme");
  });
});
