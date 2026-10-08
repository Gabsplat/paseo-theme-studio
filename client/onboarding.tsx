import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { colorKeys, type StudioTheme } from "../shared/theme";
import { examplePrompts } from "./designer-inspector";
import { StudioButton } from "./studio-ui";
import { useAgentConnection } from "./agent-connection";

type Props = { theme: PluginTheme; pack: StudioTheme; mcpConnected: boolean };

// Small building blocks for the diagrams. They use the host theme so the
// onboarding sits naturally inside Paseo, and the draft pack where it is shown.

function Box({
  theme,
  children,
  tone = "surface1",
  flex,
  dashed = false,
}: {
  theme: PluginTheme;
  children: ReactNode;
  tone?: "surface0" | "surface1" | "surface2";
  flex?: number;
  dashed?: boolean;
}) {
  return (
    <View
      style={{
        // Side-by-side when there is room; stacked in narrow panels.
        ...(flex ? { flexGrow: flex, flexBasis: 150 } : {}),
        minWidth: 0,
        padding: 10,
        gap: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: dashed ? "dashed" : "solid",
        borderColor: theme.colors.border,
        backgroundColor: theme.colors[tone],
      }}
    >
      {children}
    </View>
  );
}

function Caption({ theme, icon, title, text }: { theme: PluginTheme; icon: string; title: string; text?: string }) {
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={13} color={theme.colors.accent} />
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
        >
          {title}
        </Text>
      </View>
      {text ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>{text}</Text> : null}
    </View>
  );
}

function Arrow({ theme, label }: { theme: PluginTheme; label?: string }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 2, gap: 2 }}>
      <Icon name="ArrowRight" size={16} color={theme.colors.foregroundMuted} />
      {label ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{label}</Text> : null}
    </View>
  );
}

function Marker({ theme, n }: { theme: PluginTheme; n: number }) {
  return (
    <View
      style={{
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.accent,
      }}
    >
      <Text style={{ color: theme.colors.accentForeground, fontSize: 10, fontWeight: "700" }}>{n}</Text>
    </View>
  );
}

function Swatches({ pack, size = 16 }: { pack: StudioTheme; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 3, flexWrap: "wrap" }}>
      {colorKeys.map(key => (
        <View
          key={key}
          style={{
            width: size,
            height: size,
            borderRadius: 4,
            backgroundColor: pack.colors[key],
            borderWidth: 1,
            borderColor: "#00000022",
          }}
        />
      ))}
    </View>
  );
}

function Legend({ theme, items }: { theme: PluginTheme; items: { icon: string; name: string; text: string }[] }) {
  return (
    <View style={{ gap: 7 }}>
      {items.map(item => (
        <View key={item.name} style={{ flexDirection: "row", gap: 9, alignItems: "flex-start" }}>
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Icon name={item.icon} size={13} color={theme.colors.foreground} />
          </View>
          <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{item.name}</Text> {item.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Welcome({ theme, pack, mcpConnected }: Props) {
  const p = pack.colors;
  return (
    <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
      <Box theme={theme} flex={1}>
        <Caption theme={theme} icon="Palette" title="Palette" text="Eight colors that repaint all of Paseo." />
        <Swatches pack={pack} />
      </Box>
      <Box theme={theme} flex={1}>
        <Caption theme={theme} icon="LayoutTemplate" title="UI pack" text="Styles for tool cards, notes, and panels." />
        <View style={{ padding: 7, borderRadius: pack.ui.radius, backgroundColor: p.raised, gap: 4 }}>
          <View style={{ height: 5, width: "70%", borderRadius: 3, backgroundColor: p.foreground }} />
          <View style={{ height: 5, width: "45%", borderRadius: 3, backgroundColor: p.mutedForeground }} />
          <View style={{ height: 5, width: "60%", borderRadius: 3, backgroundColor: p.accent }} />
        </View>
      </Box>
      {mcpConnected ? (
        <Box theme={theme} flex={1}>
          <Caption theme={theme} icon="Blocks" title="Components" text="Native cards your agents show in chat." />
          <View style={{ flexDirection: "row", gap: 4 }}>
            {["Yes", "No"].map(label => (
              <View
                key={label}
                style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: p.control }}
              >
                <Text style={{ color: p.foreground, fontSize: 10 }}>{label}</Text>
              </View>
            ))}
          </View>
        </Box>
      ) : null}
    </View>
  );
}

function StudioMap({ theme, mcpConnected }: Props) {
  const c = theme.colors;
  const pill = (label: string) => (
    <View
      key={label}
      style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: c.border }}
    >
      <Text style={{ color: c.foregroundMuted, fontSize: 9 }}>{label}</Text>
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, overflow: "hidden" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            padding: 7,
            borderBottomWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
            flexWrap: "wrap",
          }}
        >
          <Marker theme={theme} n={1} />
          <Text style={{ color: c.foreground, fontSize: 10, fontWeight: "600" }}>Pack · Active</Text>
          <View style={{ flex: 1 }} />
          {["Undo", "Redo", "History", "Light/Dark", "Save", "Designer"].map(pill)}
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: c.accent }}>
            <Text style={{ color: c.accentForeground, fontSize: 9, fontWeight: "600" }}>Activate</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", minHeight: 120 }}>
          <View style={{ flex: 1, padding: 10, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Marker theme={theme} n={2} />
              <Text style={{ color: c.foreground, fontSize: 11, fontWeight: "600" }}>Live Paseo preview</Text>
            </View>
            {[80, 55, 70, 40].map((width, index) => (
              <View
                key={index}
                style={{ height: 6, width: `${width}%`, borderRadius: 3, backgroundColor: c.surface2 }}
              />
            ))}
          </View>
          <View style={{ width: "36%", padding: 10, gap: 6, borderLeftWidth: 1, borderColor: c.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Marker theme={theme} n={3} />
              <Text style={{ color: c.foreground, fontSize: 11, fontWeight: "600" }}>Inspector</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 3, flexWrap: "wrap" }}>
              {["Colors", "Design", ...(mcpConnected ? ["Components"] : []), "Packs", "Designer"].map(pill)}
            </View>
          </View>
        </View>
      </View>
      <Legend
        theme={theme}
        items={[
          {
            icon: "Undo2",
            name: "1 · Top bar.",
            text: "Undo and redo draft edits, open History, switch light/dark, save a copy, open the designer, and Activate.",
          },
          {
            icon: "Monitor",
            name: "2 · Preview.",
            text: "A working miniature of Paseo with your draft. Click its sidebar and tabs; type in its composer.",
          },
          {
            icon: "SlidersHorizontal",
            name: "3 · Inspector.",
            text: "Change what you edit without losing the preview. On narrow screens it sits below.",
          },
        ]}
      />
    </View>
  );
}

function DraftFlow({ theme }: Props) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "stretch", gap: 4, flexWrap: "wrap" }}>
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="Pencil"
            title="Draft"
            text="You and the designer edit it. Paseo doesn't change yet."
          />
        </Box>
        <Arrow theme={theme} label="Activate" />
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="CircleCheck"
            title="Active pack"
            text="Its extensions turn on: tool cards, notes, panels."
          />
        </Box>
        <Arrow theme={theme} />
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="Settings"
            title="Paseo colors"
            text="Choose Theme Studio · Live once in Settings → Appearance."
          />
        </Box>
      </View>
      <Legend
        theme={theme}
        items={[
          { icon: "LockKeyhole", name: "Locks", text: "protect colors you love from presets, undo, and the designer." },
          { icon: "Save", name: "Save pack", text: "keeps a named copy in Packs → Your library. It doesn't activate." },
          { icon: "Power", name: "Revert and Disable", text: "live in Packs, in case an active pack isn't right." },
          {
            icon: "Type",
            name: "Typography",
            text: "applies to the pack's own cards and panels. Paseo's fonts are in Settings → Appearance → Fonts.",
          },
        ]}
      />
    </View>
  );
}

function McpFlow({ theme }: Props) {
  const c = theme.colors;
  const { query, mutation } = useAgentConnection();
  const connected = query.data?.enabled === true;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "stretch", gap: 4, flexWrap: "wrap" }}>
        <Box theme={theme} flex={1}>
          <Caption theme={theme} icon="User" title="You" text="Describe what you want in the designer chat." />
        </Box>
        <Arrow theme={theme} label="chat" />
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="Bot"
            title="Designer agent"
            text="A normal Paseo agent with Theme Studio's tools."
          />
        </Box>
        <Arrow theme={theme} label="MCP" />
        <Box theme={theme} flex={1}>
          <Caption theme={theme} icon="Palette" title="Your draft" text="The preview updates as it edits." />
        </Box>
      </View>
      <Box theme={theme} tone="surface0" dashed>
        <Text style={{ color: c.foreground, fontSize: 12, lineHeight: 18 }}>
          <Text style={{ fontWeight: "600" }}>MCP connects agents to Theme Studio.</Text> They can edit your draft and
          use interactive blocks in chat. You still activate packs and generated code yourself. The dedicated designer
          is already connected.
        </Text>
      </Box>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="Plug"
            title="Connect · recommended"
            text="New agents get cards, buttons and inputs. Adds Theme Studio tools and instructions to their context."
          />
        </Box>
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="Palette"
            title="Keep it off · optional"
            text="Keep editing themes and using the designer. Other new agents won't get block tools, and Components stays hidden."
          />
        </Box>
      </View>
      <StudioButton
        theme={theme}
        title={connected ? "MCP connected" : mutation.isPending ? "Connecting…" : "Connect MCP"}
        icon={connected ? "Check" : "Plug"}
        primary={!connected}
        small
        disabled={connected || !query.data || mutation.isPending}
        onPress={() => query.data && mutation.mutate({ expectedRevision: query.data.revision, enabled: true })}
      />
      <Text style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        Applies to new Codex, Claude Code and OpenCode agents. Existing chats keep their tools. You can connect or stop
        new connections later in Designer.
      </Text>
      {query.error || mutation.error ? (
        <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12 }}>
          {(mutation.error ?? query.error)?.message}
        </Text>
      ) : null}
    </View>
  );
}

function ComponentFlow({ theme }: Props) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="Sparkles"
            title="Always custom"
            text="An agent designs each component for the job. Nothing is assembled from pre-made blocks."
          />
        </Box>
        <Box theme={theme} flex={1}>
          <Caption
            theme={theme}
            icon="Code2"
            title="No frame"
            text="It appears in the chat exactly as designed. You review its source and activate it before it runs."
          />
        </Box>
      </View>
      <View style={{ flexDirection: "row", alignItems: "stretch", gap: 4, flexWrap: "wrap" }}>
        {[
          ["Sparkles", "Create", "Ask the designer, or use the library."],
          ["Eye", "Preview", "Select it in Components to see it in the preview chat."],
          ["Send", "Use in agent", "Publish it to a real chat, or let a trigger show it."],
          ["MousePointerClick", "Interact", "Clicks reach the agent; it updates the card."],
        ].map(([icon, title, text], index, all) => (
          <View key={title} style={{ flexDirection: "row", flex: 1, minWidth: 120, gap: 4 }}>
            <Box theme={theme} flex={1}>
              <Caption theme={theme} icon={icon} title={title} text={text} />
            </Box>
            {index < all.length - 1 ? <Arrow theme={theme} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function Tips({ theme, mcpConnected }: Props) {
  const c = theme.colors;
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <View style={{ gap: 12 }}>
      <Legend
        theme={theme}
        items={[
          { icon: "Target", name: "Be specific.", text: "Name the mood, the colors to keep, and what to avoid." },
          { icon: "LockKeyhole", name: "Lock first.", text: "Lock the colors you love before asking for big changes." },
          { icon: "Contrast", name: "Check contrast.", text: "Ask the designer to keep text at 4.5:1 or better." },
          {
            icon: "Save",
            name: "Save before experiments.",
            text: "Undo covers small steps; a saved pack covers big ones.",
          },
        ]}
      />
      <View style={{ gap: 2 }}>
        <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600", marginBottom: 4 }}>
          Try asking · tap to copy
        </Text>
        {(mcpConnected ? examplePrompts : examplePrompts.slice(0, -1)).map((prompt, index) => (
          <Pressable
            key={prompt}
            accessibilityRole="button"
            accessibilityLabel={`Copy prompt: ${prompt}`}
            onPress={() => {
              void copyText(prompt).then(() => setCopied(index));
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 8,
              paddingVertical: 6,
              paddingHorizontal: 8,
              borderRadius: 8,
              backgroundColor: pressed ? c.surface2 : "transparent",
            })}
          >
            <Icon
              name={copied === index ? "Check" : "Copy"}
              size={13}
              color={copied === index ? c.statusSuccess : c.foregroundMuted}
            />
            <Text style={{ flex: 1, color: c.foreground, fontSize: 12, lineHeight: 18 }}>“{prompt}”</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const steps: { title: string; body: string; Visual: (props: Props) => ReactNode }[] = [
  {
    title: "Welcome to Theme Studio",
    body: "Design how Paseo looks and give your agents native UI. Everything happens on a draft you can see live before it touches Paseo.",
    Visual: Welcome,
  },
  {
    title: "Your workspace",
    body: "The preview always stays in view. The top bar holds actions; the inspector on the right changes what you edit.",
    Visual: StudioMap,
  },
  {
    title: "Draft first, then activate",
    body: "Nothing changes in Paseo until you press Activate. You can undo, save copies, and revert at any time.",
    Visual: DraftFlow,
  },
  {
    title: "Connect your agents",
    body: "Enable blocks in your agents' chats with the optional MCP connection. You can also continue with it off.",
    Visual: McpFlow,
  },
  {
    title: "Components for your agents",
    body: "Reusable cards that agents can place in their chats to ask, show, or confirm things. Choices come back to the agent.",
    Visual: ComponentFlow,
  },
  {
    title: "Get the most out of it",
    body: "A few habits make the designer faster and the results better.",
    Visual: Tips,
  },
];

/** First-run walkthrough. Reopen it any time from the help button. */
export function Onboarding({
  theme,
  pack,
  mcpConnected,
  canOpenDesigner,
  onFinish,
  onOpenDesigner,
}: Props & { canOpenDesigner: boolean; onFinish: () => void; onOpenDesigner: () => void }) {
  const [index, setIndex] = useState(0);
  const tourSteps = mcpConnected ? steps : steps.filter(step => step.Visual !== ComponentFlow);
  const currentIndex = Math.min(index, tourSteps.length - 1);
  const step = tourSteps[currentIndex];
  const last = currentIndex === tourSteps.length - 1;
  const c = theme.colors;
  return (
    <View
      accessibilityViewIsModal
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backgroundColor: "#00000099",
      }}
    >
      <View
        testID="theme-studio-onboarding"
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "100%",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface0,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingTop: 14 }}>
          <Icon name="Palette" size={15} color={c.accent} />
          <Text style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>
            Theme Studio · {currentIndex + 1} of {tourSteps.length}
          </Text>
          <StudioButton theme={theme} title="Skip tour" small onPress={onFinish} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 14, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: 20, fontWeight: "600" }}>
              {step.title}
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{step.body}</Text>
          </View>
          <step.Visual theme={theme} pack={pack} mcpConnected={mcpConnected} />
        </ScrollView>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 18,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderColor: c.border,
            flexWrap: "wrap",
          }}
        >
          <View style={{ flexDirection: "row", gap: 5, flex: 1 }}>
            {tourSteps.map((item, dot) => (
              <Pressable
                key={item.title}
                accessibilityRole="button"
                accessibilityLabel={`Go to step ${dot + 1}: ${item.title}`}
                onPress={() => setIndex(dot)}
                style={{
                  width: dot === currentIndex ? 18 : 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: dot === currentIndex ? c.accent : c.surface2,
                }}
              />
            ))}
          </View>
          {currentIndex > 0 ? (
            <StudioButton
              theme={theme}
              title="Back"
              icon="ArrowLeft"
              small
              onPress={() => setIndex(currentIndex - 1)}
            />
          ) : null}
          {last && canOpenDesigner ? (
            <StudioButton
              theme={theme}
              title="Open the designer"
              icon="MessageSquare"
              small
              onPress={() => {
                onFinish();
                onOpenDesigner();
              }}
            />
          ) : null}
          <StudioButton
            theme={theme}
            title={last ? "Start designing" : "Next"}
            icon={last ? "Check" : "ArrowRight"}
            primary
            small
            onPress={() => (last ? onFinish() : setIndex(currentIndex + 1))}
          />
        </View>
      </View>
    </View>
  );
}
