"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Status = {
  running: boolean;
  cdpPort: number;
  userDataDir: string;
  uptimeMs?: number;
};

type Tab = { id: string; url: string; title: string };

const SIGNIN_TARGETS: Array<{ label: string; url: string }> = [
  { label: "Google", url: "https://accounts.google.com/" },
  { label: "Meta / Facebook", url: "https://www.facebook.com/login/" },
  { label: "Search Console", url: "https://search.google.com/search-console" },
];

export function WorkspaceBrowserCard({ projectSlug }: { projectSlug: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/browser/status?project_slug=${encodeURIComponent(projectSlug)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      setStatus(body.status);
      setTabs(body.tabs ?? []);
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function launch(signinUrl?: string) {
    setPending(true);
    try {
      const res = await fetch("/api/browser/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_slug: projectSlug,
          signin_url: signinUrl,
          headless: false,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Launch failed");
      toast.success(
        signinUrl
          ? `Opened ${new URL(signinUrl).hostname} — sign in, then come back.`
          : "Workspace browser is running.",
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function shutdown() {
    setPending(true);
    try {
      const res = await fetch("/api/browser/shutdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_slug: projectSlug }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Shutdown failed");
      toast.success("Workspace browser stopped. Cookies persist for next launch.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ns-card">
      <div className="space-y-4 p-[18px]">
        <div>
          <h3 className="text-[14.5px] font-semibold tracking-tight text-[hsl(var(--notfair-ink))]">
            Workspace browser
          </h3>
          <p className="mt-1 text-[12.5px] leading-snug text-[hsl(var(--notfair-ink-4))]">
            Agents share a single Chrome instance with persistent cookies.
            Sign in once here (Google, Meta, Search Console, …) and every
            agent inherits the session. Each agent gets its own labeled tab,
            so they don&apos;t race.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={
              "inline-flex items-center gap-1.5 text-[12.5px] " +
              (status?.running
                ? "text-[hsl(var(--notfair-ink-2))]"
                : "text-[hsl(var(--notfair-ink-4))]")
            }
          >
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (status?.running ? "bg-emerald-500" : "bg-[hsl(var(--notfair-ink-5))]")
              }
            />
            {loading
              ? "Checking…"
              : status?.running
                ? `Running on port ${status.cdpPort}` +
                  (status.uptimeMs ? ` · ${Math.round(status.uptimeMs / 1000)}s uptime` : "")
                : "Not running"}
          </span>

          <div className="ml-auto flex gap-2">
            {status?.running ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={shutdown}>
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                Stop
              </Button>
            ) : (
              <Button size="sm" disabled={pending} onClick={() => launch()}>
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                Launch
              </Button>
            )}
          </div>
        </div>

        {status?.running && (
          <div className="space-y-3">
            <div>
              <div className="text-[12px] font-medium uppercase tracking-wide text-[hsl(var(--notfair-ink-4))]">
                Sign in to a service
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {SIGNIN_TARGETS.map((target) => (
                  <Button
                    key={target.url}
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => launch(target.url)}
                  >
                    Open {target.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-[hsl(var(--notfair-ink-4))]">
                Clicking opens (or reuses) a tab labelled <code>signin</code>.
                Complete the login in the Chrome window — cookies persist
                automatically in this workspace&apos;s profile directory.
              </p>
            </div>

            {tabs.length > 0 && (
              <div>
                <div className="text-[12px] font-medium uppercase tracking-wide text-[hsl(var(--notfair-ink-4))]">
                  Open tabs ({tabs.length})
                </div>
                <ul className="mt-2 space-y-1">
                  {tabs.map((tab) => (
                    <li
                      key={tab.id}
                      className="flex items-center gap-2 text-[12.5px] text-[hsl(var(--notfair-ink-2))]"
                    >
                      <span className="ns-tag-mono">{tab.id}</span>
                      <span className="truncate" title={tab.url}>
                        {tab.title || tab.url}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {status && !status.running && (
          <p className="text-[11.5px] text-[hsl(var(--notfair-ink-4))]">
            Profile dir: <code className="break-all">{status.userDataDir}</code>
          </p>
        )}
      </div>
    </div>
  );
}
