"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type {
  CodexUsage,
  HarnessUsage,
  RateLimitWindow,
} from "@/server/harness-usage";
import {
  refreshCodexUsageAction,
  startCodexLoginAction,
} from "@/server/actions/harness";

type Props = {
  adapter: "claude-code-local" | "codex-local";
  usage: HarnessUsage;
};

const HARNESS_LABEL: Record<Props["adapter"], string> = {
  "codex-local": "Codex",
  "claude-code-local": "Claude Code",
};

// localStorage key — single bool. Default = expanded (we want users to
// see their usage at a glance on first install; collapsing is a
// per-user preference for once they've internalised the pattern).
const COLLAPSE_KEY = "NotFair:harness-footer:collapsed";

/**
 * Sidebar footer summary of the active harness. The header row (dot,
 * harness name, plan chip, chevron) is always visible and acts as the
 * collapse toggle; the detail section below — usage bars for Codex,
 * activity counts for Claude Code — hides when the user collapses.
 *
 * State is persisted in localStorage so the choice survives page
 * reloads. Default is expanded.
 */
export function HarnessFooter({ adapter, usage }: Props) {
  const router = useRouter();
  const harnessName = HARNESS_LABEL[adapter];
  const [currentUsage, setCurrentUsage] = useState(usage);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const pollingRef = useRef(false);
  // Default to expanded; hydrate from localStorage after mount so SSR
  // and first paint stay deterministic.
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch {
      // localStorage unavailable — keep the default.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (collapsed) window.localStorage.setItem(COLLAPSE_KEY, "1");
      else window.localStorage.removeItem(COLLAPSE_KEY);
    } catch {
      // Storage write failure is non-fatal.
    }
  }, [collapsed, hydrated]);

  useEffect(() => setCurrentUsage(usage), [usage]);

  useEffect(() => {
    if (!signingIn) return;
    let attempts = 0;
    const id = window.setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const next = await refreshCodexUsageAction();
        setCurrentUsage(next);
        attempts += 1;
        if (
          next.kind === "codex" &&
          next.auth !== "signed-out" &&
          next.auth !== "unknown"
        ) {
          setSigningIn(false);
          setSignInError(null);
          router.refresh();
        } else if (attempts >= 60) {
          setSigningIn(false);
          setSignInError("Sign-in was not completed. Try again when ready.");
        }
      } catch (err) {
        attempts += 1;
        if (attempts >= 60) {
          setSigningIn(false);
          setSignInError(
            err instanceof Error
              ? err.message
              : "Couldn’t refresh Codex sign-in status.",
          );
        }
      } finally {
        pollingRef.current = false;
      }
    }, 2_000);
    return () => window.clearInterval(id);
  }, [router, signingIn]);

  if (currentUsage.kind === "codex") {
    const planLabel = formatPlan(currentUsage.plan);
    const signedIn =
      currentUsage.auth !== "signed-out" && currentUsage.auth !== "unknown";
    return (
      <FooterShell>
        <FooterHeader
          harness={harnessName}
          chip={codexChip(currentUsage, planLabel)}
          chipTone={signedIn ? "accent" : "neutral"}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
        {!collapsed &&
          (currentUsage.rateLimits.length > 0 ? (
            <div className="mt-2 space-y-2">
              {currentUsage.rateLimits.map((window) => (
                <UsageBar
                  key={`${window.label}:${window.limit_window_seconds}`}
                  label={window.label}
                  window={window}
                />
              ))}
            </div>
          ) : currentUsage.auth === "signed-out" ? (
            <div className="mt-1.5 space-y-1.5">
              <FooterDetail>Codex is signed out</FooterDetail>
              <button
                type="button"
                disabled={signingIn}
                onClick={async () => {
                  setSignInError(null);
                  const result = await startCodexLoginAction();
                  if (!result.ok) {
                    setSignInError(result.error);
                    return;
                  }
                  setSigningIn(true);
                }}
                className="ns-btn ns-btn-outline ns-btn-sm w-full justify-center disabled:opacity-60"
              >
                {signingIn ? "Waiting for sign-in…" : "Sign in to Codex"}
              </button>
              {signInError && <FooterError>{signInError}</FooterError>}
            </div>
          ) : (
            <FooterDetail>{codexSignedInDetail(currentUsage)}</FooterDetail>
          ))}
      </FooterShell>
    );
  }

  if (currentUsage.kind === "claude-code") {
    const detail = currentUsage.stale
      ? lastSeenLabel(currentUsage.lastComputedDate)
      : `${formatCount(currentUsage.messagesToday)} msg · ${formatTokens(
          currentUsage.tokensToday,
        )} today`;
    return (
      <FooterShell>
        <FooterHeader
          harness={harnessName}
          chip={currentUsage.stale ? "Idle" : "Active today"}
          chipTone={currentUsage.stale ? "neutral" : "accent"}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
        {!collapsed && detail && <FooterDetail>{detail}</FooterDetail>}
      </FooterShell>
    );
  }

  // Unknown harness — nothing collapsible, just a tiny chip.
  return (
    <FooterShell>
      <FooterHeader
        harness={harnessName}
        chip={null}
        collapsed={false}
        onToggle={null}
      />
    </FooterShell>
  );
}

function FooterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col px-1 py-1.5 leading-tight">{children}</div>
  );
}

function FooterHeader({
  harness,
  chip,
  chipTone = "neutral",
  collapsed,
  onToggle,
}: {
  harness: string;
  chip: string | null;
  chipTone?: "accent" | "neutral";
  collapsed: boolean;
  onToggle: (() => void) | null;
}) {
  const body = (
    <>
      <span
        aria-hidden
        className={`ns-dot ${chipTone === "accent" ? "ns-dot-on" : "ns-dot-mute"}`}
      />
      <span className="text-[12px] font-medium tracking-tight text-[hsl(var(--notfair-ink-2))]">
        {harness}
      </span>
      {chip && (
        <span className="ml-auto truncate text-[11px] font-medium text-[hsl(var(--notfair-ink-4))]">
          {chip}
        </span>
      )}
      {onToggle && (
        <ChevronDown
          aria-hidden
          className={`size-3 shrink-0 text-[hsl(var(--notfair-ink-4))] transition-transform duration-150 ${
            collapsed ? "-rotate-90" : ""
          } ${chip ? "ml-1" : "ml-auto"}`}
        />
      )}
    </>
  );

  if (!onToggle) {
    return <div className="flex items-center gap-1.5">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Show harness usage" : "Hide harness usage"}
      className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-[hsl(var(--notfair-surface-2))]"
    >
      {body}
    </button>
  );
}

function FooterDetail({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mt-1 truncate text-[11px] tabular-nums text-[hsl(var(--notfair-ink-4))]">
      {children}
    </p>
  );
}

function FooterError({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 text-[10.5px] leading-snug text-destructive">{children}</p>
  );
}

function codexChip(usage: CodexUsage, planLabel: string | null): string | null {
  if (planLabel) return `ChatGPT ${planLabel}`;
  if (usage.auth === "api-key") return "API key";
  if (usage.auth === "agent-identity") return "Access token";
  if (usage.auth === "chatgpt") return "ChatGPT";
  return null;
}

function codexSignedInDetail(usage: CodexUsage): string {
  if (usage.auth === "api-key") return "Signed in · usage billed by API";
  if (usage.auth === "agent-identity") return "Signed in with access token";
  if (usage.auth === "chatgpt") {
    return usage.email
      ? `Signed in as ${usage.email} · usage unavailable`
      : "Signed in · usage limits unavailable";
  }
  return "Couldn’t check Codex sign-in";
}

/**
 * Usage bar — label + remaining percent + thin progress track + reset
 * timestamp. Mirrors the ChatGPT settings page bars but compact enough
 * to fit a 240px sidebar.
 */
function UsageBar({
  label,
  window,
}: {
  label: string;
  window: RateLimitWindow;
}) {
  const used = clamp(window.used_percent, 0, 100);
  const remaining = 100 - used;
  // Bar color signals headroom. Brand green when comfortable, amber
  // approaching the limit, red when about to hit it.
  const tone =
    remaining < 5
      ? "bg-[hsl(0_72%_51%)]"
      : remaining < 20
        ? "bg-[hsl(38_92%_50%)]"
        : "bg-[hsl(var(--notfair-accent))]";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-[hsl(var(--notfair-ink-3))]">
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-[hsl(var(--notfair-ink-4))]">
          {Math.round(remaining)}% left
        </span>
      </div>
      <div
        className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[hsl(var(--notfair-surface-2))]"
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
      >
        <div
          className={`h-full rounded-full transition-[width] ${tone}`}
          style={{ width: `${remaining}%` }}
        />
      </div>
      <p className="m-0 mt-0.5 text-[10.5px] text-[hsl(var(--notfair-ink-4))]">
        Resets {formatReset(window.reset_at)}
      </p>
    </div>
  );
}

function formatPlan(slug: string | null): string | null {
  if (!slug) return null;
  // wham/usage returns lowercase plan slugs like "prolite", "pro",
  // "free", "plus". Title-case and tidy a couple of multi-word ones.
  const map: Record<string, string> = {
    // `prolite` is the provider's internal slug for the lower Pro tier.
    // It is still sold and presented to users as ChatGPT Pro.
    prolite: "Pro",
    pro: "Pro",
    free: "Free",
    plus: "Plus",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Edu",
  };
  return map[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

function formatReset(unixSeconds: number): string {
  const now = Date.now();
  const target = unixSeconds * 1000;
  const deltaMs = target - now;
  if (deltaMs <= 0) return "now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  const date = new Date(target);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `${n}`;
}

function lastSeenLabel(iso: string | null): string {
  if (!iso) return "No usage logged";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "No usage logged";
  return `Last seen ${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
