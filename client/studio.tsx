import type { PluginAgentPanelProps, PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { contrastRatio } from "../shared/color";
import { contrastReport } from "../shared/contrast";
import { PaseoPreview } from "./preview";
import { PaletteInspector } from "./studio-inspector";
import { PackDesignInspector } from "./studio-design";
import { PackNote, PackToolCard, RecipePanel } from "./pack-runtime";
import { previewPluginTheme } from "./preview-colors";
import { StudioButton, StudioCard, StudioLabel } from "./studio-ui";
import { ComponentLibrarySurface } from "./component-library";

export type StudioProps = (PluginSurfaceProps | PluginWorkspacePanelProps | PluginAgentPanelProps) & {
  onOpenPreview?: (workspaceId: string, agentId: string) => void | Promise<void>;
  onOpenPack?: (workspaceId: string, agentId?: string) => void | Promise<void>;
};
type Tab = "preview" | "colors" | "design" | "components" | "presets" | "history";
type Scene = "chat" | "changes" | "terminal";
type Dialog = "save" | "import" | "export" | "settings" | null;
export const studioQueryKey = ["theme-studio-document"] as const;
const studioViews = new Map<string, { tab: Tab; scene: Scene; filterFavorites?: boolean }>();

const tabs: { id: Tab; title: string; icon: string }[] = [
  { id: "preview", title: "Preview", icon: "PanelsTopLeft" },
  { id: "colors", title: "Colors", icon: "SlidersHorizontal" },
  { id: "design", title: "Design", icon: "LayoutTemplate" },
  { id: "components", title: "Components", icon: "Blocks" },
  { id: "presets", title: "Presets", icon: "Palette" },
  { id: "history", title: "History", icon: "History" },
];

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function DesignerStatus({ theme, agentId }: { theme: PluginTheme; agentId: string }) {
  const state = useAgent(agentId, agent => ({ status: agent.status, attention: agent.requiresAttention }));
  const label = !state
    ? "Session available"
    : state.attention
      ? "Needs your attention"
      : state.status === "running"
        ? "Designer working"
        : state.status === "idle"
          ? "Ready for your next change"
          : state.status === "closed"
            ? "Session closed"
            : state.status === "error"
              ? "Designer needs attention"
              : "Starting designer";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor:
            state?.status === "error" || state?.attention ? theme.colors.statusWarning : theme.colors.statusSuccess,
        }}
      />
      <StudioLabel theme={theme} subdued>
        {label}
      </StudioLabel>
    </View>
  );
}

function PaletteStrip({
  theme,
  document,
  onSelect,
}: {
  theme: PluginTheme;
  document: StudioDocument;
  onSelect: () => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 18, padding: 15 }}
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
        flexGrow: 0,
      }}
    >
      {colorKeys.map(key => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={`Inspect ${colorLabels[key]} ${document.current.colors[key]}`}
          onPress={onSelect}
          style={{ gap: 7, minWidth: 69 }}
        >
          <View
            style={{
              height: 32,
              width: 32,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 7,
              backgroundColor: document.current.colors[key],
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {document.locks.includes(key) ? (
              <Icon
                name="LockKeyhole"
                size={12}
                color={
                  contrastRatio(document.current.colors.foreground, document.current.colors[key]) >= 3
                    ? document.current.colors.foreground
                    : document.current.colors.background
                }
              />
            ) : null}
          </View>
          <Text style={{ color: theme.colors.foreground, fontSize: 11 }}>{colorLabels[key]}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontFamily: "monospace" }}>
            {document.current.colors[key].toUpperCase()}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
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
        width: 190,
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
                width: 28,
                height: 28,
                borderRadius: 14,
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
  const [tab, setTabState] = useState<Tab>(() => studioViews.get(viewKey)?.tab ?? "preview");
  const [scene, setSceneState] = useState<Scene>(() => studioViews.get(viewKey)?.scene ?? "chat");
  function setTab(next: Tab) {
    studioViews.set(viewKey, { ...studioViews.get(viewKey), tab: next, scene });
    setTabState(next);
  }
  function setScene(next: Scene) {
    studioViews.set(viewKey, { ...studioViews.get(viewKey), tab, scene: next });
    setSceneState(next);
  }
  const [filterFavorites, setFilterFavoritesState] = useState(() => studioViews.get(viewKey)?.filterFavorites ?? false);
  function setFilterFavorites(next: boolean) {
    studioViews.set(viewKey, { tab, scene, filterFavorites: next });
    setFilterFavoritesState(next);
  }
  const [width, setWidth] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saveName, setSaveName] = useState("");
  const [json, setJson] = useState("");
  const [exportRevision, setExportRevision] = useState(0);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [provider, setProvider] = useState(defaultDesignerProvider);
  const [model, setModel] = useState(() => defaultDesignerModel(defaultDesignerProvider));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const compact = layout.compact || (width > 0 && width < 820);
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

  const designer = useMutation({
    mutationFn: start,
    onSuccess: async result => {
      await query.refetch();
      try {
        props.navigation?.openAgent({ agentId: result.agentId, serverId: props.host.id });
        await props.onOpenPreview?.(result.workspaceId, result.agentId);
        setNotice("The designer chat is open. Describe your changes there; this preview follows its edits.");
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
        "Pack activated. Its extensions are enabled. Select Theme Studio · Live in Settings → Appearance once to use the pack's colors.",
      );
    } catch {
      /* The mutation reports its error. */
    }
  }

  function openDesigner() {
    setError(null);
    designer.mutate({ workspaceId, provider: provider.trim() || undefined, model: model.trim() || undefined });
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
      setNotice("Pack saved to your library. Activate pack applies the draft to Paseo.");
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
      setNotice("Pack imported into the draft. Locked colors were preserved. Activate it when ready.");
    } catch {
      /* The mutation reports its error. */
    }
  }

  const busy = update.isPending || exporter.isPending;
  const dirty = document ? JSON.stringify(document.current) !== JSON.stringify(document.baseline) : false;
  const savedToLibrary =
    document?.saved.some(saved => JSON.stringify(saved) === JSON.stringify(document.current)) ?? false;
  const libraryPacks =
    document?.saved.filter(candidate => !filterFavorites || document.favorites.includes(candidate.id)) ?? [];
  const packChanges = document ? describePackChanges(document.current, document.active) : [];
  const draftMatchesActive = Boolean(document?.active) && packChanges.length === 0;
  const draftTheme = document ? previewPluginTheme(document.current) : theme;
  const packWorkspaceId = workspaceId ?? document?.designerWorkspaceId;
  const activePanelEnabled = Boolean(
    document?.active && (document.active.ui.activityPanel || document.active.ui.panel.enabled),
  );
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

  const preview = document ? (
    <View style={{ gap: 12, flex: 1, minWidth: 0 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name="Monitor" size={14} color={theme.colors.foregroundMuted} />
          <StudioLabel theme={theme} subdued>
            Draft preview
          </StudioLabel>
        </View>
        <View style={{ flexDirection: "row", gap: 5 }}>
          {(["chat", "changes", "terminal"] as Scene[]).map(item => (
            <StudioButton
              key={item}
              theme={theme}
              title={item === "chat" ? "Agent" : item === "changes" ? "Changes" : "Terminal"}
              small
              active={scene === item}
              onPress={() => setScene(item)}
            />
          ))}
        </View>
      </View>
      <PaseoPreview theme={document.current} compact={compact} scene={scene} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: draftMatchesActive ? theme.colors.statusSuccess : theme.colors.statusWarning,
            }}
          />
          <StudioLabel theme={theme}>{document.current.name}</StudioLabel>
          <StudioLabel theme={theme} subdued>
            · {savedToLibrary ? "Saved to library" : dirty ? "Edited draft" : "Draft pack"}
          </StudioLabel>
        </View>
        <StudioLabel theme={theme} subdued>
          Workspace text{" "}
          {contrastReport(document.current.colors, document.current.appearance)
            .checks.find(
              check =>
                check.foreground === "foreground" &&
                check.background === (document.current.appearance === "dark" ? "raised" : "background"),
            )!
            .ratio.toFixed(1)}
          :1
        </StudioLabel>
      </View>
      <PaletteStrip theme={theme} document={document} onSelect={() => setTab("colors")} />
    </View>
  ) : null;

  return (
    <View
      testID="theme-studio"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}
    >
      <View
        style={{
          paddingHorizontal: inPanel ? 12 : compact ? 16 : 24,
          paddingTop: inPanel ? 10 : compact ? 16 : 21,
          paddingBottom: inPanel ? 10 : 16,
          gap: inPanel ? 7 : 13,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: inPanel ? 8 : 12,
            flexWrap: "wrap",
          }}
        >
          <View style={{ flexDirection: "row", gap: 11, alignItems: "center", flexShrink: 1, maxWidth: "100%" }}>
            {!inPanel ? (
              <View style={{ padding: 9, borderRadius: 10, backgroundColor: theme.colors.surface2 }}>
                <Icon name="Palette" size={20} color={theme.colors.accent} />
              </View>
            ) : null}
            <View style={{ gap: 3, flexShrink: 1 }}>
              <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: inPanel ? 16 : 19 }}>
                Theme Studio
              </Text>
              {!inPanel ? (
                <StudioLabel theme={theme} subdued>
                  Create themes and UI packs in the designer's Paseo chat.
                </StudioLabel>
              ) : null}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: inPanel ? 5 : 7, alignItems: "center", flexWrap: "wrap" }}>
            <StudioButton
              theme={theme}
              title="Undo"
              icon="Undo2"
              small
              iconOnly={inPanel}
              disabled={!document || busy || document.cursor === 0}
              onPress={() => dispatch({ type: "undo" })}
            />
            <StudioButton
              theme={theme}
              title="Redo"
              icon="Redo2"
              small
              iconOnly={inPanel}
              disabled={!document || busy || document.cursor >= document.history.length - 1}
              onPress={() => dispatch({ type: "redo" })}
            />
            <StudioButton
              theme={theme}
              title="Save pack"
              icon="Save"
              small={inPanel}
              iconOnly={inPanel}
              disabled={!document || busy}
              onPress={() => openDialog("save")}
            />
            {!inPanel ? (
              <StudioButton
                theme={theme}
                title={draftMatchesActive ? "Pack active" : "Activate pack"}
                icon="Check"
                primary
                disabled={!document || busy || draftMatchesActive}
                onPress={() => {
                  void activatePack();
                }}
              />
            ) : null}
          </View>
        </View>
        {inPanel ? (
          document?.designerAgentId ? (
            <DesignerStatus theme={theme} agentId={document.designerAgentId} />
          ) : (
            <View style={{ flexDirection: "row", gap: 7 }}>
              <StudioButton
                theme={theme}
                title={designer.isPending ? "Starting…" : "Start designer"}
                icon="ArrowUpRight"
                small
                disabled={!document || designer.isPending || !props.navigation}
                onPress={() => {
                  void openDesigner();
                }}
              />
              <StudioButton theme={theme} title="Model" icon="Settings2" small onPress={() => openDialog("settings")} />
            </View>
          )
        ) : (
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <View style={{ gap: 4, flex: 1, minWidth: 170 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Icon name="Bot" size={14} color={theme.colors.foregroundMuted} />
                <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>Pack designer</Text>
              </View>
              {document?.designerAgentId ? (
                workspaceId ? (
                  <DesignerStatus theme={theme} agentId={document.designerAgentId} />
                ) : (
                  <StudioLabel theme={theme} subdued>
                    Session saved. Open the designer chat to continue.
                  </StudioLabel>
                )
              ) : (
                <StudioLabel theme={theme} subdued>
                  Start a real agent session to design this theme and UI pack.
                </StudioLabel>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <StudioButton theme={theme} title="Model" icon="Settings2" small onPress={() => openDialog("settings")} />
              <StudioButton
                theme={theme}
                title={
                  designer.isPending ? "Starting…" : document?.designerAgentId ? "Open designer chat" : "Start designer"
                }
                icon="ArrowUpRight"
                small
                disabled={!document || designer.isPending || !props.navigation}
                onPress={() => {
                  void openDesigner();
                }}
              />
            </View>
          </View>
        )}
        {inPanel ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1 }}>
              <View
                style={{
                  height: 6,
                  width: 6,
                  borderRadius: 3,
                  backgroundColor: document?.active ? theme.colors.statusSuccess : theme.colors.foregroundMuted,
                }}
              />
              <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
                {document?.active ? `Active · ${document.active.name}` : "No active pack"}
              </Text>
            </View>
            <StudioButton
              theme={theme}
              title={draftMatchesActive ? "Pack active" : "Activate pack"}
              icon="Check"
              primary
              small
              disabled={!document || busy || draftMatchesActive}
              onPress={() => {
                void activatePack();
              }}
            />
          </View>
        ) : null}
        {!props.navigation ? (
          <StudioLabel theme={theme} subdued>
            Update the Paseo app to open the designer chat from this studio.
          </StudioLabel>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: 1, borderColor: theme.colors.border }}
        contentContainerStyle={{ paddingHorizontal: inPanel ? 12 : compact ? 16 : 24, gap: compact ? 10 : 24 }}
      >
        {tabs.map(item => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityState={{ selected: tab === item.id }}
            onPress={() => setTab(item.id)}
            style={{
              paddingVertical: inPanel ? 11 : 14,
              flexDirection: "row",
              alignItems: "center",
              gap: compact ? 4 : 7,
              borderBottomWidth: 2,
              borderColor: tab === item.id ? theme.colors.accent : "transparent",
            }}
          >
            {!compact ? (
              <Icon
                name={item.icon}
                size={14}
                color={tab === item.id ? theme.colors.foreground : theme.colors.foregroundMuted}
              />
            ) : null}
            <Text
              style={{
                color: tab === item.id ? theme.colors.foreground : theme.colors.foregroundMuted,
                fontSize: compact ? 12 : 13,
                fontWeight: tab === item.id ? "600" : "400",
              }}
            >
              {item.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === "components" ? (
        <ComponentLibrarySurface {...props} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: compact ? 16 : 24, gap: 17 }}
        >
          {error || query.error ? (
            <View
              accessibilityRole="alert"
              style={{
                padding: 13,
                gap: 10,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: theme.colors.statusDanger,
                backgroundColor: theme.colors.surface1,
              }}
            >
              <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
                {error ?? messageFor(query.error)}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
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
                padding: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 9,
                flexDirection: "row",
                gap: 8,
              }}
            >
              <Icon name="CircleCheck" size={15} color={theme.colors.statusSuccess} />
              <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>{notice}</Text>
            </View>
          ) : null}
          {!document ? (
            <View style={{ paddingVertical: 60, alignItems: "center", gap: 12 }}>
              <Icon name="Palette" size={28} color={theme.colors.foregroundMuted} />
              <StudioLabel theme={theme} subdued>
                {query.isPending ? "Loading your pack…" : "The pack is unavailable. Refresh to reconnect."}
              </StudioLabel>
            </View>
          ) : (
            <>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <View style={{ flexDirection: "row", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "500" }}>
                    {document.current.name}
                  </Text>
                  <StudioButton
                    theme={theme}
                    small
                    title={document.current.appearance === "dark" ? "Dark" : "Light"}
                    icon={document.current.appearance === "dark" ? "Moon" : "Sun"}
                    disabled={busy}
                    onPress={() =>
                      dispatch({
                        type: "patch",
                        colors: {},
                        appearance: document.current.appearance === "dark" ? "light" : "dark",
                        label: "Change appearance",
                      })
                    }
                  />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: query.error ? theme.colors.statusWarning : theme.colors.statusSuccess,
                    }}
                  />
                  <StudioLabel theme={theme} subdued>
                    {busy ? "Saving edit" : query.error ? "Reconnecting" : "Draft synced"} · r{document.revision}
                  </StudioLabel>
                  <StudioButton
                    theme={theme}
                    title="Import"
                    icon="Upload"
                    small
                    disabled={busy}
                    onPress={() => openDialog("import")}
                  />
                  <StudioButton
                    theme={theme}
                    title="Export"
                    icon="Download"
                    small
                    onPress={() => openDialog("export")}
                  />
                </View>
              </View>
              <View
                style={{
                  padding: 12,
                  borderRadius: 9,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                  <Icon
                    name={draftMatchesActive ? "CircleCheck" : "Layers"}
                    size={14}
                    color={draftMatchesActive ? theme.colors.statusSuccess : theme.colors.foregroundMuted}
                  />
                  <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>
                    {draftMatchesActive ? "Draft matches the active pack" : "Draft preview only"}
                  </Text>
                  {!inPanel ? (
                    <StudioLabel theme={theme} subdued>
                      {document.active ? `Active · ${document.active.name}` : "No active pack"}
                    </StudioLabel>
                  ) : null}
                </View>
                {packChanges.length ? (
                  <StudioLabel theme={theme} subdued>
                    Activate to update {packChanges.join(", ").toLowerCase()}.
                  </StudioLabel>
                ) : null}
                {tab === "design" ? (
                  <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap", paddingTop: 3 }}>
                    <StudioButton
                      theme={theme}
                      title="Revert pack"
                      icon="Undo2"
                      small
                      disabled={busy || !document.previousActive}
                      onPress={() => dispatch({ type: "revert-active" })}
                    />
                    <StudioButton
                      theme={theme}
                      title="Disable pack"
                      icon="Power"
                      small
                      disabled={busy || !document.active}
                      onPress={() => dispatch({ type: "disable-pack" })}
                    />
                    {activePanelEnabled && props.onOpenPack ? (
                      <StudioButton
                        theme={theme}
                        title="Open pack panel"
                        icon="PanelRightOpen"
                        small
                        disabled={busy || !packWorkspaceId}
                        onPress={() => {
                          void openPackPanel();
                        }}
                      />
                    ) : null}
                  </View>
                ) : null}
                {tab === "design" && activePanelEnabled && !packWorkspaceId ? (
                  <StudioLabel theme={theme} subdued>
                    Open a workspace or start the designer to view the pack panel.
                  </StudioLabel>
                ) : null}
              </View>
              {tab === "preview" ? preview : null}
              {tab === "colors" ? (
                <View style={{ flexDirection: compact ? "column" : "row", gap: 22, alignItems: "stretch" }}>
                  {!compact ? preview : null}
                  <View
                    style={{
                      width: compact ? "100%" : 340,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: 12,
                      backgroundColor: theme.colors.surface1,
                    }}
                  >
                    <PaletteInspector
                      theme={theme}
                      document={document}
                      busy={busy}
                      onCommit={commitColor}
                      onLock={(key, locked) => dispatch({ type: "lock", key, locked })}
                    />
                  </View>
                  {compact ? preview : null}
                </View>
              ) : null}
              {tab === "design" ? (
                <View style={{ flexDirection: compact ? "column" : "row", gap: 22, alignItems: "flex-start" }}>
                  {compact ? (
                    <View style={{ width: "100%" }}>
                      <PackDesignInspector theme={theme} document={document} busy={busy} onPatch={patchUi} />
                    </View>
                  ) : null}
                  <View
                    style={{ flex: compact ? undefined : 1, width: compact ? "100%" : undefined, minWidth: 0, gap: 17 }}
                  >
                    {preview}
                    <StudioCard
                      theme={theme}
                      title="Draft extensions"
                      description="These pack-owned components use your typography, spacing, and card styles."
                    >
                      <View
                        style={{ padding: 13, backgroundColor: draftTheme.colors.surface0, borderRadius: 10, gap: 14 }}
                      >
                        <PackNote
                          theme={draftTheme}
                          pack={document.current}
                          text="A note from your pack. Keep the workspace focused and readable."
                        />
                        {document.current.ui.toolCards !== "native" ? (
                          <PackToolCard
                            theme={draftTheme}
                            pack={document.current}
                            data={{
                              label: "npm run check",
                              kind: "shell",
                              command: "npm run check",
                              output: "All checks passed.",
                              exitCode: 0,
                            }}
                            initiallyExpanded
                          />
                        ) : (
                          <StudioLabel theme={theme} subdued>
                            Completed shell tools keep Paseo's native cards.
                          </StudioLabel>
                        )}
                        {document.current.ui.panel.enabled ? (
                          <RecipePanel theme={draftTheme} pack={document.current} />
                        ) : null}
                      </View>
                    </StudioCard>
                  </View>
                  {!compact ? (
                    <View style={{ width: 360 }}>
                      <PackDesignInspector theme={theme} document={document} busy={busy} onPatch={patchUi} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              {tab === "presets" ? (
                <>
                  <StudioCard
                    theme={theme}
                    title="Starting packs"
                    description="Load a draft, then ask the designer for palette and UI changes. Locked colors stay in place."
                  >
                    <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
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
                  <StudioCard
                    theme={theme}
                    title="Your library"
                    description="Saved theme and UI packs live on this Paseo host."
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
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
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
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
                          ? "No favorite packs yet. Show all packs and star the ones you want to keep handy."
                          : "Your library is empty. Save this pack to keep a named version."}
                      </StudioLabel>
                    )}
                    <StudioLabel theme={theme} subdued>
                      Load any saved pack into the draft, then activate it when ready.
                    </StudioLabel>
                  </StudioCard>
                </>
              ) : null}
              {tab === "history" ? (
                <StudioCard
                  theme={theme}
                  title="Draft history"
                  description="Undo and redo move through draft edits. Activation stays separate; locked colors remain protected."
                >
                  {[...document.history].reverse().map((entry, reverseIndex) => {
                    const index = document.history.length - reverseIndex - 1;
                    const current = index === document.cursor;
                    return (
                      <View
                        key={`${entry.at}-${index}`}
                        style={{
                          paddingVertical: 10,
                          flexDirection: "row",
                          gap: 12,
                          borderBottomWidth: 1,
                          borderColor: theme.colors.border,
                          opacity: index > document.cursor ? 0.5 : 1,
                        }}
                      >
                        <View
                          style={{
                            height: 28,
                            width: 28,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: theme.colors.surface2,
                            borderRadius: 8,
                          }}
                        >
                          <Icon
                            name={entry.source === "agent" ? "Bot" : entry.source === "preset" ? "Palette" : "Pencil"}
                            size={14}
                            color={current ? theme.colors.accent : theme.colors.foregroundMuted}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text
                            style={{
                              color: theme.colors.foreground,
                              fontSize: 13,
                              fontWeight: current ? "600" : "400",
                            }}
                          >
                            {entry.label}
                          </Text>
                          <StudioLabel theme={theme} subdued>
                            {entry.source === "agent"
                              ? "Designer"
                              : entry.source === "preset"
                                ? "Preset"
                                : entry.source === "manual"
                                  ? "You"
                                  : "Studio"}{" "}
                            · {new Date(entry.at).toLocaleTimeString()} · {entry.theme.name}
                          </StudioLabel>
                        </View>
                        {current ? <StudioLabel theme={theme}>Current</StudioLabel> : null}
                      </View>
                    );
                  })}
                </StudioCard>
              ) : null}
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <Icon name="Info" size={14} color={theme.colors.foregroundMuted} />
                <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 17 }}>
                  Activate applies the draft pack. Select Theme Studio · Live in Settings → Appearance once for its
                  colors. UI styles apply to pack-owned timeline extensions and panels. Change global fonts in Settings
                  → Appearance → Fonts.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
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
