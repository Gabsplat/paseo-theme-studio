import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";

/** A permission the designer is waiting on, reduced to what the user needs to decide. */
export type DesignerPermission = {
  id: string;
  title: string;
  /** The command, path, or other input the request is about, if any. */
  detail: string | null;
  actions: { id: string; label: string; behavior: "allow" | "deny"; variant?: string }[];
};
export type DesignerStatus = {
  label: string;
  working: boolean;
  tone: "success" | "accent" | "warning" | "danger";
  permissions: DesignerPermission[];
};

type RawPermission = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  actions?: DesignerPermission["actions"];
};

/** "mcp__fs__read_file" or "Bash" become a short human title. */
function humanize(name: string): string {
  if (/^bash$|shell|exec/i.test(name)) return "Run a shell command";
  const tail = name.split("__").pop() ?? name;
  return tail.replace(/[_-]+/g, " ").replace(/^./, letter => letter.toUpperCase());
}

export function describePermission(request: RawPermission): DesignerPermission {
  const input = request.input ?? {};
  const pick = ["command", "cmd", "file_path", "path", "url", "query", "pattern", "description"]
    .map(key => input[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const fallback = Object.keys(input).length ? JSON.stringify(input) : (request.description ?? null);
  return {
    id: request.id,
    title: request.title?.trim() || humanize(request.name),
    detail: (pick ?? fallback)?.slice(0, 400) ?? null,
    actions: request.actions ?? [],
  };
}

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
      const raw = agent.pendingPermissions as unknown;
      const list = (
        Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : []
      ) as RawPermission[];
      const permissions = list.filter(item => item && typeof item.id === "string").map(describePermission);
      if (permissions.length) return { label: "Needs your OK", working: true, tone: "warning", permissions };
      if (agent.requiresAttention && agent.attentionReason !== "finished")
        return { label: "Needs you", working: false, tone: "warning", permissions };
      if (agent.status === "running") return { label: "Working", working: true, tone: "accent", permissions };
      if (agent.status === "idle") return { label: "Ready", working: false, tone: "success", permissions };
      if (agent.status === "error") return { label: "Error", working: false, tone: "danger", permissions };
      if (agent.status === "closed") return { label: "Closed", working: false, tone: "danger", permissions };
      return { label: "Starting", working: true, tone: "accent", permissions };
    },
    // Fast enough that a permission request shows up while the user is still looking.
    refetchInterval: 1500,
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
