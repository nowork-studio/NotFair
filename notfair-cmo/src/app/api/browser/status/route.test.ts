import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/browser/session", () => ({
  getSessionStatus: vi.fn(() => ({
    projectSlug: "acme",
    running: true,
    cdpPort: 19042,
    userDataDir: "/tmp/profile",
    launchedAt: 1_000,
    uptimeMs: 5_000,
  })),
}));

vi.mock("@/server/browser/tabs", () => ({
  listTabs: vi.fn(async () => [
    { id: "greg", label: "greg", url: "https://example.com", title: "Example" },
  ]),
}));

import { GET } from "./route";
import * as session from "@/server/browser/session";
import * as tabs from "@/server/browser/tabs";

function makeReq(qs: string): Request {
  return new Request(`http://localhost/api/browser/status${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/browser/status", () => {
  it("400s when project_slug is missing", async () => {
    const res = await GET(makeReq(""));
    expect(res.status).toBe(400);
  });

  it("returns status + tabs when running", async () => {
    const res = await GET(makeReq("?project_slug=acme"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.running).toBe(true);
    expect(body.tabs).toHaveLength(1);
    expect(body.tabs[0].id).toBe("greg");
  });

  it("returns status without tabs when not running", async () => {
    (session.getSessionStatus as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      projectSlug: "acme",
      running: false,
      cdpPort: 19042,
      userDataDir: "/tmp/profile",
    });
    const res = await GET(makeReq("?project_slug=acme"));
    const body = await res.json();
    expect(body.status.running).toBe(false);
    expect(body.tabs).toEqual([]);
    expect(tabs.listTabs).not.toHaveBeenCalled();
  });

  it("returns empty tab list when listTabs throws (doesn't fail the whole probe)", async () => {
    (tabs.listTabs as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const res = await GET(makeReq("?project_slug=acme"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tabs).toEqual([]);
  });
});
