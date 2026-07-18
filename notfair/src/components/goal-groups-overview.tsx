import Link from "next/link";
import { FolderKanban } from "lucide-react";

export type GoalGroupOverviewRow = {
  id: string;
  href: string;
  name: string;
  description: string;
  goal_count: number;
  healthy_count: number;
  attention_count: number;
  waiting_count: number;
};

export function GoalGroupsOverview({ groups }: { groups: GoalGroupOverviewRow[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-xl bg-[hsl(var(--notfair-surface-2)/0.45)] px-4 py-5 text-[12.5px] text-[hsl(var(--notfair-ink-4))]">
        Group related goals to see their metrics and recent checks together.
      </div>
    );
  }
  return (
    <ol className="ns-group">
      {groups.map((group) => (
        <li key={group.id}>
          <Link href={group.href} className="ns-row-button">
            <span className="ns-glyph" aria-hidden>
              <FolderKanban className="size-4" />
            </span>
            <span className="ns-row-body min-w-0">
              <span className="ns-row-title-row">
                <span className="ns-row-title">{group.name}</span>
                <span className="ns-tag-mono">{group.goal_count} goal{group.goal_count === 1 ? "" : "s"}</span>
              </span>
              <span className="ns-row-desc block truncate">
                {group.description || "A shared dashboard for related goals."}
              </span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-3 text-[11.5px]">
              {group.healthy_count > 0 && (
                <span className="text-[hsl(var(--notfair-accent))]">{group.healthy_count} healthy</span>
              )}
              {group.attention_count > 0 && (
                <span className="text-[hsl(var(--destructive))]">{group.attention_count} attention</span>
              )}
              {group.waiting_count > 0 && (
                <span className="text-[hsl(var(--notfair-ink-4))]">{group.waiting_count} waiting</span>
              )}
              <span className="chev" aria-hidden>›</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
