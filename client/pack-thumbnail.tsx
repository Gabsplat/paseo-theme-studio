import { View } from "react-native";
import type { StudioTheme } from "../shared/theme";
import { previewColors } from "./preview-colors";

/**
 * A miniature of Paseo painted with a pack: sidebar, a user bubble, reply text,
 * a tool card, and the accent action. Corner radius and density follow the pack.
 */
export function PackThumbnail({ pack, height = 84 }: { pack: StudioTheme; height?: number }) {
  const c = previewColors(pack);
  const radius = Math.min(6, Math.round(pack.ui.radius / 3));
  const gap = pack.ui.density === "compact" ? 3 : pack.ui.density === "spacious" ? 6 : 4.5;
  const line = (width: `${number}%`, color: string, thickness = 3) => (
    <View style={{ width, height: thickness, borderRadius: thickness / 2, backgroundColor: color }} />
  );
  // Small slots keep only the surfaces and the accent; the full layout would turn to noise.
  if (height < 50)
    return (
      <View
        style={{ height, flexDirection: "row", backgroundColor: c.workspace, overflow: "hidden" }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={{ width: "27%", backgroundColor: c.sidebar, borderRightWidth: 1, borderColor: c.border }} />
        <View style={{ flex: 1, padding: 6, gap: 4, justifyContent: "center" }}>
          {line("80%", c.foreground)}
          {line("55%", c.mutedForeground)}
          <View style={{ width: 16, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
        </View>
      </View>
    );
  return (
    <View
      style={{ height, flexDirection: "row", backgroundColor: c.workspace, overflow: "hidden" }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={{
          width: "27%",
          backgroundColor: c.sidebar,
          borderRightWidth: 1,
          borderColor: c.border,
          paddingVertical: 8,
          paddingHorizontal: 6,
          gap,
        }}
      >
        {line("70%", c.mutedForeground)}
        {line("52%", c.mutedForeground)}
        <View
          style={{
            marginHorizontal: -3,
            paddingHorizontal: 3,
            paddingVertical: 3,
            borderRadius: radius,
            backgroundColor: c.selected,
          }}
        >
          {line("78%", c.foreground)}
        </View>
        {line("60%", c.mutedForeground)}
      </View>
      <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 9, gap }}>
        <View
          style={{
            alignSelf: "flex-end",
            width: "46%",
            paddingVertical: 4,
            paddingHorizontal: 5,
            borderRadius: radius + 2,
            backgroundColor: c.bubble,
          }}
        >
          {line("100%", c.foreground)}
        </View>
        {line("82%", c.foreground)}
        {line("58%", c.mutedForeground)}
        <View
          style={{
            flex: 1,
            minHeight: 14,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: radius + 1,
            backgroundColor: c.background,
            padding: 4,
            gap: 3,
            justifyContent: "center",
          }}
        >
          {line("44%", c.success, 2.5)}
          {line("66%", c.mutedForeground, 2.5)}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 26, height: 9, borderRadius: radius + 1, backgroundColor: c.accent }} />
          <View
            style={{
              flex: 1,
              height: 9,
              borderRadius: radius + 1,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.control,
            }}
          />
        </View>
      </View>
    </View>
  );
}
