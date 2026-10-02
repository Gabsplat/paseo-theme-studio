import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Per-host Theme Studio UI preferences. Last write wins; they never touch the pack document.
export const studioPreferencesSchema = z.object({
  /** Whether the user left the designer chat open, so Theme Studio reopens it next time. */
  designerOpen: z.boolean().default(false),
});
export type StudioPreferences = z.infer<typeof studioPreferencesSchema>;
export const readStudioPreferences = defineRpc({
  name: "studio.preferences",
  input: z.object({}).strict(),
  output: studioPreferencesSchema,
});
export const changeStudioPreferences = defineRpc({
  name: "studio.change-preferences",
  input: studioPreferencesSchema.partial().strict(),
  output: studioPreferencesSchema,
});
