// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SidebarVersion } from "./sidebar-version";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const value = handler(url, init);
    return new Response(JSON.stringify(value), {
      status: typeof value === "object" && value && "__status" in value
        ? (value as { __status: number }).__status
        : 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SidebarVersion", () => {
  it("renders just the version when no update is available", async () => {
    mockFetch(() => ({ current: "0.7.0", latest: "0.7.0", has_update: false }));
    render(<SidebarVersion />);
    await waitFor(() =>
      expect(screen.getByText(/notfair-cmo v0\.7\.0/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the Update button when has_update=true", async () => {
    mockFetch(() => ({ current: "0.7.0", latest: "0.8.1", has_update: true }));
    render(<SidebarVersion />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /v0\.8\.1 available/ })).toBeInTheDocument(),
    );
  });

  it("POSTs /api/upgrade on click and shows 'Restart to apply' on success", async () => {
    const fetchSpy = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.endsWith("/api/version")) {
          return new Response(
            JSON.stringify({ current: "0.7.0", latest: "0.8.0", has_update: true }),
            { status: 200 },
          );
        }
        if (url.endsWith("/api/upgrade")) {
          return new Response(JSON.stringify({ ok: true, note: "Upgraded." }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 200 });
      },
    );
    globalThis.fetch = fetchSpy as typeof fetch;

    render(<SidebarVersion />);
    const btn = await screen.findByRole("button", { name: /v0\.8\.0 available/ });
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByText(/Restart to apply/)).toBeInTheDocument());
    const upgradeCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/api/upgrade"));
    expect(upgradeCall).toBeDefined();
    expect(upgradeCall![1]!.method).toBe("POST");
  });

  it("keeps the Upgrade button enabled when the API errors (so the user can retry)", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/api/version")) {
        return new Response(
          JSON.stringify({ current: "0.7.0", latest: "0.8.0", has_update: true }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: "npm not on PATH", command: "npm i -g notfair-cmo@latest" }),
        { status: 500 },
      );
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    render(<SidebarVersion />);
    const btn = await screen.findByRole("button", { name: /v0\.8\.0 available/ });
    fireEvent.click(btn);

    // After the failed upgrade, the button label resets and stays clickable.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /v0\.8\.0 available/ })).not.toBeDisabled(),
    );
  });

  it("falls back to a minimal label when /api/version is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    render(<SidebarVersion />);
    // Initial render shows the fallback before fetch resolves; offline keeps it.
    await waitFor(() =>
      expect(screen.getByText(/notfair-cmo/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
