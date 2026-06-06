import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/browser/session", () => ({
  stopBrowser: vi.fn(async () => {}),
}));

import { POST } from "./route";
import * as session from "@/server/browser/session";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/browser/shutdown", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/browser/shutdown", () => {
  it("400s when project_slug is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("calls stopBrowser and returns ok", async () => {
    const res = await POST(makeReq({ project_slug: "acme" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(session.stopBrowser).toHaveBeenCalledWith("acme");
  });

  it("500s with the error message when stopBrowser throws", async () => {
    (session.stopBrowser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("kill failed"),
    );
    const res = await POST(makeReq({ project_slug: "acme" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("kill failed");
  });
});
