"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type VersionInfo = {
  current: string;
  latest: string | null;
  has_update: boolean;
};

/**
 * Sidebar footer: current version + an Upgrade button when npm reports a
 * newer version. Clicking Upgrade runs `npm i -g notfair-cmo@latest` via
 * /api/upgrade and tells the user to restart.
 */
export function SidebarVersion() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgraded, setUpgraded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/version", { cache: "no-store" })
      .then((r) => r.json() as Promise<VersionInfo>)
      .then((v) => {
        if (!cancelled) setInfo(v);
      })
      .catch(() => {
        // Offline / blocked — keep the bar empty rather than spam errors.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function upgrade() {
    if (!info?.has_update || upgrading) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/upgrade", { method: "POST" });
      const body = (await res.json()) as
        | { ok: true; note?: string }
        | { ok: false; error?: string; command?: string; hint?: string };
      if (!res.ok || !body.ok) {
        const msg = !body.ok
          ? body.hint ?? body.error ?? "Upgrade failed"
          : "Upgrade failed";
        if (!body.ok && body.command) {
          await navigator.clipboard.writeText(body.command).catch(() => {});
          toast.error(`${msg}\nCommand copied to clipboard.`, { duration: 10_000 });
        } else {
          toast.error(msg, { duration: 8_000 });
        }
        return;
      }
      setUpgraded(true);
      toast.success(
        body.note ??
          "Upgraded. Restart notfair-cmo in your terminal to apply.",
        { duration: 15_000 },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  }

  if (!info) {
    return (
      <div className="px-1 text-[11px] font-mono text-[hsl(var(--notfair-ink-5))]">
        notfair-cmo
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
      <span className="font-mono text-[hsl(var(--notfair-ink-4))]">
        notfair-cmo v{info.current}
      </span>

      {info.has_update && !upgraded && (
        <Button
          size="sm"
          variant="outline"
          disabled={upgrading}
          onClick={upgrade}
          title={`Update available: v${info.latest}`}
          className="h-6 gap-1 px-2 text-[10.5px] font-medium"
        >
          {upgrading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Upgrading…
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3" />
              v{info.latest} available
            </>
          )}
        </Button>
      )}

      {upgraded && (
        <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">
          Restart to apply
        </span>
      )}
    </div>
  );
}
