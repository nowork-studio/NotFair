"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createGoalAgentAction } from "@/server/actions/goals";
import {
  goalPlatformsForConnected,
  type GoalPlatform,
} from "@/lib/goal-platforms";
import { projectHref } from "@/lib/project-href";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const DEFAULT_PLACEHOLDER =
  'e.g. "Cut our Google Ads CAC to $30" or "Get to 100 signups a month from paid"';

/**
 * Statement-first goal creation, shared by the goals index and
 * onboarding's first-goal step. When the workspace has connected
 * platforms, a focus row appears — one chip per connected platform
 * (Google Ads, SEO, …) plus "Other" — with tap-to-fill example
 * statements per focus. The chosen focus rides along to the agent's
 * intake kickoff so it explores the right platform; the statement
 * stays the user's words.
 */
export function NewGoalForm({
  projectSlug,
  connectedMcpKeys = [],
}: {
  projectSlug: string;
  /** Drives which focus chips show. Omit/empty → no focus row. */
  connectedMcpKeys?: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [statement, setStatement] = useState("");
  // null = nothing chosen yet; "other" = explicit free-form choice.
  const [selected, setSelected] = useState<GoalPlatform | "other" | null>(null);
  const platform = selected && selected !== "other" ? selected : null;

  const platforms = goalPlatformsForConnected(connectedMcpKeys);

  function submit() {
    startTransition(async () => {
      const r = await createGoalAgentAction({
        project_slug: projectSlug,
        statement,
        focus: platform?.focus ?? null,
      });
      if (!r.ok || !r.agent_slug) {
        toast.error(r.error ?? "Could not create the goal.");
        return;
      }
      toast.success("Your agent is on it — watch it work.");
      router.push(projectHref(projectSlug, `/goals/${r.agent_slug}`));
    });
  }

  return (
    <div className="ns-card flex flex-col gap-3 p-4">
      <label htmlFor="new-goal-statement" className="text-[13px] font-medium">
        What do you want to achieve?
      </label>

      {platforms.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Goal focus"
        >
          {platforms.map((p) => (
            <FocusChip
              key={p.key}
              label={p.label}
              active={platform?.key === p.key}
              disabled={pending}
              onClick={() => setSelected(platform?.key === p.key ? null : p)}
            />
          ))}
          <FocusChip
            label="Other"
            active={selected === "other"}
            disabled={pending}
            onClick={() => setSelected(selected === "other" ? null : "other")}
          />
        </div>
      )}

      <textarea
        id="new-goal-statement"
        className="min-h-20 w-full resize-y rounded-lg bg-[hsl(var(--notfair-surface-2))] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--notfair-accent))]"
        placeholder={platform?.placeholder ?? DEFAULT_PLACEHOLDER}
        value={statement}
        onChange={(e) => setStatement(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && statement.trim() && !pending) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={pending}
      />

      {platform && platform.examples.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {platform.examples.map((example) => (
            <button
              key={example}
              type="button"
              disabled={pending}
              onClick={() => setStatement(example)}
              className="rounded-lg bg-[hsl(var(--notfair-surface-2)/0.6)] px-2.5 py-1 text-[12px] text-[hsl(var(--notfair-ink-3))] shadow-[var(--notfair-shadow-sm)] transition-colors hover:bg-[hsl(var(--notfair-surface-2))] hover:text-[hsl(var(--notfair-ink-1))]"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-[12px] text-[hsl(var(--notfair-ink-4))]">
          An agent takes it from here: it turns this into a measured metric,
          shows you the baseline, and nothing runs until you press START.
        </p>
        <Button onClick={submit} disabled={pending || !statement.trim()}>
          {pending ? "Creating…" : "Create goal"}
        </Button>
      </div>
    </div>
  );
}

function FocusChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
        active
          ? "bg-[hsl(var(--notfair-accent-soft))] text-[hsl(var(--notfair-accent))] shadow-[var(--notfair-shadow-sm)]"
          : "bg-[hsl(var(--notfair-surface-2)/0.6)] text-[hsl(var(--notfair-ink-3))] hover:bg-[hsl(var(--notfair-surface-2))]",
      )}
    >
      {label}
    </button>
  );
}
