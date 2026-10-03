import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { StudioTheme } from "../shared/theme";
import { PreviewActivity, type PreviewTimelineItem } from "./preview";
import { previewColors, previewPluginTheme, type PreviewColors } from "./preview-colors";
import { PackToolCard } from "./pack-runtime";

// A compact, interactive miniature of the Paseo phone app, painted with the draft pack.
type ColorProps = { c: PreviewColors };
const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const projects = [
  { name: "theme-creator", badge: "#3f7a6b", sessions: [{ title: "Pack designer", status: "running" as const }] },
  {
    name: "website",
    badge: "#4a6fa5",
    sessions: [
      { title: "Navigation review", status: "idle" as const },
      { title: "Fix footer links", status: "idle" as const },
    ],
  },
  {
    name: "paseo-api",
    badge: "#a0613f",
    sessions: [{ title: "Refactor auth middleware", status: "attention" as const }],
  },
];

function Glyph({ name, c, size = 14, color }: ColorProps & { name: string; size?: number; color?: string }) {
  return <Icon name={name} size={size} color={color ?? c.mutedForeground} />;
}

function Label({
  c,
  children,
  muted = false,
  size = 12,
}: ColorProps & { children: ReactNode; muted?: boolean; size?: number }) {
  return (
    <Text
      numberOfLines={1}
      style={{ color: muted ? c.mutedForeground : c.foreground, fontSize: size, lineHeight: size + 6, flexShrink: 1 }}
    >
      {children}
    </Text>
  );
}

function IconButton({
  c,
  name,
  label,
  onPress,
  active = false,
}: ColorProps & { name: string; label: string; onPress?: () => void; active?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [s.iconButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Glyph name={name} c={c} size={15} color={active ? c.foreground : c.mutedForeground} />
    </Pressable>
  );
}

function Code({ c, children }: ColorProps & { children: string }) {
  return (
    <Text style={{ fontFamily: mono, fontSize: 10.5, backgroundColor: c.control, color: c.foreground }}>
      {` ${children} `}
    </Text>
  );
}

function ToolRow({ c, icon, name, detail }: ColorProps & { icon: string; name: string; detail: string }) {
  return (
    <View style={s.toolRow}>
      <Glyph name={icon} c={c} size={12} />
      <Text numberOfLines={1} style={{ fontSize: 12, color: c.mutedForeground, flexShrink: 1 }}>
        <Text style={{ color: c.foreground }}>{name}</Text> {detail}
      </Text>
    </View>
  );
}

function Header({
  c,
  title,
  hasPanel,
  panelOpen,
  onMenu,
  onPanel,
}: ColorProps & { title: string; hasPanel: boolean; panelOpen: boolean; onMenu: () => void; onPanel: () => void }) {
  return (
    <View>
      <View style={s.header}>
        <IconButton c={c} name="Menu" label="Open navigation drawer" onPress={onMenu} />
        <View style={s.flex}>
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "500" }}>
            {title}
          </Text>
          <View style={s.row}>
            <Label c={c} muted size={10}>
              website
            </Label>
            <Text style={{ color: c.mutedForeground, fontSize: 10 }}>·</Text>
            <Glyph name="Server" c={c} size={10} />
            <Label c={c} muted size={10}>
              omarchy
            </Label>
          </View>
        </View>
        <IconButton c={c} name="Ellipsis" label="More actions" />
        <IconButton
          c={c}
          name="PanelRight"
          label={hasPanel ? "Toggle pack panel" : "Panel unavailable in this theme"}
          onPress={hasPanel ? onPanel : undefined}
          active={panelOpen}
        />
      </View>
      <View style={[s.agentRow, { borderBottomColor: c.border }]}>
        <Glyph name="Sparkles" c={c} size={13} color={c.foreground} />
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flex: 1 }}>
          Theme designer
        </Text>
        <Glyph name="ChevronDown" c={c} size={13} />
      </View>
    </View>
  );
}

function Composer({ c, onSubmit }: ColorProps & { onSubmit: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  function submit() {
    if (!draft.trim()) return;
    onSubmit(draft.trim());
    setDraft("");
  }
  const ready = draft.trim().length > 0;
  return (
    <View style={[s.composer, { backgroundColor: c.workspace, borderColor: focused ? c.ring : c.border }]}>
      <TextInput
        accessibilityLabel="Preview message. Messages only appear in this demo."
        multiline
        placeholder="Message, @files, /commands"
        placeholderTextColor={c.mutedForeground}
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={submit}
        style={[s.composerInput, { color: c.foreground }]}
      />
      <View style={s.composerFooter}>
        <Glyph name="Plus" c={c} size={15} />
        <Glyph name="Sparkles" c={c} size={12} color={c.foreground} />
        <Text numberOfLines={1} style={{ fontSize: 11, color: c.foreground, flexShrink: 1 }}>
          GPT-6.1-Sol <Text style={{ color: c.mutedForeground }}>High</Text>
        </Text>
        <View style={s.flex} />
        <Glyph name="Mic" c={c} size={13} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send simulated preview message"
          accessibilityState={{ disabled: !ready }}
          onPress={submit}
          disabled={!ready}
          style={({ pressed }) => [
            s.sendButton,
            { backgroundColor: ready ? c.accent : "transparent", opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Glyph
            name={ready ? "ArrowUp" : "AudioLines"}
            c={c}
            size={13}
            color={ready ? c.accentForeground : c.mutedForeground}
          />
        </Pressable>
      </View>
    </View>
  );
}

function Chat({
  c,
  pack,
  items,
  compact,
}: ColorProps & { pack: StudioTheme; items: PreviewTimelineItem[]; compact: boolean }) {
  const [messages, setMessages] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (items.length) scrollRef.current?.scrollToEnd({ animated: true });
  }, [items.map(item => item.key).join("|")]);
  return (
    <View style={s.flex}>
      <ScrollView
        ref={scrollRef}
        style={s.flex}
        contentContainerStyle={s.chatContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (messages.length) scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        <View style={[s.userBubble, { backgroundColor: c.bubble }]}>
          <Text style={{ color: c.foreground, fontSize: 12, lineHeight: 18 }}>
            Review the navigation and fix the active states.
          </Text>
        </View>
        <Text style={[s.assistantText, { color: c.foreground }]}>
          I'll check the sidebar items, then fix how the selected workspace is highlighted:
        </Text>
        <View style={s.bullets}>
          {["Selected rows use the control color", "Hover and pressed states share one surface"].map(line => (
            <View key={line} style={s.bulletRow}>
              <Text style={{ color: c.mutedForeground, fontSize: 12 }}>•</Text>
              <Text style={[s.assistantText, s.flex, { color: c.foreground }]}>{line}</Text>
            </View>
          ))}
        </View>
        <View>
          <ToolRow c={c} icon="Wrench" name="Read" detail="src/navigation.tsx" />
          <ToolRow c={c} icon="Search" name="Search" detail="isActive surface" />
          <ToolRow c={c} icon="Pencil" name="Edit" detail="src/sidebar.tsx" />
          <ToolRow c={c} icon="SquareTerminal" name="Shell" detail="npm run check" />
        </View>
        {pack.ui.toolCards !== "native" ? (
          <PackToolCard
            theme={previewPluginTheme(pack)}
            pack={pack}
            data={{
              label: "Run npm run check",
              kind: "shell",
              command: "npm run check",
              output: "✓ Typecheck passed\n✓ 4 navigation tests passed",
              exitCode: 0,
            }}
            initiallyExpanded
          />
        ) : null}
        {items.map(item => (
          <View key={item.key}>{item.node}</View>
        ))}
        <View style={[s.divider, { backgroundColor: c.border }]} />
        <Text style={[s.assistantText, { color: c.foreground }]}>
          The selected workspace now uses <Code c={c}>c.control</Code> and all four navigation tests pass.
        </Text>
        <View style={[s.row, { gap: 12, marginTop: 4 }]}>
          <Glyph name="Copy" c={c} size={12} />
          <Glyph name="GitFork" c={c} size={12} />
          <Label c={c} muted size={11}>
            Worked for 8s
          </Label>
        </View>
        {messages.map((message, index) => (
          <View key={index} style={{ gap: 12 }}>
            <View style={[s.userBubble, { backgroundColor: c.bubble }]}>
              <Text style={{ color: c.foreground, fontSize: 12, lineHeight: 18 }}>{message}</Text>
            </View>
            <Text style={[s.assistantText, { color: c.foreground }]}>
              This is a preview conversation. Your palette is shown across the drawer, messages, tools, and composer.
            </Text>
          </View>
        ))}
      </ScrollView>
      {/* Short preview windows leave the room to the conversation. */}
      <View style={[s.composerWrap, compact && { display: "none" }]}>
        <View style={[s.skillsPill, { borderColor: c.border }]}>
          <Glyph name="Sparkles" c={c} size={11} />
          <Label c={c} muted size={11}>
            Skills 79
          </Label>
        </View>
        <Composer c={c} onSubmit={text => setMessages(previous => [...previous, text])} />
      </View>
    </View>
  );
}

function Drawer({
  c,
  selected,
  onSelect,
  onClose,
}: ColorProps & { selected: string; onSelect: (title: string) => void; onClose: () => void }) {
  return (
    <View style={s.overlay} testID="paseo-mobile-drawer">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close navigation drawer"
        onPress={onClose}
        style={[s.backdrop, { backgroundColor: "#00000088" }]}
      />
      <View style={[s.drawer, { backgroundColor: c.sidebar, borderRightColor: c.border }]}>
        <View style={s.drawerNav}>
          {[
            ["Plus", "New workspace"],
            ["History", "History"],
            ["Search", "Search"],
            ["CalendarClock", "Schedules"],
            ["Palette", "Theme Studio"],
          ].map(([icon, label]) => (
            <View key={label} style={s.navRow}>
              <Glyph name={icon} c={c} size={14} />
              <Label c={c} muted size={12}>
                {label}
              </Label>
            </View>
          ))}
          <View style={s.closeButton}>
            <IconButton c={c} name="X" label="Close drawer" onPress={onClose} />
          </View>
        </View>
        <View style={[s.divider, { backgroundColor: c.border }]} />
        <View style={s.sectionTitle}>
          <Label c={c} muted size={10}>
            Workspaces
          </Label>
          <Glyph name="SlidersHorizontal" c={c} size={11} />
        </View>
        <ScrollView style={s.flex} showsVerticalScrollIndicator={false}>
          {projects.map(project => (
            <View key={project.name} style={{ marginBottom: 8 }}>
              <View style={s.projectRow}>
                <View style={[s.badge, { backgroundColor: project.badge }]}>
                  <Text style={{ color: "#ffffff", fontSize: 8, fontWeight: "600" }}>
                    {project.name[0].toUpperCase()}
                  </Text>
                </View>
                <Label c={c} muted size={12}>
                  {project.name}
                </Label>
                <View style={s.flex} />
                <Glyph name="Plus" c={c} size={12} />
                <Glyph name="EllipsisVertical" c={c} size={12} />
              </View>
              {project.sessions.map(session => {
                const active = selected === session.title;
                return (
                  <Pressable
                    key={session.title}
                    accessibilityRole="button"
                    accessibilityLabel={`Preview ${session.title}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      onSelect(session.title);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      s.sessionRow,
                      { backgroundColor: active || pressed ? c.selected : "transparent" },
                    ]}
                  >
                    <View
                      style={[
                        s.sessionDot,
                        {
                          backgroundColor:
                            session.status === "running"
                              ? c.dotRunning
                              : session.status === "attention"
                                ? c.dotWarning
                                : c.border,
                        },
                      ]}
                    />
                    <Label c={c} size={12}>
                      {session.title}
                    </Label>
                    <View style={s.flex} />
                    <Glyph name="EllipsisVertical" c={c} size={12} />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <View style={[s.drawerFooter, { borderTopColor: c.border }]}>
          <Glyph name="FolderPlus" c={c} size={13} />
          <Label c={c} muted size={11}>
            Add project
          </Label>
          <View style={s.flex} />
          {["Server", "HardDriveDownload", "CircleHelp", "Settings"].map(icon => (
            <Glyph key={icon} name={icon} c={c} size={13} />
          ))}
        </View>
      </View>
    </View>
  );
}

export function PaseoMobilePreview({
  theme,
  items = [],
  compact = false,
}: {
  theme: StudioTheme;
  items?: PreviewTimelineItem[];
  /** Hides the composer when the preview is only a short window. */
  compact?: boolean;
}) {
  const c = previewColors(theme);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [session, setSession] = useState("Navigation review");
  const hasPanel = theme.ui.activityPanel || theme.ui.panel.enabled;
  const showPanel = hasPanel && panelOpen;
  return (
    <View
      testID="paseo-mobile-preview"
      accessibilityLabel={`${theme.name} Paseo mobile preview`}
      style={[s.frame, { borderColor: c.border, backgroundColor: c.workspace }]}
    >
      <View style={s.statusArea} />
      <Header
        c={c}
        title={session}
        hasPanel={hasPanel}
        panelOpen={showPanel}
        onMenu={() => setDrawerOpen(true)}
        onPanel={() => setPanelOpen(open => !open)}
      />
      <Chat c={c} pack={theme} items={items} compact={compact} />
      {showPanel && (
        <View style={s.overlay} testID="paseo-mobile-panel">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close pack panel"
            onPress={() => setPanelOpen(false)}
            style={[s.backdrop, { backgroundColor: "#00000066" }]}
          />
          <View style={[s.sheet, { backgroundColor: c.workspace, borderLeftColor: c.border }]}>
            <View style={[s.agentRow, { borderBottomColor: c.border }]}>
              <Glyph name={theme.ui.panel.enabled ? theme.ui.panel.icon : "Activity"} c={c} size={13} />
              <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flex: 1 }}>
                {theme.ui.panel.enabled ? theme.ui.panel.title : "Pack activity"}
              </Text>
              <IconButton c={c} name="X" label="Close pack panel" onPress={() => setPanelOpen(false)} />
            </View>
            <PreviewActivity pack={theme} />
          </View>
        </View>
      )}
      {drawerOpen && <Drawer c={c} selected={session} onSelect={setSession} onClose={() => setDrawerOpen(false)} />}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  frame: { flex: 1, borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  statusArea: { height: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  iconButton: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  agentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  chatContent: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  userBubble: { alignSelf: "flex-end", maxWidth: "88%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  assistantText: { fontSize: 12, lineHeight: 19 },
  bullets: { gap: 4, paddingLeft: 4 },
  bulletRow: { flexDirection: "row", gap: 8 },
  toolRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 4 },
  divider: { height: 1 },
  composerWrap: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 6, gap: 8 },
  skillsPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  composer: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  composerInput: { fontSize: 12, lineHeight: 18, minHeight: 36, maxHeight: 90, padding: 0 },
  composerFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  sendButton: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  drawer: { width: "82%", borderRightWidth: 1, paddingTop: 12 },
  drawerNav: { paddingHorizontal: 8, paddingBottom: 6 },
  closeButton: { position: "absolute", top: 0, right: 10 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 7 },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  projectRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  badge: { width: 14, height: 14, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
  },
  sessionDot: { width: 5, height: 5, borderRadius: 3 },
  drawerFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  sheet: { position: "absolute", top: 0, right: 0, bottom: 0, width: "86%", borderLeftWidth: 1, paddingTop: 12 },
});
