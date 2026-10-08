import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { interactComponent, readLiveInstance } from "../shared/component-rpc";
import type { ComponentInstance, ComponentState } from "../shared/components";
import type { LiveTheme } from "../shared/live";
import { readActiveTheme } from "../shared/rpc";
import { componentEvents } from "./component-events";
import { Eyebrow } from "./studio-ui";
import { canRunLiveFrames, LiveFrameView } from "./web";

type LiveTimelineData = { instanceId: string };

/** The frame's view of the host: the colors on screen plus the active pack's shape and type. */
function useLiveTheme(theme: PluginTheme): LiveTheme {
  const readActive = useRpc(readActiveTheme);
  const active = useQuery({ queryKey: ["theme-studio-active-pack"], queryFn: () => readActive({}), staleTime: 5000 });
  const c = theme.colors;
  const dark = (() => {
    const hex = c.surface0.replace("#", "");
    if (!/^[0-9a-f]{6}/i.test(hex)) return true;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    return r * 0.299 + g * 0.587 + b * 0.114 < 140;
  })();
  return {
    appearance: dark ? "dark" : "light",
    colors: { ...c, ring: active.data?.colors.ring ?? c.accent },
    radius: active.data?.ui.radius ?? 10,
    fontFamily: active.data?.ui.fontFamily ?? "system",
    fontSize: active.data?.ui.fontSize ?? 13,
  };
}

export function LiveRow({ theme, item, agentId }: PluginTimelineItemProps<LiveTimelineData>) {
  const c = theme.colors;
  const read = useRpc(readLiveInstance);
  const interact = useRpc(interactComponent);
  const cache = useQueryClient();
  const key = ["studio-live", item.data.instanceId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const instance = await read({ instanceId: item.data.instanceId });
      componentEvents.updateInstance(instance);
      const previous = cache.getQueryData<ComponentInstance>(key);
      return previous && previous.revision > instance.revision ? previous : instance;
    },
    refetchInterval: 1500,
  });
  const liveTheme = useLiveTheme(theme);
  const [notice, setNotice] = useState<string | null>(null);
  // Writes go one at a time so each carries the latest instance revision.
  const queue = useRef(Promise.resolve());
  const save = useMutation({
    mutationFn: async (action: { action: string; value?: unknown; patch?: ComponentState }) => {
      const run = async (attempt: number): Promise<void> => {
        const instance = cache.getQueryData<ComponentInstance>(key) ?? query.data;
        if (!instance) return;
        try {
          const result = await interact({ instanceId: instance.id, expectedRevision: instance.revision, action });
          componentEvents.updateInstance(result.instance);
          cache.setQueryData(key, result.instance);
          if (action.action !== "__state__")
            setNotice(
              result.dispatch === "sent"
                ? "Sent to your agent"
                : result.dispatch === "queued"
                  ? "Your agent will get this when it is free"
                  : "Saved. Reopen your agent to continue.",
            );
        } catch (error) {
          if (attempt === 0 && error instanceof Error && /changed elsewhere/i.test(error.message)) {
            await query.refetch();
            return run(1);
          }
          throw error;
        }
      };
      const next = queue.current.then(() => run(0));
      queue.current = next.catch(() => {});
      return next;
    },
    onError: error => setNotice(error instanceof Error ? error.message : "Could not save."),
  });

  if (!query.data)
    return (
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
        {query.error && /not found/i.test(query.error.message)
          ? "This live frame was removed from Theme Studio."
          : (query.error?.message ?? "Loading live frame…")}
      </Text>
    );
  const instance = query.data;
  const live = instance.live;
  if (!live || instance.agentId !== agentId)
    return (
      <Text style={{ color: c.statusDanger, fontSize: 12 }}>This live frame does not belong to this conversation.</Text>
    );

  return (
    <View style={{ gap: 6 }}>
      {/* Visible provenance: this is agent-written HTML, not Paseo's own interface. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="Sparkles" size={12} color={c.accent} />
        <Eyebrow theme={theme}>Live · agent-generated</Eyebrow>
        <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 12, fontWeight: "600" }}>
          {live.title}
        </Text>
      </View>
      {canRunLiveFrames ? (
        <LiveFrameView
          id={instance.id}
          title={live.title}
          html={live.html}
          theme={liveTheme}
          state={instance.state}
          height={live.height}
          events={{
            onState: state => save.mutate({ action: "__state__", patch: state }),
            onAction: action => save.mutate(action),
            onRejected: reason => setNotice(`A message from the frame was ignored (${reason}).`),
          }}
        />
      ) : (
        <View
          style={{
            gap: 6,
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: c.border,
          }}
        >
          {live.summary ? (
            <Text style={{ color: c.foreground, fontSize: 13, lineHeight: 19 }}>{live.summary}</Text>
          ) : null}
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
            Interactive frame. Open this conversation on Paseo web or desktop to use it.
          </Text>
        </View>
      )}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={{ color: c.foregroundMuted, fontSize: 11 }}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
