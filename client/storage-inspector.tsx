import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import { clearComponentInstances, readComponentStorage } from "../shared/component-rpc";
import type { ComponentStorage } from "../shared/components";
import { componentLibraryQueryKey } from "./component-inspector";
import { Eyebrow, formatBytes, monoFont, StudioButton, StudioLabel } from "./studio-ui";

const storageQueryKey = ["theme-studio-storage"] as const;
type Clearing = z.input<typeof clearComponentInstances.input>;
type Pending = { input: Clearing; title: string; detail: string };

/** How much disk Theme Studio uses on this host, and the only places that ever delete cards. */
export function StorageInspector({ theme }: { theme: PluginTheme }) {
  const c = theme.colors;
  const read = useRpc(readComponentStorage);
  const clear = useRpc(clearComponentInstances);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: storageQueryKey, queryFn: () => read({}), refetchInterval: 5000 });
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const clearing = useMutation({
    mutationFn: clear,
    onSuccess: value => {
      queryClient.setQueryData<ComponentStorage>(storageQueryKey, value.storage);
      void queryClient.invalidateQueries({ queryKey: componentLibraryQueryKey });
      setResult(
        value.removed ? `Removed ${value.removed} ${value.removed === 1 ? "card" : "cards"}.` : "Nothing to remove.",
      );
      setPending(null);
    },
  });
  const storage = query.data;
  if (!storage)
    return (
      <View style={{ paddingVertical: 14 }}>
        <StudioLabel theme={theme} subdued>
          {query.isPending ? "Measuring storage…" : "Storage is unavailable. It will retry."}
        </StudioLabel>
      </View>
    );
  const tones = [c.accent, c.foreground, c.statusSuccess, c.statusWarning, c.foregroundMuted];
  const parts = storage.parts.filter(part => part.bytes > 0);
  return (
    <View style={{ paddingVertical: 14, gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Eyebrow theme={theme}>Storage on this host</Eyebrow>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text style={{ color: c.foreground, fontSize: 26, fontWeight: "600" }}>
            {formatBytes(storage.totalBytes)}
          </Text>
          <StudioLabel theme={theme} subdued>
            no limit
          </StudioLabel>
        </View>
        <View
          accessibilityLabel="Storage by kind"
          style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: c.surface2 }}
        >
          {parts.map(part => (
            <View
              key={part.id}
              style={{
                flexGrow: part.bytes,
                flexBasis: 0,
                minWidth: 2,
                backgroundColor: tones[storage.parts.indexOf(part) % tones.length],
                marginRight: 1,
              }}
            />
          ))}
        </View>
        <View style={{ gap: 5 }}>
          {storage.parts.map((part, index) => (
            <View key={part.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: tones[index % tones.length] }} />
              <Text style={{ flex: 1, color: c.foreground, fontSize: 12 }}>{part.label}</Text>
              <Text style={{ color: c.foregroundMuted, fontSize: 11, fontFamily: monoFont }}>
                {formatBytes(part.bytes)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: c.border }}>
        <Eyebrow theme={theme}>
          {storage.instances} {storage.instances === 1 ? "card" : "cards"} · {storage.conversations}{" "}
          {storage.conversations === 1 ? "conversation" : "conversations"}
        </Eyebrow>
        <StudioLabel theme={theme} subdued>
          Every card an agent publishes stays with its conversation
          {storage.oldestInstanceAt
            ? `; the oldest is from ${new Date(storage.oldestInstanceAt).toLocaleDateString()}`
            : ""}
          . Nothing is removed automatically except cards whose conversation you deleted.
        </StudioLabel>
        {storage.components.length ? (
          <View style={{ gap: 2, marginHorizontal: -8 }}>
            {storage.components.map(component => (
              <View
                key={component.id}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13 }}>
                    {component.name}
                  </Text>
                  <Eyebrow theme={theme}>
                    {component.instances} {component.instances === 1 ? "card" : "cards"} ·{" "}
                    {formatBytes(component.bytes)}
                  </Eyebrow>
                </View>
                <StudioButton
                  theme={theme}
                  title={`Clear ${component.name} cards`}
                  icon="Eraser"
                  small
                  iconOnly
                  disabled={!component.instances || clearing.isPending}
                  onPress={() =>
                    setPending({
                      input: { scope: "component", componentId: component.id },
                      title: `Clear ${component.instances} ${component.name} ${component.instances === 1 ? "card" : "cards"}?`,
                      detail: "The component stays in your library. Its old chat rows will say the card was removed.",
                    })
                  }
                />
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: c.border }}>
        <Eyebrow theme={theme}>Free up space</Eyebrow>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          <StudioButton
            theme={theme}
            title="Deleted conversations"
            icon="MessageSquareOff"
            small
            disabled={clearing.isPending}
            onPress={() => clearing.mutate({ scope: "closed-conversations" })}
          />
          {[30, 90].map(days => (
            <StudioButton
              key={days}
              theme={theme}
              title={`Older than ${days} days`}
              icon="CalendarMinus"
              small
              disabled={clearing.isPending || !storage.instances}
              onPress={() =>
                setPending({
                  input: { scope: "older", days },
                  title: `Clear cards older than ${days} days?`,
                  detail: "Their chat rows will say the card was removed. Cards waiting for an agent are kept.",
                })
              }
            />
          ))}
        </View>
        {pending ? (
          <View style={{ gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: c.statusDanger }}>
            <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{pending.title}</Text>
            <StudioLabel theme={theme} subdued>
              {pending.detail} This cannot be undone.
            </StudioLabel>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <StudioButton
                theme={theme}
                title={clearing.isPending ? "Clearing…" : "Clear"}
                icon="Eraser"
                small
                danger
                disabled={clearing.isPending}
                onPress={() => clearing.mutate(pending.input)}
              />
              <StudioButton
                theme={theme}
                title="Cancel"
                small
                disabled={clearing.isPending}
                onPress={() => setPending(null)}
              />
            </View>
          </View>
        ) : null}
        {clearing.error ? (
          <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12, lineHeight: 18 }}>
            {clearing.error instanceof Error ? clearing.error.message : String(clearing.error)}
          </Text>
        ) : result ? (
          <StudioLabel theme={theme} subdued>
            {result}
          </StudioLabel>
        ) : null}
      </View>

      <View style={{ gap: 4, paddingTop: 14, borderTopWidth: 1, borderColor: c.border }}>
        <Eyebrow theme={theme}>Folder</Eyebrow>
        <Text selectable style={{ color: c.foregroundMuted, fontSize: 11, fontFamily: monoFont, lineHeight: 16 }}>
          {storage.directory}
        </Text>
      </View>
    </View>
  );
}
