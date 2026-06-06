// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { WorkspaceBrowserCard } from "./workspace-browser-card";

// sonner.toast emits real DOM in jsdom; stub so we can assert on call args.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const value = handler(url, init);
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

describe("WorkspaceBrowserCard", () => {
  it("renders 'Not running' state on initial load when no session is active", async () => {
    mockFetch(() => ({
      status: { running: false, cdpPort: 19042, userDataDir: "/tmp/profile" },
      tabs: [],
    }));

    render(<WorkspaceBrowserCard projectSlug="acme" />);

    await waitFor(() => expect(screen.getByText(/Not running/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Launch$/ })).toBeInTheDocument();
    expect(screen.getByText(/Profile dir:/)).toBeInTheDocument();
  });

  it("shows running state, sign-in buttons, and open tabs when session is up", async () => {
    mockFetch(() => ({
      status: {
        running: true,
        cdpPort: 19042,
        userDataDir: "/tmp/profile",
        uptimeMs: 32_000,
      },
      tabs: [
        { id: "greg", url: "https://greg.example/", title: "Greg" },
        { id: "tina", url: "https://tina.example/", title: "Tina" },
      ],
    }));

    render(<WorkspaceBrowserCard projectSlug="acme" />);

    await waitFor(() => expect(screen.getByText(/Running on port 19042/)).toBeInTheDocument());
    expect(screen.getByText(/32s uptime/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Google/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Meta/ })).toBeInTheDocument();
    expect(screen.getByText("greg")).toBeInTheDocument();
    expect(screen.getByText("Tina")).toBeInTheDocument();
  });

  it("POSTs to /api/browser/launch with headless=false when Launch is clicked", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/status")) {
        return new Response(
          JSON.stringify({
            status: { running: false, cdpPort: 19042, userDataDir: "/tmp/profile" },
            tabs: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/launch")) {
        return new Response(JSON.stringify({ status: { running: true } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    render(<WorkspaceBrowserCard projectSlug="acme" />);
    await waitFor(() => screen.getByRole("button", { name: /^Launch$/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Launch$/ }));

    await waitFor(() => {
      const launchCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/launch"));
      expect(launchCall).toBeDefined();
      const body = JSON.parse((launchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ project_slug: "acme", signin_url: undefined, headless: false });
    });
  });

  it("POSTs to /api/browser/shutdown when Stop is clicked", async () => {
    let runningState = true;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/status")) {
        return new Response(
          JSON.stringify({
            status: { running: runningState, cdpPort: 19042, userDataDir: "/tmp/profile" },
            tabs: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/shutdown")) {
        runningState = false;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    render(<WorkspaceBrowserCard projectSlug="acme" />);
    await waitFor(() => screen.getByRole("button", { name: /^Stop$/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Stop$/ }));

    await waitFor(() => {
      const shutdownCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/shutdown"));
      expect(shutdownCall).toBeDefined();
    });
  });

  it("POSTs signin_url when a sign-in target button is clicked", async () => {
    const fetchSpy = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/status")) {
        return new Response(
          JSON.stringify({
            status: {
              running: true,
              cdpPort: 19042,
              userDataDir: "/tmp/profile",
              uptimeMs: 1_000,
            },
            tabs: [],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: { running: true } }), { status: 200 });
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    render(<WorkspaceBrowserCard projectSlug="acme" />);
    await waitFor(() => screen.getByRole("button", { name: /Open Google/ }));

    fireEvent.click(screen.getByRole("button", { name: /Open Google/ }));

    await waitFor(() => {
      const launchCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/launch"));
      expect(launchCall).toBeDefined();
      const body = JSON.parse(launchCall![1]!.body as string);
      expect(body.signin_url).toBe("https://accounts.google.com/");
    });
  });
});
