import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import type { StudioDocument, StudioTheme } from "../shared/theme";
import { StudioButton, StudioCard, StudioLabel } from "./studio-ui";

type PackUi = StudioTheme["ui"];
type PatchUi = (ui: Partial<PackUi>, label: string, expectedRevision: number) => Promise<void>;

function Choices<T extends string>({
  theme,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  theme: PluginTheme;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
        {options.map(option => (
          <StudioButton
            key={option.value}
            theme={theme}
            title={option.label}
            small
            active={option.value === value}
            disabled={disabled}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function Stepper({
  theme,
  label,
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
}: {
  theme: PluginTheme;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <View
      style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 7, alignItems: "center" }}>
        <StudioButton
          theme={theme}
          title={`Decrease ${label.toLowerCase()}`}
          icon="Minus"
          iconOnly
          small
          disabled={disabled || value <= min}
          onPress={() => onChange(Math.max(min, value - 1))}
        />
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: 12,
            width: 45,
            textAlign: "center",
            fontFamily: "monospace",
          }}
        >
          {value}
          {unit}
        </Text>
        <StudioButton
          theme={theme}
          title={`Increase ${label.toLowerCase()}`}
          icon="Plus"
          iconOnly
          small
          disabled={disabled || value >= max}
          onPress={() => onChange(Math.min(max, value + 1))}
        />
      </View>
    </View>
  );
}

function Visibility({
  theme,
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  theme: PluginTheme;
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{label}</Text>
        <StudioLabel theme={theme} subdued>
          {description}
        </StudioLabel>
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        onPress={() => onChange(!value)}
        style={{
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          gap: 5,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: value ? theme.colors.surface2 : theme.colors.surface0,
          borderWidth: 1,
          borderColor: value ? theme.colors.accent : theme.colors.border,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Icon
          name={value ? "Eye" : "EyeOff"}
          size={13}
          color={value ? theme.colors.accent : theme.colors.foregroundMuted}
        />
        <Text style={{ color: value ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 12 }}>
          {value ? "Shown" : "Hidden"}
        </Text>
      </Pressable>
    </View>
  );
}

export function PackDesignInspector({
  theme,
  document,
  busy,
  onPatch,
}: {
  theme: PluginTheme;
  document: StudioDocument;
  busy: boolean;
  onPatch: PatchUi;
}) {
  const ui = document.current.ui;
  const patch = (value: Partial<PackUi>, label: string) => {
    void onPatch(value, label, document.revision).catch(() => {});
  };
  return (
    <View style={{ gap: 15 }}>
      <StudioCard theme={theme} title="Component layout" description="Spacing and corners for pack cards and panels.">
        <Choices
          theme={theme}
          label="Density"
          value={ui.density}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "spacious", label: "Spacious" },
          ]}
          disabled={busy}
          onChange={density => patch({ density }, "Change density")}
        />
        <Stepper
          theme={theme}
          label="Corner radius"
          value={ui.radius}
          min={0}
          max={24}
          unit="px"
          disabled={busy}
          onChange={radius => patch({ radius }, "Change corner radius")}
        />
        <View
          style={{
            backgroundColor: theme.colors.surface2,
            borderRadius: ui.radius,
            padding: 13,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <StudioLabel theme={theme}>Card corner preview</StudioLabel>
        </View>
      </StudioCard>
      <StudioCard theme={theme} title="Pack typography" description="Fonts for pack cards, notes, and panels.">
        <Choices
          theme={theme}
          label="Font family"
          value={ui.fontFamily}
          options={[
            { value: "system", label: "System" },
            { value: "mono", label: "Mono" },
            { value: "serif", label: "Serif" },
          ]}
          disabled={busy}
          onChange={fontFamily => patch({ fontFamily }, "Change font family")}
        />
        <Stepper
          theme={theme}
          label="Font size"
          value={ui.fontSize}
          min={11}
          max={18}
          unit="px"
          disabled={busy}
          onChange={fontSize => patch({ fontSize }, "Change font size")}
        />
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: ui.fontSize,
            lineHeight: ui.fontSize * 1.6,
            fontFamily: ui.fontFamily === "mono" ? "monospace" : ui.fontFamily === "serif" ? "Georgia" : undefined,
          }}
        >
          A calmer workspace. Clear, readable text.
        </Text>
        <StudioLabel theme={theme} subdued>
          For global app typography, open Settings → Appearance → Fonts and change the interface or monospace font and
          size.
        </StudioLabel>
      </StudioCard>
      <StudioCard
        theme={theme}
        title="Tool cards and notes"
        description="Style the pack's notes and completed shell tool summaries."
      >
        <Choices
          theme={theme}
          label="Pack note style"
          value={ui.messageStyle}
          options={[
            { value: "plain", label: "Plain" },
            { value: "card", label: "Card" },
          ]}
          disabled={busy}
          onChange={messageStyle => patch({ messageStyle }, "Change pack note style")}
        />
        <Choices
          theme={theme}
          label="Completed shell tool cards"
          value={ui.toolCards}
          options={[
            { value: "native", label: "Native" },
            { value: "compact", label: "Compact" },
            { value: "bordered", label: "Bordered" },
          ]}
          disabled={busy}
          onChange={toolCards => patch({ toolCards }, "Change completed shell tool cards")}
        />
        <Visibility
          theme={theme}
          label="Activity panel"
          description="Show the pack's workspace activity panel."
          value={ui.activityPanel}
          disabled={busy}
          onChange={activityPanel => patch({ activityPanel }, "Change activity panel")}
        />
      </StudioCard>
    </View>
  );
}
