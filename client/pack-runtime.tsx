import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useAgent, useWorkspace, type PluginClientContext, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { forestTheme, type StudioTheme, type PackUi } from "../shared/theme";
import { packToolCardSchema, transformPackTool, type PackToolData } from "./pack-transform";
export { packToolCardSchema, transformPackTool, type PackToolData } from "./pack-transform";

export function packMetrics(ui: PackUi) {
  return {
    padding: ui.density === "compact" ? 8 : ui.density === "spacious" ? 18 : 12,
    gap: ui.density === "compact" ? 6 : ui.density === "spacious" ? 14 : 10,
    radius: ui.radius,
    fontSize: ui.fontSize,
    fontFamily: ui.fontFamily === "mono" ? Platform.select({ ios: "Menlo", default: "monospace" }) : ui.fontFamily === "serif" ? Platform.select({ ios: "Georgia", android: "serif", default: "serif" }) : undefined,
  };
}

export function PackToolCard({ theme, pack, data, initiallyExpanded = false }: { theme: PluginTheme; pack: StudioTheme; data: PackToolData; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const m = packMetrics(pack.ui);
  const c = theme.colors;
  const bordered = pack.ui.toolCards === "bordered";
  return <View style={{ borderWidth: bordered ? 1 : 0, borderTopWidth: 1, borderColor: c.border, borderRadius: bordered ? m.radius : 0, overflow: "hidden", backgroundColor: bordered ? c.surface1 : "transparent" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "Collapse" : "Expand"} completed ${data.label}`} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={({ pressed }) => ({ padding: m.padding, flexDirection: "row", alignItems: "center", gap: m.gap, backgroundColor: pressed ? c.surface2 : "transparent" })}>
      <Icon name={data.kind === "shell" ? "SquareTerminal" : "CircleCheck"} size={16} color={c.foregroundMuted} />
      <Text numberOfLines={2} style={{ flex: 1, color: c.foreground, fontFamily: m.fontFamily, fontSize: m.fontSize, lineHeight: m.fontSize + 5 }}>{data.label}</Text>
      <Icon name="Check" size={13} color={c.statusSuccess} />
      <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={13} color={c.foregroundMuted} />
    </Pressable>
    {expanded && <View style={{ padding: m.padding, gap: m.gap, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }}>
      {data.command !== undefined && <Text selectable style={{ color: c.foreground, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: m.fontSize, lineHeight: m.fontSize + 6 }}>{"$ " + data.command}</Text>}
      {data.cwd && <Text selectable style={{ color: c.foregroundMuted, fontFamily: m.fontFamily, fontSize: m.fontSize - 1 }}>{data.cwd}</Text>}
      {data.output.length > 0 && <Text selectable style={{ color: c.foreground, fontFamily: m.fontFamily, fontSize: m.fontSize, lineHeight: m.fontSize + 6 }}>{data.output}</Text>}
      {data.exitCode !== undefined && <Text style={{ color: data.exitCode === 0 ? c.statusSuccess : c.foregroundMuted, fontFamily: m.fontFamily, fontSize: m.fontSize - 1 }}>Exit code {data.exitCode ?? "unavailable"}</Text>}
    </View>}
  </View>;
}

export function PackNote({ theme, pack, text }: { theme: PluginTheme; pack: StudioTheme; text: string }) {
  const m = packMetrics(pack.ui);
  const card = pack.ui.messageStyle === "card";
  return <View style={{ padding: card ? m.padding : 0, borderWidth: card ? 1 : 0, borderColor: theme.colors.border, borderRadius: m.radius, backgroundColor: card ? theme.colors.surface1 : "transparent" }}>
    <Text selectable style={{ color: theme.colors.foreground, fontFamily: m.fontFamily, fontSize: m.fontSize, lineHeight: m.fontSize + 7 }}>{text}</Text>
  </View>;
}

export function RecipePanel({ theme, pack }: { theme: PluginTheme; pack: StudioTheme }) {
  if (!pack.ui.panel.enabled) return null;
  const c = theme.colors;
  const m = packMetrics(pack.ui);
  const typography = { color: c.foreground, fontFamily: m.fontFamily, fontSize: m.fontSize, lineHeight: m.fontSize + 6 };
  return <View style={{ backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1, borderRadius: m.radius, padding: m.padding, gap: m.gap }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: m.gap }}><Icon name={pack.ui.panel.icon} size={16} color={c.accent} /><Text style={[typography, { fontWeight: "600", flexShrink: 1 }]}>{pack.ui.panel.title}</Text></View>
    {pack.ui.panel.blocks.map((block, index) => {
      if (block.type === "text") return <PackNote key={index} theme={theme} pack={pack} text={block.text} />;
      if (block.type === "stat") return <View key={index} style={{ flexDirection: "row", alignItems: "baseline", gap: m.gap }}><Text style={[typography, { color: c.foregroundMuted, flex: 1 }]}>{block.label}</Text><Text style={[typography, { fontWeight: "600", flexShrink: 1 }]}>{block.value}</Text></View>;
      if (block.type === "list") return <View key={index} style={{ gap: m.gap / 2 }}><Text style={[typography, { color: c.foregroundMuted }]}>{block.title}</Text>{block.items.map((item, itemIndex) => <View key={itemIndex} style={{ flexDirection: "row", gap: m.gap }}><Text style={[typography, { color: c.foregroundMuted }]}>·</Text><Text style={[typography, { flex: 1 }]}>{item}</Text></View>)}</View>;
      return <View key={index} style={{ gap: m.gap / 2 }}><View style={{ flexDirection: "row", gap: m.gap }}><Text style={[typography, { flex: 1 }]}>{block.label}</Text><Text style={[typography, { color: c.foregroundMuted }]}>{block.value}%</Text></View><View accessibilityRole="progressbar" accessibilityLabel={block.label} accessibilityValue={{ min: 0, max: 100, now: block.value }} style={{ height: 6, backgroundColor: c.surface2, borderRadius: Math.min(m.radius, 3), overflow: "hidden" }}><View style={{ height: 6, width: `${block.value}%`, backgroundColor: c.accent }} /></View></View>;
    })}
  </View>;
}

function AgentActivity({ theme, pack, agentId }: { theme: PluginTheme; pack: StudioTheme; agentId: string }) {
  const agent = useAgent(agentId, ({ title, status, requiresAttention, attentionReason, model }) => ({ title, status, requiresAttention, attentionReason, model }));
  if (!agent) return <PackNote theme={theme} pack={pack} text="Agent is unavailable." />;
  return <PackNote theme={theme} pack={pack} text={`${agent.title ?? "Agent"} · ${agent.status}${agent.model ? ` · ${agent.model}` : ""}${agent.requiresAttention ? `\nNeeds attention: ${agent.attentionReason ?? "input"}` : ""}`} />;
}

export function PackActivity({ theme, workspaceId, pack, agentId }: { theme: PluginTheme; workspaceId: string; pack: StudioTheme; agentId?: string }) {
  const workspace = useWorkspace(workspaceId, ({ name, status, directory, diffStat }) => ({ name, status, directory, additions: diffStat?.additions ?? null, deletions: diffStat?.deletions ?? null }));
  const m = packMetrics(pack.ui);
  const c = theme.colors;
  return <ScrollView style={{ flex: 1, minWidth: 0, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: m.padding, gap: m.gap }}>
    {pack.ui.activityPanel && <View style={{ gap: m.gap, padding: m.padding, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, borderRadius: m.radius }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: m.gap }}><Icon name="Activity" size={16} color={c.accent} /><Text style={{ color: c.foreground, fontFamily: m.fontFamily, fontSize: m.fontSize, fontWeight: "600", flex: 1 }}>{workspace?.name ?? "Workspace unavailable"}</Text><Text style={{ color: workspace?.status === "failed" ? c.statusDanger : workspace?.status === "needs_input" || workspace?.status === "attention" ? c.statusWarning : c.foregroundMuted, fontFamily: m.fontFamily, fontSize: m.fontSize - 1 }}>{workspace?.status.replace(/_/g, " ") ?? "offline"}</Text></View>
      {workspace && <Text selectable style={{ color: c.foregroundMuted, fontFamily: m.fontFamily, fontSize: m.fontSize - 1 }}>{workspace.directory}</Text>}
      {workspace?.additions !== null && workspace?.additions !== undefined && <View style={{ flexDirection: "row", gap: m.gap }}><Text style={{ color: c.statusSuccess, fontFamily: m.fontFamily, fontSize: m.fontSize }}>+{workspace.additions}</Text><Text style={{ color: c.statusDanger, fontFamily: m.fontFamily, fontSize: m.fontSize }}>−{workspace.deletions}</Text><Text style={{ color: c.foregroundMuted, fontFamily: m.fontFamily, fontSize: m.fontSize }}>uncommitted lines</Text></View>}
      {agentId && <AgentActivity theme={theme} pack={pack} agentId={agentId} />}
    </View>}
    <RecipePanel theme={theme} pack={pack} />
  </ScrollView>;
}

export function registerPackExtensions(client: PluginClientContext, getActivePack: () => StudioTheme | null, subscribe?: (listener: () => void) => () => void) {
  function ToolRenderer({ theme, item }: PluginTimelineItemProps<PackToolData>) {
    const [, setVersion] = useState(0);
    useEffect(() => subscribe?.(() => setVersion(value => value + 1)), []);
    return <PackToolCard theme={theme} pack={getActivePack() ?? forestTheme} data={item.data} />;
  }
  const removeRenderer = client.addTimelineRenderer({ kind: "theme-pack-tool", version: 1, schema: packToolCardSchema, Component: ToolRenderer });
  const addTransformer = () => client.addTimelineTransformer({ id: "theme-pack-tools", query: { itemType: "tool_call" }, transform: input => transformPackTool(getActivePack(), input) });
  let removeTransformer = addTransformer();
  let disposed = false;
  let pending = Promise.resolve();
  // Paseo caches transformed source objects. Register a fresh transformer when the
  // active pack changes so existing rows return to native or acquire the new style.
  const unsubscribe = subscribe?.(() => {
    pending = pending.then(async () => {
      if (disposed) return;
      await removeTransformer();
      if (!disposed) removeTransformer = addTransformer();
    });
  });
  return async () => { disposed = true; unsubscribe?.(); await pending; await removeTransformer(); await removeRenderer(); };
}
