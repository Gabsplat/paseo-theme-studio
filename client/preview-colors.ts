import type { StudioTheme } from "../shared/theme";
import type { PluginTheme } from "@getpaseo/plugin";

// Matches Paseo v0.9.2's plugin theme expansion and semantic color constants.
// See packages/app/src/plugins/themes/index.ts and src/styles/theme.ts.
export function previewColors(theme: StudioTheme) {
  const p = theme.colors;
  const light = theme.appearance === "light";
  return {
    ...p,
    sidebar: light ? p.control : p.background,
    workspace: light ? p.background : p.raised,
    selected: light ? p.border : p.control,
    bubble: p.border,
    accentForeground: p.background,
    success: light ? "#3e704a" : "#6cb17b",
    danger: light ? "#9d433b" : "#d8847b",
    warning: light ? "#7b5d39" : "#c09664",
    dotSuccess: light ? "#299f51" : "#35c264",
    dotWarning: light ? "#b37824" : "#db932e",
    dotRunning: light ? "#268ae0" : "#5caaf6",
    addition: light ? "#15803d" : "#4ade80",
    deletion: light ? "#b91c1c" : "#ef4444",
    additionBackground: light ? "#15803d14" : "#4ade8014",
    deletionBackground: light ? "#b91c1c14" : "#ef444414",
    ansiGreen: light ? "#16a34a" : "#5dba80",
    ansiBlue: light ? "#2563eb" : "#6a9de0",
    ansiYellow: light ? "#ca8a04" : "#d4a44a",
    ansiMagenta: light ? "#9333ea" : "#b07ad0",
    ansiCyan: light ? "#0891b2" : "#4aabb8",
  };
}

export type PreviewColors = ReturnType<typeof previewColors>;

export function previewPluginTheme(theme: StudioTheme): PluginTheme {
  const c = previewColors(theme);
  return {
    colors: {
      surface0: c.background,
      surface1: c.raised,
      surface2: c.control,
      border: c.border,
      foreground: c.foreground,
      foregroundMuted: c.mutedForeground,
      accent: c.accent,
      accentForeground: c.accentForeground,
      statusSuccess: c.success,
      statusWarning: c.warning,
      statusDanger: c.danger,
    },
  };
}
