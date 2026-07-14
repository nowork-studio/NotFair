// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { NewGoalForm } from "@/components/new-goal-form";
import { createGoalAgentAction } from "@/server/actions/goals";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/server/actions/goals", () => ({
  createGoalAgentAction: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NewGoalForm focus chips", () => {
  it("shows no focus row when nothing is connected", () => {
    render(<NewGoalForm projectSlug="proj" connectedMcpKeys={[]} />);
    expect(screen.queryByRole("group", { name: "Goal focus" })).toBeNull();
  });

  it("shows one chip per connected platform, plus Other", () => {
    render(
      <NewGoalForm
        projectSlug="proj"
        connectedMcpKeys={["notfair-googlesearchconsole", "notfair-xads"]}
      />,
    );
    expect(screen.getByRole("button", { name: "SEO" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "X Ads" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Other" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Google Ads" })).toBeNull();
  });

  it("selecting a focus swaps the placeholder and offers tap-to-fill examples", () => {
    render(
      <NewGoalForm
        projectSlug="proj"
        connectedMcpKeys={["notfair-googlesearchconsole"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "SEO" }));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(
      "What do you want to achieve?",
    );
    expect(textarea.placeholder).toMatch(/organic clicks/i);

    fireEvent.click(
      screen.getByRole("button", { name: "Grow organic clicks 30% in 90 days" }),
    );
    expect(textarea.value).toBe("Grow organic clicks 30% in 90 days");
  });

  it("passes the chosen focus to goal creation and lands in the agent chat", async () => {
    vi.mocked(createGoalAgentAction).mockResolvedValue({
      ok: true,
      goal_id: "g1",
      agent_slug: "goal-1",
    });
    render(
      <NewGoalForm
        projectSlug="proj"
        connectedMcpKeys={["notfair-googlesearchconsole"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "SEO" }));
    fireEvent.change(screen.getByLabelText("What do you want to achieve?"), {
      target: { value: "Grow organic clicks 30% in 90 days" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));

    await waitFor(() => {
      expect(createGoalAgentAction).toHaveBeenCalledWith({
        project_slug: "proj",
        statement: "Grow organic clicks 30% in 90 days",
        focus:
          "SEO / organic search — measure via the notfair-googlesearchconsole MCP",
      });
      expect(push).toHaveBeenCalledWith("/proj/goals/goal-1");
    });
  });

  it("sends no focus when Other (or nothing) is chosen", async () => {
    vi.mocked(createGoalAgentAction).mockResolvedValue({
      ok: true,
      goal_id: "g1",
      agent_slug: "goal-1",
    });
    render(
      <NewGoalForm
        projectSlug="proj"
        connectedMcpKeys={["notfair-googlesearchconsole"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(screen.getByLabelText("What do you want to achieve?"), {
      target: { value: "Double our newsletter signups" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));

    await waitFor(() => {
      expect(createGoalAgentAction).toHaveBeenCalledWith({
        project_slug: "proj",
        statement: "Double our newsletter signups",
        focus: null,
      });
    });
  });
});
