import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Per-host Theme Studio UI preferences. Last write wins; they never touch the pack document.
const fields = {
  /** Whether the user left the designer chat open, so Theme Studio reopens it next time. */
  designerOpen: z.boolean(),
  /** Provider and model for the next new designer session. Existing sessions keep their own. */
  designerProvider: z.string().trim().max(60),
  designerModel: z.string().trim().max(200),
  /** Whether the first-run onboarding was completed or skipped. */
  onboardingDone: z.boolean(),
  /** The quick model behind instant ideas and looks; empty means the suggested one. */
  sparkProvider: z.string().trim().max(60),
  sparkModel: z.string().trim().max(200),
  /** Whether ideas and looks refresh on their own while the user types. */
  sparkLive: z.boolean(),
  /** Saved pack ids when the last brief was sent; packs saved since are the designer's takes. */
  takeBaseline: z.array(z.string()),
};
export const studioPreferencesSchema = z.object({
  designerOpen: fields.designerOpen.default(false),
  designerProvider: fields.designerProvider.optional(),
  designerModel: fields.designerModel.optional(),
  onboardingDone: fields.onboardingDone.default(false),
  takeBaseline: fields.takeBaseline.optional(),
  sparkProvider: fields.sparkProvider.optional(),
  sparkModel: fields.sparkModel.optional(),
  sparkLive: fields.sparkLive.default(true),
});
// No defaults here: a patch must only carry the fields it changes.
export const studioPreferencesPatchSchema = z.object(fields).partial().strict();
export type StudioPreferences = z.infer<typeof studioPreferencesSchema>;
export const readStudioPreferences = defineRpc({
  name: "studio.preferences",
  input: z.object({}).strict(),
  output: studioPreferencesSchema,
});
export const changeStudioPreferences = defineRpc({
  name: "studio.change-preferences",
  input: studioPreferencesPatchSchema,
  output: studioPreferencesSchema,
});
