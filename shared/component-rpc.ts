import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  componentActionSchema,
  componentDefinitionSchema,
  componentIdSchema,
  componentInstanceSchema,
  componentLibrarySchema,
  componentNodeSchema,
  componentStateSchema,
  componentBuildSchema,
  componentTriggersSchema,
} from "./components";

export const componentCreateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    id: componentIdSchema,
    name: z.string().trim().min(1).max(60),
    tree: componentNodeSchema,
    triggers: componentTriggersSchema.optional(),
  })
  .strict();
export const componentCodeSchema = componentCreateSchema
  .omit({ tree: true })
  .extend({ code: z.string().min(1).max(40000) });
export const componentPublishSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    componentId: componentIdSchema,
    version: z.number().int().positive().optional(),
    agentId: z.string().optional(),
    state: componentStateSchema.optional(),
  })
  .strict();
const componentInteractSchema = z
  .object({ expectedRevision: z.number().int().nonnegative(), instanceId: z.string(), action: componentActionSchema })
  .strict();
export const componentUpdateSchema = z
  .object({ expectedRevision: z.number().int().nonnegative(), instanceId: z.string(), state: componentStateSchema })
  .strict();
export const readComponentLibrary = defineRpc({
  name: "component.library",
  input: z.object({}),
  output: componentLibrarySchema,
});
const created = z.object({ library: componentLibrarySchema, definition: componentDefinitionSchema });
export const createComposition = defineRpc({
  name: "component.create-composition",
  input: componentCreateSchema,
  output: created,
});
export const createCodeComponent = defineRpc({
  name: "component.create-code",
  input: componentCodeSchema,
  output: created,
});
export const deleteComponent = defineRpc({
  name: "component.delete",
  input: z.object({ expectedRevision: z.number().int().nonnegative(), componentId: componentIdSchema }),
  output: z.object({ library: componentLibrarySchema, removedInstances: z.number().int().nonnegative() }),
});
export const favoriteComponent = defineRpc({
  name: "component.favorite",
  input: z.object({
    expectedRevision: z.number().int().nonnegative(),
    componentId: componentIdSchema,
    favorite: z.boolean(),
  }),
  output: componentLibrarySchema,
});
export const buildComponents = defineRpc({
  name: "component.build",
  input: z.object({ expectedRevision: z.number().int().nonnegative() }),
  output: z.object({
    library: componentLibrarySchema,
    build: componentBuildSchema,
    files: z.array(z.string()),
    validation: z.object({ typecheck: z.literal(true) }),
  }),
});
export const activateComponentBuild = defineRpc({
  name: "component.activate-build",
  input: z.object({
    expectedRevision: z.number().int().nonnegative(),
    buildId: z.string(),
    // Keys whose full source the user reviewed in the activation dialog.
    reviewedKeys: z.array(z.string()).max(500),
  }),
  output: z.object({ library: componentLibrarySchema, reloadRequired: z.literal(true) }),
});
export const publishComponent = defineRpc({
  name: "component.publish",
  input: componentPublishSchema,
  output: componentInstanceSchema,
});
export const readComponentInstance = defineRpc({
  name: "component.instance",
  input: z.object({ instanceId: z.string() }),
  output: z.object({ instance: componentInstanceSchema, definition: componentDefinitionSchema }),
});
export const interactComponent = defineRpc({
  name: "component.interact",
  input: componentInteractSchema,
  output: z.object({
    instance: componentInstanceSchema,
    dispatch: z.enum(["sent", "queued", "state-only", "unavailable"]),
  }),
});
export const updateComponentState = defineRpc({
  name: "component.update-state",
  input: componentUpdateSchema,
  output: componentInstanceSchema,
});
export const componentTriggerPublishSchema = z
  .object({
    componentId: componentIdSchema,
    version: z.number().int().positive().optional(),
    triggerId: componentIdSchema,
    agentId: z.string().uuid().optional(),
    state: componentStateSchema.optional(),
    occurrenceKey: z.string().min(1).max(160).optional(),
  })
  .strict();
