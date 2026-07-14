// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HarnessFooter } from "@/components/harness-footer";
import { startCodexLoginAction } from "@/server/actions/harness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/server/actions/harness", () => ({
  startCodexLoginAction: vi.fn(),
  refreshCodexUsageAction: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HarnessFooter Codex account state", () => {
  it("shows Pro and a single weekly limit for the prolite tier", () => {
    render(
      <HarnessFooter
        adapter="codex-local"
        usage={{
          kind: "codex",
          auth: "chatgpt",
          plan: "prolite",
          email: "pro@example.com",
          rateLimits: [
            {
              label: "Weekly",
              used_percent: 8,
              limit_window_seconds: 604_800,
              reset_at: Math.floor(Date.now() / 1000) + 86_400,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("ChatGPT Pro")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Weekly usage" })).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to Codex/)).toBeNull();
  });

  it("does not call an authenticated user signed out when usage is unavailable", () => {
    render(
      <HarnessFooter
        adapter="codex-local"
        usage={{
          kind: "codex",
          auth: "chatgpt",
          plan: "prolite",
          email: "pro@example.com",
          rateLimits: [],
        }}
      />,
    );

    expect(screen.getByText(/Signed in as pro@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in to Codex" })).toBeNull();
  });

  it("offers a working manual sign-in action only when the CLI is actually signed out", async () => {
    vi.mocked(startCodexLoginAction).mockResolvedValue({
      ok: true,
      alreadySignedIn: false,
    });
    render(
      <HarnessFooter
        adapter="codex-local"
        usage={{
          kind: "codex",
          auth: "signed-out",
          plan: null,
          email: null,
          rateLimits: [],
        }}
      />,
    );

    expect(screen.getByText("Codex is signed out")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in to Codex" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in to Codex" }));
    await waitFor(() => {
      expect(startCodexLoginAction).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("button", { name: "Waiting for sign-in…" }),
      ).toBeDisabled();
    });
  });
});
