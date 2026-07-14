import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { getProject } from "@/server/db/projects";
import { prefetchAccountChoice } from "@/server/mcp/account-selection";
import { listProjectMcpTokens } from "@/server/mcp/tokens";

export const dynamic = "force-dynamic";

type Search = { slug?: string; mcp_key?: string };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { slug, mcp_key } = await searchParams;

  // Same post-OAuth picker flow as the Connections page: when the callback
  // flagged a multi-account MCP (`?mcp_key=`), prefetch the account list
  // server-side so the connect step opens the picker dialog with data —
  // never a client fetch racing the flash banner's URL cleanup.
  const project = slug ? getProject(slug) : null;
  const pendingChoice =
    project && mcp_key ? await prefetchAccountChoice(project, mcp_key) : null;

  // The first-goal step's focus chips derive from what got connected.
  // Fresh on every render — stepping Connect → Goal is a full RSC pass.
  const connectedMcpKeys = project
    ? listProjectMcpTokens(project.slug).map((t) => t.server_name)
    : [];

  return (
    <Suspense fallback={null}>
      <OnboardingFlow
        pickerMcpKey={pendingChoice && mcp_key ? mcp_key : null}
        pickerPrefetch={pendingChoice?.prefetch ?? null}
        connectedMcpKeys={connectedMcpKeys}
      />
    </Suspense>
  );
}
