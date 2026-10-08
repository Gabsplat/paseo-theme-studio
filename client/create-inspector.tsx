import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  briefExtras,
  briefMoods,
  composeBrief,
  mixIsEmpty,
  mixPatch,
  mixSlots,
  type Brief,
  type BriefExtra,
  type Mix,
  type MixSlot,
} from "../shared/brief";
import { presets } from "../shared/presets";
import type { StudioPreferences } from "../shared/preferences";
import type { ColorKey, StudioAction, StudioDocument, StudioTheme } from "../shared/theme";
import { SparkPanel } from "./spark-panel";
import { statusColor, type DesignerStatus } from "./designer-status";
import { PackThumbnail } from "./pack-thumbnail";
import { Eyebrow, monoFont, StudioButton, StudioChip, StudioLabel, StudioSegments } from "./studio-ui";

type Draft = Omit<Brief, "context">;
const emptyDraft: Draft = { subject: "", appearance: "any", moods: [], mix: {}, extras: ["contrast"], variants: 3 };
// The brief survives switching tabs while Paseo keeps the plugin loaded.
let rememberedDraft: Draft = emptyDraft;

function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

function PackPicker({
  theme,
  slot,
  packs,
  onPick,
  onClose,
}: {
  theme: PluginTheme;
  slot: MixSlot | null;
  packs: StudioTheme[];
  onPick: (pack: StudioTheme) => void;
  onClose: () => void;
}) {
  const c = theme.colors;
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const meta = mixSlots.find(item => item.id === slot);
  return (
    <Modal
      title={meta ? `Take ${meta.label.toLowerCase()} from` : "Choose a pack"}
      icon={<Icon name="Blend" size={18} color={c.foreground} />}
      open={slot !== null}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <Modal.Content>
        <TextInput
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search packs"
          placeholder="Search packs…"
          placeholderTextColor={c.foregroundMuted}
          style={{
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            color: c.foreground,
            fontSize: 13,
            backgroundColor: c.surface0,
          }}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {packs
            .filter(pack => !needle || pack.name.toLowerCase().includes(needle))
            .slice(0, 60)
            .map(pack => (
              <Pressable
                key={pack.id}
                accessibilityRole="button"
                accessibilityLabel={`Take from ${pack.name}`}
                onPress={() => onPick(pack)}
                style={({ pressed }) => ({
                  width: 132,
                  flexGrow: 1,
                  maxWidth: 200,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: c.border,
                  overflow: "hidden",
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <PackThumbnail pack={pack} height={64} />
                <View style={{ paddingHorizontal: 8, paddingVertical: 6, borderTopWidth: 1, borderColor: c.border }}>
                  <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12 }}>
                    {pack.name}
                  </Text>
                  <Eyebrow theme={theme}>
                    {slot === "shape"
                      ? `r${pack.ui.radius} · ${pack.ui.density}`
                      : slot === "type"
                        ? `${pack.ui.fontFamily} ${pack.ui.fontSize} · ${pack.ui.toolCards}`
                        : pack.appearance}
                  </Eyebrow>
                </View>
              </Pressable>
            ))}
        </View>
      </Modal.Content>
    </Modal>
  );
}

/**
 * The brief builder: describe an idea, borrow parts of existing packs, and send
 * the result to the designer. Mixing packs applies at once and needs no agent.
 */
export function CreateInspector({
  theme,
  document,
  busy,
  context,
  status,
  takes,
  sending,
  sendError,
  canSend,
  preferences,
  onSavePreferences,
  onSend,
  onApply,
  onRemoveContext,
  onOpenDesigner,
  onDesignerSettings,
}: {
  theme: PluginTheme;
  document: StudioDocument;
  busy: boolean;
  /** Things pointed at in the preview. */
  context: string[];
  status: DesignerStatus | null;
  /** Packs the designer saved since the last brief was sent. */
  takes: StudioTheme[];
  sending: boolean;
  sendError: string | null;
  canSend: boolean;
  preferences: StudioPreferences | undefined;
  onSavePreferences: (patch: Partial<StudioPreferences>) => void;
  onSend: (text: string) => void;
  onApply: (action: StudioAction) => Promise<unknown>;
  onRemoveContext: (item: string) => void;
  onOpenDesigner: () => void;
  onDesignerSettings: () => void;
}) {
  const c = theme.colors;
  const [draft, setDraftState] = useState<Draft>(rememberedDraft);
  const [picking, setPicking] = useState<MixSlot | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mixed, setMixed] = useState<string | null>(null);
  function setDraft(patch: Partial<Draft>) {
    rememberedDraft = { ...draft, ...patch };
    setDraftState(rememberedDraft);
    setCopied(false);
  }
  const setMix = (mix: Mix) => (setMixed(null), setDraft({ mix }));
  const packs = [...document.saved, ...presets.filter(preset => !document.saved.some(item => item.id === preset.id))];
  const text = composeBrief({ ...draft, context });
  const ready = Boolean(draft.subject.trim() || draft.moods.length || !mixIsEmpty(draft.mix) || context.length);
  const mixNames = mixSlots.flatMap(slot => (draft.mix[slot.id] ? [draft.mix[slot.id]!.name] : []));

  async function applyMix() {
    try {
      await onApply({
        type: "patch",
        ...mixPatch(draft.mix, document.locks),
        label: `Mix: ${[...new Set(mixNames)].join(" + ")}`.slice(0, 200),
      });
      setMixed(
        draft.mix.colors && document.locks.length
          ? "Mixed into the draft. Locked colors were kept."
          : "Mixed into the draft. Undo brings the previous look back.",
      );
    } catch {
      /* The studio reports the error. */
    }
  }

  return (
    <View style={{ paddingVertical: 14, gap: 18 }}>
      {/* The answer to the last brief comes first. */}
      {takes.length ? (
        <View style={{ gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderColor: c.border }}>
          <Eyebrow theme={theme}>
            {takes.length} {takes.length === 1 ? "take" : "takes"} from the designer
          </Eyebrow>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {takes.map(take => {
              const current = document.current.id === take.id;
              return (
                <View
                  key={take.id}
                  style={{
                    width: 150,
                    flexGrow: 1,
                    maxWidth: 240,
                    borderRadius: 10,
                    borderWidth: current ? 1.5 : 1,
                    borderColor: current ? c.accent : c.border,
                    overflow: "hidden",
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Preview ${take.name}`}
                    accessibilityState={{ selected: current }}
                    disabled={busy}
                    onPress={() => void onApply({ type: "load", id: take.id }).catch(() => {})}
                  >
                    <PackThumbnail pack={take} height={78} />
                  </Pressable>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingLeft: 9,
                      paddingRight: 3,
                      paddingVertical: 3,
                      borderTopWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 12 }}>
                      {take.name}
                    </Text>
                    <StudioButton
                      theme={theme}
                      title={`Discard ${take.name}`}
                      icon="Trash2"
                      small
                      iconOnly
                      disabled={busy}
                      onPress={() => void onApply({ type: "delete", id: take.id }).catch(() => {})}
                    />
                  </View>
                </View>
              );
            })}
          </View>
          <StudioLabel theme={theme} subdued>
            Tap a take to load it into the draft. Kept takes stay in Packs; nothing is active until you press Activate.
          </StudioLabel>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Eyebrow theme={theme}>Idea</Eyebrow>
        <TextInput
          value={draft.subject}
          onChangeText={subject => setDraft({ subject })}
          accessibilityLabel="Theme idea"
          placeholder="Spider-Man. Deep red and midnight blue, comic ink."
          placeholderTextColor={c.foregroundMuted}
          multiline
          maxLength={600}
          style={{
            minHeight: 62,
            textAlignVertical: "top",
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 8,
            paddingHorizontal: 11,
            paddingVertical: 9,
            color: c.foreground,
            fontSize: 13,
            lineHeight: 19,
            backgroundColor: c.surface0,
          }}
        />
        <SparkPanel
          theme={theme}
          input={{ subject: draft.subject, moods: [...draft.moods], appearance: draft.appearance }}
          base={document.current}
          busy={busy}
          preferences={preferences}
          appliedColors={JSON.stringify(document.current.colors)}
          onSavePreferences={onSavePreferences}
          onSubject={subject => setDraft({ subject: subject.slice(0, 600) })}
          onMood={mood => setDraft({ moods: toggled(draft.moods, mood) })}
          onApplyLook={(look, subject) =>
            void onApply({
              type: "patch",
              colors: Object.fromEntries(
                Object.entries(look.colors).filter(([key]) => !document.locks.includes(key as ColorKey)),
              ),
              appearance: look.appearance,
              label: `Look: ${look.name}${subject ? ` (${subject})` : ""}`.slice(0, 200),
            }).catch(() => {})
          }
        />
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow theme={theme}>Mood</Eyebrow>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {briefMoods.map(mood => (
            <StudioChip
              key={mood}
              theme={theme}
              label={mood}
              selected={draft.moods.includes(mood)}
              onPress={() => setDraft({ moods: toggled(draft.moods, mood) })}
            />
          ))}
        </View>
        <StudioSegments
          theme={theme}
          value={draft.appearance}
          onChange={appearance => setDraft({ appearance })}
          options={[
            { value: "any", label: "Either" },
            { value: "dark", label: "Dark", icon: "Moon" },
            { value: "light", label: "Light", icon: "Sun" },
          ]}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow theme={theme}>Take from</Eyebrow>
        <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, overflow: "hidden" }}>
          {mixSlots.map((slot, index) => {
            const pack = draft.mix[slot.id];
            return (
              <View
                key={slot.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderTopWidth: index ? 1 : 0,
                  borderColor: c.border,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${slot.label}: ${pack ? pack.name : "choose a pack"}`}
                  onPress={() => setPicking(slot.id)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minWidth: 0,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 8,
                    backgroundColor: pressed ? c.surface2 : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 58,
                      height: 38,
                      borderRadius: 6,
                      overflow: "hidden",
                      borderWidth: 1,
                      borderStyle: pack ? "solid" : "dashed",
                      borderColor: c.border,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {pack ? (
                      <View style={{ width: "100%" }}>
                        <PackThumbnail pack={pack} height={38} />
                      </View>
                    ) : (
                      <Icon name="Plus" size={14} color={c.foregroundMuted} />
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "500" }}>
                      {slot.label}
                    </Text>
                    <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>
                      {pack ? pack.name : slot.detail}
                    </Text>
                  </View>
                </Pressable>
                {pack ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Clear ${slot.label.toLowerCase()}`}
                    onPress={() => setMix({ ...draft.mix, [slot.id]: undefined })}
                    hitSlop={6}
                    style={{ padding: 10 }}
                  >
                    <Icon name="X" size={14} color={c.foregroundMuted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StudioButton
            theme={theme}
            title="Mix into draft"
            icon="Blend"
            small
            disabled={busy || mixIsEmpty(draft.mix)}
            onPress={() => void applyMix()}
          />
          <View style={{ flex: 1 }}>
            <StudioLabel theme={theme} subdued>
              {mixed ?? "Instant. No agent needed."}
            </StudioLabel>
          </View>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow theme={theme}>Also</Eyebrow>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {briefExtras.map(extra => (
            <StudioChip
              key={extra.id}
              theme={theme}
              label={extra.label}
              selected={draft.extras.includes(extra.id)}
              onPress={() => setDraft({ extras: toggled<BriefExtra>(draft.extras, extra.id) })}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow theme={theme}>Takes</Eyebrow>
        <StudioSegments
          theme={theme}
          value={String(draft.variants)}
          onChange={value => setDraft({ variants: Number(value) })}
          options={["1", "2", "3", "4"].map(value => ({ value, label: value }))}
        />
      </View>

      {context.length ? (
        <View style={{ gap: 8 }}>
          <Eyebrow theme={theme}>Pointing at</Eyebrow>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {context.map(item => (
              <StudioChip
                key={item}
                theme={theme}
                label={item}
                swatch={/#[0-9A-Fa-f]{3,8}$/.exec(item)?.[0]}
                onRemove={() => onRemoveContext(item)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: c.border }}>
        <StudioButton
          theme={theme}
          title={sending ? "Sending…" : status?.working ? "Designer is working…" : "Send to designer"}
          icon="Sparkles"
          primary
          disabled={!ready || sending || !canSend || Boolean(status?.working)}
          onPress={() => onSend(text)}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Designer settings"
            onPress={onDesignerSettings}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1 }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor(theme, status) }} />
            <Eyebrow theme={theme}>Designer · {status ? status.label : "starts on send"}</Eyebrow>
          </Pressable>
          <StudioButton
            theme={theme}
            title={showBrief ? "Hide brief" : "Show brief"}
            icon="FileText"
            small
            active={showBrief}
            onPress={() => setShowBrief(!showBrief)}
          />
          <StudioButton theme={theme} title="Open chat" icon="MessageSquare" small iconOnly onPress={onOpenDesigner} />
        </View>
        {sendError ? (
          <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12, lineHeight: 18 }}>
            {sendError}
          </Text>
        ) : null}
        {!canSend ? (
          <StudioLabel theme={theme} subdued>
            Update the Paseo app to send briefs from the studio.
          </StudioLabel>
        ) : null}
        {showBrief ? (
          <View style={{ gap: 6 }}>
            <Text
              selectable
              style={{
                color: c.foreground,
                fontFamily: monoFont,
                fontSize: 11,
                lineHeight: 17,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface0,
              }}
            >
              {text}
            </Text>
            <View style={{ flexDirection: "row" }}>
              <StudioButton
                theme={theme}
                title={copied ? "Copied" : "Copy brief"}
                icon={copied ? "Check" : "Copy"}
                small
                onPress={() => void copyText(text).then(() => setCopied(true))}
              />
            </View>
          </View>
        ) : null}
      </View>

      <PackPicker
        theme={theme}
        slot={picking}
        packs={packs}
        onClose={() => setPicking(null)}
        onPick={pack => {
          if (picking) setMix({ ...draft.mix, [picking]: pack });
          setPicking(null);
        }}
      />
    </View>
  );
}
