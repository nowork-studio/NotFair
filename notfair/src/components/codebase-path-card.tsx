"use client";

import { useState, useTransition } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setProjectCodebasePathAction } from "@/server/actions/projects";

/**
 * Settings card for the workspace's local codebase folder — the sanctioned
 * root for agent code changes. Agents can only touch the site's code via
 * the branch + PR protocol, and only inside this folder; without it, code
 * changes are off the table and agents log recommendations instead.
 */
export function CodebasePathCard({
  projectSlug,
  currentPath,
}: {
  projectSlug: string;
  currentPath: string | null;
}) {
  const [value, setValue] = useState(currentPath ?? "");
  const [picking, setPicking] = useState(false);
  const [pending, startTransition] = useTransition();

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
      if (body.kind === "cancelled") return;
      toast.error(body.message ?? "Couldn't open the folder picker.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  }

  function onSave() {
    startTransition(async () => {
      const r = await setProjectCodebasePathAction({
        project_slug: projectSlug,
        codebase_path: value,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.codebase_path
          ? "Codebase folder saved — agents can now propose code changes via pull requests."
          : "Codebase folder cleared — agents can no longer change code.",
      );
    });
  }

  const dirty = (currentPath ?? "") !== value.trim();

  return (
    <div className="ns-card p-[18px]">
      <p className="m-0 mb-1 text-[13px] font-medium">Codebase folder</p>
      <p className="m-0 mb-3 text-[12px] leading-relaxed text-[hsl(var(--notfair-ink-4))]">
        The local git checkout of your website. Goal agents may change code
        only here, only on a branch, and only through a pull request you
        review and merge on GitHub. Leave empty to keep code off-limits.
      </p>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="/path/to/your/site"
          maxLength={500}
          disabled={pending || picking}
          aria-label="Local codebase folder"
        />
        <Button
          type="button"
          variant="outline"
          onClick={onBrowse}
          disabled={pending || picking}
          aria-label="Browse for a folder"
        >
          {picking ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <FolderOpen className="mr-1.5 size-4" />
          )}
          Browse&hellip;
        </Button>
        <Button type="button" onClick={onSave} disabled={pending || !dirty}>
          {pending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
