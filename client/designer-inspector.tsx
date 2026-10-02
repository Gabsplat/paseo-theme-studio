import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { copyText, Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { defaultDesignerModel, defaultDesignerProvider } from "../shared/designer";
import type { StudioPreferences } from "../shared/preferences";
import { AgentConnectionCard } from "./agent-connection";
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
  const [model, setModel] = useState(preferences?.designerModel ?? "");
  useEffect(() => setModel(preferences?.designerModel ?? ""), [preferences?.designerModel]);
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
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {providers.map(item => (
            <StudioButton
              key={item.id}
              theme={theme}
              title={item.label}
              small
              active={next.provider === item.id}
              onPress={() => onSavePreferences({ designerProvider: item.id, designerModel: "" })}
            />
          ))}
        </View>
        <View style={{ gap: 4 }}>
          <StudioLabel theme={theme} subdued>
            Model
          </StudioLabel>
          <TextInput
            accessibilityLabel="Designer model"
            value={model}
            onChangeText={setModel}
            onEndEditing={() => onSavePreferences({ designerModel: model.trim() })}
            onBlur={() => onSavePreferences({ designerModel: model.trim() })}
            placeholder={defaultDesignerModel(next.provider)}
            placeholderTextColor={c.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              color: c.foreground,
              fontSize: 12,
              backgroundColor: c.surface0,
            }}
          />
          <StudioLabel theme={theme} subdued>
            Leave it empty to use {defaultDesignerModel(next.provider)}.
          </StudioLabel>
        </View>
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
          {examplePrompts.map((prompt, index) => (
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
