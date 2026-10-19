import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import type { DesignerPermission } from "./designer-status";
import { Eyebrow, monoFont, StudioButton } from "./studio-ui";

/**
 * The designer's pending permission, answered where the user is working. Without it the
 * request waits silently in a chat the user may not have open.
 */
export function PermissionBar({
  theme,
  paseo,
  agentId,
  permission,
  more,
  onOpenChat,
}: {
  theme: PluginTheme;
  paseo: PluginClientContext["paseo"];
  agentId: string;
  permission: DesignerPermission;
  /** Further requests queued behind this one. */
  more: number;
  onOpenChat: () => void;
}) {
  const c = theme.colors;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function respond(behavior: "allow" | "deny", selectedActionId?: string) {
    setBusy(true);
    setError(null);
    try {
      await paseo.agents.ref(agentId).respondToPermission({
        requestId: permission.id,
        response:
          behavior === "allow"
            ? { behavior, ...(selectedActionId ? { selectedActionId } : {}) }
            : {
                behavior,
                ...(selectedActionId ? { selectedActionId } : {}),
                message: "The user declined from Theme Studio. Continue with Theme Studio tools only.",
              },
      });
      await queryClient.invalidateQueries({ queryKey: ["theme-studio-designer-status", agentId] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  // Providers can offer their own choices (plans, questions); plain tool requests get Deny and Allow.
  const actions = permission.actions.length
    ? permission.actions
    : [
        { id: "", label: "Deny", behavior: "deny" as const },
        { id: "", label: "Allow", behavior: "allow" as const, variant: "primary" },
      ];
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
      }}
    >
      <Icon name="ShieldQuestion" size={16} color={c.statusWarning} />
      <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
        <Eyebrow theme={theme} color={c.statusWarning}>
          The designer is waiting for your OK{more ? ` · ${more} more after this` : ""}
        </Eyebrow>
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{permission.title}</Text>
        {permission.detail ? (
          <Text numberOfLines={3} selectable style={{ color: c.foregroundMuted, fontSize: 12, fontFamily: monoFont }}>
            {permission.detail}
          </Text>
        ) : null}
        {error ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{error}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <StudioButton theme={theme} title="Open chat" icon="MessageSquare" small iconOnly onPress={onOpenChat} />
        {actions.map((action, index) => (
          <StudioButton
            key={`${action.id}-${index}`}
            theme={theme}
            title={action.label}
            small
            primary={action.variant === "primary" || (action.behavior === "allow" && index === actions.length - 1)}
            danger={action.variant === "danger"}
            disabled={busy}
            onPress={() => void respond(action.behavior, action.id || undefined)}
          />
        ))}
      </View>
    </View>
  );
}
