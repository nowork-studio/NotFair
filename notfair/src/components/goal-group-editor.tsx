"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createGoalGroupAction,
  deleteGoalGroupAction,
  saveGoalGroupAction,
} from "@/server/actions/goal-groups";
import { projectHref } from "@/lib/project-href";

export type GoalGroupEditorGoal = {
  id: string;
  label: string;
  status: string;
  current_group_id: string | null;
  current_group_name: string | null;
};

export function GoalGroupEditor({
  projectSlug,
  goals,
  group,
}: {
  projectSlug: string;
  goals: GoalGroupEditorGoal[];
  group?: { id: string; name: string; description: string };
}) {
  const router = useRouter();
  const editing = Boolean(group);
  const initialSelected = goals
    .filter((goal) => goal.current_group_id === group?.id)
    .map((goal) => goal.id);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [pending, startTransition] = useTransition();

  function reset() {
    setName(group?.name ?? "");
    setDescription(group?.description ?? "");
    setSelected(new Set(initialSelected));
    setConfirmDelete(false);
  }

  function toggle(goalId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const result = group
        ? await saveGoalGroupAction({
            group_id: group.id,
            name,
            description,
            goal_ids: [...selected],
          })
        : await createGoalGroupAction({
            project_slug: projectSlug,
            name,
            description,
            goal_ids: [...selected],
          });
      if (!result.ok || !result.group_id) {
        toast.error(result.error ?? "Could not save the group.");
        return;
      }
      toast.success(group ? "Group updated." : "Group created.");
      setOpen(false);
      router.push(projectHref(projectSlug, `/groups/${result.group_id}`));
      router.refresh();
    });
  }

  function remove() {
    if (!group) return;
    startTransition(async () => {
      const result = await deleteGoalGroupAction(group.id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete the group.");
        return;
      }
      toast.success("Group deleted. Its goals are now ungrouped.");
      setOpen(false);
      router.push(projectHref(projectSlug, "/goals"));
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={editing ? "ns-btn ns-btn-ghost" : "ns-btn ns-btn-primary"}>
          {editing ? <Settings2 className="size-3.5" /> : <FolderPlus className="size-3.5" />}
          {editing ? "Manage group" : "New group"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Manage goal group" : "Create a goal group"}</DialogTitle>
          <DialogDescription>
            A group is one dashboard for related goals. Moving a goal here removes it from
            its previous group, but never changes its heartbeat or history.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <label htmlFor="goal-group-name" className="text-[12.5px] font-medium">
              Name
            </label>
            <Input
              id="goal-group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ads MCP reliability"
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="goal-group-description" className="text-[12.5px] font-medium">
              Description <span className="font-normal text-[hsl(var(--notfair-ink-4))]">optional</span>
            </label>
            <textarea
              id="goal-group-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Keep every paid-ads MCP connection reliable."
              maxLength={240}
              rows={3}
              className="w-full resize-none rounded-md border border-transparent bg-[hsl(var(--notfair-surface-2))] px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-[12.5px] font-medium">
              Goals <span className="font-normal tabular-nums text-[hsl(var(--notfair-ink-4))]">{selected.size} selected</span>
            </legend>
            {goals.length === 0 ? (
              <p className="m-0 rounded-xl bg-[hsl(var(--notfair-surface-2)/0.55)] p-4 text-[12.5px] text-[hsl(var(--notfair-ink-4))]">
                No goals yet. You can create the empty group now and add goals later.
              </p>
            ) : (
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                {goals.map((goal) => {
                  const moving =
                    selected.has(goal.id) &&
                    goal.current_group_id !== null &&
                    goal.current_group_id !== group?.id;
                  return (
                    <label
                      key={goal.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl bg-[hsl(var(--notfair-surface-2)/0.55)] px-3 py-2.5 transition-colors hover:bg-[hsl(var(--notfair-surface-2))]"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(goal.id)}
                        onChange={() => toggle(goal.id)}
                        className="mt-0.5 size-4 accent-[hsl(var(--notfair-ink))]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{goal.label}</span>
                        <span className="block text-[11px] text-[hsl(var(--notfair-ink-4))]">
                          {moving ? `Moves from ${goal.current_group_name}` : goal.status}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <DialogFooter className="items-center sm:justify-between">
            {editing ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-[hsl(var(--notfair-ink-4))]">Goals will become ungrouped.</span>
                  <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={pending}>
                    Delete group
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={pending}>
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Saving…" : editing ? "Save group" : "Create group"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
