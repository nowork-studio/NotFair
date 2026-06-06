import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/browser/session", () => ({
  getOrLaunchBrowser: vi.fn(async () => ({})),
  getSessionStatus: vi.fn(() => ({
    projectSlug: "acme",
    running: true,
    cdpPort: 19042,
    userDataDir: "/tmp/profile",
    launchedAt: 1_000,
    uptimeMs: 5_000,
  })),
  registerShutdownHooks: vi.fn(),
}));

vi.mock("@/server/browser/tabs", () => ({
  openTab: vi.fn(async (_slug: string, opts: { label?: string; url?: string }) => ({
    id: opts.label ?? "t1",
    label: opts.label ?? "t1",
    url: opts.url ?? "about:blank",
    title: "",
  })),
}));

import { POST } from "./route";
import * as session from "@/server/browser/session";
import * as tabs from "@/server/browser/tabs";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/browser/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/browser/launch", () => {
  it("400s when project_slug is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("launches the browser headed by default and returns status", async () => {
    const res = await POST(makeReq({ project_slug: "acme" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.running).toBe(true);
    expect(session.getOrLaunchBrowser).toHaveBeenCalledWith("acme", { headless: false });
    expect(session.registerShutdownHooks).toHaveBeenCalledOnce();
  });

  it("honors headless=true when provided", async () => {
    await POST(makeReq({ project_slug: "acme", headless: true }));
    expect(session.getOrLaunchBrowser).toHaveBeenCalledWith("acme", { headless: true });
  });

  it("opens a signin tab when signin_url is provided", async () => {
    const res = await POST(
      makeReq({ project_slug: "acme", signin_url: "https://accounts.google.com" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signin_tab).toEqual({ id: "signin", url: "https://accounts.google.com" });
    expect(tabs.openTab).toHaveBeenCalledWith("acme", {
      label: "signin",
      url: "https://accounts.google.com",
    });
  });

  it("500s with the error message when launch fails", async () => {
    (session.getOrLaunchBrowser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Chrome not found"),
    );
    const res = await POST(makeReq({ project_slug: "acme" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Chrome not found");
  });
});
