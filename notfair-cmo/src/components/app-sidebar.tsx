import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { SidebarBrand } from "@/components/sidebar-brand";
import {
  Home,
  CheckCircle2,
  ListChecks,
  Clock,
  Plug,
  Settings,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { listProjects } from "@/server/db/projects";
import { getActiveProject } from "@/server/active-project";
import { listProjectAgents } from "@/server/agent-meta";
import { TEMPLATES } from "@/server/agent-templates";
import { readHarnessUsage } from "@/server/harness-usage";
import { projectHref } from "@/lib/project-href";
import { ProjectSwitcher } from "./project-switcher";
import { AgentNav } from "./agent-nav";
import { ApprovalsLiveBadge } from "./live-badge";
import { HarnessFooter } from "./harness-footer";
import { SidebarVersion } from "./sidebar-version";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
};

const NAV: NavItem[] = [
  { href: "", label: "Home", icon: Home },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2, badge: true },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/crons", label: "Crons", icon: Clock },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export async function AppSidebar() {
  const projects = listProjects();
  const active = await getActiveProject();
  const agentEntries = active ? await listProjectAgents(active.slug) : [];
  // Best-effort fetch of harness usage. For Codex this hits the
  // chatgpt.com wham/usage endpoint (cached 60s in-process); for
  // Claude Code it just reads the local stats-cache. Either failure
  // mode collapses to a quieter chip.
  const harnessUsage = active
    ? await readHarnessUsage(active.harness_adapter)
    : null;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Brand mark + project switcher. The mark doubles as the expand
            toggle when collapsed (SidebarBrand handles both modes);
            SidebarTrigger only renders in the expanded state so the icon
            rail isn't doubled up. */}
        <div className="flex items-center gap-1">
          <SidebarBrand homeHref={active ? projectHref(active.slug, "") : "/"} />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <SidebarMenu>
              <SidebarMenuItem>
                <ProjectSwitcher
                  projects={projects}
                  activeSlug={active?.slug ?? null}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
          <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {active && (
          <SidebarGroup>
            <SidebarGroupLabel>Team</SidebarGroupLabel>
            <SidebarGroupContent>
              <AgentNav
                projectSlug={active.slug}
                agents={agentEntries.map((a) => ({
                  key: a.agent_id,
                  slug: a.slug,
                  name: a.name,
                  role_label: a.template_key
                    ? TEMPLATES.find((t) => t.key === a.template_key)?.display_name
                    : undefined,
                  description: a.description,
                  template_key: a.template_key,
                }))}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {active && (
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.href || "home"}>
                    <SidebarMenuButton asChild>
                      <Link href={projectHref(active.slug, item.href)}>
                        <item.icon />
                        <span>{item.label}</span>
                        {item.badge && <ApprovalsLiveBadge />}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-border/60 px-3 py-2 group-data-[collapsible=icon]:hidden">
        {active && harnessUsage && (
          <HarnessFooter
            adapter={active.harness_adapter}
            usage={harnessUsage}
          />
        )}
        <SidebarVersion />
      </SidebarFooter>
    </Sidebar>
  );
}
