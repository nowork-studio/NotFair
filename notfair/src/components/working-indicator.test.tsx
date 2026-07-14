// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkingIndicator } from "@/components/working-indicator";

describe("WorkingIndicator completed state", () => {
  it("renders a completed turn without live motion or an increasing timer", () => {
    const { container } = render(
      <WorkingIndicator
        agentDisplayName="Growth agent"
        headline="Turn complete"
        subtitle={null}
        phases={[
          {
            id: "unfinished-tool",
            label: "Inspecting data",
            state: "active",
          },
        ]}
        elapsedMs={65_000}
        mood="ended"
      />,
    );

    expect(
      screen.getByRole("status", { name: "Growth agent Turn complete" }),
    ).toBeInTheDocument();
    expect(container.querySelector('[class*="animate-"]')).toBeNull();
    expect(screen.queryByText("1:05")).toBeNull();
  });
});
