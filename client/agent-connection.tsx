import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { useState } from "react";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { changeAgentConnection, readAgentConnection, readAgentMcpSetup } from "../shared/agent-connection";
import { StudioButton, StudioCard, StudioLabel } from "./studio-ui";
const key = ["theme-studio-agent-connection"];
export function AgentConnectionCard({ theme }: { theme: PluginTheme }) {
  const read = useRpc(readAgentConnection),
    change = useRpc(changeAgentConnection),
    cache = useQueryClient();
  const setup = useRpc(readAgentMcpSetup);
  const [provider, setProvider] = useState<"codex" | "claude" | "opencode">("codex");
  const [showSetup, setShowSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  const setupQuery = useQuery({
    queryKey: [...key, "setup", provider],
    queryFn: () => setup({ provider }),
    enabled: showSetup,
  });
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await read({});
      const previous = cache.getQueryData<typeof result>(key);
      return previous && previous.revision > result.revision ? previous : result;
    },
    refetchInterval: 3000,
  });
  const mutation = useMutation({
    mutationFn: change,
    onSuccess: result =>
      cache.setQueryData(key, (previous: typeof query.data) =>
        previous && previous.revision > result.revision ? previous : result,
      ),
    onError: () => {
      void query.refetch();
    },
  });
  const automaticTriggers = query.data?.automaticTriggers ?? true;
  const settingsDisabled = !query.data || mutation.isPending;
  return (
    <StudioCard
      theme={theme}
      title="Connect your agents"
      description="Choose whether new Codex, Claude Code, and OpenCode agents on this host receive the Theme Studio MCP. This connection is off by default."
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <StudioButton
          theme={theme}
          title={query.data?.enabled ? "Disconnect new agents" : "Connect new agents"}
          icon="Plug"
          small
          active={query.data?.enabled}
          disabled={!query.data || mutation.isPending}
          onPress={() => {
            if (query.data) mutation.mutate({ expectedRevision: query.data.revision, enabled: !query.data.enabled });
          }}
        />
        <StudioLabel theme={theme} subdued>
          {query.data?.enabled
            ? "New agents receive component tools automatically."
            : "Only the dedicated designer is connected automatically."}
        </StudioLabel>
      </View>
      <StudioLabel theme={theme} subdued>
        After connecting, create an agent normally in Paseo. Existing conversations keep their current configuration.
        Disconnecting stops new connections; agents already created keep their tools.
      </StudioLabel>
      <View style={{ gap: 8, paddingTop: 13, borderTopWidth: 1, borderColor: theme.colors.border }}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Automatic component triggers"
          accessibilityState={{ checked: automaticTriggers, disabled: settingsDisabled }}
          disabled={settingsDisabled}
          onPress={() => {
            if (query.data)
              mutation.mutate({ expectedRevision: query.data.revision, automaticTriggers: !automaticTriggers });
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 6,
            opacity: settingsDisabled ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "500", lineHeight: 19 }}>
            Automatic component triggers
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{automaticTriggers ? "On" : "Off"}</Text>
          <View
            style={{
              width: 34,
              height: 20,
              padding: 3,
              borderRadius: 10,
              backgroundColor: automaticTriggers ? theme.colors.accent : theme.colors.surface2,
              borderWidth: automaticTriggers ? 0 : 1,
              borderColor: theme.colors.border,
              alignItems: automaticTriggers ? "flex-end" : "flex-start",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: automaticTriggers ? theme.colors.accentForeground : theme.colors.foregroundMuted,
              }}
            />
          </View>
        </Pressable>
        <StudioLabel theme={theme} subdued>
          Each component owns its conditions and moments for appearing in chat. Turning this off pauses automatic
          triggers. You can still place components manually.
        </StudioLabel>
      </View>
      <StudioButton
        theme={theme}
        title={showSetup ? "Hide existing-agent setup" : "Set up an existing agent"}
        small
        onPress={() => setShowSetup(!showSetup)}
      />
      {showSetup ? (
        <View style={{ gap: 9 }}>
          <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
            {(["codex", "claude", "opencode"] as const).map(value => (
              <StudioButton
                key={value}
                theme={theme}
                title={value === "codex" ? "Codex" : value === "claude" ? "Claude Code" : "OpenCode"}
                small
                active={provider === value}
                onPress={() => {
                  setProvider(value);
                  setCopied(false);
                }}
              />
            ))}
          </View>
          <StudioLabel theme={theme} subdued>
            {setupQuery.data?.instructions ?? "Loading provider setup…"}
          </StudioLabel>
          {setupQuery.data ? (
            <>
              <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 11 }}>
                {setupQuery.data.configuration}
              </Text>
              <StudioButton
                theme={theme}
                title={copied ? "Configuration copied" : "Copy MCP configuration"}
                small
                icon="Copy"
                onPress={() => {
                  void copyText(setupQuery.data!.configuration).then(() => setCopied(true));
                }}
              />
            </>
          ) : null}
          {setupQuery.error ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
              {setupQuery.error.message}
            </Text>
          ) : null}
        </View>
      ) : null}
      {query.error || mutation.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
          {(mutation.error ?? query.error)?.message}
        </Text>
      ) : null}
    </StudioCard>
  );
}
