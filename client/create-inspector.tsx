import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import {
  briefMoods,
  composeBrief,
  mixIsEmpty,
  mixPatch,
  mixSlots,
  splitTakeName,
  type Mix,
  type MixSlot,
} from "../shared/brief";
import type { StudioPreferences } from "../shared/preferences";
import { presets } from "../shared/presets";
import {
  colorKeys,
  colorLabels,
  type ColorKey,
  type StudioAction,
  type StudioDocument,
  type StudioTheme,
} from "../shared/theme";
import { statusColor, type DesignerStatus } from "./designer-status";
import { PackThumbnail } from "./pack-thumbnail";
import { Eyebrow, monoFont, StudioButton, StudioLabel } from "./studio-ui";

/** Parts of the preview the user can point at, and the color that paints most of each. */
export const previewParts = [
  { id: "Sidebar", role: (light: boolean): ColorKey => (light ? "control" : "background") },
  { id: "Messages", role: (): ColorKey => "foreground" },
  { id: "Tool card", role: (): ColorKey => "border" },
  { id: "Composer", role: (): ColorKey => "control" },
] as const;

const ideas = [
  "Spider-Man, comic ink",
  "Blade Runner 2049 in the rain",
  "Studio Ghibli forest at dusk",
  "Old Macintosh, System 7",
  "Amber terminal in a submarine",
  "Windows 98, but beautiful",
  "Tokyo vending machines at 3am",
  "Deep sea bioluminescence",
  "Risograph zine, two inks",
  "Italian espresso bar, 1962",
  "Aurora over a black lake",
  "Bauhaus primary blocks",
];
const pickIdeas = () => [...ideas].sort(() => Math.random() - 0.5).slice(0, 3);

type Menu = "mode" | "mood" | "mix" | "point" | "takes" | null;
type Draft = {
  mode: "new" | "remix";
  subject: string;
  appearance: "any" | "dark" | "light";
  moods: string[];
  mix: Mix;
  variants: number;
  /** "part:Tool card", "color:accent", or "component". */
  pointing: string[];
};
const emptyDraft: Draft = {
  mode: "new",
  subject: "",
  appearance: "any",
  moods: [],
  mix: {},
  variants: 3,
  pointing: [],
};
// The brief survives switching tabs while Paseo keeps the plugin loaded.
let remembered: Draft = emptyDraft;

function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value];
}

/** A placeholder that breathes while the designer works on a take. */
function Pending({ theme, delay }: { theme: PluginTheme; delay: number }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 0.85, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={{
        flexGrow: 1,
        flexBasis: 140,
        height: 112,
        borderRadius: 10,
        backgroundColor: theme.colors.surface2,
        opacity,
      }}
    />
  );
}

/** A compact control in the composer; menus open only when one is pressed. */
function Pill({
  theme,
  label,
  icon,
  active = false,
  set = false,
  iconOnly = false,
  onPress,
  onRemove,
}: {
  theme: PluginTheme;
  label: string;
  icon?: string;
  active?: boolean;
  /** Shows only the icon; the label stays as the accessible name. */
  iconOnly?: boolean;
  /** Has a non-default value. */
  set?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const c = theme.colors;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 28,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active || set ? c.accent : c.border,
        backgroundColor: active ? c.surface2 : "transparent",
        maxWidth: "100%",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: active }}
        onPress={onPress}
        hitSlop={4}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          paddingLeft: iconOnly ? 8 : 10,
          paddingRight: onRemove ? 4 : iconOnly ? 8 : 10,
          flexShrink: 1,
        }}
      >
        {icon ? <Icon name={icon} size={13} color={set ? c.accent : c.foregroundMuted} /> : null}
        {!iconOnly ? (
          <Text
            numberOfLines={1}
            style={{ color: set ? c.foreground : c.foregroundMuted, fontSize: 12, flexShrink: 1 }}
          >
            {label}
          </Text>
        ) : null}
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          onPress={onRemove}
          hitSlop={6}
          style={{ paddingLeft: 2, paddingRight: 9 }}
        >
          <Icon name="X" size={11} color={c.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A choice inside an open menu. Hovering it can highlight the matching part of the preview. */
function Option({
  theme,
  label,
  selected,
  swatch,
  onPress,
  onHover,
}: {
  theme: PluginTheme;
  label: string;
  selected: boolean;
  swatch?: string;
  onPress: () => void;
  onHover?: (on: boolean) => void;
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => onHover?.(true)}
      onHoverOut={() => onHover?.(false)}
      onPressIn={() => onHover?.(true)}
      onPressOut={() => onHover?.(false)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: selected ? c.accent : c.border,
        backgroundColor: selected || pressed ? c.surface2 : "transparent",
      })}
    >
      {swatch ? (
        <View
          style={{
            width: 11,
            height: 11,
            borderRadius: 6,
            backgroundColor: swatch,
            borderWidth: 1,
            borderColor: c.border,
          }}
        />
      ) : null}
      <Text style={{ color: selected ? c.foreground : c.foregroundMuted, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
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
                </View>
              </Pressable>
            ))}
        </View>
      </Modal.Content>
    </Modal>
  );
}

/** A large choice on the first screen. */
function StartCard({
  theme,
  title,
  detail,
  selected = false,
  onPress,
  children,
}: {
  theme: PluginTheme;
  title: string;
  detail: string;
  selected?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 150,
        borderRadius: 12,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? c.accent : c.border,
        overflow: "hidden",
        backgroundColor: pressed ? c.surface2 : c.surface1,
      })}
    >
      {children}
      <View style={{ padding: 10, gap: 2, borderTopWidth: 1, borderColor: c.border }}>
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{title}</Text>
        <Text numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Create: a canvas above (where to start, then the designer's takes as they arrive) and a
 * composer fixed below, so the brief and its send button are always in reach.
 */
export function CreateWorkspace({
  theme,
  document,
  busy,
  status,
  takes,
  preferences,
  sending,
  sendError,
  componentName,
  onSend,
  onApply,
  onHighlight,
  onOpenDesigner,
  onDesignerSettings,
  onNewDesigner,
}: {
  theme: PluginTheme;
  document: StudioDocument;
  busy: boolean;
  status: DesignerStatus | null;
  /** Packs the designer saved since the last brief. */
  takes: StudioTheme[];
  preferences: StudioPreferences | undefined;
  sending: boolean;
  sendError: string | null;
  /** The card selected in Cards, which can be pointed at. */
  componentName: string | null;
  onSend: (text: string, lastBrief: NonNullable<StudioPreferences["lastBrief"]>) => void;
  onApply: (action: StudioAction) => Promise<unknown>;
  onHighlight: (key: ColorKey | null) => void;
  onOpenDesigner: () => void;
  onDesignerSettings: () => void;
  /** Starts a fresh designer session, for when the current one stopped. */
  onNewDesigner: () => void;
}) {
  const c = theme.colors;
  const light = document.current.appearance === "light";
  const [draft, setDraftState] = useState<Draft>(remembered);
  const [menu, setMenu] = useState<Menu>(null);
  const [picking, setPicking] = useState<MixSlot | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [suggested, setSuggested] = useState(pickIdeas);
  const [started, setStarted] = useState(Boolean(preferences?.lastBrief));
  const input = useRef<{ focus(): void } | null>(null);
  function setDraft(patch: Partial<Draft>) {
    remembered = { ...draft, ...patch };
    setDraftState(remembered);
  }
  const last = preferences?.lastBrief;
  const working = Boolean(status?.working);
  const pending = last && working ? Math.max(0, last.variants - takes.length) : 0;
  const packs = [...document.saved, ...presets.filter(preset => !document.saved.some(item => item.id === preset.id))];

  const pointLabel = (id: string) =>
    id === "component"
      ? `Card ${componentName ?? ""}`.trim()
      : id.startsWith("color:")
        ? `${colorLabels[id.slice(6) as ColorKey]} ${document.current.colors[id.slice(6) as ColorKey]}`
        : id.slice(5);
  const pointing = draft.pointing.filter(id => id !== "component" || componentName);
  // Takes are named "Title · note"; the title is enough to say what is being remixed.
  const remixName = splitTakeName(document.current.name).title;
  const text = composeBrief({
    mode: draft.mode,
    remixName,
    subject: draft.subject,
    appearance: draft.appearance,
    moods: draft.moods,
    mix: draft.mix,
    variants: draft.variants,
    context: pointing.map(pointLabel),
  });
  const ready =
    draft.mode === "remix" ||
    Boolean(draft.subject.trim() || draft.moods.length || !mixIsEmpty(draft.mix) || pointing.length);
  const canSend = ready && !sending && !working;

  function send() {
    if (!canSend) return;
    setMenu(null);
    setStarted(true);
    const summary =
      (draft.mode === "remix" ? `Remix of ${remixName}` : "") +
      (draft.subject.trim() ? (draft.mode === "remix" ? `: ${draft.subject.trim()}` : draft.subject.trim()) : "") +
      (draft.appearance !== "any" ? ` · ${draft.appearance}` : "") +
      (draft.moods.length ? ` · ${draft.moods.join(", ")}` : "");
    onSend(text, {
      summary: (summary || "New pack").slice(0, 400),
      variants: draft.variants,
      mode: draft.mode,
      at: new Date().toISOString(),
    });
    setDraft({ subject: "", pointing: [] });
  }
  /** Remix starts from the draft, so a take is loaded into the draft first. */
  async function remix(take?: StudioTheme) {
    if (take && document.current.id !== take.id) await onApply({ type: "load", id: take.id }).catch(() => {});
    setDraft({ mode: "remix" });
    setMenu(null);
    input.current?.focus();
  }
  function startNew(subject = "") {
    setDraft({ mode: "new", subject });
    setMenu(null);
    input.current?.focus();
  }
  async function applyMix() {
    try {
      await onApply({
        type: "patch",
        ...mixPatch(draft.mix, document.locks),
        label:
          `Mix: ${[...new Set(mixSlots.flatMap(slot => (draft.mix[slot.id] ? [draft.mix[slot.id]!.name] : [])))].join(" + ")}`.slice(
            0,
            200,
          ),
      });
      setMenu(null);
    } catch {
      /* The studio reports the error. */
    }
  }

  const appearanceLabel = draft.appearance === "any" ? "Light or dark" : draft.appearance === "dark" ? "Dark" : "Light";
  const nextAppearance = { any: "dark", dark: "light", light: "any" } as const;
  const mixCount = mixSlots.filter(slot => draft.mix[slot.id]).length;

  const canvas =
    !started && !takes.length ? (
      <View style={{ gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Eyebrow theme={theme}>Start from</Eyebrow>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <StartCard
              theme={theme}
              title="Remix this theme"
              detail={`Keep what works in ${remixName} and change the rest.`}
              selected={draft.mode === "remix"}
              onPress={() => void remix()}
            >
              <PackThumbnail pack={document.current} height={92} />
            </StartCard>
            <StartCard
              theme={theme}
              title="Start from an idea"
              detail="A film, a place, an object, a mood. The designer takes it from there."
              selected={draft.mode === "new" && Boolean(draft.subject.trim())}
              onPress={() => startNew()}
            >
              <View style={{ height: 92, alignItems: "center", justifyContent: "center", backgroundColor: c.surface0 }}>
                <Icon name="Sparkles" size={26} color={c.accent} />
              </View>
            </StartCard>
          </View>
        </View>
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Eyebrow theme={theme}>Or try</Eyebrow>
            <StudioButton
              theme={theme}
              title="Other ideas"
              icon="Dices"
              small
              iconOnly
              onPress={() => setSuggested(pickIdeas())}
            />
          </View>
          {suggested.map(idea => (
            <Pressable
              key={idea}
              accessibilityRole="button"
              accessibilityLabel={`Use the idea ${idea}`}
              onPress={() => startNew(idea)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 8,
                paddingHorizontal: 8,
                marginHorizontal: -8,
                borderRadius: 8,
                backgroundColor: pressed ? c.surface2 : "transparent",
              })}
            >
              <Icon name="CornerDownRight" size={13} color={c.foregroundMuted} />
              <Text style={{ color: c.foreground, fontSize: 13 }}>{idea}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    ) : (
      <View style={{ gap: 12 }}>
        {last ? (
          <View
            style={{
              alignSelf: "flex-end",
              maxWidth: "90%",
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 14,
              borderBottomRightRadius: 4,
              backgroundColor: c.surface2,
            }}
          >
            <Text style={{ color: c.foreground, fontSize: 13, lineHeight: 19 }}>{last.summary}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor(theme, status) }} />
          <Eyebrow theme={theme}>
            {status?.permissions.length
              ? "Waiting for your OK above"
              : working
                ? `Designer is working${takes.length ? ` · ${takes.length} of ${last?.variants ?? takes.length} ready` : ""}`
                : takes.length
                  ? `${takes.length} ${takes.length === 1 ? "take" : "takes"} · try one, activate to keep it`
                  : status?.tone === "danger"
                    ? "The designer stopped"
                    : sending
                      ? "Sending…"
                      : "Waiting for the designer"}
          </Eyebrow>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {takes.map(take => {
            const current = document.current.id === take.id;
            // A take joins My packs only once it has been activated.
            const kept = document.saved.some(pack => pack.id === take.id);
            const { title, note } = splitTakeName(take.name);
            return (
              <View
                key={take.id}
                style={{
                  flexGrow: 1,
                  flexBasis: 140,
                  maxWidth: 260,
                  borderRadius: 10,
                  borderWidth: current ? 1.5 : 1,
                  borderColor: current ? c.accent : c.border,
                  overflow: "hidden",
                  backgroundColor: c.surface1,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Try ${title}`}
                  accessibilityState={{ selected: current }}
                  disabled={busy}
                  onPress={() => void onApply({ type: "load", id: take.id }).catch(() => {})}
                >
                  <PackThumbnail pack={take} height={78} />
                  {kept ? (
                    <View
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderRadius: 9,
                        backgroundColor: c.surface0,
                      }}
                    >
                      <Icon name="Check" size={10} color={c.statusSuccess} />
                      <Text style={{ color: c.foreground, fontSize: 10 }}>In My packs</Text>
                    </View>
                  ) : null}
                </Pressable>
                <View style={{ padding: 9, gap: 6, borderTopWidth: 1, borderColor: c.border }}>
                  <View style={{ gap: 1 }}>
                    <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}>
                      {title}
                    </Text>
                    {note ? (
                      <Text numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 15 }}>
                        {note}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    <StudioButton
                      theme={theme}
                      title="Remix"
                      icon="Repeat2"
                      small
                      disabled={busy || working}
                      onPress={() => void remix(take)}
                    />
                    <View style={{ flex: 1 }} />
                    <StudioButton
                      theme={theme}
                      title={`Discard ${title}`}
                      icon="Trash2"
                      small
                      iconOnly
                      disabled={busy}
                      onPress={() => void onApply({ type: "discard-take", id: take.id }).catch(() => {})}
                    />
                  </View>
                </View>
              </View>
            );
          })}
          {Array.from({ length: pending }, (_, index) => (
            <Pending key={`pending-${index}`} theme={theme} delay={index * 160} />
          ))}
        </View>
        {!working && !sending ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start over"
            onPress={() => setStarted(false)}
            style={{ alignSelf: "flex-start", paddingVertical: 4 }}
          >
            <Eyebrow theme={theme}>← Start over</Eyebrow>
          </Pressable>
        ) : null}
      </View>
    );

  // Menu bodies, shown between the canvas and the composer only while a pill is open.
  const menuBody =
    menu === "mode" ? (
      <View style={{ gap: 6 }}>
        <Option
          theme={theme}
          label="New from an idea"
          selected={draft.mode === "new"}
          onPress={() => startNew(draft.subject)}
        />
        <Option
          theme={theme}
          label={`Remix ${remixName}`}
          selected={draft.mode === "remix"}
          onPress={() => void remix()}
        />
        {takes
          .filter(take => take.id !== document.current.id)
          .map(take => (
            <Option
              key={take.id}
              theme={theme}
              label={`Remix ${splitTakeName(take.name).title}`}
              selected={false}
              onPress={() => void remix(take)}
            />
          ))}
      </View>
    ) : menu === "mood" ? (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {briefMoods.map(mood => (
          <Option
            key={mood}
            theme={theme}
            label={mood}
            selected={draft.moods.includes(mood)}
            onPress={() => setDraft({ moods: toggled(draft.moods, mood) })}
          />
        ))}
      </View>
    ) : menu === "takes" ? (
      <View style={{ flexDirection: "row", gap: 6 }}>
        {[1, 2, 3, 4].map(count => (
          <Option
            key={count}
            theme={theme}
            label={`${count} ${count === 1 ? "take" : "takes"}`}
            selected={draft.variants === count}
            onPress={() => (setDraft({ variants: count }), setMenu(null))}
          />
        ))}
      </View>
    ) : menu === "point" ? (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {previewParts.map(part => (
            <Option
              key={part.id}
              theme={theme}
              label={part.id}
              selected={draft.pointing.includes(`part:${part.id}`)}
              onPress={() => setDraft({ pointing: toggled(draft.pointing, `part:${part.id}`) })}
              onHover={on => onHighlight(on ? part.role(light) : null)}
            />
          ))}
          {componentName ? (
            <Option
              theme={theme}
              label={`Card ${componentName}`}
              selected={draft.pointing.includes("component")}
              onPress={() => setDraft({ pointing: toggled(draft.pointing, "component") })}
            />
          ) : null}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {colorKeys.map(key => (
            <Option
              key={key}
              theme={theme}
              label={colorLabels[key]}
              swatch={document.current.colors[key]}
              selected={draft.pointing.includes(`color:${key}`)}
              onPress={() => setDraft({ pointing: toggled(draft.pointing, `color:${key}`) })}
              onHover={on => onHighlight(on ? key : null)}
            />
          ))}
        </View>
        <StudioLabel theme={theme} subdued>
          Hover to see it light up in the preview.
        </StudioLabel>
      </View>
    ) : menu === "mix" ? (
      <View style={{ gap: 8 }}>
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
                    padding: 7,
                    backgroundColor: pressed ? c.surface2 : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 46,
                      height: 30,
                      borderRadius: 5,
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
                        <PackThumbnail pack={pack} height={30} />
                      </View>
                    ) : (
                      <Icon name="Plus" size={12} color={c.foregroundMuted} />
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, fontWeight: "500" }}>
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
                    onPress={() => setDraft({ mix: { ...draft.mix, [slot.id]: undefined } })}
                    hitSlop={6}
                    style={{ padding: 9 }}
                  >
                    <Icon name="X" size={13} color={c.foregroundMuted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StudioButton
            theme={theme}
            title="Mix into draft now"
            icon="Blend"
            small
            disabled={busy || mixCount === 0}
            onPress={() => void applyMix()}
          />
          <View style={{ flex: 1 }}>
            <StudioLabel theme={theme} subdued>
              Or leave it for the designer to use.
            </StudioLabel>
          </View>
        </View>
      </View>
    ) : null;
  const menuTitle = {
    mode: "Start from",
    mood: "Mood",
    takes: "How many takes",
    point: "Point at",
    mix: "Mix in other packs",
  } as const;

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18 }}
      >
        {canvas}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 10,
          paddingBottom: 12,
          gap: 8,
          borderTopWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface0,
        }}
      >
        {menu ? (
          <View
            style={{
              gap: 8,
              padding: 10,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface1,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Eyebrow theme={theme}>{menuTitle[menu]}</Eyebrow>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                onPress={() => setMenu(null)}
                hitSlop={8}
              >
                <Icon name="X" size={13} color={c.foregroundMuted} />
              </Pressable>
            </View>
            {menuBody}
          </View>
        ) : null}
        <View
          style={{
            gap: 8,
            padding: 10,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          {/* New or Remix is the first decision, so it leads the composer. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              alignSelf: "flex-start",
              padding: 2,
              borderRadius: 9,
              backgroundColor: c.surface0,
            }}
          >
            {(["new", "remix"] as const).map(mode => {
              const selected = draft.mode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={mode === "new" ? "New from an idea" : `Remix ${remixName}`}
                  onPress={() =>
                    mode === "new"
                      ? startNew(draft.subject)
                      : selected && takes.length
                        ? setMenu(menu === "mode" ? null : "mode")
                        : void remix()
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    height: 24,
                    paddingHorizontal: 9,
                    borderRadius: 7,
                    backgroundColor: selected ? c.surface2 : "transparent",
                    maxWidth: 220,
                  }}
                >
                  <Icon
                    name={mode === "new" ? "Sparkles" : "Repeat2"}
                    size={12}
                    color={selected ? c.accent : c.foregroundMuted}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: selected ? c.foreground : c.foregroundMuted,
                      fontSize: 12,
                      fontWeight: selected ? "600" : "400",
                      flexShrink: 1,
                    }}
                  >
                    {mode === "new" ? "New" : `Remix · ${remixName}`}
                  </Text>
                  {mode === "remix" && selected && takes.length ? (
                    <Icon name="ChevronDown" size={11} color={c.foregroundMuted} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {pointing.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {pointing.map(id => (
                <Pill
                  key={id}
                  theme={theme}
                  label={pointLabel(id)}
                  icon="Crosshair"
                  set
                  onRemove={() => setDraft({ pointing: draft.pointing.filter(item => item !== id) })}
                />
              ))}
            </View>
          ) : null}
          <TextInput
            ref={input as never}
            value={draft.subject}
            onChangeText={subject => setDraft({ subject: subject.slice(0, 600) })}
            accessibilityLabel={draft.mode === "remix" ? "What to change in the remix" : "Theme idea"}
            placeholder={
              draft.mode === "remix"
                ? `What should change in ${remixName}? Warmer, more contrast, a light version…`
                : "Describe the theme you want…"
            }
            placeholderTextColor={c.foregroundMuted}
            multiline
            onKeyPress={event => {
              const native = event.nativeEvent as { key: string; shiftKey?: boolean };
              if (native.key === "Enter" && !native.shiftKey) {
                (event as unknown as { preventDefault?: () => void }).preventDefault?.();
                send();
              }
            }}
            style={{
              minHeight: 44,
              maxHeight: 140,
              textAlignVertical: "top",
              color: c.foreground,
              fontSize: 13,
              lineHeight: 19,
              padding: 0,
              ...({ outlineStyle: "none" } as object),
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Pill
              theme={theme}
              label={draft.moods.length ? draft.moods.join(", ") : "Mood"}
              icon="Palette"
              set={draft.moods.length > 0}
              active={menu === "mood"}
              onPress={() => setMenu(menu === "mood" ? null : "mood")}
            />
            <Pill
              theme={theme}
              label={draft.appearance === "any" ? "Light or dark" : appearanceLabel}
              icon={draft.appearance === "light" ? "Sun" : draft.appearance === "dark" ? "Moon" : "SunMoon"}
              iconOnly={draft.appearance === "any"}
              set={draft.appearance !== "any"}
              onPress={() => setDraft({ appearance: nextAppearance[draft.appearance] })}
            />
            <Pill
              theme={theme}
              label={mixCount ? `Mix · ${mixCount}` : "Mix"}
              icon="Blend"
              set={mixCount > 0}
              active={menu === "mix"}
              onPress={() => setMenu(menu === "mix" ? null : "mix")}
            />
            <Pill
              theme={theme}
              label={pointing.length ? `Point · ${pointing.length}` : "Point"}
              icon="Crosshair"
              set={pointing.length > 0}
              active={menu === "point"}
              onPress={() => setMenu(menu === "point" ? null : "point")}
            />
            <Pill
              theme={theme}
              label={String(draft.variants)}
              icon="LayoutGrid"
              active={menu === "takes"}
              onPress={() => setMenu(menu === "takes" ? null : "takes")}
            />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Designer settings"
            onPress={onDesignerSettings}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor(theme, status) }} />
            <Eyebrow theme={theme}>Designer · {status ? status.label : "starts on send"}</Eyebrow>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show the brief"
            onPress={() => setBriefOpen(true)}
            hitSlop={6}
          >
            <Eyebrow theme={theme}>Brief</Eyebrow>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the designer chat"
            onPress={onOpenDesigner}
            hitSlop={6}
            style={{ paddingHorizontal: 6 }}
          >
            <Icon name="MessageSquare" size={13} color={c.foregroundMuted} />
          </Pressable>
          <StudioButton
            theme={theme}
            title={sending ? "Sending…" : working ? "Working…" : draft.mode === "remix" ? "Remix" : "Create"}
            icon={draft.mode === "remix" ? "Repeat2" : "Sparkles"}
            primary
            small
            disabled={!canSend}
            onPress={send}
          />
        </View>
        {status?.tone === "danger" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text accessibilityRole="alert" style={{ flex: 1, color: c.statusDanger, fontSize: 12, lineHeight: 18 }}>
              {sendError ??
                (status.label === "Closed"
                  ? "The designer session is closed. A new one picks up this draft."
                  : "The designer stopped with an error. A new session picks up this draft.")}
            </Text>
            <StudioButton theme={theme} title="New designer" icon="RotateCcw" small onPress={onNewDesigner} />
          </View>
        ) : sendError ? (
          <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12, lineHeight: 18 }}>
            {sendError}
          </Text>
        ) : null}
      </View>
      <PackPicker
        theme={theme}
        slot={picking}
        packs={packs}
        onClose={() => setPicking(null)}
        onPick={pack => {
          if (picking) setDraft({ mix: { ...draft.mix, [picking]: pack } });
          setPicking(null);
        }}
      />
      <Modal
        title="Brief"
        icon={<Icon name="FileText" size={18} color={c.foreground} />}
        open={briefOpen}
        onOpenChange={setBriefOpen}
      >
        <Modal.Content>
          <StudioLabel theme={theme} subdued>
            This is the exact message the designer receives when you press {draft.mode === "remix" ? "Remix" : "Create"}
            .
          </StudioLabel>
          <Text
            selectable
            style={{
              color: c.foreground,
              fontFamily: monoFont,
              fontSize: 12,
              lineHeight: 18,
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface0,
            }}
          >
            {text}
          </Text>
          <StudioButton theme={theme} title="Copy brief" icon="Copy" small onPress={() => void copyText(text)} />
        </Modal.Content>
      </Modal>
    </View>
  );
}
