import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { componentTriggersSchema, type ComponentDefinition } from "../shared/components";
import { StudioButton, StudioLabel } from "./studio-ui";

const eventLabels = {
  agent_context: "Agent context",
  turn_started: "Before task work",
  turn_completed: "Before the final answer",
  tool_failed: "After a tool fails",
};

const triggerExample = [{
  id: "screenshot-review",
  event: "agent_context",
  when: "When the user provides a screenshot and asks for a visual review, show this component to organize the review.",
  enabled: true,
}];

export function parseTriggersJson(value: string) {
  let json: unknown;
  try { json = JSON.parse(value); }
  catch { throw new Error("Triggers must be a JSON array. Use [] for manual placement."); }
  const result = componentTriggersSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Check triggers${issue.path.length ? ` at ${issue.path.join(".")}` : ""}. ${issue.message}`);
  }
  return result.data;
}

export function ComponentTriggersEditor({ theme, value, onChange, disabled }: {
  theme: PluginTheme; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  let error: string | null = null;
  try { parseTriggersJson(value); } catch (reason) { error = (reason as Error).message; }
  return <View style={{ gap: 8, padding: 13, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9 }}>
    <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}><Icon name="Zap" size={15} color={theme.colors.accent} /><StudioLabel theme={theme}>Component triggers</StudioLabel></View>
    <StudioLabel theme={theme} subdued>Describe a moment the agent can observe during its turn, such as a supplied image, results ready to review, or collected research sources. The agent checks each component's condition. Use [] for manual placement.</StudioLabel>
    <TextInput accessibilityLabel="Component triggers JSON" value={value} onChangeText={onChange} multiline editable={!disabled} autoCapitalize="none" autoCorrect={false} maxLength={12000}
      style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, padding: 11, minHeight: 115, fontSize: 12, lineHeight: 18, fontFamily: "monospace", textAlignVertical: "top" }} />
    <StudioLabel theme={theme} subdued>Use agent_context for the current context, turn_started before task work, turn_completed before the final answer, or tool_failed after observing a tool failure. Each trigger needs an id, event, when condition, and enabled flag.</StudioLabel>
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>{error}</Text> : null}
    <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
      <StudioButton theme={theme} title="Use trigger example" small disabled={disabled} onPress={() => onChange(JSON.stringify(triggerExample, null, 2))} />
      <StudioButton theme={theme} title="Format triggers" small disabled={disabled || Boolean(error)} onPress={() => onChange(JSON.stringify(parseTriggersJson(value), null, 2))} />
      <StudioButton theme={theme} title="Clear triggers" small disabled={disabled || value.trim() === "[]"} onPress={() => onChange("[]")} />
    </View>
  </View>;
}

export function ComponentTriggersSummary({ theme, definition, detailed = false }: {
  theme: PluginTheme; definition: ComponentDefinition; detailed?: boolean;
}) {
  const triggers = definition.triggers ?? [];
  const enabled = triggers.filter(trigger => trigger.enabled);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const summary = enabled.length ? `${enabled.length} enabled ${enabled.length === 1 ? "trigger" : "triggers"}` : triggers.length ? "All triggers disabled" : "Manual placement";
  return <View style={{ gap: 7 }}>
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <Icon name={enabled.length ? "Zap" : "Hand"} size={13} color={enabled.length ? theme.colors.accent : theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{summary}</Text>
      {!detailed && enabled.length ? <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{[...new Set(enabled.map(trigger => eventLabels[trigger.event]))].join(" · ")}</Text> : null}
    </View>
    {detailed ? <>
      {!triggers.length ? <StudioLabel theme={theme} subdued>This version appears when you or the agent publish it manually.</StudioLabel> : triggers.map(trigger => <View key={trigger.id} style={{ gap: 4, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: theme.colors.border }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}><StudioLabel theme={theme}>{eventLabels[trigger.event]}</StudioLabel><StudioLabel theme={theme} subdued>{trigger.enabled ? "Enabled" : "Disabled"}</StudioLabel></View>
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>{trigger.when}</Text>
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontFamily: "monospace" }}>{trigger.id}</Text>
      </View>)}
      {triggers.length ? <StudioButton theme={theme} title={copied ? "Triggers copied" : "Copy triggers JSON"} icon={copied ? "Check" : "Copy"} small onPress={() => { void copyText(JSON.stringify(triggers, null, 2)).then(() => { setCopied(true); setCopyError(false); }).catch(() => setCopyError(true)); }} /> : null}
      {copyError ? <StudioLabel theme={theme} subdued>Could not copy the triggers. Try again.</StudioLabel> : null}
    </> : null}
  </View>;
}
