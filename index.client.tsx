import type { PluginClientContext, PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ThemeStudio } from "./client/studio";
import { PackActivity, registerPackExtensions } from "./client/pack-runtime";
import { readStudio } from "./shared/rpc";
import type { StudioDocument, StudioTheme } from "./shared/theme";
import { registerComponents } from "./client/component-runtime";

export default function contribute(client: PluginClientContext) {
  let disposed = false;
  let busy = false;
  let themeSignature = "";
  let activeSignature = "";
  let panelSignature = "";
  let activePack: StudioTheme | null = null;
  let removeTheme: (() => void | Promise<void>) | undefined;
  let removePanel: (() => void | Promise<void>) | undefined;
  let removePanelCommand: (() => void | Promise<void>) | undefined;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  function useActivePack() {
    const [pack, setPack] = useState(activePack);
    useEffect(() => subscribe(() => setPack(activePack)), []);
    return pack;
  }
  function Activity(props: PluginWorkspacePanelProps) {
    const pack = useActivePack();
    if (!pack)
      return (
        <View style={{ flex: 1, padding: 20, backgroundColor: props.theme.colors.surface0 }}>
          <Text style={{ color: props.theme.colors.foregroundMuted }}>
            This pack is disabled. Activate a design from Theme Studio to restore its extensions.
          </Text>
        </View>
      );
    return <PackActivity theme={props.theme} workspaceId={props.workspaceId} pack={pack} />;
  }
  function updateActive(document: StudioDocument) {
    if (disposed) return;
    const pack = document.active;
    const next = JSON.stringify(pack ? { colors: pack.colors, appearance: pack.appearance } : null);
    if (next !== themeSignature) {
      void removeTheme?.();
      removeTheme = undefined;
      if (pack)
        removeTheme = client.addTheme({
          id: "live",
          name: "Theme Studio · Live",
          appearance: pack.appearance,
          colors: pack.colors,
        });
      themeSignature = next;
    }
    const panel =
      pack && (pack.ui.activityPanel || pack.ui.panel.enabled)
        ? {
            title: pack.ui.panel.enabled ? pack.ui.panel.title : "Pack activity",
            icon: pack.ui.panel.enabled ? pack.ui.panel.icon : "Activity",
          }
        : null;
    const nextPanel = JSON.stringify(panel);
    if (nextPanel !== panelSignature) {
      void removePanel?.();
      void removePanelCommand?.();
      removePanel = undefined;
      removePanelCommand = undefined;
      if (panel) {
        removePanel = client.addWorkspacePanel({
          id: "pack-panel",
          title: panel.title,
          icon: panel.icon,
          context: "workspace",
          locations: ["workspace", "explorer"],
          Component: Activity,
        });
        removePanelCommand = client.addCommandCenterItem({
          id: "open-pack-panel",
          title: "Open " + panel.title,
          icon: panel.icon,
          context: "workspace",
          keywords: ["pack", "design", "activity"],
          onSelect({ openPanel }) {
            openPanel("pack-panel", { location: "explorer" });
          },
        });
      }
      panelSignature = nextPanel;
    }
    const currentSignature = JSON.stringify(pack);
    if (currentSignature !== activeSignature) {
      activePack = pack;
      activeSignature = currentSignature;
      for (const listener of listeners) listener();
    }
  }
  const removeExtensions = registerPackExtensions(client, () => activePack, subscribe);
  const removeComponents = registerComponents(client);
  async function refresh() {
    if (disposed || busy) return;
    busy = true;
    try {
      updateActive(await client.rpc(readStudio, {}));
    } catch {
      /* The studio reports connection failures; retain the last active design. */
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => {
    void refresh();
  }, 800);
  void refresh();
  function openPreview(workspaceId: string, agentId: string) {
    client.openPanel("studio", { workspaceId, agentId, location: "explorer" });
  }
  function openPack(workspaceId: string, agentId?: string) {
    client.openPanel("pack-panel", { workspaceId, agentId, location: "explorer" });
  }
  const openStudio = () => client.openSurface("studio");
  function Surface(props: PluginSurfaceProps) {
    return (
      <ThemeStudio
        {...props}
        onOpenPreview={openPreview}
        onOpenPack={openPack}
        onOpenStudio={openStudio}
        autoOpenDesigner
      />
    );
  }
  function SettingsScreen(props: PluginSurfaceProps) {
    return <ThemeStudio {...props} onOpenPreview={openPreview} onOpenPack={openPack} onOpenStudio={openStudio} />;
  }
  function Panel(props: PluginWorkspacePanelProps) {
    return <ThemeStudio {...props} onOpenPreview={openPreview} onOpenPack={openPack} onOpenStudio={openStudio} />;
  }
  client.addSurface("studio", Surface);
  client.addSidebarItem({ id: "studio", title: "Theme Studio", icon: "Palette", surface: "studio" });
  client.addWorkspacePanel({
    id: "studio",
    title: "Theme Studio",
    icon: "Palette",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: Panel,
  });
  client.addSettingsScreen({ id: "studio", title: "Theme Studio", icon: "Palette", Component: SettingsScreen });
  client.addCommandCenterItem({
    id: "open-studio",
    title: "Open Theme Studio",
    icon: "Palette",
    keywords: ["theme", "palette", "appearance", "pack", "components"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("studio");
    },
  });
  client.addCommandCenterItem({
    id: "open-preview",
    title: "Theme Studio: preview beside chat",
    icon: "PanelsTopLeft",
    keywords: ["theme", "preview", "pack"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("studio", { location: "explorer" });
    },
  });
  client.addSlashCommand({
    name: "theme",
    description: "Open the design pack preview beside this chat",
    argumentHint: "",
    context: "agent",
    onSubmit({ openPanel }) {
      openPanel("studio", { location: "explorer" });
    },
  });
  return async () => {
    disposed = true;
    clearInterval(timer);
    await removeComponents();
    await removeExtensions();
    await removePanelCommand?.();
    await removePanel?.();
    await removeTheme?.();
    listeners.clear();
  };
}
