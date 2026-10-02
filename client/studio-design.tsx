import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { panelIcons, themeSchema, type StudioDocument, type StudioTheme } from "../shared/theme";
import { StudioButton, StudioCard, StudioLabel } from "./studio-ui";
import { RecipePanel } from "./pack-runtime";
import { previewPluginTheme } from "./preview-colors";

type PackUi = StudioTheme["ui"];
type PackPanel = PackUi["panel"];
type PanelBlock = PackPanel["blocks"][number];
type BlockType = PanelBlock["type"];
type PatchUi = (ui: Partial<PackUi>, label: string, expectedRevision: number) => Promise<void>;

function Choices<T extends string>({ theme, label, value, options, disabled, onChange }: {
  theme: PluginTheme; label: string; value: T; options: { value: T; label: string }[];
  disabled: boolean; onChange: (value: T) => void;
}) {
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>{options.map(option =>
      <StudioButton key={option.value} theme={theme} title={option.label} small active={option.value === value} disabled={disabled} onPress={() => onChange(option.value)} />)}</View>
  </View>;
}

function Stepper({ theme, label, value, min, max, unit, disabled, onChange }: {
  theme: PluginTheme; label: string; value: number; min: number; max: number; unit: string;
  disabled: boolean; onChange: (value: number) => void;
}) {
  return <View style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
    <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}>
      <StudioButton theme={theme} title={`Decrease ${label.toLowerCase()}`} icon="Minus" iconOnly small disabled={disabled || value <= min} onPress={() => onChange(Math.max(min, value - 1))} />
      <Text style={{ color: theme.colors.foreground, fontSize: 12, width: 45, textAlign: "center", fontFamily: "monospace" }}>{value}{unit}</Text>
      <StudioButton theme={theme} title={`Increase ${label.toLowerCase()}`} icon="Plus" iconOnly small disabled={disabled || value >= max} onPress={() => onChange(Math.min(max, value + 1))} />
    </View>
  </View>;
}

function Visibility({ theme, label, description, value, disabled, onChange }: {
  theme: PluginTheme; label: string; description: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void;
}) {
  return <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
      <StudioLabel theme={theme} subdued>{description}</StudioLabel>
    </View>
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)}
      style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 5, flexDirection: "row", alignItems: "center", backgroundColor: value ? theme.colors.surface2 : theme.colors.surface0, borderWidth: 1, borderColor: value ? theme.colors.accent : theme.colors.border, opacity: disabled ? 0.5 : 1 }}>
      <Icon name={value ? "Eye" : "EyeOff"} size={13} color={value ? theme.colors.accent : theme.colors.foregroundMuted} />
      <Text style={{ color: value ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12 }}>{value ? "Shown" : "Hidden"}</Text>
    </Pressable>
  </View>;
}

const blockNames: Record<BlockType, string> = { text: "Text", stat: "Stat", list: "List", progress: "Progress" };
const blockIcons: Record<BlockType, string> = { text: "Type", stat: "Hash", list: "List", progress: "ChartNoAxesColumnIncreasing" };
function newBlock(type: BlockType): PanelBlock {
  switch (type) {
    case "text": return { type, text: "A note for your workspace." };
    case "stat": return { type, label: "Open tasks", value: "3" };
    case "list": return { type, title: "Next steps", items: ["Review changes", "Run checks"] };
    case "progress": return { type, label: "Project progress", value: 50 };
  }
}

function PanelBuilder({ theme, document, busy, open, onOpenChange, onPatch }: {
  theme: PluginTheme; document: StudioDocument; busy: boolean; open: boolean; onOpenChange: (value: boolean) => void; onPatch: PatchUi;
}) {
  const [panel, setPanel] = useState<PackPanel>(() => JSON.parse(JSON.stringify(document.current.ui.panel)));
  const [revision] = useState(document.revision);
  const [error, setError] = useState<string | null>(null);
  const changed = revision !== document.revision;
  const previewPack = { ...document.current, ui: { ...document.current.ui, panel } };
  const inputStyle = { color: theme.colors.foreground, backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 7, padding: 10, fontSize: 12 };
  function patchBlock(index: number, transform: (block: PanelBlock) => PanelBlock) {
    setPanel(current => ({ ...current, blocks: current.blocks.map((block, item) => item === index ? transform(block) : block) }));
  }
  function moveBlock(index: number, direction: number) {
    setPanel(current => { const blocks = [...current.blocks]; [blocks[index], blocks[index + direction]] = [blocks[index + direction], blocks[index]]; return { ...current, blocks }; });
  }
  async function save() {
    const normalized = { ...panel, title: panel.title.trim(), blocks: panel.blocks.map(block => block.type === "list" ? { ...block, items: block.items.map(item => item.trim()).filter(Boolean) } : block) };
    const parsed = themeSchema.safeParse({ ...document.current, ui: { ...document.current.ui, panel: normalized } });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n")); return; }
    try { await onPatch({ panel: parsed.data.ui.panel }, "Edit custom panel", revision); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the panel."); }
  }
  return <Modal title="Custom panel builder" icon={<Icon name="PanelsTopLeft" size={18} color={theme.colors.foreground} />} open={open} onOpenChange={onOpenChange}>
    <Modal.Content>
      <StudioLabel theme={theme} subdued>Build a native panel from text, stats, lists, and progress bars. It is previewed in your draft and appears in Paseo when you activate the pack.</StudioLabel>
      <Visibility theme={theme} label="Custom panel" description="Register this panel with the active pack." value={panel.enabled} disabled={busy} onChange={enabled => setPanel(current => ({ ...current, enabled }))} />
      <StudioLabel theme={theme}>Panel title</StudioLabel>
      <TextInput accessibilityLabel="Custom panel title" value={panel.title} onChangeText={title => setPanel(current => ({ ...current, title }))} maxLength={48} editable={!busy} style={inputStyle} />
      <StudioLabel theme={theme}>Panel icon</StudioLabel>
      <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>{panelIcons.map(icon =>
        <StudioButton key={icon} theme={theme} title={`Panel icon ${icon}`} icon={icon} iconOnly small active={panel.icon === icon} disabled={busy} onPress={() => setPanel(current => ({ ...current, icon }))} />)}</View>
      <View style={{ gap: 13 }}>
        {panel.blocks.map((block, index) => <View key={index} style={{ padding: 12, gap: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Icon name={blockIcons[block.type]} size={14} color={theme.colors.foregroundMuted} />
            <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600", flex: 1 }}>{index + 1}. {blockNames[block.type]}</Text>
            <StudioButton theme={theme} title={`Move block ${index + 1} up`} icon="ArrowUp" iconOnly small disabled={busy || index === 0} onPress={() => moveBlock(index, -1)} />
            <StudioButton theme={theme} title={`Move block ${index + 1} down`} icon="ArrowDown" iconOnly small disabled={busy || index === panel.blocks.length - 1} onPress={() => moveBlock(index, 1)} />
            <StudioButton theme={theme} title={`Remove block ${index + 1}`} icon="Trash2" iconOnly small disabled={busy} onPress={() => setPanel(current => ({ ...current, blocks: current.blocks.filter((_, item) => item !== index) }))} />
          </View>
          {block.type === "text" ? <TextInput accessibilityLabel={`Block ${index + 1} text`} value={block.text} multiline maxLength={600} editable={!busy} style={{ ...inputStyle, minHeight: 74, textAlignVertical: "top" }}
            onChangeText={text => patchBlock(index, () => ({ ...block, text }))} /> : null}
          {block.type === "stat" ? <>
            <TextInput accessibilityLabel={`Block ${index + 1} stat label`} value={block.label} placeholder="Label" placeholderTextColor={theme.colors.foregroundMuted} maxLength={60} editable={!busy} style={inputStyle}
              onChangeText={label => patchBlock(index, () => ({ ...block, label }))} />
            <TextInput accessibilityLabel={`Block ${index + 1} stat value`} value={block.value} placeholder="Value" placeholderTextColor={theme.colors.foregroundMuted} maxLength={80} editable={!busy} style={inputStyle}
              onChangeText={value => patchBlock(index, () => ({ ...block, value }))} />
          </> : null}
          {block.type === "list" ? <>
            <TextInput accessibilityLabel={`Block ${index + 1} list title`} value={block.title} placeholder="List title" placeholderTextColor={theme.colors.foregroundMuted} maxLength={60} editable={!busy} style={inputStyle}
              onChangeText={title => patchBlock(index, () => ({ ...block, title }))} />
            <TextInput accessibilityLabel={`Block ${index + 1} list items`} value={block.items.join("\n")} multiline maxLength={2400} editable={!busy} style={{ ...inputStyle, minHeight: 90, textAlignVertical: "top" }}
              onChangeText={items => patchBlock(index, () => ({ ...block, items: items.split(/\r?\n/) }))} />
            <StudioLabel theme={theme} subdued>One list item per line, up to 12 items and 180 characters each.</StudioLabel>
          </> : null}
          {block.type === "progress" ? <>
            <TextInput accessibilityLabel={`Block ${index + 1} progress label`} value={block.label} placeholder="Progress label" placeholderTextColor={theme.colors.foregroundMuted} maxLength={60} editable={!busy} style={inputStyle}
              onChangeText={label => patchBlock(index, () => ({ ...block, label }))} />
            <Stepper theme={theme} label={`Block ${index + 1} progress`} value={block.value} min={0} max={100} unit="%" disabled={busy} onChange={value => patchBlock(index, () => ({ ...block, value }))} />
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: "hidden" }}><View style={{ width: `${block.value}%`, height: 6, backgroundColor: theme.colors.accent }} /></View>
          </> : null}
        </View>)}
      </View>
      {!panel.blocks.length ? <StudioLabel theme={theme} subdued>This panel is empty. Add a block below.</StudioLabel> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>{(["text", "stat", "list", "progress"] as BlockType[]).map(type =>
        <StudioButton key={type} theme={theme} title={`Add ${blockNames[type].toLowerCase()}`} icon="Plus" small disabled={busy || panel.blocks.length >= 12} onPress={() => setPanel(current => ({ ...current, blocks: [...current.blocks, newBlock(type)] }))} />)}</View>
      {panel.enabled ? <View style={{ gap: 8 }}><StudioLabel theme={theme}>Panel preview</StudioLabel><RecipePanel theme={previewPluginTheme(previewPack)} pack={previewPack} /></View> : null}
      {changed ? <StudioLabel theme={theme} subdued>The draft changed while this builder was open. Close and reopen it before applying.</StudioLabel> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <StudioButton theme={theme} title="Cancel" disabled={busy} onPress={() => onOpenChange(false)} />
        <StudioButton theme={theme} title="Apply panel draft" icon="Check" primary disabled={busy || changed} onPress={() => { void save(); }} />
      </View>
    </Modal.Content>
  </Modal>;
}

export function PackDesignInspector({ theme, document, busy, onPatch }: { theme: PluginTheme; document: StudioDocument; busy: boolean; onPatch: PatchUi }) {
  const ui = document.current.ui;
  const [builderOpen, setBuilderOpen] = useState(false);
  const patch = (value: Partial<PackUi>, label: string) => { void onPatch(value, label, document.revision).catch(() => {}); };
  return <View style={{ gap: 15 }}>
    <StudioCard theme={theme} title="Component layout" description="Spacing and corners for pack cards and panels.">
      <Choices theme={theme} label="Density" value={ui.density} options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }, { value: "spacious", label: "Spacious" }]} disabled={busy}
        onChange={density => patch({ density }, "Change density")} />
      <Stepper theme={theme} label="Corner radius" value={ui.radius} min={0} max={24} unit="px" disabled={busy} onChange={radius => patch({ radius }, "Change corner radius")} />
      <View style={{ backgroundColor: theme.colors.surface2, borderRadius: ui.radius, padding: 13, borderWidth: 1, borderColor: theme.colors.border }}>
        <StudioLabel theme={theme}>Card corner preview</StudioLabel>
      </View>
    </StudioCard>
    <StudioCard theme={theme} title="Pack typography" description="Fonts for pack cards, notes, and panels.">
      <Choices theme={theme} label="Font family" value={ui.fontFamily} options={[{ value: "system", label: "System" }, { value: "mono", label: "Mono" }, { value: "serif", label: "Serif" }]} disabled={busy}
        onChange={fontFamily => patch({ fontFamily }, "Change font family")} />
      <Stepper theme={theme} label="Font size" value={ui.fontSize} min={11} max={18} unit="px" disabled={busy} onChange={fontSize => patch({ fontSize }, "Change font size")} />
      <Text style={{ color: theme.colors.foreground, fontSize: ui.fontSize, lineHeight: ui.fontSize * 1.6, fontFamily: ui.fontFamily === "mono" ? "monospace" : ui.fontFamily === "serif" ? "Georgia" : undefined }}>A calmer workspace. Clear, readable text.</Text>
      <StudioLabel theme={theme} subdued>For global app typography, open Settings → Appearance → Fonts and change the interface or monospace font and size.</StudioLabel>
    </StudioCard>
    <StudioCard theme={theme} title="Tool cards and notes" description="Style the pack's notes and completed shell tool summaries.">
      <Choices theme={theme} label="Pack note style" value={ui.messageStyle} options={[{ value: "plain", label: "Plain" }, { value: "card", label: "Card" }]} disabled={busy}
        onChange={messageStyle => patch({ messageStyle }, "Change pack note style")} />
      <Choices theme={theme} label="Completed shell tool cards" value={ui.toolCards} options={[{ value: "native", label: "Native" }, { value: "compact", label: "Compact" }, { value: "bordered", label: "Bordered" }]} disabled={busy}
        onChange={toolCards => patch({ toolCards }, "Change completed shell tool cards")} />
      <Visibility theme={theme} label="Activity panel" description="Show the pack's workspace activity panel." value={ui.activityPanel} disabled={busy}
        onChange={activityPanel => patch({ activityPanel }, "Change activity panel")} />
    </StudioCard>
    <StudioCard theme={theme} title="Custom panel" description="Add a panel built from native blocks, with your own title and content.">
      <Visibility theme={theme} label="Custom panel visibility" description={`${ui.panel.title} · ${ui.panel.blocks.length} ${ui.panel.blocks.length === 1 ? "block" : "blocks"}`} value={ui.panel.enabled} disabled={busy}
        onChange={enabled => patch({ panel: { ...ui.panel, enabled } }, "Change custom panel visibility")} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <StudioButton theme={theme} title="Edit panel blocks" icon="PanelsTopLeft" small disabled={busy} onPress={() => setBuilderOpen(true)} />
      </View>
      {builderOpen ? <PanelBuilder theme={theme} document={document} busy={busy} open={builderOpen} onOpenChange={setBuilderOpen} onPatch={onPatch} /> : null}
    </StudioCard>
  </View>;
}
