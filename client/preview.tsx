import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { StudioTheme } from "../shared/theme";
import { previewColors, previewPluginTheme, type PreviewColors } from "./preview-colors";
import { PackToolCard, PackNote, RecipePanel, packMetrics } from "./pack-runtime";

export type PreviewScene = "chat" | "changes" | "terminal";
type PreviewTab = PreviewScene | "activity";
type ColorProps = { c: PreviewColors };
const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

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
    <Text style={{ color: muted ? c.mutedForeground : c.foreground, fontSize: size, lineHeight: size + 6 }}>
      {children}
    </Text>
  );
}

function IconButton({
  c,
  icon,
  label,
  onPress,
  selected = false,
}: ColorProps & { icon: string; label: string; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, { backgroundColor: selected || pressed ? c.selected : "transparent" }]}
    >
      <Glyph name={icon} c={c} color={selected ? c.foreground : c.mutedForeground} />
    </Pressable>
  );
}

function Sidebar({
  c,
  collapsed,
  forcedCompact,
  setCollapsed,
  selected,
  setSelected,
}: ColorProps & {
  collapsed: boolean;
  forcedCompact: boolean;
  setCollapsed: (value: boolean) => void;
  selected: string;
  setSelected: (value: string) => void;
}) {
  const workspaces = [
    { title: "Theme creator", subtitle: "theme-creator · dev", status: c.dotSuccess },
    { title: "Website", subtitle: "feature/navigation", status: c.dotSuccess },
    { title: "API refactor", subtitle: "paseo-api · dev", status: c.dotWarning },
    { title: "Design system", subtitle: "paseo-ui · dev", status: c.dotSuccess },
    { title: "Mobile app", subtitle: "paseo-mobile · planning", status: c.ring },
  ];
  return (
    <View style={[s.sidebar, { width: collapsed ? 42 : 168, backgroundColor: c.sidebar, borderRightColor: c.border }]}>
      <View style={[s.sidebarTitle, collapsed && { justifyContent: "center", paddingHorizontal: 0 }]}>
        {!collapsed && (
          <View style={s.trafficLights}>
            {["#ff5f57", "#febc2e", "#28c840"].map(color => (
              <View key={color} style={[s.trafficLight, { backgroundColor: color }]} />
            ))}
          </View>
        )}
        {forcedCompact ? (
          <Glyph name="PanelLeft" c={c} />
        ) : (
          <IconButton
            c={c}
            icon="PanelLeft"
            label={collapsed ? "Expand preview sidebar" : "Collapse preview sidebar"}
            onPress={() => setCollapsed(!collapsed)}
          />
        )}
      </View>
      <View style={[s.navigation, collapsed && { paddingHorizontal: 5 }]}>
        {[
          ["Plus", "New workspace"],
          ["History", "History"],
          ["CalendarClock", "Schedules"],
        ].map(([icon, label]) => (
          <View
            key={label}
            accessibilityLabel={label}
            style={[s.navRow, collapsed && { justifyContent: "center", paddingHorizontal: 0 }]}
          >
            <Glyph name={icon} c={c} />
            {!collapsed && (
              <Label c={c} muted>
                {label}
              </Label>
            )}
          </View>
        ))}
      </View>
      <View style={[s.sidebarDivider, { backgroundColor: c.border }]} />
      {!collapsed && (
        <View style={s.sectionTitle}>
          <Label c={c} muted size={10}>
            Workspaces
          </Label>
          <View style={s.row}>
            <Glyph name="Search" c={c} size={12} />
            <Glyph name="SlidersHorizontal" c={c} size={12} />
          </View>
        </View>
      )}
      <ScrollView
        style={s.flex}
        contentContainerStyle={{ paddingHorizontal: collapsed ? 5 : 5, paddingTop: collapsed ? 10 : 3 }}
        showsVerticalScrollIndicator={false}
      >
        {workspaces.map(workspace => (
          <Pressable
            key={workspace.title}
            accessibilityRole="button"
            accessibilityLabel={`Preview ${workspace.title} workspace`}
            accessibilityState={{ selected: selected === workspace.title }}
            onPress={() => setSelected(workspace.title)}
            style={({ pressed }) => [
              s.workspaceRow,
              collapsed && { justifyContent: "center", paddingHorizontal: 0, height: 38 },
              { backgroundColor: selected === workspace.title || pressed ? c.selected : "transparent" },
            ]}
          >
            <View style={[s.statusDot, { backgroundColor: workspace.status }]} />
            {!collapsed && (
              <View style={s.flex}>
                <Text numberOfLines={1} style={{ fontSize: 12, color: c.foreground, lineHeight: 19 }}>
                  {workspace.title}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 10, color: c.mutedForeground, lineHeight: 15 }}>
                  {workspace.subtitle}
                </Text>
              </View>
            )}
          </Pressable>
        ))}
        {!collapsed && (
          <View style={[s.navRow, { marginTop: 12, alignItems: "flex-start" }]}>
            <Glyph name="Archive" c={c} />
            <View>
              <Label c={c}>Archived</Label>
              <Label c={c} muted size={10}>
                3 workspaces
              </Label>
            </View>
          </View>
        )}
      </ScrollView>
      <View style={[s.localHost, collapsed && { justifyContent: "center", paddingHorizontal: 0 }]}>
        <Glyph name="Monitor" c={c} />
        {!collapsed && (
          <Label c={c} size={11}>
            Local
          </Label>
        )}
        <View style={[s.statusDot, { width: 5, height: 5, backgroundColor: c.dotSuccess }]} />
      </View>
      <View
        style={[
          s.sidebarFooter,
          { borderTopColor: c.border },
          collapsed && { flexDirection: "column", paddingHorizontal: 0 },
        ]}
      >
        {(collapsed ? ["Settings"] : ["Server", "FolderPlus", "House", "CircleHelp", "Settings"]).map(icon => (
          <View key={icon} style={s.footerIcon}>
            <Glyph name={icon} c={c} size={13} />
          </View>
        ))}
      </View>
    </View>
  );
}

function WorkspaceHeader({
  c,
  title,
  narrow,
  onChanges,
}: ColorProps & { title: string; narrow: boolean; onChanges: () => void }) {
  return (
    <View style={[s.workspaceHeader, { backgroundColor: c.sidebar, borderBottomColor: c.border }]}>
      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, fontWeight: "500", flexShrink: 1 }}>
        {title}
      </Text>
      {!narrow && (
        <Text numberOfLines={1} style={{ color: c.mutedForeground, fontSize: 10, flexShrink: 1 }}>
          feature/navigation
        </Text>
      )}
      <View style={s.flex} />
      {!narrow && (
        <View style={[s.headerControl, { borderColor: c.border }]}>
          <Glyph name="GitCommitHorizontal" c={c} size={12} />
          <Label c={c} size={10}>
            Commit
          </Label>
          <Glyph name="ChevronDown" c={c} size={10} />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show preview changes, 3 additions and 1 deletion"
        onPress={onChanges}
        style={[s.headerControl, { backgroundColor: c.raised, borderColor: c.border }]}
      >
        <Text style={{ fontSize: 10, color: c.success }}>+3</Text>
        <Text style={{ fontSize: 10, color: c.danger }}>−1</Text>
      </Pressable>
      <Glyph name="Ellipsis" c={c} />
    </View>
  );
}

function Tabs({
  c,
  active,
  onSelect,
  narrow,
  pack,
}: ColorProps & { active: PreviewTab; onSelect: (value: PreviewTab) => void; narrow: boolean; pack: StudioTheme }) {
  const tabs: { id: PreviewTab; title: string; icon: string }[] = [
    { id: "chat", title: narrow ? "Agent" : "Navigation review", icon: "Sparkles" },
    { id: "terminal", title: "Terminal", icon: "Terminal" },
    { id: "changes", title: "Changes", icon: "GitCompareArrows" },
  ];
  if (pack.ui.activityPanel || pack.ui.panel.enabled)
    tabs.push({
      id: "activity",
      title: pack.ui.activityPanel ? "Activity" : pack.ui.panel.title,
      icon: pack.ui.activityPanel ? "Activity" : pack.ui.panel.icon,
    });
  return (
    <View style={[s.tabs, { backgroundColor: c.sidebar, borderBottomColor: c.border }]}>
      {tabs.map(tab => (
        <Pressable
          key={tab.id}
          accessibilityRole="tab"
          accessibilityLabel={`${tab.title} preview`}
          accessibilityState={{ selected: active === tab.id }}
          onPress={() => onSelect(tab.id)}
          style={({ pressed }) => [
            s.tab,
            {
              borderTopColor: active === tab.id ? c.accent : "transparent",
              borderRightColor: c.border,
              backgroundColor: active === tab.id ? c.workspace : pressed ? c.selected : "transparent",
            },
          ]}
        >
          <Glyph name={tab.icon} c={c} size={12} color={active === tab.id ? c.foreground : c.mutedForeground} />
          <Text
            numberOfLines={1}
            style={{ fontSize: 10, color: active === tab.id ? c.foreground : c.mutedForeground, flexShrink: 1 }}
          >
            {tab.title}
          </Text>
        </Pressable>
      ))}
      <View style={s.flex} />
      <View style={{ paddingHorizontal: 8 }}>
        <Glyph name="Plus" c={c} size={12} />
      </View>
    </View>
  );
}

const diffLines: { old: string; next: string; kind?: "add" | "remove"; text: string }[] = [
  { old: "12", next: "12", text: "const items = [" },
  { old: "13", next: "13", text: "  {" },
  { old: "14", next: "", kind: "remove", text: '    background: isActive ? colors.surface1 : "transparent",' },
  { old: "", next: "14", kind: "add", text: '    background: isActive ? colors.surface2 : "transparent",' },
  { old: "15", next: "15", text: '    icon: "Folder",' },
  { old: "16", next: "16", text: '    label: "Website",' },
  { old: "17", next: "17", text: "  }," },
  { old: "18", next: "18", text: "];" },
];

function Syntax({ c, text }: ColorProps & { text: string }) {
  const pieces = text.split(/("[^"]*"|\bconst\b|\bcolors\b|\b(?:surface1|surface2|isActive)\b)/g);
  return (
    <>
      {pieces.map((piece, index) => (
        <Text
          key={index}
          style={{
            color: piece.startsWith('"')
              ? c.ansiGreen
              : piece === "const"
                ? c.ansiMagenta
                : piece === "colors" || piece.startsWith("surface")
                  ? c.ansiBlue
                  : piece === "isActive"
                    ? c.ansiCyan
                    : c.foreground,
          }}
        >
          {piece}
        </Text>
      ))}
    </>
  );
}

function CodeDiff({ c, full = false }: ColorProps & { full?: boolean }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ backgroundColor: c.raised }}
      contentContainerStyle={{ minWidth: "100%" }}
    >
      <View style={{ minWidth: full ? 640 : 570, paddingVertical: 5 }}>
        {diffLines.slice(0, full ? undefined : 7).map((line, index) => (
          <View
            key={index}
            style={[
              s.codeLine,
              {
                backgroundColor:
                  line.kind === "add"
                    ? c.additionBackground
                    : line.kind === "remove"
                      ? c.deletionBackground
                      : "transparent",
              },
            ]}
          >
            <Text
              style={[
                s.lineNumber,
                { color: line.kind ? (line.kind === "add" ? c.addition : c.deletion) : c.mutedForeground },
              ]}
            >
              {line.old}
            </Text>
            <Text
              style={[
                s.lineNumber,
                { color: line.kind ? (line.kind === "add" ? c.addition : c.deletion) : c.mutedForeground },
              ]}
            >
              {line.next}
            </Text>
            <Text
              style={[
                s.codeText,
                {
                  width: 16,
                  color: line.kind === "add" ? c.addition : line.kind === "remove" ? c.deletion : c.mutedForeground,
                },
              ]}
            >
              {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
            </Text>
            <Text style={[s.codeText, { color: c.foreground }]}>
              <Syntax c={c} text={line.text} />
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function ToolRow({ c, type }: ColorProps & { type: "read" | "edit" }) {
  const [expanded, setExpanded] = useState(type === "edit");
  return (
    <View style={[s.tool, { borderColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${type === "read" ? "read navigation.tsx" : "edit sidebar.tsx"} tool details`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => [s.toolHeader, { backgroundColor: pressed ? c.selected : "transparent" }]}
      >
        <Glyph name={type === "read" ? "CircleCheck" : "Wrench"} c={c} size={13} />
        <Label c={c} size={11}>
          {type === "read" ? "Read navigation.tsx" : "Edit sidebar.tsx"}
        </Label>
        <View style={s.flex} />
        <Glyph name={expanded ? "ChevronUp" : "ChevronDown"} c={c} size={11} />
      </Pressable>
      {expanded && (
        <View style={[s.toolBody, { borderColor: c.border }]}>
          {type === "edit" ? (
            <CodeDiff c={c} />
          ) : (
            <View style={{ padding: 10, backgroundColor: c.raised }}>
              <Text style={[s.codeText, { color: c.mutedForeground }]}>Read 84 lines · src/navigation.tsx</Text>
              <Text style={[s.codeText, { color: c.foreground, marginTop: 5 }]}>
                export const navigation = ["Home", "Website"];
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function Terminal({ c, full = false }: ColorProps & { full?: boolean }) {
  return (
    <View style={[full ? s.terminalFull : s.terminalInline, { backgroundColor: c.background, borderColor: c.border }]}>
      <View style={[s.terminalHeader, { backgroundColor: c.raised, borderBottomColor: c.border }]}>
        <Glyph name="SquareTerminal" c={c} size={12} />
        <Label c={c} size={10}>
          Terminal
        </Label>
        <View style={[s.terminalSeparator, { backgroundColor: c.border }]} />
        <Glyph name="Plus" c={c} size={12} />
        <View style={s.flex} />
        {full && (
          <Label c={c} muted size={10}>
            zsh
          </Label>
        )}
      </View>
      <ScrollView
        style={s.flex}
        contentContainerStyle={{ padding: full ? 17 : 9, gap: full ? 8 : 3 }}
        showsVerticalScrollIndicator={false}
      >
        {full && (
          <>
            <Text style={[s.codeText, { color: c.mutedForeground }]}>Last login: Thu Oct 1 09:41:00 on ttys001</Text>
            <Text style={[s.codeText, { color: c.ansiCyan }]}>
              ~/website <Text style={{ color: c.ansiMagenta }}>feature/navigation</Text>
            </Text>
          </>
        )}
        <Text style={[s.codeText, { color: c.foreground }]}>
          <Text style={{ color: c.mutedForeground }}>$ </Text>npm run check
        </Text>
        {full && (
          <>
            <Text style={[s.codeText, { color: c.mutedForeground }]}>
              {"> website@1.0.0 check\n> tsc --noEmit && vitest run"}
            </Text>
            <Text style={[s.codeText, { color: c.ansiBlue }]}> RUN v3.2.4 /website</Text>
            <Text style={[s.codeText, { color: c.ansiGreen }]}> ✓ src/navigation.test.ts (4 tests) 12ms</Text>
            <Text style={[s.codeText, { color: c.foreground }]}>
              <Text style={{ color: c.ansiGreen }}> Test Files </Text> 1 passed (1){"\n"}
              <Text style={{ color: c.ansiGreen }}> Tests </Text> 4 passed (4){"\n"}
              <Text style={{ color: c.mutedForeground }}> Duration </Text> 382ms
            </Text>
          </>
        )}
        <Text style={[s.codeText, { color: c.ansiGreen }]}>✓ Typecheck passed</Text>
        {full && (
          <Text style={[s.codeText, { color: c.ansiCyan, marginTop: 8 }]}>
            ~/website <Text style={{ color: c.ansiMagenta }}>feature/navigation</Text>
          </Text>
        )}
        <View style={s.row}>
          <Text style={[s.codeText, { color: c.mutedForeground }]}>$ </Text>
          <View style={{ width: 6, height: 13, backgroundColor: c.foreground, opacity: 0.75 }} />
        </View>
      </ScrollView>
      {full && (
        <View style={[s.terminalStatus, { borderTopColor: c.border }]}>
          <View style={[s.statusDot, { backgroundColor: c.dotSuccess }]} />
          <Label c={c} muted size={10}>
            Process exited with code 0
          </Label>
          <View style={s.flex} />
          <Label c={c} muted size={10}>
            Preview
          </Label>
        </View>
      )}
    </View>
  );
}

function Changes({ c }: ColorProps) {
  const [file, setFile] = useState("sidebar.tsx");
  return (
    <View style={s.flex}>
      <View style={[s.changeToolbar, { borderBottomColor: c.border }]}>
        <Glyph name="GitBranch" c={c} />
        <Label c={c} size={11}>
          feature/navigation
        </Label>
        <View style={s.flex} />
        <Glyph name="ChevronDown" c={c} size={11} />
      </View>
      <View style={[s.changeToolbar, { borderBottomColor: c.border }]}>
        <Label c={c} muted size={10}>
          Uncommitted
        </Label>
        <Glyph name="ChevronDown" c={c} size={10} />
        <View style={s.flex} />
        <Glyph name="Columns2" c={c} size={12} />
        <Glyph name="List" c={c} size={12} />
      </View>
      <ScrollView style={s.flex} showsVerticalScrollIndicator={false}>
        {[
          { name: "sidebar.tsx", added: 1, removed: 1 },
          { name: "navigation.test.ts", added: 2, removed: 0 },
        ].map(item => (
          <View key={item.name}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${file === item.name ? "Collapse" : "Expand"} ${item.name} diff`}
              accessibilityState={{ expanded: file === item.name }}
              onPress={() => setFile(file === item.name ? "" : item.name)}
              style={({ pressed }) => [
                s.fileRow,
                { backgroundColor: pressed ? c.selected : c.raised, borderBottomColor: c.border },
              ]}
            >
              <Glyph name={file === item.name ? "ChevronDown" : "ChevronRight"} c={c} size={11} />
              <Glyph name="FileCode2" c={c} size={12} color={c.ansiBlue} />
              <Label c={c} size={11}>
                {item.name}
              </Label>
              <View style={s.flex} />
              <Text style={{ fontSize: 10, color: c.success }}>+{item.added}</Text>
              {item.removed > 0 && <Text style={{ fontSize: 10, color: c.danger }}>−{item.removed}</Text>}
            </Pressable>
            {file === item.name &&
              (item.name === "sidebar.tsx" ? (
                <>
                  <View style={[s.hunkHeader, { backgroundColor: c.control }]}>
                    <Text style={[s.codeText, { color: c.mutedForeground }]}>@@ −12,8 +12,8 @@</Text>
                  </View>
                  <CodeDiff c={c} full />
                </>
              ) : (
                <View style={{ padding: 12, backgroundColor: c.additionBackground }}>
                  <Text style={[s.codeText, { color: c.addition }]}>
                    {
                      '+ expect(active.background).toBe(colors.surface2);\n+ expect(inactive.background).toBe("transparent");'
                    }
                  </Text>
                </View>
              ))}
          </View>
        ))}
      </ScrollView>
      <View style={[s.terminalStatus, { borderTopColor: c.border }]}>
        <Glyph name="ChevronRight" c={c} size={10} />
        <Label c={c} size={10}>
          Commits
        </Label>
        <View style={s.flex} />
        <Label c={c} muted size={10}>
          0 local · 0 remote
        </Label>
      </View>
    </View>
  );
}

function Composer({ c, onSubmit, narrow }: ColorProps & { onSubmit: (text: string) => void; narrow: boolean }) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  function submit() {
    if (draft.trim()) {
      onSubmit(draft.trim());
      setDraft("");
    }
  }
  return (
    <View style={[s.composer, { backgroundColor: c.raised, borderColor: focused ? c.ring : c.border }]}>
      <TextInput
        ref={inputRef}
        accessibilityLabel="Preview message. Messages only appear in this demo."
        multiline
        placeholder={narrow ? "Message the agent…" : "Message the agent, tag @files, or use /commands"}
        placeholderTextColor={c.ring}
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[s.composerInput, { color: c.foreground }]}
      />
      <View style={s.composerFooter}>
        <View style={s.row}>
          <Glyph name="Plus" c={c} />
          <Glyph name="Paperclip" c={c} />
        </View>
        <View style={[s.row, { gap: 4 }]}>
          <Glyph name="Sparkles" c={c} size={12} />
          <Label c={c} muted size={10}>
            {narrow ? "Sonnet" : "Sonnet 4.6"}
          </Label>
          <Glyph name="ChevronDown" c={c} size={9} />
        </View>
        {!narrow && (
          <View style={[s.row, { gap: 4 }]}>
            <Glyph name="Blocks" c={c} size={12} />
            <Label c={c} muted size={10}>
              Build
            </Label>
            <Glyph name="ChevronDown" c={c} size={9} />
          </View>
        )}
        <View style={s.flex} />
        <Glyph name="Mic" c={c} size={13} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send simulated preview message"
          accessibilityHint="Adds a sample response without contacting an agent"
          accessibilityState={{ disabled: !draft.trim() }}
          onPress={submit}
          disabled={!draft.trim()}
          style={({ pressed }) => [
            s.sendButton,
            { backgroundColor: draft.trim() ? c.accent : c.control, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Glyph name="ArrowUp" c={c} size={14} color={draft.trim() ? c.accentForeground : c.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

function Chat({ c, narrow, pack }: ColorProps & { narrow: boolean; pack: StudioTheme }) {
  const [messages, setMessages] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  return (
    <View style={s.flex}>
      <ScrollView
        ref={scrollRef}
        style={s.flex}
        contentContainerStyle={[s.chatContent, { paddingHorizontal: narrow ? 12 : 18 }]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (messages.length) scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        <View style={[s.userBubble, { backgroundColor: c.bubble }]}>
          <Label c={c} size={12}>
            Review the navigation and fix the active states.
          </Label>
        </View>
        <Text style={[s.assistantText, { color: c.foreground }]}>
          I updated the menu and checked the navigation states.
        </Text>
        <View style={{ gap: 0 }}>
          <ToolRow c={c} type="read" />
          <ToolRow c={c} type="edit" />
        </View>
        {pack.ui.toolCards === "native" ? (
          <Terminal c={c} />
        ) : (
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
        )}
        <Text style={[s.assistantText, { color: c.foreground }]}>
          The selected workspace now uses the control color. All four navigation tests pass.
        </Text>
        <View style={[s.row, { gap: 6 }]}>
          <Glyph name="Clock" c={c} size={12} />
          <Label c={c} muted size={10}>
            Worked for 8s
          </Label>
        </View>
        {messages.map((message, index) => (
          <View key={index} style={{ gap: 16, marginTop: 12 }}>
            <View style={[s.userBubble, { backgroundColor: c.bubble }]}>
              <Label c={c} size={12}>
                {message}
              </Label>
            </View>
            <Text style={[s.assistantText, { color: c.foreground }]}>
              This is a preview conversation. Your palette is shown across the sidebar, messages, tools, and composer.
            </Text>
          </View>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: narrow ? 12 : 18, paddingBottom: 14, paddingTop: 8 }}>
        <Composer c={c} narrow={narrow} onSubmit={text => setMessages(previous => [...previous, text])} />
      </View>
    </View>
  );
}

export function PaseoPreview({
  theme,
  compact = false,
  scene = "chat",
}: {
  theme: StudioTheme;
  compact?: boolean;
  scene?: PreviewScene;
}) {
  const c = previewColors(theme);
  const [active, setActive] = useState<PreviewTab>(scene);
  const [width, setWidth] = useState(800);
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);
  const [workspace, setWorkspace] = useState("Website");
  const narrow = compact || width < 520;
  const collapsed = narrow || manuallyCollapsed;
  useEffect(() => setActive(scene), [scene]);
  useEffect(() => {
    if (active === "activity" && !theme.ui.activityPanel && !theme.ui.panel.enabled) setActive("chat");
  }, [active, theme.ui.activityPanel, theme.ui.panel.enabled]);
  return (
    <View
      testID="paseo-preview"
      accessibilityLabel={`${theme.name} Paseo preview`}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[s.frame, { borderColor: c.border, backgroundColor: c.workspace }]}
    >
      <Sidebar
        c={c}
        collapsed={collapsed}
        forcedCompact={narrow}
        setCollapsed={setManuallyCollapsed}
        selected={workspace}
        setSelected={setWorkspace}
      />
      <View style={s.flex}>
        <WorkspaceHeader c={c} title={workspace} narrow={narrow} onChanges={() => setActive("changes")} />
        <Tabs c={c} active={active} onSelect={setActive} narrow={narrow} pack={theme} />
        <View style={[s.flex, { backgroundColor: c.workspace }]}>
          {active === "chat" ? (
            <Chat c={c} narrow={narrow} pack={theme} />
          ) : active === "terminal" ? (
            <Terminal c={c} full />
          ) : active === "changes" ? (
            <Changes c={c} />
          ) : (
            <PreviewActivity pack={theme} />
          )}
        </View>
      </View>
    </View>
  );
}

function PreviewActivity({ pack }: { pack: StudioTheme }) {
  const theme = previewPluginTheme(pack);
  const c = theme.colors;
  const m = packMetrics(pack.ui);
  return (
    <ScrollView style={s.flex} contentContainerStyle={{ padding: m.padding, gap: m.gap }}>
      {pack.ui.activityPanel && (
        <View
          style={{
            padding: m.padding,
            gap: m.gap,
            borderRadius: m.radius,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: m.gap }}>
            <Icon name="Activity" size={16} color={c.accent} />
            <Text
              style={{
                color: c.foreground,
                fontSize: m.fontSize,
                fontFamily: m.fontFamily,
                fontWeight: "600",
                flex: 1,
              }}
            >
              Website
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: m.fontSize - 1, fontFamily: m.fontFamily }}>done</Text>
          </View>
          <Text style={{ color: c.foregroundMuted, fontSize: m.fontSize - 1, fontFamily: m.fontFamily }}>
            /projects/website
          </Text>
          <View style={{ flexDirection: "row", gap: m.gap }}>
            <Text style={{ color: c.statusSuccess, fontSize: m.fontSize, fontFamily: m.fontFamily }}>+3</Text>
            <Text style={{ color: c.statusDanger, fontSize: m.fontSize, fontFamily: m.fontFamily }}>−1</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: m.fontSize, fontFamily: m.fontFamily }}>
              uncommitted lines
            </Text>
          </View>
          <PackNote theme={theme} pack={pack} text="Navigation review · idle · Sonnet 4.6" />
        </View>
      )}
      <RecipePanel theme={theme} pack={pack} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, minHeight: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 9 },
  frame: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  sidebar: { flexShrink: 0, borderRightWidth: 1 },
  sidebarTitle: {
    height: 36,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trafficLights: { flexDirection: "row", gap: 5 },
  trafficLight: { width: 8, height: 8, borderRadius: 4 },
  iconButton: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 4 },
  navigation: { paddingHorizontal: 8, paddingTop: 3, paddingBottom: 8 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 30, paddingHorizontal: 6 },
  sidebarDivider: { height: 1 },
  sectionTitle: {
    paddingHorizontal: 12,
    paddingTop: 13,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  workspaceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 5,
    marginBottom: 2,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  localHost: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34 },
  sidebarFooter: {
    height: 34,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  footerIcon: { width: 22, height: 24, alignItems: "center", justifyContent: "center" },
  workspaceHeader: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    borderBottomWidth: 1,
  },
  headerControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 24,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderRadius: 4,
  },
  tabs: { height: 34, flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  tab: {
    height: 33,
    borderTopWidth: 2,
    borderRightWidth: 1,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  chatContent: { paddingTop: 16, paddingBottom: 12, gap: 15 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 14,
    borderTopRightRadius: 4,
  },
  assistantText: { fontSize: 12, lineHeight: 19 },
  tool: { borderTopWidth: 1 },
  toolHeader: { height: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  toolBody: { borderWidth: 1, borderRadius: 5, overflow: "hidden", marginBottom: 7 },
  codeLine: { height: 18, flexDirection: "row", alignItems: "center" },
  codeText: { fontFamily: mono, fontSize: 10, lineHeight: 18 },
  lineNumber: { fontFamily: mono, fontSize: 10, width: 26, textAlign: "right", paddingRight: 6 },
  terminalInline: { height: 91, borderWidth: 1, borderRadius: 5, overflow: "hidden" },
  terminalFull: { flex: 1, minHeight: 0, minWidth: 0 },
  terminalHeader: {
    height: 26,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderBottomWidth: 1,
  },
  terminalSeparator: { width: 1, height: 14, marginHorizontal: 3 },
  terminalStatus: {
    height: 29,
    paddingHorizontal: 11,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  composer: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  composerInput: {
    minHeight: 47,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    fontSize: 12,
    lineHeight: 18,
    textAlignVertical: "top",
  },
  composerFooter: {
    height: 36,
    paddingHorizontal: 10,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sendButton: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  changeToolbar: {
    height: 31,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    gap: 7,
    borderBottomWidth: 1,
  },
  fileRow: {
    height: 35,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 7,
    borderBottomWidth: 1,
  },
  hunkHeader: { paddingHorizontal: 12, paddingVertical: 4 },
});
