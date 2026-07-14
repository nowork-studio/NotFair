"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * WorkingIndicator — the bottom-anchored "agent is doing work" card.
 *
 * Replaces the previous BeamingHeadline (cyan ✳ + cycling verb) that
 * looked janky next to the rest of the UI. The new design is
 * editorial-cockpit: a thin colored aurora bar across the top, a
 * trajectory of phase chips (past tools → active step), an animated
 * mood dot, a monospace subtitle for tool args, a digital elapsed
 * readout, and a shimmer bar across the bottom. The mood color cycles
 * by phase so a quick glance tells you where the agent is:
 *
 *   - waiting (pre-first-token / between events): sky → cyan
 *   - tool in flight: violet → fuchsia
 *   - writing response: emerald → teal
 *   - wrapping up: amber → orange
 *
 * Everything past the trajectory chips is decoration; the chips
 * themselves carry the real "what is happening right now" signal.
 */

export type WorkingPhase = {
  /** Stable key so React reconciles correctly across renders. */
  id: string;
  /** Human-readable tool name (already display-formatted upstream). */
  label: string;
  /** Compact arg / detail line shown for the active phase. */
  detail?: string | null;
  state: "done" | "active" | "failed";
};

export type WorkingMood = "waiting" | "tool" | "writing" | "wrapping" | "ended";

export function WorkingIndicator({
  agentDisplayName,
  headline,
  subtitle,
  phases,
  elapsedMs,
  mood,
}: {
  agentDisplayName: string;
  /** Primary sentence shown in the active row. */
  headline: string;
  /** Optional monospace context line (tool args, lifecycle phase). */
  subtitle?: string | null;
  /** Recent + active trajectory chips. Most recent right-most. */
  phases: WorkingPhase[];
  /** ms since the turn began. null = hide the readout. */
  elapsedMs: number | null;
  /** Drives the color story. */
  mood: WorkingMood;
}) {
  const palette = MOOD_PALETTES[mood];
  const ended = mood === "ended";
  // Only show the last few phases — older ones scroll off-screen, the
  // full transcript is the source of truth for history. Three keeps the
  // strip dense without wrapping at common widths.
  const visiblePhases = phases.slice(-3);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${agentDisplayName} ${headline}`}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card/40 backdrop-blur-sm",
        "ring-1 ring-inset",
        palette.ring,
      )}
    >
      {!ended && (
        /* Aurora top edge — primary "alive" signal. */
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden"
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-1/3",
              "motion-safe:animate-aurora-sweep",
            )}
            style={{
              backgroundImage: `linear-gradient(to right, transparent, ${palette.beam}, transparent)`,
            }}
          />
        </span>
      )}

      <div className="flex items-start gap-3 px-3.5 py-2.5">
        {/* Mood dot: scaling heartbeat with a soft halo. */}
        <span
          aria-hidden
          className="relative mt-1 inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              "absolute inset-[-2px] rounded-full blur-sm",
              palette.haloBg,
            )}
          />
          <span
            className={cn(
              "relative inline-block h-2 w-2 rounded-full",
              palette.dotBg,
              !ended && "motion-safe:animate-heartbeat",
            )}
          />
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Active row: agent · headline + cycling verb fallback. */}
          <div className="flex items-baseline gap-2 text-xs leading-tight">
            <span className={cn("font-semibold", palette.accentText)}>
              {agentDisplayName}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-foreground/85">
              {headline}
              {!ended && <BreathingDots />}
            </span>
          </div>

          {/* Subtitle: monospace context (tool args, lifecycle hint). */}
          {subtitle && (
            <div className="truncate font-mono text-[10.5px] tracking-tight text-muted-foreground/80">
              {subtitle}
            </div>
          )}

          {/* Trajectory chips — what's been done + what's active. */}
          {visiblePhases.length > 0 && (
            <ol className="-ml-0.5 flex flex-wrap items-center gap-1 pt-0.5">
              {visiblePhases.map((phase, idx) => (
                <li
                  key={phase.id}
                  className="flex items-center gap-1"
                >
                  <PhaseChip
                    phase={phase}
                    palette={palette}
                    animated={!ended}
                  />
                  {idx < visiblePhases.length - 1 && (
                    <ChevronRight
                      className="size-3 text-muted-foreground/35"
                      aria-hidden
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Elapsed readout — small digital pill, right aligned. */}
        {!ended && elapsedMs != null && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5",
              "border-border/40 bg-background/70",
              "font-mono text-[10px] tabular-nums tracking-wider",
              "text-muted-foreground",
            )}
          >
            {formatElapsed(elapsedMs)}
          </span>
        )}
      </div>

      {!ended && (
        /* Shimmer bottom edge — continuous motion when waiting. */
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] overflow-hidden"
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-1/4 opacity-70",
              "motion-safe:animate-shimmer-bar",
            )}
            style={{
              backgroundImage: `linear-gradient(to right, transparent, ${palette.beam}, transparent)`,
            }}
          />
        </span>
      )}
    </div>
  );
}

function PhaseChip({
  phase,
  palette,
  animated,
}: {
  phase: WorkingPhase;
  palette: MoodPalette;
  animated: boolean;
}) {
  if (phase.state === "done") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        )}
      >
        <Check className="size-2.5" aria-hidden />
        <span className="max-w-[12rem] truncate font-mono text-[10px]">
          {phase.label}
        </span>
      </span>
    );
  }
  if (phase.state === "failed") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
          "bg-destructive/10 text-destructive",
        )}
      >
        <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
        <span className="max-w-[12rem] truncate font-mono text-[10px]">
          {phase.label}
        </span>
      </span>
    );
  }
  // active
  return (
    <span
      className={cn(
        "relative inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
        "ring-1 ring-inset",
        palette.chipBg,
        palette.chipText,
        palette.chipRing,
      )}
    >
      <Wrench className="size-2.5" aria-hidden />
      <span className="max-w-[14rem] truncate font-mono text-[10px] font-medium">
        {phase.label}
      </span>
      {animated && (
        /* tiny in-chip pulse ring */
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full ring-1 ring-inset",
            palette.chipRing,
            "motion-safe:animate-phase-glow",
          )}
        />
      )}
    </span>
  );
}

/**
 * Trailing three-dot animation. Smooth amplitude pulse on each dot
 * staggered by ~150 ms — reads as a wave traveling left-to-right.
 * Done with state instead of CSS because we want each dot to be
 * independent of the others (a single keyframe applied to all three
 * would have them all pulse together, which is harsher).
 */
function BreathingDots() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 6), 220);
    return () => clearInterval(id);
  }, []);
  return (
    <span aria-hidden className="ml-0.5 inline-flex gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-current"
          style={{
            opacity: dotOpacity(tick, i),
            transform: `translateY(${dotOffset(tick, i)}px)`,
            transition: "opacity 200ms ease, transform 200ms ease",
          }}
        />
      ))}
    </span>
  );
}

function dotOpacity(tick: number, i: number): number {
  // Each dot peaks 2 ticks apart, gives a wave-like feel.
  const phase = (tick - i + 6) % 6;
  if (phase === 0) return 1;
  if (phase === 1 || phase === 5) return 0.7;
  return 0.3;
}

function dotOffset(tick: number, i: number): number {
  const phase = (tick - i + 6) % 6;
  if (phase === 0) return -1;
  return 0;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `0:${totalSec.toString().padStart(2, "0")}`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ────────────────────────────────────────────────────────────────────
// Mood palettes
//
// Tailwind classnames are static (so the JIT can pick them up) but
// the inline-gradient `beam` color is a raw hex/HSL because the
// gradient is built via inline style. Keeping the two in lockstep is
// the whole point of bundling them per-mood — change a mood's vibe
// here and the dot, halo, chip, beam, and shimmer all update together.

type MoodPalette = {
  /** Outermost ring around the card. */
  ring: string;
  /** Filled mood dot background. */
  dotBg: string;
  /** Soft glow behind the dot. */
  haloBg: string;
  /** Active phase chip background. */
  chipBg: string;
  /** Active phase chip text. */
  chipText: string;
  /** Active phase chip ring. */
  chipRing: string;
  /** Agent name accent text color. */
  accentText: string;
  /** Inline-style gradient stop for the aurora + shimmer bars. */
  beam: string;
};

const MOOD_PALETTES: Record<WorkingMood, MoodPalette> = {
  waiting: {
    ring: "ring-sky-500/15",
    dotBg: "bg-sky-500",
    haloBg: "bg-sky-400/40",
    chipBg: "bg-sky-500/10",
    chipText: "text-sky-700 dark:text-sky-300",
    chipRing: "ring-sky-500/30",
    accentText: "text-sky-700 dark:text-sky-300",
    beam: "hsl(199 89% 60%)",
  },
  tool: {
    ring: "ring-violet-500/15",
    dotBg: "bg-violet-500",
    haloBg: "bg-violet-400/40",
    chipBg: "bg-violet-500/10",
    chipText: "text-violet-700 dark:text-violet-300",
    chipRing: "ring-violet-500/30",
    accentText: "text-violet-700 dark:text-violet-300",
    beam: "hsl(258 90% 66%)",
  },
  writing: {
    ring: "ring-emerald-500/15",
    dotBg: "bg-emerald-500",
    haloBg: "bg-emerald-400/40",
    chipBg: "bg-emerald-500/10",
    chipText: "text-emerald-700 dark:text-emerald-300",
    chipRing: "ring-emerald-500/30",
    accentText: "text-emerald-700 dark:text-emerald-300",
    beam: "hsl(160 84% 45%)",
  },
  wrapping: {
    ring: "ring-amber-500/15",
    dotBg: "bg-amber-500",
    haloBg: "bg-amber-400/40",
    chipBg: "bg-amber-500/10",
    chipText: "text-amber-700 dark:text-amber-300",
    chipRing: "ring-amber-500/30",
    accentText: "text-amber-700 dark:text-amber-300",
    beam: "hsl(38 92% 55%)",
  },
  ended: {
    // Muted slate and fully static. A completed turn must not retain any
    // of the motion language used to communicate active work.
    ring: "ring-slate-500/15",
    dotBg: "bg-slate-500",
    haloBg: "bg-slate-400/30",
    chipBg: "bg-slate-500/10",
    chipText: "text-slate-700 dark:text-slate-300",
    chipRing: "ring-slate-500/30",
    accentText: "text-slate-700 dark:text-slate-300",
    beam: "hsl(215 16% 60%)",
  },
};
