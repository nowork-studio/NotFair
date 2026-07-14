import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getProject } from "@/server/db/projects";
import { resolveAgentBySlug } from "@/server/agent-meta";
import { getGoalForAgent, getLatestGoalForAgent } from "@/server/db/goals";
import { listSessionsForAgent } from "@/server/sessions/view";
import { readTranscriptTail } from "@/server/sessions/transcript-tail";
import { getMcpCatalog } from "@/server/mcp-catalog";
import { projectHref } from "@/lib/project-href";
import { goalLabel } from "@/lib/goal-label";
import { LiveTranscript } from "@/components/live-transcript";

export const dynamic = "force-dynamic";

/**
 * Read-only transcript of one loop check (tick). Reached from the goal
 * screen's Checks list; the composer is disabled — steering happens in
 * the goal's own conversation, not inside a check's log.
 */
export default async function CheckTranscriptPage({
  params,
}: {
  params: Promise<{ agent: string; thread: string; project: string }>;
}) {
  const { agent: agentSlug, thread: threadId, project: slug } = await params;
  const project = getProject(slug);
  if (!project || project.archived_at) notFound();
  const resolved = await resolveAgentBySlug(slug, agentSlug);
  if (!resolved) notFound();
  const goal =
    getGoalForAgent(resolved.agent_id) ?? getLatestGoalForAgent(resolved.agent_id);

  const sessions = listSessionsForAgent(slug, resolved.agent_id);
  const existing = sessions.find((s) => s.sessionId === threadId);
  const { events: initialEvents, cursor: initialCursor } = readTranscriptTail(
    slug,
    resolved.agent_id,
    threadId,
    0,
  );
  const mcpCatalog = getMcpCatalog(slug).map((m) => ({
    key: m.key,
    display_name: m.display_name,
    resource_url: m.resource_url,
  }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 px-5 py-2.5">
        <Link
          href={projectHref(slug, `/goals/${agentSlug}`)}
          className="ns-btn ns-btn-outline ns-btn-sm shrink-0"
        >
          <ArrowLeft className="size-3.5" />
          Back to goal
        </Link>
        <h1 className="m-0 min-w-0 truncate text-[14px] font-semibold">
          {goal ? goalLabel(goal) : resolved.name} — check log
        </h1>
      </header>
      <div className="min-h-0 flex-1">
        <LiveTranscript
          key={threadId}
          projectSlug={slug}
          agentSlug={agentSlug}
          agentDisplayName={goal ? goalLabel(goal) : resolved.name}
          threadId={threadId}
          initialEvents={initialEvents}
          initialCursor={initialCursor}
          composerDisabled
          disabledComposerPlaceholder="This check log is read-only — follow up from the goal chat"
          showCompletedStatus
          mcpCatalog={mcpCatalog}
        />
      </div>
    </div>
  );
}
