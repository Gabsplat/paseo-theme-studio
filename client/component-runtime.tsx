import { Component, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useRpc, type PluginClientContext, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  componentTimelineSchema,
  type ComponentDefinition,
  type ComponentInstance,
  type ComponentNode,
  type ComponentProps,
  type ComponentState,
  type ComponentTimelineData,
} from "../shared/components";
import { interactComponent, readComponentInstance, readComponentLibrary } from "../shared/component-rpc";
import { generatedComponents } from "./generated-components";
import { componentEvents, componentHasAgentUpdate } from "./component-events";

export function CompositionRenderer({ tree, theme, state, onAction }: ComponentProps & { tree: ComponentNode }) {
  const c = theme.colors;
  const text = { color: c.foreground, fontSize: 13, lineHeight: 19 };
  const control = { padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface2 };
  if (tree.type === "stack" || tree.type === "row")
    return (
      <View
        style={{
          gap: tree.gap ?? 10,
          flexDirection: tree.type === "row" ? "row" : "column",
          flexWrap: tree.type === "row" ? "wrap" : "nowrap",
        }}
      >
        {tree.children.map((child, i) => (
          <CompositionRenderer key={i} tree={child} theme={theme} state={state} onAction={onAction} />
        ))}
      </View>
    );
  if (tree.type === "text")
    return (
      <Text
        selectable
        style={[
          text,
          {
            fontSize: tree.size ?? 13,
            color: tree.tone === "muted" ? c.foregroundMuted : tree.tone === "accent" ? c.accent : c.foreground,
          },
        ]}
      >
        {tree.text}
      </Text>
    );
  if (tree.type === "stat")
    return (
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <Text style={[text, { color: c.foregroundMuted }]}>{tree.label}</Text>
        <Text style={text}>{String(tree.stateKey ? (state[tree.stateKey] ?? tree.value) : tree.value)}</Text>
      </View>
    );
  if (tree.type === "list")
    return (
      <View style={{ gap: 5 }}>
        <Text style={[text, { fontWeight: "600" }]}>{tree.title}</Text>
        {tree.items.map((item, i) => (
          <Text key={i} style={text}>
            · {item}
          </Text>
        ))}
      </View>
    );
  if (tree.type === "progress") {
    const value = Math.max(
      0,
      Math.min(100, Number(tree.stateKey ? (state[tree.stateKey] ?? tree.value) : tree.value) || 0),
    );
    return (
      <View style={{ gap: 7 }}>
        <Text style={text}>
          {tree.label} · {value}%
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={tree.label}
          accessibilityValue={{ min: 0, max: 100, now: value }}
          style={{ height: 7, backgroundColor: c.surface2, borderRadius: 4, overflow: "hidden" }}
        >
          <View style={{ width: `${value}%`, height: 7, backgroundColor: c.accent }} />
        </View>
      </View>
    );
  }
  if (tree.type === "button")
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tree.label}
        style={control}
        onPress={() => onAction({ action: tree.action, value: tree.value, patch: tree.patch })}
      >
        <Text style={[text, { color: c.accent }]}>{tree.label}</Text>
      </Pressable>
    );
  if (tree.type === "input")
    return (
      <View style={{ gap: 6 }}>
        <Text style={text}>{tree.label}</Text>
        <TextInput
          accessibilityLabel={tree.label}
          placeholder={tree.placeholder}
          placeholderTextColor={c.foregroundMuted}
          value={String(state[tree.stateKey] ?? "")}
          style={[control, text]}
          onChangeText={value => onAction({ action: "__state__", patch: { [tree.stateKey]: value } })}
          onSubmitEditing={() => onAction({ action: tree.action, value: state[tree.stateKey] ?? "" })}
        />
      </View>
    );
  if (tree.type === "select")
    return (
      <View style={{ gap: 6 }}>
        <Text style={text}>{tree.label}</Text>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {tree.options.map(option => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: state[tree.stateKey] === option.value }}
              style={[control, { borderColor: state[tree.stateKey] === option.value ? c.accent : c.border }]}
              onPress={() =>
                onAction({ action: tree.action, value: option.value, patch: { [tree.stateKey]: option.value } })
              }
            >
              <Text style={text}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  if (tree.type === "toggle")
    return (
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={tree.label}
        accessibilityState={{ checked: Boolean(state[tree.stateKey]) }}
        style={control}
        onPress={() =>
          onAction({
            action: tree.action,
            value: !state[tree.stateKey],
            patch: { [tree.stateKey]: !state[tree.stateKey] },
          })
        }
      >
        <Text style={text}>
          {tree.label} · {state[tree.stateKey] ? "On" : "Off"}
        </Text>
      </Pressable>
    );
  return null;
}

/** The chat card shared by real timeline rows and the studio preview. */
export function ComponentCard({
  theme,
  definition,
  state,
  onAction,
  feedback,
  feedbackTone = "muted",
}: {
  theme: PluginTheme;
  definition: ComponentDefinition;
  state: ComponentState;
  onAction: ComponentProps["onAction"];
  feedback?: string | null;
  feedbackTone?: "muted" | "danger";
}) {
  const c = theme.colors;
  const Code = definition.mode === "code" ? generatedComponents[`${definition.id}@${definition.version}`] : undefined;
  return (
    <View
      style={{
        padding: 14,
        gap: 10,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 12,
        backgroundColor: c.surface1,
      }}
    >
      <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{definition.name}</Text>
      <ComponentBoundary key={`${definition.id}@${definition.version}`} theme={theme}>
        {definition.mode === "composition" ? (
          <CompositionRenderer tree={definition.tree} theme={theme} state={state} onAction={onAction} />
        ) : Code ? (
          <Code theme={theme} state={state} onAction={onAction} />
        ) : (
          <Text style={{ color: c.foregroundMuted }}>Activate this component's validated build from Components.</Text>
        )}
      </ComponentBoundary>
      {feedback ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: feedbackTone === "danger" ? c.statusDanger : c.foregroundMuted, fontSize: 11 }}
        >
          {feedback}
        </Text>
      ) : null}
    </View>
  );
}

class ComponentBoundary extends Component<{ children: ReactNode; theme: PluginTheme }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <Text style={{ color: this.props.theme.colors.statusDanger }}>Component error: {this.state.error}</Text>
    ) : (
      this.props.children
    );
  }
}

const activePollMs = 800;
const idlePollMs = 3000;

/** True while the latest interaction still awaits delivery or an agent update. */
function awaitingAgent(instance: ComponentInstance): boolean {
  const latest = instance.events.findLast(event => event.action.action !== "__state__");
  return Boolean(latest && (!latest.dispatchedAt || !componentHasAgentUpdate(instance)));
}

function useInstance(instanceId: string) {
  const read = useRpc(readComponentInstance);
  const cache = useQueryClient();
  const key = ["studio-component", instanceId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await read({ instanceId });
      componentEvents.updateInstance(result.instance);
      const previous = cache.getQueryData<typeof result>(key);
      return previous && previous.instance.revision > result.instance.revision ? previous : result;
    },
    // Poll quickly only while an agent response is expected; idle cards still pick up agent updates.
    refetchInterval: current =>
      current.state.data && awaitingAgent(current.state.data.instance) ? activePollMs : idlePollMs,
  });
  return { query, key, cache };
}

type OwnerState = { status: string | null; archived: boolean; permissions: number };

function useOwner(paseo: PluginClientContext["paseo"], agentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["studio-component-owner", agentId],
    queryFn: async (): Promise<OwnerState> => {
      const handle = paseo.agents.ref(agentId);
      await handle.refresh();
      return {
        status: handle.status,
        archived: Boolean(handle.archivedAt),
        permissions: Object.keys(handle.pendingPermissions ?? {}).length,
      };
    },
    enabled,
    refetchInterval: 1500,
  });
}

function interactionFeedback(instance: ComponentInstance, owner: OwnerState | undefined): string | null {
  const latest = instance.events.findLast(event => event.action.action !== "__state__");
  if (!latest) return null;
  if (owner?.archived || owner?.status === "closed") return "Reopen your agent to continue.";
  if (owner?.permissions) return "Your agent needs your approval in chat.";
  if (!latest.dispatchedAt) return "Waiting for your agent…";
  if (owner?.status === "running") return "Your agent is working…";
  if (componentHasAgentUpdate(instance)) return "Updated by your agent";
  if (owner?.status === "error") return "Your agent needs attention in chat.";
  return "Waiting for an update…";
}

function ComponentRow({
  theme,
  item,
  agentId,
  paseo,
}: PluginTimelineItemProps<ComponentTimelineData> & { paseo: PluginClientContext["paseo"] }) {
  const interact = useRpc(interactComponent);
  const { query, key, cache } = useInstance(item.data.instanceId);
  const owner = useOwner(
    paseo,
    agentId,
    Boolean(query.data && query.data.instance.agentId === agentId && awaitingAgent(query.data.instance)),
  );
  const [pendingPatch, setPendingPatch] = useState<ComponentState>({});
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: interact,
    onSuccess: (result, variables) => {
      componentEvents.updateInstance(result.instance);
      cache.setQueryData(key, (previous: typeof query.data) =>
        previous && previous.instance.revision <= result.instance.revision
          ? { ...previous, instance: result.instance }
          : previous,
      );
      setPendingPatch(previous =>
        Object.fromEntries(
          Object.entries(previous).filter(
            ([field, value]) => JSON.stringify(value) !== JSON.stringify(variables.action.patch?.[field]),
          ),
        ),
      );
      setNotice(result.dispatch === "unavailable" ? "Saved. Reopen your agent to continue." : null);
      if (variables.action.action !== "__state__") void owner.refetch();
    },
    onError: () => {
      setNotice("Could not save this change. Your input is still here; try again.");
      void query.refetch();
    },
  });
  useEffect(() => {
    if (!query.data || !Object.keys(pendingPatch).length || mutation.isPending || mutation.error) return;
    const timer = setTimeout(
      () =>
        mutation.mutate({
          instanceId: item.data.instanceId,
          expectedRevision: query.data!.instance.revision,
          action: { action: "__state__", patch: pendingPatch },
        }),
      700,
    );
    return () => clearTimeout(timer);
  }, [pendingPatch, query.data?.instance.revision, mutation.isPending]);
  const c = theme.colors;
  if (!query.data)
    return (
      <Text style={{ color: c.foregroundMuted }}>
        {query.error && /not found/i.test(query.error.message)
          ? "This component was deleted from Theme Studio."
          : (query.error?.message ?? "Loading component…")}
      </Text>
    );
  const { instance, definition } = query.data;
  const local = { ...instance.state, ...pendingPatch };
  if (
    instance.agentId !== agentId ||
    instance.componentId !== item.data.componentId ||
    instance.componentVersion !== item.data.componentVersion
  )
    return <Text style={{ color: c.statusDanger }}>Component does not belong to this conversation.</Text>;
  const onAction: ComponentProps["onAction"] = action => {
    if (action.action === "__state__") {
      mutation.reset();
      setNotice(null);
      setPendingPatch(previous => ({ ...previous, ...action.patch }));
      return;
    }
    if (mutation.isPending) {
      setNotice("Wait for the current interaction to finish saving.");
      return;
    }
    setNotice(null);
    mutation.mutate({
      instanceId: instance.id,
      expectedRevision: instance.revision,
      action: { ...action, patch: { ...pendingPatch, ...action.patch } },
    });
  };
  const feedback = mutation.isPending
    ? "Saving…"
    : (notice ?? (Object.keys(pendingPatch).length ? "Saving your input…" : interactionFeedback(instance, owner.data)));
  return (
    <ComponentCard
      theme={theme}
      definition={definition}
      state={local}
      onAction={onAction}
      feedback={feedback}
      feedbackTone={mutation.error ? "danger" : "muted"}
    />
  );
}

export function registerComponents(client: PluginClientContext) {
  function Renderer(props: PluginTimelineItemProps<ComponentTimelineData>) {
    return <ComponentRow {...props} paseo={client.paseo} />;
  }
  const removeRenderer = client.addTimelineRenderer({
    kind: "studio-component",
    version: 1,
    schema: componentTimelineSchema,
    Component: Renderer,
  });
  const addTransformer = () =>
    client.addTimelineTransformer({
      id: "verified-component-events",
      query: { itemType: "user_message" },
      transform: ({ item }) => (componentEvents.hides(item) ? { items: [] } : undefined),
    });
  let removeTransformer = addTransformer();
  let disposed = false;
  let busy = false;
  let pending = Promise.resolve();
  // Re-registration invalidates Paseo's cached projections after a persisted
  // event arrives. The canonical conversation is never modified.
  const unsubscribe = componentEvents.subscribe(() => {
    pending = pending.then(async () => {
      if (disposed) return;
      await removeTransformer();
      if (!disposed) removeTransformer = addTransformer();
    });
  });
  async function refresh() {
    if (disposed || busy) return;
    busy = true;
    try {
      const library = await client.rpc(readComponentLibrary, {});
      if (!disposed) componentEvents.updateLibrary(library);
    } catch {
      /* Keep the last verified snapshot when offline. */
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => {
    void refresh();
  }, 800);
  void refresh();
  return async () => {
    disposed = true;
    clearInterval(timer);
    unsubscribe();
    await pending;
    await removeTransformer();
    await removeRenderer();
  };
}
