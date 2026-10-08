import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colorKeys, colorLabels, hexSchema, type ColorKey, type Palette, type StudioDocument } from "../shared/theme";
import { contrastReport } from "../shared/contrast";
import { harmonies, harmonyPalette } from "../shared/harmony";
import { Eyebrow, monoFont, StudioButton, StudioLabel } from "./studio-ui";
import { StudioColorPicker } from "./studio-color-picker";

const hints: Record<ColorKey, string> = {
  background: "The sidebar and app backdrop in dark palettes; the workspace canvas in light palettes.",
  foreground: "Primary text, titles, and icons.",
  raised: "The workspace canvas in dark palettes; cards and elevated surfaces in light palettes.",
  control: "Inputs and selected controls; the sidebar in light palettes.",
  border: "Dividers and edges between surfaces.",
  accent: "Primary actions and selected states. Button text uses Background.",
  mutedForeground: "Secondary labels and quiet metadata.",
  ring: "Keyboard focus and selection outlines.",
};

function ColorField({
  theme,
  document,
  colorKey,
  busy,
  showHint,
  onCommit,
  onLock,
}: {
  theme: PluginTheme;
  document: StudioDocument;
  colorKey: ColorKey;
  busy: boolean;
  showHint: boolean;
  onCommit: (key: ColorKey, color: string, expectedRevision: number) => Promise<void>;
  onLock: (key: ColorKey, locked: boolean) => void;
}) {
  const value = document.current.colors[colorKey];
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldWidth, setFieldWidth] = useState(340);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRevision, setPickerRevision] = useState(document.revision);
  const focusedRevision = useRef(document.revision);
  const committing = useRef(false);
  const locked = document.locks.includes(colorKey);
  const narrow = fieldWidth < 290;
  useEffect(() => {
    if (!focused) {
      setDraft(value);
      setError(null);
    }
  }, [value]);

  async function commit() {
    if (committing.current || draft.toUpperCase() === value.toUpperCase()) return;
    const parsed = hexSchema.safeParse(draft.trim());
    if (!parsed.success) {
      setError("Use #RGB, #RRGGBB, or #RRGGBBAA.");
      return;
    }
    committing.current = true;
    try {
      await onCommit(colorKey, parsed.data.toUpperCase(), focusedRevision.current);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this color.");
    } finally {
      committing.current = false;
    }
  }

  const input = (
    <TextInput
      testID={`color-${colorKey}`}
      accessibilityLabel={`${colorLabels[colorKey]} color`}
      value={draft}
      onChangeText={setDraft}
      onFocus={() => {
        setFocused(true);
        focusedRevision.current = document.revision;
      }}
      onBlur={() => {
        void commit();
        setFocused(false);
      }}
      onSubmitEditing={() => {
        void commit();
      }}
      autoCapitalize="characters"
      autoCorrect={false}
      maxLength={9}
      editable={!busy && !locked}
      style={{
        width: narrow ? "100%" : 112,
        paddingHorizontal: 8,
        paddingVertical: 7,
        fontSize: 12,
        fontFamily: "monospace",
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: error ? theme.colors.statusDanger : focused ? theme.colors.accent : theme.colors.border,
      }}
    />
  );

  return (
    <View onLayout={event => setFieldWidth(event.nativeEvent.layout.width)} style={{ gap: 6, paddingVertical: 7 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <Pressable
          testID={`swatch-${colorKey}`}
          accessibilityRole="button"
          accessibilityLabel={`Pick ${colorLabels[colorKey].toLowerCase()} color`}
          accessibilityState={{ disabled: busy || locked }}
          disabled={busy || locked}
          onPress={() => {
            setPickerRevision(document.revision);
            setPickerOpen(true);
          }}
          style={{
            height: 28,
            width: 28,
            borderRadius: 7,
            backgroundColor: value,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}>
            {colorLabels[colorKey]}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontFamily: "monospace" }}>{colorKey}</Text>
        </View>
        {!narrow ? input : null}
        <Pressable
          testID={`lock-${colorKey}`}
          accessibilityRole="button"
          accessibilityLabel={`${locked ? "Unlock" : "Lock"} ${colorLabels[colorKey]}`}
          accessibilityState={{ selected: locked, disabled: busy }}
          disabled={busy}
          onPress={() => onLock(colorKey, !locked)}
          style={{ padding: 8, borderRadius: 6, backgroundColor: locked ? theme.colors.surface2 : "transparent" }}
        >
          <Icon
            name={locked ? "LockKeyhole" : "LockKeyholeOpen"}
            size={14}
            color={locked ? theme.colors.accent : theme.colors.foregroundMuted}
          />
        </Pressable>
      </View>
      {narrow ? input : null}
      {showHint ? (
        <StudioLabel theme={theme} subdued>
          {hints[colorKey]}
          {locked ? " Unlock to edit this color." : ""}
        </StudioLabel>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 11, lineHeight: 16 }}>
          {error}
        </Text>
      ) : null}
      {focused && document.revision !== focusedRevision.current ? (
        <StudioLabel theme={theme} subdued>
          The palette changed while you were editing. Reopen this field before applying your color.
        </StudioLabel>
      ) : null}
      <StudioColorPicker
        theme={theme}
        label={colorLabels[colorKey]}
        value={value}
        open={pickerOpen}
        locked={locked}
        busy={busy}
        changed={pickerRevision !== document.revision}
        onOpenChange={setPickerOpen}
        onApply={async color => {
          await onCommit(colorKey, color, pickerRevision);
        }}
      />
    </View>
  );
}

function ContrastSummary({ theme, document }: { theme: PluginTheme; document: StudioDocument }) {
  const { colors } = document.current;
  const workspaceKey = document.current.appearance === "dark" ? "raised" : "background";
  const report = contrastReport(colors, document.current.appearance);
  const pairs = [
    { name: "Text", foreground: "foreground", background: workspaceKey },
    { name: "Muted text", foreground: "mutedForeground", background: workspaceKey },
    { name: "Text on raised", foreground: "foreground", background: "raised" },
    { name: "Accent button", foreground: "background", background: "accent" },
  ] as const;
  return (
    <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: theme.colors.border }}>
      <Eyebrow theme={theme}>Contrast · AA needs 4.5:1</Eyebrow>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {pairs.map(pair => {
          const ratio = report.checks.find(
            check => check.foreground === pair.foreground && check.background === pair.background,
          )!.ratio;
          const passes = ratio >= 4.5;
          return (
            <View
              key={pair.name}
              accessibilityLabel={`${pair.name} contrast ${ratio.toFixed(1)} to 1, ${passes ? "passes" : "too low"}`}
              style={{
                flexGrow: 1,
                flexBasis: "45%",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: passes ? theme.colors.border : theme.colors.statusWarning,
              }}
            >
              {/* The pair itself, so the number has something to point at. */}
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors[pair.background],
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: colors[pair.foreground], fontSize: 12, fontWeight: "600" }}>Aa</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 12 }}>
                  {pair.name}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon
                    name={passes ? "CircleCheck" : "TriangleAlert"}
                    size={11}
                    color={passes ? theme.colors.statusSuccess : theme.colors.statusWarning}
                  />
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: monoFont }}>
                    {ratio.toFixed(1)}:1
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Builds a whole palette from one color, in five relationships. */
function HarmonyBuilder({
  theme,
  document,
  busy,
  onApply,
}: {
  theme: PluginTheme;
  document: StudioDocument;
  busy: boolean;
  onApply: (colors: Partial<Palette>, label: string) => void;
}) {
  const c = theme.colors;
  const [seed, setSeed] = useState(document.current.colors.accent);
  const [draft, setDraft] = useState(seed);
  const [pickerOpen, setPickerOpen] = useState(false);
  function commit(value: string) {
    const parsed = hexSchema.safeParse(value.trim());
    if (parsed.success) setSeed(parsed.data.toUpperCase());
    setDraft(parsed.success ? parsed.data.toUpperCase() : seed);
  }
  return (
    <View style={{ gap: 8, paddingTop: 14, borderTopWidth: 1, borderColor: c.border }}>
      <Eyebrow theme={theme}>From one color</Eyebrow>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick the starting color"
          onPress={() => setPickerOpen(true)}
          style={{
            height: 28,
            width: 28,
            borderRadius: 7,
            backgroundColor: seed,
            borderWidth: 1,
            borderColor: c.border,
          }}
        />
        <TextInput
          accessibilityLabel="Starting color"
          value={draft}
          onChangeText={setDraft}
          onBlur={() => commit(draft)}
          onSubmitEditing={() => commit(draft)}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={9}
          style={{
            width: 112,
            paddingHorizontal: 8,
            paddingVertical: 7,
            fontSize: 12,
            fontFamily: monoFont,
            color: c.foreground,
            backgroundColor: c.surface0,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: c.border,
          }}
        />
        <View style={{ flex: 1 }}>
          <StudioLabel theme={theme} subdued>
            Text and accent stay readable.
          </StudioLabel>
        </View>
      </View>
      <View style={{ gap: 4, marginHorizontal: -8 }}>
        {harmonies.map(harmony => {
          const palette = harmonyPalette(seed, harmony.id, document.current.appearance);
          return (
            <Pressable
              key={harmony.id}
              accessibilityRole="button"
              accessibilityLabel={`Apply ${harmony.name.toLowerCase()} palette`}
              disabled={busy}
              onPress={() =>
                onApply(
                  Object.fromEntries(
                    Object.entries(palette).filter(([key]) => !document.locks.includes(key as ColorKey)),
                  ),
                  `${harmony.name} from ${seed}`,
                )
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 8,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: pressed ? c.surface2 : "transparent",
                opacity: busy ? 0.5 : 1,
              })}
            >
              <Text style={{ width: 104, color: c.foreground, fontSize: 12 }}>{harmony.name}</Text>
              <View
                style={{
                  flex: 1,
                  height: 22,
                  flexDirection: "row",
                  borderRadius: 6,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: c.border,
                }}
              >
                {colorKeys.map(key => (
                  <View key={key} style={{ flex: 1, backgroundColor: palette[key] }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <StudioColorPicker
        theme={theme}
        label="Starting color"
        value={seed}
        open={pickerOpen}
        locked={false}
        busy={false}
        changed={false}
        onOpenChange={setPickerOpen}
        onApply={async color => {
          setSeed(color.slice(0, 7).toUpperCase());
          setDraft(color.slice(0, 7).toUpperCase());
        }}
      />
    </View>
  );
}

export function PaletteInspector(props: {
  theme: PluginTheme;
  document: StudioDocument;
  busy: boolean;
  onCommit: (key: ColorKey, color: string, expectedRevision: number) => Promise<void>;
  onLock: (key: ColorKey, locked: boolean) => void;
  onApplyPalette: (colors: Partial<Palette>, label: string) => void;
}) {
  const [showHints, setShowHints] = useState(false);
  const { onApplyPalette, ...field } = props;
  return (
    <View style={{ gap: 14 }}>
      <View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <View style={{ flex: 1 }}>
            <Eyebrow theme={props.theme}>
              Palette · {props.document.current.appearance}
              {props.document.locks.length ? ` · ${props.document.locks.length} locked` : ""}
            </Eyebrow>
          </View>
          <StudioButton
            theme={props.theme}
            title={showHints ? "Hide what each color does" : "Show what each color does"}
            icon="Info"
            small
            iconOnly
            active={showHints}
            onPress={() => setShowHints(!showHints)}
          />
        </View>
        {colorKeys.map(key => (
          <ColorField key={key} {...field} colorKey={key} showHint={showHints} />
        ))}
      </View>
      <ContrastSummary theme={props.theme} document={props.document} />
      <HarmonyBuilder theme={props.theme} document={props.document} busy={props.busy} onApply={onApplyPalette} />
    </View>
  );
}
