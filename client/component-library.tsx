import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Component, type ReactNode, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  activateComponentBuild,
  buildComponents,
  createCodeComponent,
  createComposition,
  favoriteComponent,
  publishComponent,
  readComponentLibrary,
} from "../shared/component-rpc";
import {
  componentActionSchema,
  componentIdSchema,
  componentStateSchema,
  parseComponentTree,
  type ComponentAction,
  type ComponentDefinition,
  type ComponentLibrary,
  type ComponentNode,
  type ComponentState,
} from "../shared/components";
import { CompositionRenderer } from "./component-runtime";
import { generatedComponents } from "./generated-components";
import { StudioButton, StudioCard, StudioLabel } from "./studio-ui";
import { AgentConnectionCard } from "./agent-connection";
import { ComponentTriggersEditor, ComponentTriggersSummary, parseTriggersJson } from "./component-triggers";

export type ComponentLibraryProps = Pick<PluginSurfaceProps, "theme" | "layout" | "host" | "navigation"> & {
  workspaceId?: string;
  agentId?: string;
};
export const componentLibraryQueryKey = ["theme-studio-component-library"] as const;
type Dialog = "create" | "inspect" | "publish" | "versions" | null;
type ComponentMode = ComponentDefinition["mode"];
const libraryViews = new Map<string, { search: string; favoritesOnly: boolean }>();

const compositionStarter: ComponentNode = {
  type: "stack",
  gap: 12,
  children: [
    { type: "text", text: "Workspace decision", size: 18 },
    { type: "text", text: "Choose the next step, then send your decision to the agent.", tone: "muted" },
    {
      type: "select",
      label: "Next step",
      stateKey: "nextStep",
      options: [
        { label: "Review changes", value: "review" },
        { label: "Run checks", value: "checks" },
      ],
      action: "choose-step",
    },
    { type: "toggle", label: "Include a summary", stateKey: "summary", action: "toggle-summary" },
    { type: "button", label: "Confirm", action: "confirm", patch: { confirmed: true } },
  ],
};
const codeStarter = `import { Pressable, Text, View } from "react-native";
import type { ComponentProps } from "../../shared/components";

export default function DecisionCard({ theme, state, onAction }: ComponentProps) {
  const confirmed = state.confirmed === true;
  return <View style={{ padding: 16, gap: 12, borderRadius: 12, backgroundColor: theme.colors.surface1 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>Workspace decision</Text>
    <Text style={{ color: theme.colors.foregroundMuted }}>{confirmed ? "Decision confirmed." : "Ready for your decision."}</Text>
    <Pressable accessibilityRole="button" onPress={() => onAction({ action: "confirm", patch: { confirmed: true } })}
      style={{ padding: 12, borderRadius: 8, backgroundColor: theme.colors.accent }}>
      <Text style={{ color: theme.colors.accentForeground }}>Confirm</Text>
    </Pressable>
  </View>;
}
`;

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
const definitionKey = (definition: ComponentDefinition) => `${definition.id}@${definition.version}`;
const definitionSource = (definition: ComponentDefinition) =>
  definition.mode === "composition" ? JSON.stringify(definition.tree, null, 2) : definition.code;

class PreviewBoundary extends Component<{ theme: PluginTheme; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(reason: unknown) {
    return { error: errorMessage(reason) };
  }
  render() {
    return this.state.error ? (
      <View style={{ gap: 8, padding: 12 }}>
        <Text
          accessibilityRole="alert"
          style={{ color: this.props.theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}
        >
          This component could not render. {this.state.error}
        </Text>
        <StudioLabel theme={this.props.theme} subdued>
          Create a corrected version from its source.
        </StudioLabel>
      </View>
    ) : (
      this.props.children
    );
  }
}

function ComponentTile({
  theme,
  definition,
  favorite,
  active,
  disabled,
  onFavorite,
  onPreview,
  onVersion,
  onHistory,
  onPublish,
}: {
  theme: PluginTheme;
  definition: ComponentDefinition;
  favorite: boolean;
  active: boolean;
  disabled: boolean;
  onFavorite: () => void;
  onPreview: () => void;
  onVersion: () => void;
  onHistory: () => void;
  onPublish: () => void;
}) {
  return (
    <View
      style={{
        width: 280,
        flexGrow: 1,
        maxWidth: 480,
        gap: 13,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={{ padding: 8, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
          <Icon name={definition.mode === "composition" ? "Blocks" : "Code2"} size={18} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            numberOfLines={2}
            style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600", lineHeight: 20 }}
          >
            {definition.name}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontFamily: "monospace" }}>
            {definitionKey(definition)}
          </Text>
        </View>
        <StudioButton
          theme={theme}
          title={`${favorite ? "Unfavorite" : "Favorite"} component ${definition.name}`}
          icon="Star"
          iconOnly
          small
          active={favorite}
          disabled={disabled}
          onPress={onFavorite}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {definition.mode === "composition" ? "Native composition" : "Generated React Native"}
        </Text>
        <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
          <View
            style={{
              height: 5,
              width: 5,
              borderRadius: 3,
              backgroundColor: active ? theme.colors.statusSuccess : theme.colors.statusWarning,
            }}
          />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {active ? "Ready to use" : "Build and activate"}
          </Text>
        </View>
      </View>
      <ComponentTriggersSummary theme={theme} definition={definition} />
      <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
        <StudioButton theme={theme} title="Preview & source" icon="PanelsTopLeft" small onPress={onPreview} />
        <StudioButton
          theme={theme}
          title="Use in agent"
          icon="ArrowUpRight"
          small
          disabled={disabled || !active}
          onPress={onPublish}
        />
        <StudioButton theme={theme} title="New version" icon="Plus" small disabled={disabled} onPress={onVersion} />
        <StudioButton theme={theme} title="Versions" icon="History" small onPress={onHistory} />
      </View>
    </View>
  );
}

export function ComponentLibrarySurface(props: ComponentLibraryProps) {
  const { theme, layout, host } = props;
  const queryClient = useQueryClient();
  const readLibrary = useRpc(readComponentLibrary);
  const createTree = useRpc(createComposition);
  const createCode = useRpc(createCodeComponent);
  const favorite = useRpc(favoriteComponent);
  const build = useRpc(buildComponents);
  const activate = useRpc(activateComponentBuild);
  const publish = useRpc(publishComponent);
  const [width, setWidth] = useState(0);
  const compact = layout.compact || (width > 0 && width < 760);
  const [search, setSearchState] = useState(() => libraryViews.get(host.id)?.search ?? "");
  const [favoritesOnly, setFavoritesState] = useState(() => libraryViews.get(host.id)?.favoritesOnly ?? false);
  function setSearch(value: string) {
    libraryViews.set(host.id, {
      search: value,
      favoritesOnly: libraryViews.get(host.id)?.favoritesOnly ?? favoritesOnly,
    });
    setSearchState(value);
  }
  function setFavoritesOnly(value: boolean) {
    libraryViews.set(host.id, { search: libraryViews.get(host.id)?.search ?? search, favoritesOnly: value });
    setFavoritesState(value);
  }
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<ComponentDefinition | null>(null);
  const [inspectTab, setInspectTab] = useState<"preview" | "source">("preview");
  const [mode, setMode] = useState<ComponentMode>("composition");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [source, setSource] = useState("");
  const [triggersJson, setTriggersJson] = useState("[]");
  const [newVersion, setNewVersion] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const [targetAgent, setTargetAgent] = useState(props.agentId ?? "");
  const [initialState, setInitialState] = useState("{}");
  const [previewState, setPreviewState] = useState<ComponentState>({});
  const previewStateRef = useRef<ComponentState>({});
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [lastAction, setLastAction] = useState<ComponentAction | null>(null);
  const [copiedSource, setCopiedSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const query = useQuery({
    queryKey: componentLibraryQueryKey,
    queryFn: async () => {
      const library = await readLibrary({});
      const cached = queryClient.getQueryData<ComponentLibrary>(componentLibraryQueryKey);
      return cached && cached.revision > library.revision ? cached : library;
    },
    refetchInterval: 800,
    retry: 1,
  });
  const library = query.data;
  function acceptLibrary(next: ComponentLibrary) {
    const cached = queryClient.getQueryData<ComponentLibrary>(componentLibraryQueryKey);
    if (!cached || next.revision >= cached.revision) queryClient.setQueryData(componentLibraryQueryKey, next);
    setError(null);
  }
  function report(reason: unknown) {
    setError(errorMessage(reason));
    void query.refetch();
  }
  const creatingTree = useMutation({
    mutationFn: createTree,
    onError: report,
    onSuccess: result => {
      acceptLibrary(result.library);
      setDialog(null);
      setNotice(
        `${result.definition.name} v${result.definition.version} saved. It is ready to preview and use in an agent.`,
      );
    },
  });
  const creatingCode = useMutation({
    mutationFn: createCode,
    onError: report,
    onSuccess: result => {
      acceptLibrary(result.library);
      setDialog(null);
      setNotice(
        `${result.definition.name} v${result.definition.version} saved. Build and activate components to use its code.`,
      );
    },
  });
  const starring = useMutation({ mutationFn: favorite, onError: report, onSuccess: acceptLibrary });
  const building = useMutation({
    mutationFn: build,
    onError: report,
    onSuccess: result => {
      acceptLibrary(result.library);
      setNotice("Component build passed typecheck. Activate components when you are ready.");
    },
  });
  const activating = useMutation({
    mutationFn: activate,
    onError: report,
    onSuccess: result => {
      acceptLibrary(result.library);
      setReviewing(false);
      setNotice("Components activated. Theme Studio is reloading to make their renderers available.");
    },
  });
  const publishing = useMutation({
    mutationFn: publish,
    onError: report,
    onSuccess: async instance => {
      setDialog(null);
      setNotice("The component was added to the agent's real timeline.");
      await query.refetch();
      try {
        props.navigation?.openAgent({ agentId: instance.agentId, serverId: host.id });
      } catch (reason) {
        setError(`The component was published, but the chat could not open. ${errorMessage(reason)}`);
      }
    },
  });
  const busy =
    creatingTree.isPending ||
    creatingCode.isPending ||
    starring.isPending ||
    building.isPending ||
    activating.isPending ||
    publishing.isPending;
  const codeDefinitions = library?.definitions.filter(definition => definition.mode === "code") ?? [];
  const pendingCode = codeDefinitions.filter(definition => !library?.activeKeys.includes(definitionKey(definition)));
  const latestBuild = library?.builds.at(-1);
  const canActivate = Boolean(
    latestBuild &&
    latestBuild.keys.some(key => !library?.activeKeys.includes(key)) &&
    pendingCode.every(definition => latestBuild.keys.includes(definitionKey(definition))),
  );
  const reviewKeys = latestBuild?.keys.filter(key => !library?.activeKeys.includes(key)) ?? [];
  const reviewDefinitions = codeDefinitions.filter(definition => reviewKeys.includes(definitionKey(definition)));
  const latest = new Map<string, ComponentDefinition>();
  for (const definition of library?.definitions ?? [])
    if ((latest.get(definition.id)?.version ?? 0) < definition.version) latest.set(definition.id, definition);
  const needle = search.trim().toLowerCase();
  const definitions = [...latest.values()]
    .filter(
      definition =>
        (!favoritesOnly || library?.favorites.includes(definition.id)) &&
        (!needle || `${definition.name} ${definition.id}`.toLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(library?.favorites.includes(b.id)) - Number(library?.favorites.includes(a.id)) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const selectedReady =
    selected?.mode === "composition" || Boolean(selected && library?.activeKeys.includes(definitionKey(selected)));
  const CompiledPreview = selected?.mode === "code" ? generatedComponents[definitionKey(selected)] : null;
  const formChanged = formRevision !== library?.revision;
  const inputStyle = {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 11,
    fontSize: 13,
  };

  function openCreate(nextMode: ComponentMode, definition?: ComponentDefinition) {
    setError(null);
    setNotice(null);
    setNewVersion(Boolean(definition));
    setMode(nextMode);
    setFormRevision(library?.revision ?? 0);
    setName(definition?.name ?? (nextMode === "composition" ? "Workspace decision" : "Decision card"));
    setId(definition?.id ?? (nextMode === "composition" ? "workspace-decision" : "decision-card"));
    setSource(
      definition
        ? definitionSource(definition)
        : nextMode === "composition"
          ? JSON.stringify(compositionStarter, null, 2)
          : codeStarter,
    );
    setTriggersJson(JSON.stringify(definition?.triggers ?? [], null, 2));
    setDialog("create");
  }
  function resetPreview() {
    previewStateRef.current = {};
    setPreviewState({});
    setLastAction(null);
    setPreviewEpoch(value => value + 1);
    setError(null);
  }
  function openInspect(definition: ComponentDefinition) {
    setSelected(definition);
    resetPreview();
    setCopiedSource(false);
    setInspectTab("preview");
    setError(null);
    setDialog("inspect");
  }
  function openPublish(definition: ComponentDefinition) {
    const state = selected && definitionKey(selected) === definitionKey(definition) ? previewState : {};
    setSelected(definition);
    setFormRevision(library?.revision ?? 0);
    setTargetAgent(props.agentId ?? "");
    setInitialState(JSON.stringify(state, null, 2));
    setError(null);
    setDialog("publish");
  }
  function previewAction(input: ComponentAction) {
    try {
      const action = componentActionSchema.parse(input);
      const nextState = componentStateSchema.parse({ ...previewStateRef.current, ...action.patch });
      previewStateRef.current = nextState;
      setPreviewState(nextState);
      setLastAction(action);
      setError(null);
    } catch (reason) {
      setError(`Preview action was invalid. ${errorMessage(reason)}`);
    }
  }
  function create() {
    const componentId = componentIdSchema.safeParse(id.trim());
    if (!componentId.success) {
      setError("Use a lowercase component ID with letters, numbers, and hyphens, starting with a letter.");
      return;
    }
    if (!name.trim()) {
      setError("Give the component a name.");
      return;
    }
    let triggers: ComponentDefinition["triggers"];
    try {
      triggers = parseTriggersJson(triggersJson);
    } catch (reason) {
      setError(errorMessage(reason));
      return;
    }
    const base = { expectedRevision: formRevision, id: componentId.data, name: name.trim(), triggers };
    if (mode === "code") {
      if (!source.trim()) {
        setError("Paste a React Native component source file.");
        return;
      }
      creatingCode.mutate({ ...base, code: source });
      return;
    }
    try {
      creatingTree.mutate({ ...base, tree: parseComponentTree(JSON.parse(source)) });
    } catch (reason) {
      setError(`The composition must be a valid native component tree. ${errorMessage(reason)}`);
    }
  }
  function publishSelected() {
    if (!selected) return;
    try {
      const state = componentStateSchema.parse(JSON.parse(initialState));
      publishing.mutate({
        expectedRevision: formRevision,
        componentId: selected.id,
        version: selected.version,
        agentId: targetAgent.trim() || undefined,
        state,
      });
    } catch (reason) {
      setError(`Initial state must be a JSON object. ${errorMessage(reason)}`);
    }
  }

  return (
    <View
      testID="component-library"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={{ flex: 1, backgroundColor: theme.colors.surface0, minHeight: 0 }}
    >
      <View style={{ padding: compact ? 16 : 24, gap: 13, borderBottomWidth: 1, borderColor: theme.colors.border }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
            <Icon name="Blocks" size={23} color={theme.colors.accent} />
            <View style={{ gap: 3, flexShrink: 1 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "600" }}>Component library</Text>
              {!compact ? (
                <StudioLabel theme={theme} subdued>
                  Reusable native UI for your agents. Save versions, preview, and publish.
                </StudioLabel>
              ) : null}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
            <StudioButton
              theme={theme}
              title="New composition"
              icon="Plus"
              small
              disabled={!library || busy}
              onPress={() => openCreate("composition")}
            />
            <StudioButton
              theme={theme}
              title="New code component"
              icon="Code2"
              small
              disabled={!library || busy}
              onPress={() => openCreate("code")}
            />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <TextInput
            accessibilityLabel="Search components"
            value={search}
            onChangeText={setSearch}
            placeholder="Search components…"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCorrect={false}
            style={{ ...inputStyle, flex: 1, minWidth: compact ? 150 : 220 }}
          />
          <StudioButton
            theme={theme}
            title="Favorites only"
            icon="Star"
            small
            active={favoritesOnly}
            onPress={() => setFavoritesOnly(!favoritesOnly)}
          />
        </View>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: compact ? 16 : 24, gap: 17 }}
      >
        <AgentConnectionCard theme={theme} />
        {error || query.error ? (
          <View
            style={{ padding: 12, gap: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.statusDanger }}
          >
            <Text
              selectable
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}
            >
              {error ?? errorMessage(query.error)}
            </Text>
            <View style={{ flexDirection: "row", gap: 7 }}>
              <StudioButton
                theme={theme}
                title="Refresh"
                icon="RefreshCw"
                small
                onPress={() => {
                  setError(null);
                  void query.refetch();
                }}
              />
              {error ? <StudioButton theme={theme} title="Dismiss" small onPress={() => setError(null)} /> : null}
            </View>
          </View>
        ) : null}
        {notice ? (
          <View
            style={{
              flexDirection: "row",
              padding: 12,
              gap: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Icon name="CircleCheck" size={15} color={theme.colors.statusSuccess} />
            <Text style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18, flex: 1 }}>{notice}</Text>
          </View>
        ) : null}
        {!library ? (
          <StudioLabel theme={theme} subdued>
            {query.isPending
              ? "Loading your components…"
              : "The component library is unavailable. Refresh to reconnect."}
          </StudioLabel>
        ) : (
          <>
            {codeDefinitions.length ? (
              <StudioCard
                theme={theme}
                title="Generated components"
                description={`${pendingCode.length} saved ${pendingCode.length === 1 ? "version needs" : "versions need"} activation. Builds typecheck the source before it runs in the plugin.`}
              >
                <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
                  <StudioButton
                    theme={theme}
                    title={building.isPending ? "Building…" : "Build components"}
                    icon="Hammer"
                    small
                    disabled={busy || pendingCode.length === 0}
                    onPress={() => building.mutate({ expectedRevision: library.revision })}
                  />
                  <StudioButton
                    theme={theme}
                    title={activating.isPending ? "Activating…" : "Activate components"}
                    icon="Check"
                    primary
                    small
                    disabled={busy || !canActivate || reviewing}
                    onPress={() => setReviewing(true)}
                  />
                </View>
                {reviewing && latestBuild ? (
                  <View style={{ gap: 8 }}>
                    <StudioLabel theme={theme}>
                      Review the source before activating. Typecheck and import checks are not a sandbox: activated code
                      runs inside Paseo with the plugin's permissions.
                    </StudioLabel>
                    {reviewDefinitions.map(definition =>
                      definition.mode === "code" ? (
                        <View key={definitionKey(definition)} style={{ gap: 4 }}>
                          <StudioLabel theme={theme}>
                            {definition.name} · {definitionKey(definition)}
                          </StudioLabel>
                          <ScrollView
                            style={{
                              maxHeight: 260,
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                              borderRadius: 8,
                              backgroundColor: theme.colors.surface2,
                            }}
                            contentContainerStyle={{ padding: 10 }}
                          >
                            <Text
                              selectable
                              style={{
                                color: theme.colors.foreground,
                                fontSize: 11,
                                lineHeight: 16,
                                fontFamily: "monospace",
                              }}
                            >
                              {definition.code}
                            </Text>
                          </ScrollView>
                        </View>
                      ) : null,
                    )}
                    <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
                      <StudioButton
                        theme={theme}
                        title={activating.isPending ? "Activating…" : "I reviewed this code · Activate"}
                        icon="Check"
                        primary
                        small
                        disabled={busy}
                        onPress={() =>
                          activating.mutate({
                            expectedRevision: library.revision,
                            buildId: latestBuild.id,
                            reviewedKeys: reviewKeys,
                          })
                        }
                      />
                      <StudioButton
                        theme={theme}
                        title="Cancel"
                        icon="X"
                        small
                        disabled={activating.isPending}
                        onPress={() => setReviewing(false)}
                      />
                    </View>
                  </View>
                ) : null}
                {latestBuild ? (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Icon name="CircleCheck" size={13} color={theme.colors.statusSuccess} />
                      <StudioLabel theme={theme}>
                        Latest build passed typecheck · {latestBuild.keys.length}{" "}
                        {latestBuild.keys.length === 1 ? "version" : "versions"}
                      </StudioLabel>
                    </View>
                    <Text
                      selectable
                      style={{
                        color: theme.colors.foregroundMuted,
                        fontSize: 11,
                        lineHeight: 17,
                        fontFamily: "monospace",
                      }}
                    >
                      {latestBuild.directory}
                    </Text>
                  </>
                ) : null}
              </StudioCard>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <StudioLabel theme={theme}>
                {definitions.length} {definitions.length === 1 ? "component" : "components"}
              </StudioLabel>
              <StudioLabel theme={theme} subdued>
                Library r{library.revision}
              </StudioLabel>
            </View>
            {definitions.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 13 }}>
                {definitions.map(definition => (
                  <ComponentTile
                    key={definition.id}
                    theme={theme}
                    definition={definition}
                    favorite={library.favorites.includes(definition.id)}
                    active={definition.mode === "composition" || library.activeKeys.includes(definitionKey(definition))}
                    disabled={busy}
                    onFavorite={() =>
                      starring.mutate({
                        expectedRevision: library.revision,
                        componentId: definition.id,
                        favorite: !library.favorites.includes(definition.id),
                      })
                    }
                    onPreview={() => openInspect(definition)}
                    onVersion={() => openCreate(definition.mode, definition)}
                    onHistory={() => {
                      setSelected(definition);
                      setDialog("versions");
                    }}
                    onPublish={() => openPublish(definition)}
                  />
                ))}
              </View>
            ) : (
              <StudioCard
                theme={theme}
                title={search.trim() || favoritesOnly ? "No matching components" : "Your component library is empty"}
                description={
                  search.trim() || favoritesOnly
                    ? "Clear the search or show all components to see the rest of your library."
                    : "Create a native composition, paste React Native source, or ask the designer agent to make one. New components appear here automatically."
                }
              >
                {search.trim() || favoritesOnly ? (
                  <StudioButton
                    theme={theme}
                    title="Show all components"
                    small
                    onPress={() => {
                      setSearch("");
                      setFavoritesOnly(false);
                    }}
                  />
                ) : null}
              </StudioCard>
            )}
            <StudioLabel theme={theme} subdued>
              Preview actions stay local. Use in agent publishes an interactive instance to the real chat. Favorites
              keep reusable components easy to find.
            </StudioLabel>
          </>
        )}
      </ScrollView>

      <Modal
        title={
          dialog === "create"
            ? newVersion
              ? "Create component version"
              : mode === "composition"
                ? "New composition"
                : "New code component"
            : dialog === "publish"
              ? "Use component in agent"
              : dialog === "versions"
                ? "Component versions"
                : `${selected?.name ?? "Component"} · v${selected?.version ?? 1}`
        }
        icon={
          <Icon
            name={mode === "code" && dialog === "create" ? "Code2" : "Blocks"}
            size={18}
            color={theme.colors.foreground}
          />
        }
        open={dialog !== null}
        onOpenChange={open => {
          if (!open) setDialog(null);
        }}
      >
        <Modal.Content>
          {dialog === "create" ? (
            <>
              <StudioLabel theme={theme} subdued>
                {mode === "composition"
                  ? "Compose native text, stats, lists, progress, buttons, inputs, selects, and toggles. Saved compositions are ready immediately."
                  : "Save a React Native component with theme, state, and onAction props. Build and explicitly activate it before previewing or publishing."}
              </StudioLabel>
              <StudioLabel theme={theme}>Name</StudioLabel>
              <TextInput
                accessibilityLabel="Component name"
                value={name}
                onChangeText={setName}
                maxLength={60}
                editable={!busy}
                style={inputStyle}
              />
              <StudioLabel theme={theme}>Component ID</StudioLabel>
              <TextInput
                accessibilityLabel="Component ID"
                value={id}
                onChangeText={setId}
                maxLength={48}
                editable={!busy && !newVersion}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
              {newVersion ? (
                <StudioLabel theme={theme} subdued>
                  This saves a new version. Existing versions and published instances stay available.
                </StudioLabel>
              ) : null}
              <ComponentTriggersEditor theme={theme} value={triggersJson} onChange={setTriggersJson} disabled={busy} />
              <StudioLabel theme={theme}>
                {mode === "composition" ? "Composition JSON" : "React Native source"}
              </StudioLabel>
              <TextInput
                accessibilityLabel={mode === "composition" ? "Composition JSON" : "Component React Native source"}
                value={source}
                onChangeText={setSource}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={40000}
                editable={!busy}
                style={{
                  ...inputStyle,
                  minHeight: 280,
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 18,
                  textAlignVertical: "top",
                }}
              />
              {formChanged ? (
                <View style={{ gap: 6 }}>
                  <StudioLabel theme={theme} subdued>
                    The library changed while you were editing. Refresh the revision to save your version.
                  </StudioLabel>
                  <StudioButton
                    theme={theme}
                    title="Use latest library revision"
                    small
                    disabled={busy}
                    onPress={() => setFormRevision(library?.revision ?? 0)}
                  />
                </View>
              ) : null}
              <StudioButton
                theme={theme}
                title={busy ? "Saving…" : "Save component"}
                icon="Save"
                primary
                disabled={busy || formChanged || !name.trim() || !id.trim() || !source.trim()}
                onPress={create}
              />
            </>
          ) : null}
          {dialog === "inspect" && selected ? (
            <>
              <View style={{ flexDirection: "row", gap: 7 }}>
                <StudioButton
                  theme={theme}
                  title="Preview"
                  icon="PanelsTopLeft"
                  small
                  active={inspectTab === "preview"}
                  onPress={() => setInspectTab("preview")}
                />
                <StudioButton
                  theme={theme}
                  title="Source"
                  icon="Code2"
                  small
                  active={inspectTab === "source"}
                  onPress={() => setInspectTab("source")}
                />
              </View>
              <ComponentTriggersSummary key={definitionKey(selected)} theme={theme} definition={selected} detailed />
              {inspectTab === "preview" ? (
                <>
                  {selected.mode === "composition" || CompiledPreview ? (
                    <PreviewBoundary key={`${definitionKey(selected)}:${previewEpoch}`} theme={theme}>
                      <View
                        style={{
                          padding: 14,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          borderRadius: 10,
                          backgroundColor: theme.colors.surface0,
                        }}
                      >
                        {selected.mode === "composition" ? (
                          <CompositionRenderer
                            tree={selected.tree}
                            theme={theme}
                            state={previewState}
                            onAction={previewAction}
                          />
                        ) : CompiledPreview ? (
                          <CompiledPreview theme={theme} state={previewState} onAction={previewAction} />
                        ) : null}
                      </View>
                    </PreviewBoundary>
                  ) : (
                    <StudioLabel theme={theme} subdued>
                      {selectedReady
                        ? "This version is activated. Theme Studio needs to finish reloading before its preview is available."
                        : "Build and activate components to preview this saved code version."}
                    </StudioLabel>
                  )}
                  <StudioLabel theme={theme} subdued>
                    Actions in this preview change only its local state.
                  </StudioLabel>
                  {lastAction ? (
                    <Text
                      selectable
                      style={{
                        color: theme.colors.foregroundMuted,
                        fontSize: 11,
                        lineHeight: 17,
                        fontFamily: "monospace",
                      }}
                    >
                      {JSON.stringify({ event: lastAction, state: previewState }, null, 2)}
                    </Text>
                  ) : null}
                  <StudioButton
                    theme={theme}
                    title="Reset preview state"
                    icon="RotateCcw"
                    small
                    onPress={resetPreview}
                  />
                </>
              ) : (
                <>
                  <Text
                    selectable
                    style={{
                      color: theme.colors.foreground,
                      fontFamily: "monospace",
                      fontSize: 12,
                      lineHeight: 18,
                      padding: 12,
                      borderRadius: 8,
                      backgroundColor: theme.colors.surface0,
                    }}
                  >
                    {definitionSource(selected)}
                  </Text>
                  <StudioButton
                    theme={theme}
                    title={copiedSource ? "Source copied" : "Copy source"}
                    icon={copiedSource ? "Check" : "Copy"}
                    small
                    onPress={() => {
                      void copyText(definitionSource(selected))
                        .then(() => setCopiedSource(true))
                        .catch(report);
                    }}
                  />
                </>
              )}
              <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
                <StudioButton
                  theme={theme}
                  title="Use in agent"
                  icon="ArrowUpRight"
                  primary
                  disabled={busy || !selectedReady}
                  onPress={() => openPublish(selected)}
                />
                <StudioButton
                  theme={theme}
                  title="Create new version"
                  icon="Plus"
                  disabled={busy}
                  onPress={() => openCreate(selected.mode, selected)}
                />
              </View>
            </>
          ) : null}
          {dialog === "publish" && selected ? (
            <>
              <StudioLabel theme={theme}>
                Publish {selected.name} v{selected.version}
              </StudioLabel>
              <StudioLabel theme={theme} subdued>
                A new interactive instance appears in the agent's actual timeline. Its actions update state and reach
                the agent.
              </StudioLabel>
              <StudioLabel theme={theme} subdued>
                The target needs the Theme Studio MCP. Use the designer, create an agent after enabling Connect new
                agents, or set up an existing agent's provider first.
              </StudioLabel>
              <StudioLabel theme={theme}>Agent ID</StudioLabel>
              <TextInput
                accessibilityLabel="Target agent ID"
                value={targetAgent}
                onChangeText={setTargetAgent}
                placeholder="Leave blank for the designer session"
                placeholderTextColor={theme.colors.foregroundMuted}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                style={inputStyle}
              />
              <StudioLabel theme={theme}>Initial state JSON</StudioLabel>
              <TextInput
                accessibilityLabel="Component initial state JSON"
                value={initialState}
                onChangeText={setInitialState}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                maxLength={12000}
                style={{ ...inputStyle, minHeight: 110, fontFamily: "monospace", textAlignVertical: "top" }}
              />
              {formChanged ? (
                <View style={{ gap: 6 }}>
                  <StudioLabel theme={theme} subdued>
                    The library changed. Refresh the revision before publishing.
                  </StudioLabel>
                  <StudioButton
                    theme={theme}
                    title="Use latest library revision"
                    small
                    disabled={busy}
                    onPress={() => setFormRevision(library?.revision ?? 0)}
                  />
                </View>
              ) : null}
              <StudioButton
                theme={theme}
                title={publishing.isPending ? "Publishing…" : "Publish to agent"}
                icon="ArrowUpRight"
                primary
                disabled={busy || formChanged || !selectedReady}
                onPress={publishSelected}
              />
            </>
          ) : null}
          {dialog === "versions" && selected ? (
            <>
              <StudioLabel theme={theme} subdued>
                Each version stays available for reuse. Published instances keep their original version.
              </StudioLabel>
              {[...(library?.definitions.filter(definition => definition.id === selected.id) ?? [])]
                .sort((a, b) => b.version - a.version)
                .map(definition => (
                  <View
                    key={definitionKey(definition)}
                    style={{ padding: 12, gap: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 9 }}
                  >
                    <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}>
                      {definition.name} · v{definition.version}
                    </Text>
                    <StudioLabel theme={theme} subdued>
                      {definition.mode === "composition" ? "Composition" : "Generated code"} ·{" "}
                      {new Date(definition.createdAt).toLocaleString()}
                    </StudioLabel>
                    <ComponentTriggersSummary theme={theme} definition={definition} />
                    <View style={{ flexDirection: "row", gap: 7 }}>
                      <StudioButton
                        theme={theme}
                        title="Preview & source"
                        small
                        onPress={() => openInspect(definition)}
                      />
                      <StudioButton
                        theme={theme}
                        title="Use in agent"
                        small
                        disabled={
                          busy ||
                          (definition.mode === "code" && !library?.activeKeys.includes(definitionKey(definition)))
                        }
                        onPress={() => openPublish(definition)}
                      />
                    </View>
                  </View>
                ))}
            </>
          ) : null}
          {error && dialog ? (
            <Text
              selectable
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}
            >
              {error}
            </Text>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}
