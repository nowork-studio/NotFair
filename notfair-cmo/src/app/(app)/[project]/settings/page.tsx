import { notFound } from "next/navigation";
import { getProject } from "@/server/db/projects";
import { DangerZone } from "@/components/danger-zone";
import { ProjectRenameCard } from "@/components/project-rename-card";
import { WorkspaceBrowserCard } from "@/components/workspace-browser-card";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project: slug } = await params;
  const project = getProject(slug);
  if (!project || project.archived_at) notFound();

  return (
    <div className="ns-app-narrow">
      <header className="ns-page-head">
        <div className="ns-page-head-stack">
          <h1 className="ns-page-title">Settings</h1>
          <p className="ns-page-sub">
            Manage <b>{project.display_name}</b> — name, slug, and the danger
            zone.
          </p>
        </div>
      </header>

      <section>
        <h2 className="ns-h2">
          <span>General</span>
        </h2>
        <ProjectRenameCard
          currentSlug={project.slug}
          currentDisplayName={project.display_name}
        />
      </section>

      <section>
        <h2 className="ns-h2">
          <span>Workspace details</span>
        </h2>
        <div className="ns-card">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 p-[18px]">
            <dt className="text-[12.5px] text-[hsl(var(--notfair-ink-4))]">
              Display name
            </dt>
            <dd className="text-[13px] font-medium text-[hsl(var(--notfair-ink-2))]">
              {project.display_name}
            </dd>
            <dt className="text-[12.5px] text-[hsl(var(--notfair-ink-4))]">URL slug</dt>
            <dd>
              <span className="ns-tag-mono">{project.slug}</span>
            </dd>
            <dt className="text-[12.5px] text-[hsl(var(--notfair-ink-4))]">
              AI agent runtime
            </dt>
            <dd className="text-[13px] text-[hsl(var(--notfair-ink-2))]">
              {project.harness_adapter === "codex-local" ? "Codex" : "Claude Code"}
            </dd>
          </dl>
        </div>
      </section>

      <section>
        <h2 className="ns-h2">
          <span>Workspace browser</span>
        </h2>
        <WorkspaceBrowserCard projectSlug={project.slug} />
      </section>

      <section>
        <h2 className="ns-h2">
          <span>Danger zone</span>
        </h2>
        <DangerZone projectSlug={project.slug} projectName={project.display_name} />
      </section>
    </div>
  );
}
