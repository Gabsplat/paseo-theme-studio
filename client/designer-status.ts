import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";

export type DesignerStatus = { label: string; working: boolean; tone: "success" | "accent" | "warning" | "danger" };

/** The designer's real state from Paseo, polled. Null while there is no designer or it cannot be read. */
export function useDesignerStatus(
  paseo: PluginClientContext["paseo"] | undefined,
  agentId: string | null | undefined,
): DesignerStatus | null {
  const query = useQuery({
    queryKey: ["theme-studio-designer-status", agentId],
    enabled: Boolean(paseo && agentId),
    queryFn: async (): Promise<DesignerStatus | null> => {
      const handle = paseo!.agents.ref(agentId!);
      await handle.refresh();
      const agent = handle.current();
      if (!agent) return null;
      if (agent.requiresAttention && agent.attentionReason !== "finished")
        return { label: "Needs you", working: false, tone: "warning" };
      if (agent.status === "running") return { label: "Working", working: true, tone: "accent" };
      if (agent.status === "idle") return { label: "Ready", working: false, tone: "success" };
      if (agent.status === "error") return { label: "Error", working: false, tone: "danger" };
      if (agent.status === "closed") return { label: "Closed", working: false, tone: "danger" };
      return { label: "Starting", working: true, tone: "accent" };
    },
    refetchInterval: 2000,
  });
  return query.data ?? null;
}

export function statusColor(theme: PluginTheme, status: DesignerStatus | null): string {
  const c = theme.colors;
  if (!status) return c.foregroundMuted;
  return status.tone === "success"
    ? c.statusSuccess
    : status.tone === "warning"
      ? c.statusWarning
      : status.tone === "danger"
        ? c.statusDanger
        : c.accent;
}
