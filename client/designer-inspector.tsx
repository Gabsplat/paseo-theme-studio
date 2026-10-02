import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { copyText, Icon } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { defaultDesignerModel, defaultDesignerProvider } from "../shared/designer";
import type { StudioPreferences } from "../shared/preferences";
import { AgentConnectionCard, useAgentConnection } from "./agent-connection";
import { StudioButton, StudioCard, StudioLabel } from "./studio-ui";

const providers = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "opencode", label: "OpenCode" },
] as const;

/** Prompts that show what the designer does well. Also used by the onboarding. */
export const examplePrompts = [
  "Make a warmer dark pack. Keep the green accent and lower the border contrast.",
  "Lock the accent, then give me a light variant with the same mood.",
  "Check text contrast and fix anything under 4.5:1.",
  "Use compact density, mono text, and bordered tool cards.",
  "Add a Notes panel with a short checklist and a progress bar.",
  "Create a native decision card with a select, a notes input, and a Confirm button. Publish it here.",
];

/** The provider and model a new designer session will use. */
export function nextDesignerConfig(preferences: StudioPreferences | undefined) {
  const provider = preferences?.designerProvider || defaultDesignerProvider;
  return { provider, model: preferences?.designerModel || defaultDesignerModel(provider) };
}

function Row({ theme, label, value }: { theme: PluginTheme; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <StudioLabel theme={theme} subdued>
        {label}
      </StudioLabel>
      <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 12, flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function CurrentSession({
  theme,
  agentId,
  paseo,
}: {
  theme: PluginTheme;
  agentId: string;
  paseo: PluginClientContext["paseo"];
}) {
  // Plugin state hooks only work inside workspace panels; the agent API works everywhere.
  const query = useQuery({
    queryKey: ["theme-studio-designer-agent", agentId],
    queryFn: async () => {
      const handle = paseo.agents.ref(agentId);
      await handle.refresh();
      const value = handle.current();
      if (!value) return null;
      return {
        provider: value.provider,
        model: value.model ?? null,
        thinking: value.thinkingOptionId ?? null,
        status: value.status,
        attention: Boolean(value.requiresAttention && value.attentionReason !== "finished"),
      };
    },
    refetchInterval: 3000,
  });
  const agent = query.data;
  if (!agent)
    return (
      <StudioLabel theme={theme} subdued>
        Session saved. Open it to load its details.
      </StudioLabel>
    );
  const label = agent.attention
    ? "Needs your attention"
    : agent.status === "running"
      ? "Working"
      : agent.status === "idle"
        ? "Ready"
        : agent.status === "error"
          ? "Error"
          : agent.status === "closed"
            ? "Closed"
            : "Starting";
  return (
    <View style={{ gap: 6 }}>
      <Row
        theme={theme}
        label="Provider"
        value={providers.find(item => item.id === agent.provider)?.label ?? agent.provider}
      />
      <Row theme={theme} label="Model" value={agent.model ?? "Provider default"} />
      {agent.thinking ? <Row theme={theme} label="Reasoning" value={agent.thinking} /> : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <StudioLabel theme={theme} subdued>
          Status
        </StudioLabel>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                agent.attention || agent.status === "error" ? theme.colors.statusWarning : theme.colors.statusSuccess,
            }}
          />
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

/** Choose the designer's model, start new sessions, and connect other agents. */
export function DesignerInspector({
  theme,
  agentId,
  paseo,
  preferences,
  busy,
  canNavigate,
  onSavePreferences,
  onOpen,
  onNewSession,
}: {
  theme: PluginTheme;
  agentId: string | null;
  paseo: PluginClientContext["paseo"] | undefined;
  preferences: StudioPreferences | undefined;
  busy: boolean;
  canNavigate: boolean;
  onSavePreferences: (patch: Partial<StudioPreferences>) => void;
  onOpen: () => void;
  onNewSession: () => void;
}) {
  const next = nextDesignerConfig(preferences);
  const connection = useAgentConnection();
  const models = useQuery({
    queryKey: ["theme-studio-designer-models", next.provider],
    enabled: Boolean(paseo),
    queryFn: async () => {
      const result = await paseo!.providers.listModels(next.provider);
      if (result.error) throw new Error(result.error);
      return (result.models ?? []).filter(model => model.isSelectable !== false);
    },
    staleTime: 60_000,
  });
  // An empty choice falls back to Theme Studio's default for the provider, which may be a specific model.
  const fallbackModel = defaultDesignerModel(next.provider);
  const modelOptions = [
    { value: "", label: fallbackModel === "default" ? "Provider default" : `Default (${fallbackModel})` },
    ...(models.data ?? []).map(model => ({
      value: model.id,
      label: model.label,
    })),
  ];
  if (preferences?.designerModel && !modelOptions.some(option => option.value === preferences.designerModel))
    modelOptions.push({ value: preferences.designerModel, label: preferences.designerModel });
  const [copied, setCopied] = useState<number | null>(null);
  const c = theme.colors;
  return (
    <View>
      <StudioCard
        theme={theme}
        title="Current designer"
        description="A real Paseo agent that edits this studio through Theme Studio's tools. Its model is fixed when the session starts."
      >
        {agentId && paseo ? (
          <CurrentSession theme={theme} agentId={agentId} paseo={paseo} />
        ) : (
          <StudioLabel theme={theme} subdued>
            No designer yet. Start one below.
          </StudioLabel>
        )}
        {agentId ? (
          <StudioButton
            theme={theme}
            title="Open designer chat"
            icon="MessageSquare"
            small
            disabled={busy || !canNavigate}
            onPress={onOpen}
          />
        ) : null}
      </StudioCard>
      <StudioCard
        theme={theme}
        title={agentId ? "New session" : "Start the designer"}
        description={
          agentId
            ? "Start a fresh designer with another model. The current chat stays in its workspace."
            : "Pick the provider and model, then start. Creating the designer sends no prompt."
        }
      >
        <SettingsSelect
          label="Provider"
          value={next.provider}
          options={providers.map(provider => ({ value: provider.id, label: provider.label }))}
          disabled={busy}
          onValueChange={provider => onSavePreferences({ designerProvider: provider, designerModel: "" })}
        />
        <SettingsSelect
          label="Model"
          value={preferences?.designerModel ?? ""}
          options={modelOptions}
          disabled={busy || models.isLoading || !paseo}
          onValueChange={model => onSavePreferences({ designerModel: model })}
        />
        {models.error ? (
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12 }}>
              Could not load models. {models.error.message}
            </Text>
            <StudioButton theme={theme} title="Retry models" small onPress={() => void models.refetch()} />
          </View>
        ) : null}
        <StudioButton
          theme={theme}
          title={busy ? "Starting…" : agentId ? "Start new session" : "Start designer"}
          icon={agentId ? "Plus" : "Play"}
          primary={!agentId}
          small
          disabled={busy || !canNavigate}
          onPress={onNewSession}
        />
      </StudioCard>
      <StudioCard
        theme={theme}
        title="Try asking"
        description="Tap a prompt to copy it, then paste it in the designer chat."
      >
        <View style={{ gap: 4 }}>
          {(connection.query.data?.enabled ? examplePrompts : examplePrompts.slice(0, -1)).map((prompt, index) => (
            <Pressable
              key={prompt}
              accessibilityRole="button"
              accessibilityLabel={`Copy prompt: ${prompt}`}
              onPress={() => {
                void copyText(prompt).then(() => setCopied(index));
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                gap: 8,
                padding: 8,
                marginHorizontal: -8,
                borderRadius: 8,
                backgroundColor: pressed ? c.surface2 : "transparent",
              })}
            >
              <Icon
                name={copied === index ? "Check" : "Copy"}
                size={13}
                color={copied === index ? c.statusSuccess : c.foregroundMuted}
              />
              <Text style={{ flex: 1, color: c.foreground, fontSize: 12, lineHeight: 18 }}>{prompt}</Text>
            </Pressable>
          ))}
        </View>
      </StudioCard>
      <AgentConnectionCard theme={theme} />
    </View>
  );
}
