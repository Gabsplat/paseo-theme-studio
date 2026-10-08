import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { createContext, useContext, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

export function StudioButton({
  theme,
  title,
  icon,
  onPress,
  disabled = false,
  active = false,
  primary = false,
  danger = false,
  small = false,
  iconOnly = false,
}: {
  theme: PluginTheme;
  title: string;
  icon?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  /** A destructive action, such as deleting. */
  danger?: boolean;
  small?: boolean;
  iconOnly?: boolean;
}) {
  const color = primary
    ? theme.colors.accentForeground
    : danger
      ? theme.colors.statusDanger
      : active
        ? theme.colors.accent
        : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingHorizontal: iconOnly ? (small ? 7 : 8) : small ? 10 : 13,
        paddingVertical: small ? 6 : 9,
        minHeight: small ? 30 : 34,
        borderRadius: 8,
        backgroundColor: primary
          ? theme.colors.accent
          : active
            ? theme.colors.surface2
            : pressed
              ? theme.colors.surface2
              : "transparent",
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        borderWidth: primary || active ? 0 : 1,
        borderColor: theme.colors.border,
      })}
    >
      {icon ? <Icon name={icon} size={small ? 14 : 16} color={color} /> : null}
      {!iconOnly ? (
        <Text style={{ color, fontSize: small ? 12 : 13, fontWeight: primary || active ? "600" : "500" }}>{title}</Text>
      ) : null}
    </Pressable>
  );
}

export function StudioLabel({
  theme,
  children,
  subdued = false,
}: {
  theme: PluginTheme;
  children: ReactNode;
  subdued?: boolean;
}) {
  return (
    <Text
      style={{ color: subdued ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 12, lineHeight: 18 }}
    >
      {children}
    </Text>
  );
}

/** Inside the inspector sidebar, cards render as flat sections separated by dividers. */
export const InspectorSections = createContext(false);

export function StudioCard({
  theme,
  title,
  children,
  description,
}: {
  theme: PluginTheme;
  title: string;
  children: ReactNode;
  description?: string;
}) {
  const flat = useContext(InspectorSections);
  return (
    <View
      style={
        flat
          ? { paddingVertical: 16, gap: 12, borderBottomWidth: 1, borderColor: theme.colors.border }
          : {
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              backgroundColor: theme.colors.surface1,
              padding: 16,
              gap: 13,
            }
      }
    >
      <View style={{ gap: 3 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: flat ? 13 : 14, fontWeight: "600" }}>{title}</Text>
        {description ? (
          <StudioLabel theme={theme} subdued>
            {description}
          </StudioLabel>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A compact segmented control in the style of Paseo's toolbar toggles. */
export function StudioSegments<T extends string>({
  theme,
  value,
  options,
  onChange,
}: {
  theme: PluginTheme;
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        padding: 3,
        gap: 2,
        borderRadius: 9,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              height: 28,
              paddingHorizontal: 6,
              borderRadius: 6,
              backgroundColor: selected ? theme.colors.surface2 : pressed ? theme.colors.surface2 : "transparent",
            })}
          >
            {option.icon ? (
              <Icon
                name={option.icon}
                size={13}
                color={selected ? theme.colors.foreground : theme.colors.foregroundMuted}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                color: selected ? theme.colors.foreground : theme.colors.foregroundMuted,
                fontSize: 12,
                fontWeight: selected ? "600" : "400",
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const monoFont = "monospace";

/** Machine metadata: section names, counts, ids. Mono, uppercase, quiet. */
export function Eyebrow({ theme, children, color }: { theme: PluginTheme; children: ReactNode; color?: string }) {
  return (
    <Text
      numberOfLines={1}
      style={{
        color: color ?? theme.colors.foregroundMuted,
        fontSize: 10.5,
        lineHeight: 14,
        letterSpacing: 0.6,
        fontFamily: monoFont,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

/** A small selectable or removable tag. */
export function StudioChip({
  theme,
  label,
  icon,
  swatch,
  selected = false,
  disabled = false,
  onPress,
  onRemove,
}: {
  theme: PluginTheme;
  label: string;
  icon?: string;
  /** A color dot shown before the label. */
  swatch?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const c = theme.colors;
  const body = (
    <>
      {swatch ? (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: swatch,
            borderWidth: 1,
            borderColor: c.border,
          }}
        />
      ) : null}
      {icon ? <Icon name={icon} size={12} color={selected ? c.accent : c.foregroundMuted} /> : null}
      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, fontWeight: selected ? "600" : "400" }}>
        {label}
      </Text>
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: selected ? c.accent : c.border,
    backgroundColor: selected ? c.surface2 : "transparent",
    opacity: disabled ? 0.45 : 1,
    maxWidth: "100%" as const,
  };
  return (
    <View style={style}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected, disabled }}
          disabled={disabled}
          onPress={onPress}
          hitSlop={6}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={onRemove} hitSlop={6}>
          <Icon name="X" size={12} color={c.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
