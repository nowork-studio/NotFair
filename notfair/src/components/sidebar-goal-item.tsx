"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  MoreVertical,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Trash2,
} from "lucide-react";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteGoalAction,
  pauseGoalAction,
  renameGoalAction,
  resumeGoalAction,
  setGoalPinnedAction,
} from "@/server/actions/goals";
import { cn } from "@/lib/utils";

type LiveStatus = "intake" | "proposed" | "active" | "paused";

/**
 * One goal row in the sidebar rail: link to the goal screen plus a ⋮ menu
 * (pin, rename, pause/resume, delete). Server sidebar computes the display
 * bits (dot/label classes); this component owns the interactions.
 */
export function SidebarGoalItem({
  href,
  homeHref,
  goalId,
  label,
  status,
  pinned,
  dotClass,
  labelClass,
  nested = false,
}: {
  href: string;
  /** Project home — where the user lands after deleting the open goal. */
  homeHref: string;
  goalId: string;
  label: string;
  status: LiveStatus;
  pinned: boolean;
  dotClass: string;
  labelClass: string;
  nested?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState(label);

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMsg?: string,
    after?: () => void,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? "Action failed.");
        return;
      }
      if (successMsg) toast.success(successMsg);
      after?.();
      router.refresh();
    });
  }

  function onDelete() {
    run(
      () => deleteGoalAction(goalId),
      "Goal deleted.",
      () => {
        setDeleteOpen(false);
        // If the user is anywhere inside the deleted goal's screen, that
        // route is now a 404 — send them home.
        if (pathname === href || pathname?.startsWith(`${href}/`)) {
          router.push(homeHref);
        }
      },
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className={nested ? "pl-7" : undefined}>
        <Link href={href}>
          <span className={cn("ns-dot", dotClass)} aria-hidden />
          <span className={cn("truncate", labelClass)}>{label}</span>
          {pinned && (
            <Pin
              aria-label="Pinned"
              className="ml-auto !size-3 shrink-0 text-[hsl(var(--notfair-ink-4))]"
            />
          )}
        </Link>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Goal actions: ${label}`}>
            <MoreVertical />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="min-w-44">
          <DropdownMenuItem
            disabled={pending}
            onSelect={() =>
              run(
                () => setGoalPinnedAction(goalId, !pinned),
                pinned ? "Unpinned." : "Pinned to top.",
              )
            }
          >
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? "Unpin" : "Pin to top"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => {
              setDraft(label);
              setRenameOpen(true);
            }}
          >
            <Pencil />
            Rename…
          </DropdownMenuItem>
          {status === "active" && (
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => run(() => pauseGoalAction(goalId), "Goal paused.")}
            >
              <Pause />
              Pause
            </DropdownMenuItem>
          )}
          {status === "paused" && (
            <DropdownMenuItem
              disabled={pending}
              onSelect={() =>
                run(() => resumeGoalAction(goalId), "Goal resumed — heartbeat restarted.")
              }
            >
              <Play />
              Resume
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename goal</DialogTitle>
            <DialogDescription>
              Changes the display name everywhere — the ambition itself stays
              as you stated it.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => renameGoalAction(goalId, draft),
                "Goal renamed.",
                () => setRenameOpen(false),
              );
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              aria-label="Goal name"
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !draft.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{label}”?</DialogTitle>
            <DialogDescription>
              Permanently removes the goal, its agent, its chat history, and
              every check. There is no recovery — if you just want the loop to
              stop, close the goal from its page instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={pending}>
              <Trash2 className="size-3.5" />
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
}
