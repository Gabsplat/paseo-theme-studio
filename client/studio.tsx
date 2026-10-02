import type { PluginAgentPanelProps, PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { changeStudio, exportPack, readStudio, startDesigner } from "../shared/rpc";
import { defaultDesignerModel, defaultDesignerProvider } from "../shared/designer";
import {
  colorKeys,
  colorLabels,
  describePackChanges,
  presets,
  themeSchema,
  type ColorKey,
  type PackUi,
  type StudioAction,
  type StudioDocument,
  type StudioTheme,
} from "../shared/theme";
import { contrastReport } from "../shared/contrast";
import { PaseoPreview, type PreviewScene, type PreviewTimelineItem } from "./preview";
import { PaletteInspector } from "./studio-inspector";
import { PackDesignInspector } from "./studio-design";
import { previewPluginTheme } from "./preview-colors";
import { InspectorSections, StudioButton, StudioCard, StudioLabel, StudioSegments } from "./studio-ui";
import { ComponentLibrarySurface } from "./component-library";
import { ComponentInspector, latestDefinitions, useComponentLibrary } from "./component-inspector";
import { ComponentCard } from "./component-runtime";
import type { ComponentState } from "../shared/components";
import { changeStudioPreferences, readStudioPreferences } from "../shared/preferences";

export type StudioProps = (PluginSurfaceProps | PluginWorkspacePanelProps | PluginAgentPanelProps) & {
  onOpenPreview?: (workspaceId: string, agentId: string) => void | Promise<void>;
  onOpenPack?: (workspaceId: string, agentId?: string) => void | Promise<void>;
  /** Opens the full Theme Studio surface, leaving the designer chat. */
  onOpenStudio?: () => void;
  /** Reopen the designer chat when the user left it open. Only the sidebar surface does this. */
  autoOpenDesigner?: boolean;
};
type StudioMode = "studio" | "library";
type Inspector = "colors" | "design" | "components" | "packs" | "history";
type Dialog = "save" | "import" | "export" | "settings" | null;
type StudioView = {
  view: StudioMode;
  inspector: Inspector;
  scene: PreviewScene;
  component: string | null;
  filterFavorites: boolean;
};
export const studioQueryKey = ["theme-studio-document"] as const;
const preferencesQueryKey = ["theme-studio-preferences"] as const;
// Remembers each host and workspace's view while Paseo keeps this plugin loaded.
const studioViews = new Map<string, StudioView>();

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ThemeTile({
  theme,
  candidate,
  selected,
  disabled,
  onPress,
  onDelete,
  favorite = false,
  onFavorite,
}: {
  theme: PluginTheme;
  candidate: StudioTheme;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  onDelete?: () => void;
  favorite?: boolean;
  onFavorite?: () => void;
}) {
  return (
    <View
      style={{
        width: 150,
        flexGrow: 1,
        maxWidth: 330,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface0,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Load ${candidate.name}`}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({ padding: 14, gap: 13, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "500", fontSize: 13, flex: 1 }}>
            {candidate.name}
          </Text>
          {selected ? <Icon name="CircleCheck" size={15} color={theme.colors.accent} /> : null}
          {onFavorite ? <View style={{ width: 26 }} /> : null}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            candidate.colors.background,
            candidate.colors.raised,
            candidate.colors.accent,
            candidate.colors.foreground,
          ].map((color, index) => (
            <View
              key={index}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: color,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            />
          ))}
        </View>
        <StudioLabel theme={theme} subdued>
          {candidate.appearance === "dark" ? "Dark" : "Light"} · {candidate.ui.density} · {candidate.ui.fontFamily}
        </StudioLabel>
      </Pressable>
      {onFavorite ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${favorite ? "Unfavorite" : "Favorite"} ${candidate.name}`}
          accessibilityState={{ selected: favorite, disabled }}
          disabled={disabled}
          onPress={onFavorite}
          style={({ pressed }) => ({
            position: "absolute",
            top: 6,
            right: 7,
            padding: 8,
            borderRadius: 7,
            backgroundColor: favorite || pressed ? theme.colors.surface2 : "transparent",
            opacity: disabled ? 0.5 : 1,
          })}
        >
          <Icon name="Star" size={16} color={favorite ? theme.colors.accent : theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete saved theme ${candidate.name}`}
          onPress={onDelete}
          disabled={disabled}
          style={{
            paddingVertical: 9,
            paddingHorizontal: 14,
            borderTopWidth: 1,
            borderColor: theme.colors.border,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="Trash2" size={12} color={theme.colors.foregroundMuted} />
          <StudioLabel theme={theme} subdued>
            Remove from library
          </StudioLabel>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ThemeStudio(props: StudioProps) {
  const { theme, layout } = props;
  const workspaceId = "workspaceId" in props ? props.workspaceId : undefined;
  const inPanel = workspaceId !== undefined;
  const viewKey = `${props.host.id}:${workspaceId ?? "global"}`;
  const queryClient = useQueryClient();
  const read = useRpc(readStudio);
  const change = useRpc(changeStudio);
  const start = useRpc(startDesigner);
  const exportFiles = useRpc(exportPack);
  const readPreferences = useRpc(readStudioPreferences);
  const changePreferences = useRpc(changeStudioPreferences);
  const saved = studioViews.get(viewKey);
  const [view, setViewState] = useState<StudioMode>(saved?.view ?? "studio");
  const [inspector, setInspectorState] = useState<Inspector>(saved?.inspector ?? "colors");
  const [scene, setSceneState] = useState<PreviewScene>(saved?.scene ?? "chat");
  const [selectedComponent, setSelectedComponentState] = useState<string | null>(saved?.component ?? null);
  const [filterFavorites, setFilterFavoritesState] = useState(saved?.filterFavorites ?? false);
  function remember(next: Partial<StudioView>) {
    studioViews.set(viewKey, {
      view,
      inspector,
      scene,
      component: selectedComponent,
      filterFavorites,
      ...studioViews.get(viewKey),
      ...next,
    });
  }
  const setView = (next: StudioMode) => (remember({ view: next }), setViewState(next));
  const setInspector = (next: Inspector) => (remember({ inspector: next }), setInspectorState(next));
  const setScene = (next: PreviewScene) => (remember({ scene: next }), setSceneState(next));
  const setFilterFavorites = (next: boolean) => (remember({ filterFavorites: next }), setFilterFavoritesState(next));
  const [componentState, setComponentState] = useState<ComponentState>({});
  function selectComponent(id: string | null) {
    remember({ component: id });
    setSelectedComponentState(id);
    setComponentState({});
    if (id) setScene("chat");
  }
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saveName, setSaveName] = useState("");
  const [json, setJson] = useState("");
  const [exportRevision, setExportRevision] = useState(0);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [provider, setProvider] = useState(defaultDesignerProvider);
  const [model, setModel] = useState(() => defaultDesignerModel(defaultDesignerProvider));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Beside a chat, or on small screens, the inspector moves below the preview.
  const stacked = layout.compact || (size.width > 0 && size.width < 980);
  // Explorer panels beside a chat can be very narrow; keep toolbar labels for the key action only.
  const tight = layout.compact || (size.width > 0 && size.width < 520);
  const query = useQuery({
    queryKey: studioQueryKey,
    queryFn: async () => {
      const result = await read({});
      const cached = queryClient.getQueryData<StudioDocument>(studioQueryKey);
      return cached && cached.revision > result.revision ? cached : result;
    },
    refetchInterval: 800,
    retry: 1,
  });
  const document = query.data;
  const preferences = useQuery({ queryKey: preferencesQueryKey, queryFn: () => readPreferences({}) });
  const components = useComponentLibrary();

  const update = useMutation({
    mutationFn: change,
    onSuccess: result => {
      const cached = queryClient.getQueryData<StudioDocument>(studioQueryKey);
      if (!cached || result.revision >= cached.revision) queryClient.setQueryData(studioQueryKey, result);
      setError(null);
    },
    onError: reason => {
      setError(messageFor(reason));
      void query.refetch();
    },
  });

  async function rememberDesigner(open: boolean) {
    queryClient.setQueryData(preferencesQueryKey, await changePreferences({ designerOpen: open }));
  }

  const designer = useMutation({
    mutationFn: start,
    onSuccess: async result => {
      await query.refetch();
      try {
        props.navigation?.openAgent({ agentId: result.agentId, serverId: props.host.id });
        await props.onOpenPreview?.(result.workspaceId, result.agentId);
        await rememberDesigner(true);
      } catch (reason) {
        setError(
          `The designer is ready, but opening the preview failed. ${messageFor(reason)} Open Theme Studio from the workspace's panels.`,
        );
      }
    },
    onError: reason => setError(messageFor(reason)),
  });

  const exporter = useMutation({
    mutationFn: exportFiles,
    onError: reason => setError(messageFor(reason)),
    onSuccess: () => setError(null),
  });

  // Theme Studio reopens the designer chat if the user left it open last time.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !props.autoOpenDesigner || inPanel || !props.navigation) return;
    if (!preferences.data || !document) return;
    restored.current = true;
    if (preferences.data.designerOpen && document.designerAgentId) openDesigner();
  }, [preferences.data, document?.designerAgentId]);

  async function apply(action: StudioAction, expectedRevision = document?.revision) {
    if (expectedRevision === undefined) throw new Error("Wait for the studio to finish loading.");
    setNotice(null);
    return await update.mutateAsync({ expectedRevision, action });
  }
  function dispatch(action: StudioAction) {
    void apply(action).catch(() => {});
  }
  async function commitColor(key: ColorKey, color: string, expectedRevision: number) {
    await apply(
      { type: "patch", colors: { [key]: color }, label: `Edit ${colorLabels[key].toLowerCase()}` },
      expectedRevision,
    );
  }
  async function patchUi(ui: Partial<PackUi>, label: string, expectedRevision: number) {
    await apply({ type: "patch-ui", ui, label }, expectedRevision);
  }
  async function activatePack() {
    try {
      await apply({ type: "activate" });
      setNotice(
        "Pack activated. Select Theme Studio · Live in Settings → Appearance once to use its colors across Paseo.",
      );
    } catch {
      /* The mutation reports its error. */
    }
  }

  function openDesigner() {
    setError(null);
    designer.mutate({ workspaceId, provider: provider.trim() || undefined, model: model.trim() || undefined });
  }
  async function closeDesigner() {
    try {
      await rememberDesigner(false);
      props.onOpenStudio?.();
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  function openDialog(next: Dialog) {
    setError(null);
    setNotice(null);
    if (next === "save") setSaveName(document?.current.name ?? "");
    if (next === "export") {
      setJson(JSON.stringify(document?.current, null, 2));
      setExportRevision(document?.revision ?? 0);
      setCopiedInstall(false);
      exporter.reset();
    }
    if (next === "import") setJson("");
    setDialog(next);
  }

  async function saveTheme() {
    if (!saveName.trim()) {
      setError("Give your pack a name.");
      return;
    }
    try {
      await apply({ type: "save", name: saveName.trim() });
      setDialog(null);
      setNotice("Pack saved to your library.");
    } catch {
      /* The mutation reports its error. */
    }
  }

  async function importTheme() {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      setError("That is not valid JSON. Paste a complete exported pack.");
      return;
    }
    const parsed = themeSchema.safeParse(value);
    if (!parsed.success) {
      setError(
        `The pack needs an id, name, appearance, all eight hex colors, and valid UI settings. ${parsed.error.issues[0]?.message ?? ""}`,
      );
      return;
    }
    try {
      await apply({ type: "import", theme: parsed.data });
      setDialog(null);
      setNotice("Pack imported into the draft. Locked colors were preserved.");
    } catch {
      /* The mutation reports its error. */
    }
  }

  const busy = update.isPending || exporter.isPending;
  const libraryPacks =
    document?.saved.filter(candidate => !filterFavorites || document.favorites.includes(candidate.id)) ?? [];
  const packChanges = document ? describePackChanges(document.current, document.active) : [];
  const draftMatchesActive = Boolean(document?.active) && packChanges.length === 0;
  const draftTheme = document ? previewPluginTheme(document.current) : theme;
  const packWorkspaceId = workspaceId ?? document?.designerWorkspaceId;
  const activePanelEnabled = Boolean(
    document?.active && (document.active.ui.activityPanel || document.active.ui.panel.enabled),
  );
  const besideDesigner =
    inPanel && Boolean(document?.designerWorkspaceId) && workspaceId === document?.designerWorkspaceId;
  async function openPackPanel() {
    if (!packWorkspaceId || !props.onOpenPack) return;
    const agentId =
      packWorkspaceId === document?.designerWorkspaceId ? (document?.designerAgentId ?? undefined) : undefined;
    try {
      await props.onOpenPack(packWorkspaceId, agentId);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }
  const inputStyle = {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: theme.colors.foreground,
    fontSize: 13,
  };
  const c = theme.colors;

  const previewDefinition = latestDefinitions(components.library).find(item => item.id === selectedComponent);
  const previewItems: PreviewTimelineItem[] =
    previewDefinition && document
      ? [
          {
            key: `${previewDefinition.id}@${previewDefinition.version}`,
            node: (
              <ComponentCard
                theme={draftTheme}
                definition={previewDefinition}
                state={componentState}
                onAction={action => {
                  if (action.patch) setComponentState(previous => ({ ...previous, ...action.patch }));
                }}
                feedback="Preview · actions stay local"
              />
            ),
          },
        ]
      : [];

  const textRatio = document
    ? contrastReport(document.current.colors, document.current.appearance)
        .checks.find(
          check =>
            check.foreground === "foreground" &&
            check.background === (document.current.appearance === "dark" ? "raised" : "background"),
        )!
        .ratio.toFixed(1)
    : null;

  const designerButton = besideDesigner ? (
    <StudioButton
      theme={theme}
      title="Close designer"
      icon="PanelLeftClose"
      small
      iconOnly={tight}
      onPress={() => void closeDesigner()}
    />
  ) : (
    <StudioButton
      theme={theme}
      title={designer.isPending ? "Opening…" : document?.designerAgentId ? "Designer" : "Start designer"}
      icon="MessageSquare"
      small
      iconOnly={tight}
      active={Boolean(preferences.data?.designerOpen && document?.designerAgentId)}
      disabled={!document || designer.isPending || !props.navigation}
      onPress={openDesigner}
    />
  );

  const topBar = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        paddingHorizontal: inPanel ? 12 : 16,
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderColor: c.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0, flexGrow: 1 }}>
        {view === "library" ? (
          <StudioButton theme={theme} title="Back to studio" icon="ArrowLeft" small onPress={() => setView("studio")} />
        ) : (
          <Icon name="Palette" size={15} color={c.foregroundMuted} />
        )}
        {view === "library" ? (
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 13 }}>
            Component library
          </Text>
        ) : null}
        {document && view === "studio" ? (
          <>
            <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 }}>
              {document.current.name}
            </Text>
            <View
              accessibilityLabel={draftMatchesActive ? "Draft is active" : "Draft has changes that are not active"}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 10,
                backgroundColor: c.surface1,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: draftMatchesActive ? c.statusSuccess : c.statusWarning,
                }}
              />
              <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>
                {draftMatchesActive ? "Active" : document.active ? "Not active yet" : "No active pack"}
              </Text>
            </View>
          </>
        ) : null}
      </View>
      {view === "studio" ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            flexWrap: "wrap",
            flexShrink: 1,
            maxWidth: "100%",
          }}
        >
          <StudioButton
            theme={theme}
            title="Undo"
            icon="Undo2"
            small
            iconOnly
            disabled={!document || busy || document.cursor === 0}
            onPress={() => dispatch({ type: "undo" })}
          />
          <StudioButton
            theme={theme}
            title="Redo"
            icon="Redo2"
            small
            iconOnly
            disabled={!document || busy || document.cursor >= document.history.length - 1}
            onPress={() => dispatch({ type: "redo" })}
          />
          <StudioButton
            theme={theme}
            title={document?.current.appearance === "light" ? "Switch to dark" : "Switch to light"}
            icon={document?.current.appearance === "light" ? "Sun" : "Moon"}
            small
            iconOnly
            disabled={!document || busy}
            onPress={() =>
              document &&
              dispatch({
                type: "patch",
                colors: {},
                appearance: document.current.appearance === "dark" ? "light" : "dark",
                label: "Change appearance",
              })
            }
          />
          <StudioButton
            theme={theme}
            title="Save pack"
            icon="Save"
            small
            iconOnly={stacked}
            disabled={!document || busy}
            onPress={() => openDialog("save")}
          />
          {designerButton}
          <StudioButton
            theme={theme}
            title={draftMatchesActive ? "Active" : "Activate"}
            icon="Check"
            primary
            small
            disabled={!document || busy || draftMatchesActive}
            onPress={() => void activatePack()}
          />
        </View>
      ) : null}
    </View>
  );

  const banner =
    error || query.error || notice ? (
      <View
        accessibilityRole={error || query.error ? "alert" : undefined}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
        }}
      >
        <Icon
          name={error || query.error ? "TriangleAlert" : "CircleCheck"}
          size={14}
          color={error || query.error ? c.statusDanger : c.statusSuccess}
        />
        <Text
          selectable
          style={{ flex: 1, color: error || query.error ? c.statusDanger : c.foreground, fontSize: 12, lineHeight: 18 }}
        >
          {error ?? (query.error ? messageFor(query.error) : notice)}
        </Text>
        {query.error ? (
          <StudioButton theme={theme} title="Retry" icon="RefreshCw" small onPress={() => void query.refetch()} />
        ) : null}
        <StudioButton
          theme={theme}
          title="Dismiss"
          icon="X"
          small
          iconOnly
          onPress={() => {
            setError(null);
            setNotice(null);
          }}
        />
      </View>
    ) : null;

  const canvas = document ? (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, padding: stacked ? 10 : 16, gap: 10 }}>
      <PaseoPreview
        theme={document.current}
        compact={layout.compact}
        scene={scene}
        onSceneChange={setScene}
        items={previewItems}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit colors"
          onPress={() => setInspector("colors")}
          style={{ flexDirection: "row", gap: 4 }}
        >
          {colorKeys.map(key => (
            <View
              key={key}
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: document.current.colors[key],
              }}
            />
          ))}
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
          Text {textRatio}:1 · {busy ? "Saving…" : query.error ? "Reconnecting" : "Draft synced"}
        </Text>
      </View>
    </View>
  ) : (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
      <Icon name="Palette" size={28} color={c.foregroundMuted} />
      <StudioLabel theme={theme} subdued>
        {query.isPending ? "Loading your pack…" : "The pack is unavailable. Refresh to reconnect."}
      </StudioLabel>
    </View>
  );

  const inspectorBody = document ? (
    <InspectorSections.Provider value={true}>
      {inspector === "colors" ? (
        <View style={{ paddingVertical: 14 }}>
          <PaletteInspector
            theme={theme}
            document={document}
            busy={busy}
            onCommit={commitColor}
            onLock={(key, locked) => dispatch({ type: "lock", key, locked })}
          />
        </View>
      ) : null}
      {inspector === "design" ? (
        <PackDesignInspector theme={theme} document={document} busy={busy} onPatch={patchUi} />
      ) : null}
      {inspector === "components" ? (
        <ComponentInspector
          theme={theme}
          selectedId={selectedComponent}
          onSelect={selectComponent}
          onOpenLibrary={() => setView("library")}
          onResetPreview={() => setComponentState({})}
        />
      ) : null}
      {inspector === "packs" ? (
        <>
          <StudioCard
            theme={theme}
            title="Active pack"
            description={document.active ? document.active.name : "No pack is active."}
          >
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <StudioButton
                theme={theme}
                title="Revert"
                icon="Undo2"
                small
                disabled={busy || !document.previousActive}
                onPress={() => dispatch({ type: "revert-active" })}
              />
              <StudioButton
                theme={theme}
                title="Disable"
                icon="Power"
                small
                disabled={busy || !document.active}
                onPress={() => dispatch({ type: "disable-pack" })}
              />
              {activePanelEnabled && props.onOpenPack ? (
                <StudioButton
                  theme={theme}
                  title="Open panel"
                  icon="PanelRightOpen"
                  small
                  disabled={busy || !packWorkspaceId}
                  onPress={() => void openPackPanel()}
                />
              ) : null}
            </View>
            {packChanges.length ? (
              <StudioLabel theme={theme} subdued>
                Activating updates {packChanges.join(", ").toLowerCase()}.
              </StudioLabel>
            ) : null}
          </StudioCard>
          <StudioCard
            theme={theme}
            title="Starting packs"
            description="Load a preset into the draft. Locked colors stay."
          >
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {presets.map(candidate => (
                <ThemeTile
                  key={candidate.id}
                  theme={theme}
                  candidate={candidate}
                  selected={document.current.id === candidate.id}
                  disabled={busy}
                  onPress={() => dispatch({ type: "preset", id: candidate.id })}
                />
              ))}
            </View>
          </StudioCard>
          <StudioCard theme={theme} title="Your library" description="Saved packs live on this Paseo host.">
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <StudioButton
                theme={theme}
                title="Favorites only"
                icon="Star"
                small
                active={filterFavorites}
                onPress={() => setFilterFavorites(!filterFavorites)}
              />
              <StudioLabel theme={theme} subdued>
                {libraryPacks.length} {libraryPacks.length === 1 ? "pack" : "packs"}
              </StudioLabel>
            </View>
            {libraryPacks.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {libraryPacks.map(candidate => (
                  <ThemeTile
                    key={candidate.id}
                    theme={theme}
                    candidate={candidate}
                    selected={document.current.id === candidate.id}
                    disabled={busy}
                    favorite={document.favorites.includes(candidate.id)}
                    onFavorite={() =>
                      dispatch({
                        type: document.favorites.includes(candidate.id) ? "unfavorite" : "favorite",
                        id: candidate.id,
                      })
                    }
                    onPress={() => dispatch({ type: "load", id: candidate.id })}
                    onDelete={() => dispatch({ type: "delete", id: candidate.id })}
                  />
                ))}
              </View>
            ) : (
              <StudioLabel theme={theme} subdued>
                {filterFavorites
                  ? "No favorite packs yet."
                  : "Your library is empty. Save this pack to keep a version."}
              </StudioLabel>
            )}
          </StudioCard>
          <StudioCard
            theme={theme}
            title="Share"
            description="Copy the pack as JSON, import one, or export a standalone plugin."
          >
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <StudioButton
                theme={theme}
                title="Import"
                icon="Upload"
                small
                disabled={busy}
                onPress={() => openDialog("import")}
              />
              <StudioButton theme={theme} title="Export" icon="Download" small onPress={() => openDialog("export")} />
            </View>
          </StudioCard>
        </>
      ) : null}
      {inspector === "history" ? (
        <View style={{ paddingVertical: 14, gap: 2 }}>
          <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>Draft history</Text>
          {[...document.history].reverse().map((entry, reverseIndex) => {
            const index = document.history.length - reverseIndex - 1;
            const current = index === document.cursor;
            return (
              <View
                key={`${entry.at}-${index}`}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 8,
                  marginHorizontal: -8,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 8,
                  backgroundColor: current ? c.surface2 : "transparent",
                  opacity: index > document.cursor ? 0.5 : 1,
                }}
              >
                <Icon
                  name={entry.source === "agent" ? "Bot" : entry.source === "preset" ? "Palette" : "Pencil"}
                  size={14}
                  color={current ? c.accent : c.foregroundMuted}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{ color: c.foreground, fontSize: 12, fontWeight: current ? "600" : "400" }}
                  >
                    {entry.label}
                  </Text>
                  <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>
                    {entry.source === "agent"
                      ? "Designer"
                      : entry.source === "preset"
                        ? "Preset"
                        : entry.source === "manual"
                          ? "You"
                          : "Studio"}{" "}
                    · {new Date(entry.at).toLocaleTimeString()}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </InspectorSections.Provider>
  ) : null;

  const inspectorPane = (
    <View
      style={
        stacked
          ? { borderTopWidth: 1, borderColor: c.border, flex: 1, minHeight: 0 }
          : { width: 360, borderLeftWidth: 1, borderColor: c.border, minHeight: 0 }
      }
    >
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 }}>
        <StudioSegments
          theme={theme}
          value={inspector}
          onChange={setInspector}
          options={[
            { value: "colors", label: "Colors" },
            { value: "design", label: "Design" },
            { value: "components", label: "Components" },
            { value: "packs", label: "Packs" },
            { value: "history", label: "History" },
          ]}
        />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
      >
        {inspectorBody}
        {!props.navigation ? (
          <StudioLabel theme={theme} subdued>
            Update the Paseo app to open the designer chat from this studio.
          </StudioLabel>
        ) : null}
      </ScrollView>
    </View>
  );

  return (
    <View
      testID="theme-studio"
      onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      style={{ flex: 1, minHeight: 0, backgroundColor: c.surface0 }}
    >
      {topBar}
      {banner}
      {view === "library" ? (
        <ComponentLibrarySurface {...props} />
      ) : stacked ? (
        <View style={{ flex: 1, minHeight: 0 }}>
          {/* Keep the preview large enough to read; the inspector scrolls below it. */}
          <View style={{ height: Math.max(340, Math.round(size.height * 0.56)) }}>{canvas}</View>
          {inspectorPane}
        </View>
      ) : (
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }}>
          {canvas}
          {inspectorPane}
        </View>
      )}

      <Modal
        title={
          dialog === "save"
            ? "Save pack"
            : dialog === "import"
              ? "Import pack"
              : dialog === "export"
                ? "Export pack"
                : "Designer model"
        }
        icon={<Icon name={dialog === "settings" ? "Settings2" : "Palette"} size={18} color={theme.colors.foreground} />}
        open={dialog !== null}
        onOpenChange={open => {
          if (!open) setDialog(null);
        }}
      >
        <Modal.Content>
          {dialog === "save" ? (
            <>
              <StudioLabel theme={theme} subdued>
                Keep the full theme and UI settings in your library. Activate pack applies your draft separately.
              </StudioLabel>
              <TextInput
                value={saveName}
                onChangeText={setSaveName}
                accessibilityLabel="Pack name"
                placeholder="Pack name"
                placeholderTextColor={theme.colors.foregroundMuted}
                maxLength={60}
                autoFocus
                onSubmitEditing={() => {
                  void saveTheme();
                }}
                style={inputStyle}
              />
              <StudioButton
                theme={theme}
                title={busy ? "Saving…" : "Save to library"}
                icon="Check"
                primary
                disabled={busy}
                onPress={() => {
                  void saveTheme();
                }}
              />
            </>
          ) : null}
          {dialog === "import" ? (
            <>
              <StudioLabel theme={theme} subdued>
                Paste a Theme Studio pack JSON export. Older palette exports use the default UI settings. Colors accept
                #RGB, #RRGGBB, or #RRGGBBAA.
              </StudioLabel>
              <TextInput
                value={json}
                onChangeText={setJson}
                accessibilityLabel="Pack JSON to import"
                multiline
                autoCorrect={false}
                autoCapitalize="none"
                placeholder={'{ "id": "my-theme", "name": "My theme", … }'}
                placeholderTextColor={theme.colors.foregroundMuted}
                style={{ ...inputStyle, minHeight: 220, textAlignVertical: "top", fontFamily: "monospace" }}
              />
              <StudioButton
                theme={theme}
                title="Import draft pack"
                icon="Upload"
                primary
                disabled={busy || !json.trim()}
                onPress={() => {
                  void importTheme();
                }}
              />
            </>
          ) : null}
          {dialog === "export" ? (
            <>
              <StudioLabel theme={theme} subdued>
                Export draft revision {exportRevision} as an independent Paseo plugin, or copy its JSON to share and
                import later.
              </StudioLabel>
              <StudioButton
                theme={theme}
                title={exporter.isPending ? "Building plugin…" : "Export plugin"}
                icon="Package"
                primary
                disabled={busy || Boolean(exporter.data)}
                onPress={() => exporter.mutate({ expectedRevision: exportRevision })}
              />
              {exporter.data ? (
                <StudioCard
                  theme={theme}
                  title="Plugin exported"
                  description="The source bundle is ready on this Paseo host. Install it when you choose."
                >
                  <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}>
                    <Icon
                      name={exporter.data.validation.typecheck ? "CircleCheck" : "TriangleAlert"}
                      size={14}
                      color={
                        exporter.data.validation.typecheck ? theme.colors.statusSuccess : theme.colors.statusWarning
                      }
                    />
                    <StudioLabel theme={theme}>
                      {exporter.data.validation.typecheck ? "Typecheck passed" : "Typecheck did not pass"}
                    </StudioLabel>
                  </View>
                  <StudioLabel theme={theme}>Directory</StudioLabel>
                  <Text
                    selectable
                    style={{ color: theme.colors.foreground, fontSize: 12, fontFamily: "monospace", lineHeight: 18 }}
                  >
                    {exporter.data.directory}
                  </Text>
                  <StudioLabel theme={theme} subdued>
                    {exporter.data.files.join(" · ")}
                  </StudioLabel>
                  <StudioLabel theme={theme}>Install command</StudioLabel>
                  <Text selectable style={{ ...inputStyle, fontFamily: "monospace", lineHeight: 19 }}>
                    {exporter.data.installCommand}
                  </Text>
                  <StudioButton
                    theme={theme}
                    title={copiedInstall ? "Install command copied" : "Copy install command"}
                    icon={copiedInstall ? "Check" : "Copy"}
                    small
                    onPress={() => {
                      void copyText(exporter.data!.installCommand)
                        .then(() => setCopiedInstall(true))
                        .catch(reason => setError(messageFor(reason)));
                    }}
                  />
                </StudioCard>
              ) : null}
              <StudioLabel theme={theme}>Pack JSON</StudioLabel>
              <Text
                selectable
                style={{
                  color: theme.colors.foreground,
                  fontFamily: "monospace",
                  fontSize: 12,
                  lineHeight: 19,
                  padding: 13,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface0,
                  borderRadius: 8,
                }}
              >
                {json}
              </Text>
              <StudioButton
                theme={theme}
                title="Copy JSON"
                icon="Copy"
                onPress={() => {
                  void copyText(json)
                    .then(() => {
                      setNotice("Pack JSON copied.");
                      setDialog(null);
                    })
                    .catch(reason => setError(`Could not copy. Select the JSON and use Copy. ${messageFor(reason)}`));
                }}
              />
            </>
          ) : null}
          {dialog === "settings" ? (
            <>
              <StudioLabel theme={theme} subdued>
                Choose the provider and model for a new pack designer session. The default is GPT-6.1 Sol through Codex
                with high reasoning. Existing sessions keep their model.
              </StudioLabel>
              <StudioLabel theme={theme}>Provider</StudioLabel>
              <TextInput
                accessibilityLabel="Designer provider"
                value={provider}
                onChangeText={next => {
                  // Keep a custom model, but follow the default when the user has not changed it.
                  if (model === defaultDesignerModel(provider.trim())) setModel(defaultDesignerModel(next.trim()));
                  setProvider(next);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
              />
              <StudioLabel theme={theme}>Model</StudioLabel>
              <TextInput
                accessibilityLabel="Designer model"
                value={model}
                onChangeText={setModel}
                autoCapitalize="none"
                autoCorrect={false}
                style={inputStyle}
              />
              <StudioButton theme={theme} title="Done" primary onPress={() => setDialog(null)} />
            </>
          ) : null}
          {error && dialog ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
              {error}
            </Text>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}
