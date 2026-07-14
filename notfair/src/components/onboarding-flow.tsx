"use client";

import { Suspense, useActionState, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { McpFlashBanner } from "@/components/mcp-flash-banner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { projectHref } from "@/lib/project-href";
import { createProjectForOnboardingAction } from "@/server/actions/projects";
import {
  getOnboardingConnectCardsAction,
  type ConnectCard,
} from "@/server/onboarding/accounts";
import { AddMcpServerMenu } from "@/components/add-mcp-server-card";
import { McpCard } from "@/components/mcp-card";
import { NewGoalForm } from "@/components/new-goal-form";
import type { AccountPickerPrefetch } from "@/components/mcp-account-picker-dialog";

type Step = "name" | "connect" | "goal";

/**
 * The post-OAuth account/property choice for a multi-account MCP, as
 * prefetched by the onboarding server page (`?mcp_key=`). Same shape and
 * flow as the Connections page: the matching `McpCard` auto-opens the
 * shared picker dialog with this data.
 */
type PendingAccountChoice = {
  mcp_key: string;
  prefetch: AccountPickerPrefetch | null;
};

export function OnboardingFlow({
  pickerMcpKey = null,
  pickerPrefetch = null,
  connectedMcpKeys = [],
}: {
  pickerMcpKey?: string | null;
  pickerPrefetch?: AccountPickerPrefetch | null;
  /** Feeds the first-goal step's focus chips (server-computed). */
  connectedMcpKeys?: string[];
}) {
  return (
    <Suspense fallback={null}>
      <OnboardingFlowInner
        autoPicker={
          pickerMcpKey
            ? { mcp_key: pickerMcpKey, prefetch: pickerPrefetch }
            : null
        }
        connectedMcpKeys={connectedMcpKeys}
      />
    </Suspense>
  );
}

function OnboardingFlowInner({
  autoPicker,
  connectedMcpKeys,
}: {
  autoPicker: PendingAccountChoice | null;
  connectedMcpKeys: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const stepParam = params.get("step");
  const slug = params.get("slug") ?? null;
  const mcpConnected = params.get("mcp_connected") ?? undefined;
  const mcpError = params.get("mcp_error") ?? undefined;
  const mcpAnalyzing = params.get("mcp_analyzing") === "1";
  const step: Step =
    stepParam === "connect" ? "connect" : stepParam === "goal" ? "goal" : "name";

  return (
    <div className="ns-page">
      <a
        href="#onboarding-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      {/* Brand row + progress pips. The mark anchors the wizard so the user
          always sees where they are; the pips show how far they've gone. */}
      <div className="ns-topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/notfair-mark.svg" alt="Notfair" className="dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/notfair-mark-dark.svg" alt="Notfair" className="hidden dark:block" />
        <span className="ns-topbar-label">NotFair</span>
        <div className="ml-auto">
          <div className="ns-progress">
            <Pip n={1} label="Workspace" state={step === "name" ? "active" : "done"} />
            <span className="ns-pip-line" />
            <Pip
              n={2}
              label="Connect"
              state={
                step === "name" ? "pending" : step === "connect" ? "active" : "done"
              }
            />
            <span className="ns-pip-line" />
            <Pip
              n={3}
              label="First goal"
              state={step === "goal" ? "active" : "pending"}
            />
          </div>
        </div>
      </div>

      <main id="onboarding-main">
        <McpFlashBanner
          connected={mcpConnected}
          error={mcpError}
          analyzing={mcpAnalyzing}
          goalsHref={slug ? `/${slug}` : undefined}
        />
        {step === "name" && (
          <NameStep
            onCreated={(s) =>
              router.push(`/onboarding?step=connect&slug=${encodeURIComponent(s)}`)
            }
          />
        )}
        {step === "connect" && slug && (
          <ConnectStep slug={slug} autoPicker={autoPicker} />
        )}
        {step === "goal" && slug && (
          <FirstGoalStep slug={slug} connectedMcpKeys={connectedMcpKeys} />
        )}
        {step !== "name" && !slug && <MissingSlug />}
      </main>
    </div>
  );
}

function Pip({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: "pending" | "active" | "done";
}) {
  return (
    <div
      className={`ns-pip ${state === "done" ? "is-done" : ""} ${state === "active" ? "is-active" : ""}`}
    >
      <span className="ns-pip-dot">{state === "done" ? "✓" : n}</span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

// ── Codebase folder picker (Step 1 helper) ─────────────────────────
//
// Browsers don't expose absolute paths from `<input type="file"
// webkitdirectory>` or `showDirectoryPicker()` — security. Since this
// server runs on the user's own machine (loopback only), we shell out
// to the OS-native folder dialog via POST /api/fs/pick-folder and let
// the OS handle the picker UI. The field stays editable so users on
// platforms we don't yet support natively (Linux, Windows) can paste.

function CodebasePathPicker({ disabled }: { disabled: boolean }) {
  const [value, setValue] = useState("");
  const [picking, setPicking] = useState(false);

  async function onBrowse() {
    setPicking(true);
    try {
      const res = await fetch("/api/fs/pick-folder", { method: "POST" });
      const body = (await res.json()) as
        | { ok: true; path: string }
        | { ok: false; kind: "cancelled" }
        | { ok: false; kind: "unsupported" | "error"; message?: string };
      if (body.ok) {
        setValue(body.path);
        return;
      }
      if (body.kind === "cancelled") return; // silent — user closed dialog
      toast.error(body.message ?? "Couldn't open the folder picker.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        id="codebase_path"
        name="codebase_path"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="No folder selected"
        maxLength={500}
        disabled={disabled || picking}
        readOnly={picking}
        aria-label="Local codebase folder"
      />
      <Button
        type="button"
        variant="outline"
        onClick={onBrowse}
        disabled={disabled || picking}
        aria-label="Browse for a folder"
      >
        {picking ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" />
        ) : (
          <FolderOpen className="mr-1.5 size-4" />
        )}
        Browse&hellip;
      </Button>
    </div>
  );
}

// ── Step 1: Name ───────────────────────────────────────────────────

function NameStep({ onCreated }: { onCreated: (slug: string) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [state, formAction, isPending] = useActionState<
    | { ok: true; data: { slug: string; display_name: string } }
    | { ok: false; error: string }
    | null,
    FormData
  >(async (_prev, formData) => createProjectForOnboardingAction(formData), null);

  useEffect(() => {
    if (state && state.ok) onCreated(state.data.slug);
  }, [state, onCreated]);

  const errorMessage = state && !state.ok ? state.error : null;

  return (
    <>
      <header>
        <h1 className="ns-hero-title">Let&rsquo;s set up your workspace.</h1>
        <p className="ns-hero-sub">
          Name it, point at your site, and pick which local AI runtime does the work.
        </p>
      </header>

      <form action={formAction} className="mt-5 space-y-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="display_name" className="text-[13px] font-medium">
            Workspace name
          </Label>
          <Input
            id="display_name"
            name="display_name"
            required
            autoFocus
            placeholder="Acme Inc"
            maxLength={80}
            disabled={isPending}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="h-9 rounded-lg text-[14px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="website_url" className="text-[13px] font-medium">
            Website URL{" "}
            <span className="text-[12px] font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="website_url"
            name="website_url"
            type="url"
            placeholder="https://acme.com"
            maxLength={500}
            disabled={isPending}
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            className="h-9 rounded-lg text-[14px]"
          />
          <p className="text-[11.5px] text-muted-foreground leading-tight">
            Your agents skim a few pages to learn what you sell.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="codebase_path" className="text-[13px] font-medium">
            Local codebase folder{" "}
            <span className="text-[12px] font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <CodebasePathPicker disabled={isPending} />
          <p className="text-[11.5px] text-muted-foreground leading-tight">
            Folder your agents can read locally — README, package.json, top-level
            files. Skim only.
          </p>
        </div>

        <HarnessPicker disabled={isPending} />

        {errorMessage && (
          <p role="alert" className="text-[13px] text-destructive">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="ns-btn ns-btn-primary"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Continue
        </button>
      </form>
    </>
  );
}

// ── Harness picker ─────────────────────────────────────────────────
//
// Two adapters: Codex (recommended default) and Claude Code. Persisted on
// the project row so different projects can use different harnesses. The
// chosen CLI must be on PATH when chats run — adapter testEnvironment is
// surfaced via the doctor command for diagnostic feedback.

function HarnessPicker({ disabled }: { disabled: boolean }) {
  const [value, setValue] = useState<"claude-code-local" | "codex-local">(
    "codex-local",
  );
  const options: Array<{
    id: "claude-code-local" | "codex-local";
    label: string;
    description: string;
    recommended: boolean;
  }> = [
    {
      id: "codex-local",
      label: "Codex",
      description: "Uses your local `codex` CLI. Recommended.",
      recommended: true,
    },
    {
      id: "claude-code-local",
      label: "Claude Code",
      description: "Uses your local `claude` CLI.",
      recommended: false,
    },
  ];
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-3">
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          AI agent runtime
        </Label>
        <p className="text-xs text-muted-foreground">
          Pick which local CLI runs your agents. You can have different
          projects on different harnesses.
        </p>
      </div>
      <input type="hidden" name="harness_adapter" value={value} />
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => setValue(opt.id)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg px-3 py-2 text-left transition-colors",
              value === opt.id
                ? "bg-[hsl(var(--notfair-surface-2))] shadow-[var(--notfair-shadow-sm)]"
                : "bg-background/40 hover:bg-[hsl(var(--notfair-surface-2)/0.6)]",
              disabled && "opacity-60",
            )}
            aria-pressed={value === opt.id}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-medium text-foreground">{opt.label}</span>
              {opt.recommended && (
                <span className="rounded-full bg-[hsl(var(--notfair-accent-soft))] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[hsl(var(--notfair-accent))]">
                  Recommended
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: Connect ────────────────────────────────────────────────
//
// Renders the exact `McpCard` rows the Connections page uses — one shared
// component, one lifecycle (Connect → Choose account → Switch account),
// zero drift between onboarding and the app. The wizard only curates the
// list (via `getOnboardingConnectCardsAction`): recommended MCPs always
// show; everything else appears once connected and otherwise lives in
// the "More tools" browse menu.

const RECOMMENDED_MCP_KEYS = [
  "notfair-googleads",
  "notfair-metaads",
  "notfair-googlesearchconsole",
  "notfair-xads",
];

type ConnectCardsView =
  | { phase: "loading" }
  | { phase: "loaded"; cards: ConnectCard[]; any_connected: boolean }
  | { phase: "error"; message: string };

function ConnectStep({
  slug,
  autoPicker,
}: {
  slug: string;
  autoPicker: PendingAccountChoice | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<ConnectCardsView>({ phase: "loading" });
  const [advancing, setAdvancing] = useState(false);

  const loadCards = useCallback(async () => {
    const result = await getOnboardingConnectCardsAction(slug);
    if (!result.ok) {
      setView({ phase: "error", message: result.error });
      return;
    }
    setView({
      phase: "loaded",
      cards: result.cards,
      any_connected: result.any_connected,
    });
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getOnboardingConnectCardsAction(slug);
      if (cancelled) return;
      if (!result.ok) {
        setView({ phase: "error", message: result.error });
        return;
      }
      setView({
        phase: "loaded",
        cards: result.cards,
        any_connected: result.any_connected,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function onDone() {
    setAdvancing(true);
    // With sources connected, the wizard's last step mints the first
    // goal — focus options derive from what just got connected. With
    // nothing connected there's nothing measurable to focus on, so the
    // Skip path drops straight into the workspace.
    if (view.phase === "loaded" && view.any_connected) {
      router.push(`/onboarding?step=goal&slug=${encodeURIComponent(slug)}`);
    } else {
      router.replace(projectHref(slug, ""));
    }
  }

  if (view.phase === "loading") {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground py-8">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span>Loading your connections&hellip;</span>
      </div>
    );
  }

  if (view.phase === "error") {
    return (
      <div role="alert" className="ns-list p-6 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4 text-[hsl(var(--notfair-warn))]" aria-hidden />
          <span className="font-medium text-sm">
            Couldn&rsquo;t load connection state.
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{view.message}</p>
        <Link href="/onboarding" className="ns-btn ns-btn-primary">
          Start over
        </Link>
      </div>
    );
  }

  const { cards, any_connected } = view;

  return (
    <>
      <header>
        <h1 className="ns-hero-title">Connect your data sources.</h1>
        <p className="ns-hero-sub">
          Every goal agent shares these — they are what your agents
          measure and act on.
        </p>
      </header>

      <ol className="ns-list">
        {cards.map(({ spec, status, selected_id }) => (
          <li key={spec.key}>
            <McpCard
              spec={spec}
              status={status}
              projectSlug={slug}
              selectedAccountId={selected_id}
              pickerPrefetch={
                autoPicker?.mcp_key === spec.key ? autoPicker.prefetch : null
              }
              onMutated={loadCards}
            />
          </li>
        ))}
        <li>
          {/* Reuse the connections-page Add-MCP menu so onboarding gets the
              same Browse + Custom paths. The trigger is a tile-shaped
              button so it sits naturally as the last row of the grouped
              list; the dropdown opens from there. */}
          <AddMcpServerMenu
            align="start"
            // Hide the always-visible recommended MCPs from Browse — they
            // each have their own row above already.
            hideKeys={RECOMMENDED_MCP_KEYS}
            connectedKeys={cards
              .filter((c) => c.status.state === "connected")
              .map((c) => c.spec.key)}
            trigger={
              <button
                type="button"
                aria-label="More tools"
                className="ns-tile w-full"
              >
                <span className="ns-tile-glyph" aria-hidden>
                  +
                </span>
                <span className="ns-tile-body">
                  <span className="ns-tile-name-row">
                    <span className="ns-tile-name">More tools</span>
                  </span>
                  <span className="ns-tile-desc block">
                    Browse Google Analytics, Stripe, Supabase, PostHog, or
                    paste a custom MCP URL.
                  </span>
                </span>
                <span className="ns-tile-status">
                  <span className="arrow" aria-hidden>
                    ›
                  </span>
                </span>
              </button>
            }
          />
        </li>
      </ol>

      <div className="ns-foot">
        <p className="ns-footnote">You can set up MCPs later in the app.</p>
        {any_connected ? (
          <button
            type="button"
            onClick={onDone}
            disabled={advancing}
            className="ns-btn ns-btn-primary"
          >
            {advancing && <Loader2 className="size-4 animate-spin" />}
            Next{" "}
            <span aria-hidden style={{ fontWeight: 400 }}>
              ›
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onDone}
            disabled={advancing}
            className="ns-btn ns-btn-ghost"
          >
            Skip
          </button>
        )}
      </div>
    </>
  );
}

// ── Step 3: First goal ─────────────────────────────────────────────
//
// The same statement-first creation form the goals index uses — one
// component, one experience. Focus chips derive from the platforms the
// user just connected (SEO for Search Console, Google Ads, …); creating
// drops them straight into the new agent's chat, already working.

function FirstGoalStep({
  slug,
  connectedMcpKeys,
}: {
  slug: string;
  connectedMcpKeys: string[];
}) {
  return (
    <>
      <header>
        <h1 className="ns-hero-title">Create your first goal.</h1>
        <p className="ns-hero-sub">
          Pick a focus, state the ambition. An agent measures it, shows you
          the baseline, and waits for your START.
        </p>
      </header>

      <div className="mt-5">
        <NewGoalForm projectSlug={slug} connectedMcpKeys={connectedMcpKeys} />
      </div>

      <div className="ns-foot">
        <p className="ns-footnote">
          Not sure yet? Your workspace has this same form.
        </p>
        <Link href={projectHref(slug, "")} className="ns-btn ns-btn-ghost">
          Skip for now
        </Link>
      </div>
    </>
  );
}

function MissingSlug() {
  return (
    <div className="mt-10 space-y-4">
      <p className="text-[15px] text-muted-foreground">
        This step needs a workspace. Start from the beginning.
      </p>
      <Link href="/onboarding" className="ns-btn ns-btn-primary">
        Start over
      </Link>
    </div>
  );
}
