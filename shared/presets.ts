import { communityPresets } from "./community-presets";
import { defaultPackUi } from "./pack";
import { presets as builtInPresets, type StudioTheme } from "./theme";

export type PresetCredit = { author: string; source: string };

/** Who made each community palette, keyed by preset ID. Built-in presets have no entry. */
export const presetCredits: Record<string, PresetCredit> = Object.fromEntries(
  communityPresets.map(({ id, author, source }) => [id, { author, source }]),
);

/** Every starting pack: Theme Studio's own presets first, then the community palettes. */
export const presets: StudioTheme[] = [
  ...builtInPresets,
  ...communityPresets.map(({ id, name, appearance, colors }) => ({ id, name, appearance, colors, ui: defaultPackUi })),
];
