import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colorKeys, colorLabels, hexSchema, type ColorKey, type StudioDocument } from "../shared/theme";
import { contrastReport } from "../shared/contrast";
import { StudioLabel } from "./studio-ui";
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
  onCommit,
  onLock,
}: {
  theme: PluginTheme;
  document: StudioDocument;
  colorKey: ColorKey;
  busy: boolean;
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
    <View
      onLayout={event => setFieldWidth(event.nativeEvent.layout.width)}
      style={{ gap: 6, paddingVertical: 11, borderBottomWidth: 1, borderColor: theme.colors.border }}
    >
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
            height: 33,
            width: 33,
            borderRadius: 8,
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
      <StudioLabel theme={theme} subdued>
        {hints[colorKey]}
        {locked ? " Unlock to edit this color." : ""}
      </StudioLabel>
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

export function ContrastSummary({ theme, document }: { theme: PluginTheme; document: StudioDocument }) {
  const { colors } = document.current;
  const workspaceKey = document.current.appearance === "dark" ? "raised" : "background";
  const report = contrastReport(colors, document.current.appearance);
  const pairs = [
    { name: "Workspace text", foreground: "foreground", background: workspaceKey },
    { name: "Workspace muted text", foreground: "mutedForeground", background: workspaceKey },
    { name: "Text on raised", foreground: "foreground", background: "raised" },
    { name: "Accent button text", foreground: "background", background: "accent" },
  ];
  return (
    <View style={{ gap: 8, paddingTop: 10 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>Contrast</Text>
      {pairs.map(pair => {
        const ratio = report.checks.find(
          check => check.foreground === pair.foreground && check.background === pair.background,
        )!.ratio;
        return (
          <View key={pair.name} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
            <StudioLabel theme={theme} subdued>
              {pair.name}
            </StudioLabel>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
              <Icon
                name={ratio >= 4.5 ? "CircleCheck" : "TriangleAlert"}
                size={13}
                color={ratio >= 4.5 ? theme.colors.statusSuccess : theme.colors.statusWarning}
              />
              <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{ratio.toFixed(1)}:1</Text>
            </View>
          </View>
        );
      })}
      <StudioLabel theme={theme} subdued>
        Normal text needs 4.5:1 for WCAG AA. Alpha colors are composited before measuring.
      </StudioLabel>
    </View>
  );
}

export function PaletteInspector(props: {
  theme: PluginTheme;
  document: StudioDocument;
  busy: boolean;
  onCommit: (key: ColorKey, color: string, expectedRevision: number) => Promise<void>;
  onLock: (key: ColorKey, locked: boolean) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: props.theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>Palette inspector</Text>
        <StudioLabel theme={props.theme} subdued>
          Tap a swatch to pick a color, or edit its hex value. Locks preserve colors during edits, presets, and designer
          changes.
        </StudioLabel>
      </View>
      <View>
        {colorKeys.map(key => (
          <ColorField key={key} {...props} colorKey={key} />
        ))}
      </View>
      <ContrastSummary theme={props.theme} document={props.document} />
    </View>
  );
}
