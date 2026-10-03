import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { StudioTheme } from "../shared/theme";
import { previewColors, previewPluginTheme, type PreviewColors } from "./preview-colors";
import { PackToolCard, PackNote, RecipePanel, packMetrics } from "./pack-runtime";

// A faithful, interactive miniature of Paseo 0.10's desktop layout, painted with the draft pack.
export type PreviewScene = "chat" | "changes" | "terminal" | "panel";
type ColorProps = { c: PreviewColors };
const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** A plugin row shown inside the preview conversation, such as a custom component card. */
export type PreviewTimelineItem = { key: string; node: ReactNode };

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

const projects = [
  {
    name: "theme-creator",
    badge: "#3f7a6b",
    sessions: [{ title: "Pack designer", status: "running" as const }],
  },
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

function Sidebar({ c, selected, onSelect }: ColorProps & { selected: string; onSelect: (title: string) => void }) {
  return (
    <View style={[s.sidebar, { backgroundColor: c.sidebar, borderRightColor: c.border }]}>
      <View style={s.navigation}>
        {[
          ["Plus", "New workspace"],
          ["History", "History"],
          ["Search", "Search"],
          ["CalendarClock", "Schedules"],
          ["Palette", "Theme Studio"],
        ].map(([icon, label]) => (
          <View key={label} style={s.navRow}>
            <Glyph name={icon} c={c} size={13} />
            <Label c={c} muted size={12}>
              {label}
            </Label>
          </View>
        ))}
      </View>
      <View style={[s.divider, { backgroundColor: c.border }]} />
      <View style={s.sectionTitle}>
        <Label c={c} muted size={10}>
          Workspaces
        </Label>
        <Glyph name="SlidersHorizontal" c={c} size={11} />
      </View>
      <ScrollView style={s.flex} contentContainerStyle={{ paddingHorizontal: 6 }} showsVerticalScrollIndicator={false}>
        {projects.map(project => (
          <View key={project.name} style={{ marginBottom: 6 }}>
            <View style={s.projectRow}>
              <View style={[s.badge, { backgroundColor: project.badge }]}>
                <Text style={{ color: "#ffffff", fontSize: 8, fontWeight: "600" }}>
                  {project.name[0].toUpperCase()}
                </Text>
              </View>
              <Label c={c} muted size={12}>
                {project.name}
              </Label>
            </View>
            {project.sessions.map(session => {
              const active = selected === session.title;
              return (
                <Pressable
                  key={session.title}
                  accessibilityRole="button"
                  accessibilityLabel={`Preview ${session.title}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelect(session.title)}
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
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={[s.sidebarFooter, { borderTopColor: c.border }]}>
        <Glyph name="FolderPlus" c={c} size={13} />
        <Label c={c} muted size={11}>
          Add project
        </Label>
        <View style={s.flex} />
        {["Server", "HardDriveDownload", "CircleHelp", "Settings"].map(icon => (
          <Glyph key={icon} name={icon} c={c} size={12} />
        ))}
      </View>
    </View>
  );
}

function WorkspaceHeader({ c, title, narrow }: ColorProps & { title: string; narrow: boolean }) {
  return (
    <View style={[s.workspaceHeader, { borderBottomColor: c.border }]}>
      <Glyph name="PanelLeft" c={c} size={13} />
      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flexShrink: 1 }}>
        {title}
      </Text>
      {!narrow && (
        <Text numberOfLines={1} style={{ color: c.mutedForeground, fontSize: 11, flexShrink: 1 }}>
          website
        </Text>
      )}
      <Glyph name="Ellipsis" c={c} size={13} />
      <View style={s.flex} />
      <Glyph name="PanelRight" c={c} size={13} />
    </View>
  );
}

function Tabs({
  c,
  active,
  onSelect,
  title,
  showPanelTab,
  panelTitle,
  panelIcon,
}: ColorProps & {
  active: PreviewScene;
  onSelect: (value: PreviewScene) => void;
  title: string;
  showPanelTab: boolean;
  panelTitle: string;
  panelIcon: string;
}) {
  const tabs: { id: PreviewScene; title: string; icon: string }[] = [
    { id: "chat", title, icon: "Sparkles" },
    { id: "terminal", title: "Terminal", icon: "SquareTerminal" },
    { id: "changes", title: "Changes", icon: "GitCompareArrows" },
  ];
  if (showPanelTab) tabs.push({ id: "panel", title: panelTitle, icon: panelIcon });
  return (
    <View style={[s.tabs, { borderBottomColor: c.border }]}>
      {tabs.map(tab => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.title} preview`}
            accessibilityState={{ selected }}
            onPress={() => onSelect(tab.id)}
            style={({ pressed }) => [s.tab, { backgroundColor: selected || pressed ? c.selected : "transparent" }]}
          >
            <Glyph name={tab.icon} c={c} size={11} color={selected ? c.foreground : c.mutedForeground} />
            <Text
              numberOfLines={1}
              style={{ fontSize: 11, color: selected ? c.foreground : c.mutedForeground, flexShrink: 1 }}
            >
              {tab.title}
            </Text>
          </Pressable>
        );
      })}
      <View style={{ paddingHorizontal: 6 }}>
        <Glyph name="Plus" c={c} size={12} />
      </View>
      <View style={s.flex} />
      <View style={{ paddingHorizontal: 8 }}>
        <Glyph name="Ellipsis" c={c} size={12} />
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

function ToolRow({
  c,
  icon,
  name,
  detail,
  children,
}: ColorProps & { icon: string; name: string; detail: string; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${name} ${detail}`}
        accessibilityState={{ expanded }}
        disabled={!children}
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => [s.toolRow, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Glyph name={icon} c={c} size={12} />
        <Text numberOfLines={1} style={{ fontSize: 12, color: c.mutedForeground, flexShrink: 1 }}>
          <Text style={{ color: c.foreground }}>{name}</Text> {detail}
        </Text>
      </Pressable>
      {expanded && children ? <View style={[s.toolBody, { borderColor: c.border }]}>{children}</View> : null}
    </View>
  );
}

function Composer({ c, onSubmit, narrow }: ColorProps & { onSubmit: (text: string) => void; narrow: boolean }) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  function submit() {
    if (!draft.trim()) return;
    onSubmit(draft.trim());
    setDraft("");
  }
  return (
    <View style={[s.composer, { backgroundColor: c.raised, borderColor: focused ? c.ring : c.border }]}>
      <TextInput
        accessibilityLabel="Preview message. Messages only appear in this demo."
        multiline
        placeholder={narrow ? "Message the agent…" : "Message the agent, tag @files, or use /commands and /skills"}
        placeholderTextColor={c.mutedForeground}
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={submit}
        style={[s.composerInput, { color: c.foreground }]}
      />
      <View style={s.composerFooter}>
        <Glyph name="Plus" c={c} size={13} />
        <View style={s.chip}>
          <Glyph name="Sparkles" c={c} size={11} />
          <Label c={c} muted size={11}>
            GPT-6.1-Sol
          </Label>
          <Glyph name="ChevronDown" c={c} size={10} />
        </View>
        {!narrow && (
          <>
            <View style={s.chip}>
              <Glyph name="Brain" c={c} size={11} />
              <Label c={c} muted size={11}>
                High
              </Label>
              <Glyph name="ChevronDown" c={c} size={10} />
            </View>
            <View style={s.chip}>
              <Glyph name="Shield" c={c} size={11} />
              <Label c={c} muted size={11}>
                Default permissions
              </Label>
              <Glyph name="ChevronDown" c={c} size={10} />
            </View>
          </>
        )}
        <View style={s.flex} />
        <Glyph name="Mic" c={c} size={12} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send simulated preview message"
          accessibilityState={{ disabled: !draft.trim() }}
          onPress={submit}
          disabled={!draft.trim()}
          style={({ pressed }) => [
            s.sendButton,
            { backgroundColor: draft.trim() ? c.accent : "transparent", opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Glyph
            name={draft.trim() ? "ArrowUp" : "AudioLines"}
            c={c}
            size={13}
            color={draft.trim() ? c.accentForeground : c.mutedForeground}
          />
        </Pressable>
      </View>
    </View>
  );
}

function Chat({
  c,
  narrow,
  pack,
  items,
}: ColorProps & { narrow: boolean; pack: StudioTheme; items: PreviewTimelineItem[] }) {
  const [messages, setMessages] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    // Bring a newly inspected component into view.
    if (items.length) scrollRef.current?.scrollToEnd({ animated: true });
  }, [items.map(item => item.key).join("|")]);
  return (
    <View style={s.flex}>
      <ScrollView
        ref={scrollRef}
        style={s.flex}
        contentContainerStyle={[s.chatContent, { paddingHorizontal: narrow ? 14 : 28 }]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (messages.length) scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        <View style={s.chatColumn}>
          <View style={[s.userBubble, { backgroundColor: c.bubble }]}>
            <Text style={{ color: c.foreground, fontSize: 12, lineHeight: 18 }}>
              Review the navigation and fix the active states.
            </Text>
          </View>
          <Text style={[s.assistantText, { color: c.foreground }]}>
            I'll check the sidebar items, then fix how the selected workspace is highlighted.
          </Text>
          <View>
            <ToolRow c={c} icon="Wrench" name="Read" detail="src/navigation.tsx">
              <View style={{ padding: 10, backgroundColor: c.raised }}>
                <Text style={[s.codeText, { color: c.mutedForeground }]}>Read 84 lines</Text>
                <Text style={[s.codeText, { color: c.foreground, marginTop: 5 }]}>
                  export const navigation = ["Home", "Website"];
                </Text>
              </View>
            </ToolRow>
            <ToolRow c={c} icon="Search" name="Search" detail="isActive surface">
              <View style={{ padding: 10, backgroundColor: c.raised }}>
                <Text style={[s.codeText, { color: c.foreground }]}>src/sidebar.tsx:14</Text>
              </View>
            </ToolRow>
            <ToolRow c={c} icon="Pencil" name="Edit" detail="src/sidebar.tsx">
              <CodeDiff c={c} />
            </ToolRow>
            <ToolRow c={c} icon="SquareTerminal" name="Shell" detail="npm run check">
              {pack.ui.toolCards === "native" ? <Terminal c={c} /> : null}
            </ToolRow>
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
          <View style={[s.divider, { backgroundColor: c.border, marginVertical: 2 }]} />
          <Text style={[s.assistantText, { color: c.foreground }]}>
            The selected workspace now uses the control color, and all four navigation tests pass.
          </Text>
          <View style={[s.row, { gap: 10 }]}>
            <Glyph name="Copy" c={c} size={11} />
            <Glyph name="GitFork" c={c} size={11} />
            <Label c={c} muted size={11}>
              Worked for 8s
            </Label>
          </View>
          {messages.map((message, index) => (
            <View key={index} style={{ gap: 14 }}>
              <View style={[s.userBubble, { backgroundColor: c.bubble }]}>
                <Text style={{ color: c.foreground, fontSize: 12, lineHeight: 18 }}>{message}</Text>
              </View>
              <Text style={[s.assistantText, { color: c.foreground }]}>
                This is a preview conversation. Your palette is shown across the sidebar, messages, tools, and composer.
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: narrow ? 12 : 28, paddingBottom: 12, paddingTop: 6 }}>
        <View style={s.chatColumn}>
          <Composer c={c} narrow={narrow} onSubmit={text => setMessages(previous => [...previous, text])} />
        </View>
      </View>
    </View>
  );
}

function Explorer({ c, pack }: ColorProps & { pack: StudioTheme }) {
  const title = pack.ui.panel.enabled ? pack.ui.panel.title : "Pack activity";
  const icon = pack.ui.panel.enabled ? pack.ui.panel.icon : "Activity";
  return (
    <View style={[s.explorer, { borderLeftColor: c.border, backgroundColor: c.workspace }]}>
      <View style={[s.tabs, { borderBottomColor: c.border, paddingHorizontal: 6 }]}>
        {[
          ["Files", "Files"],
          ["Changes", "GitCompareArrows"],
          [title, icon],
        ].map(([label, glyph], index) => (
          <View key={label} style={[s.tab, { backgroundColor: index === 2 ? c.selected : "transparent" }]}>
            <Glyph name={glyph} c={c} size={11} color={index === 2 ? c.foreground : c.mutedForeground} />
            <Text numberOfLines={1} style={{ fontSize: 11, color: index === 2 ? c.foreground : c.mutedForeground }}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      <PreviewActivity pack={pack} />
    </View>
  );
}

export function PaseoPreview({
  theme,
  compact = false,
  scene = "chat",
  onSceneChange,
  items = [],
}: {
  theme: StudioTheme;
  compact?: boolean;
  scene?: PreviewScene;
  onSceneChange?: (scene: PreviewScene) => void;
  items?: PreviewTimelineItem[];
}) {
  const c = previewColors(theme);
  const [localScene, setLocalScene] = useState<PreviewScene>(scene);
  const active = onSceneChange ? scene : localScene;
  const setActive = onSceneChange ?? setLocalScene;
  const [width, setWidth] = useState(900);
  const [session, setSession] = useState("Navigation review");
  const narrow = compact || width < 560;
  const hasPanel = theme.ui.activityPanel || theme.ui.panel.enabled;
  // Wide previews show the pack panel where Paseo shows it: the explorer beside the chat.
  const explorer = hasPanel && width >= 980;
  useEffect(() => {
    if (active === "panel" && (!hasPanel || explorer)) setActive("chat");
  }, [active, hasPanel, explorer]);
  return (
    <View
      testID="paseo-preview"
      accessibilityLabel={`${theme.name} Paseo preview`}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[s.frame, { borderColor: c.border, backgroundColor: c.workspace }]}
    >
      {!narrow && <Sidebar c={c} selected={session} onSelect={setSession} />}
      <View style={s.flex}>
        <WorkspaceHeader c={c} title={session} narrow={narrow} />
        <Tabs
          c={c}
          active={active}
          onSelect={setActive}
          title={session}
          showPanelTab={hasPanel && !explorer}
          panelTitle={theme.ui.panel.enabled ? theme.ui.panel.title : "Pack activity"}
          panelIcon={theme.ui.panel.enabled ? theme.ui.panel.icon : "Activity"}
        />
        <View style={[s.flex, { backgroundColor: c.workspace }]}>
          {active === "chat" ? (
            <Chat c={c} narrow={narrow} pack={theme} items={items} />
          ) : active === "terminal" ? (
            <Terminal c={c} full />
          ) : active === "changes" ? (
            <Changes c={c} />
          ) : (
            <PreviewActivity pack={theme} />
          )}
        </View>
      </View>
      {explorer && <Explorer c={c} pack={theme} />}
    </View>
  );
}

export function PreviewActivity({ pack }: { pack: StudioTheme }) {
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
    borderRadius: 10,
    overflow: "hidden",
  },
  sidebar: { width: 196, flexShrink: 0, borderRightWidth: 1 },
  navigation: { paddingHorizontal: 6, paddingTop: 8, paddingBottom: 6 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 26, paddingHorizontal: 8 },
  divider: { height: 1 },
  sectionTitle: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  projectRow: { flexDirection: "row", alignItems: "center", gap: 7, height: 28, paddingHorizontal: 8 },
  badge: { width: 12, height: 12, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingHorizontal: 8, borderRadius: 6 },
  sessionDot: { width: 5, height: 5, borderRadius: 3, marginLeft: 3, flexShrink: 0 },
  sidebarFooter: {
    height: 36,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
  },
  workspaceHeader: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  tabs: { height: 34, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 5, borderBottomWidth: 1 },
  tab: {
    height: 24,
    borderRadius: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    maxWidth: 170,
  },
  chatContent: { paddingTop: 18, paddingBottom: 12 },
  chatColumn: { width: "100%", maxWidth: 640, alignSelf: "center", gap: 14 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
  },
  assistantText: { fontSize: 12, lineHeight: 19 },
  toolRow: { height: 26, flexDirection: "row", alignItems: "center", gap: 8 },
  toolBody: { borderWidth: 1, borderRadius: 6, overflow: "hidden", marginBottom: 6, marginTop: 2 },
  codeLine: { height: 18, flexDirection: "row", alignItems: "center" },
  codeText: { fontFamily: mono, fontSize: 10, lineHeight: 18 },
  lineNumber: { fontFamily: mono, fontSize: 10, width: 26, textAlign: "right", paddingRight: 6 },
  terminalInline: { height: 91, overflow: "hidden" },
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
  statusDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  composer: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  composerInput: {
    minHeight: 44,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 6,
    fontSize: 12,
    lineHeight: 18,
    textAlignVertical: "top",
  },
  composerFooter: {
    height: 34,
    paddingHorizontal: 10,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  sendButton: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  explorer: { width: 260, flexShrink: 0, borderLeftWidth: 1 },
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
