import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

export function StudioButton({ theme, title, icon, onPress, disabled = false, active = false, primary = false, small = false, iconOnly = false }: {
  theme: PluginTheme; title: string; icon?: string; onPress: () => void;
  disabled?: boolean; active?: boolean; primary?: boolean; small?: boolean; iconOnly?: boolean;
}) {
  const color = primary ? theme.colors.accentForeground : active ? theme.colors.accent : theme.colors.foreground;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled, selected: active }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
      paddingHorizontal: iconOnly ? 8 : small ? 10 : 13, paddingVertical: small ? 8 : 10, minHeight: 36, borderRadius: 8,
      backgroundColor: primary ? theme.colors.accent : active ? theme.colors.surface2 : pressed ? theme.colors.surface2 : "transparent",
      opacity: disabled ? 0.4 : pressed ? 0.8 : 1, borderWidth: primary || active ? 0 : 1,
      borderColor: theme.colors.border })}>
    {icon ? <Icon name={icon} size={small ? 14 : 16} color={color} /> : null}
    {!iconOnly ? <Text style={{ color, fontSize: small ? 12 : 13, fontWeight: primary || active ? "600" : "500" }}>{title}</Text> : null}
  </Pressable>;
}

export function StudioLabel({ theme, children, subdued = false }: { theme: PluginTheme; children: ReactNode; subdued?: boolean }) {
  return <Text style={{ color: subdued ? theme.colors.foregroundMuted : theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>{children}</Text>;
}

export function StudioCard({ theme, title, children, description }: { theme: PluginTheme; title: string; children: ReactNode; description?: string }) {
  return <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, backgroundColor: theme.colors.surface1, padding: 16, gap: 13 }}>
    <View style={{ gap: 3 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>{title}</Text>
      {description ? <StudioLabel theme={theme} subdued>{description}</StudioLabel> : null}
    </View>
    {children}
  </View>;
}
