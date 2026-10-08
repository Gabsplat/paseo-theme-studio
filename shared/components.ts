import { z } from "zod";
import type { PluginTheme } from "@getpaseo/plugin";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export const componentStateSchema = z
  .record(z.string().max(80), jsonValueSchema)
  .refine(value => JSON.stringify(value).length <= 12000, "Component state must be at most 12,000 characters.");
export type ComponentState = z.infer<typeof componentStateSchema>;
export const componentActionSchema = z
  .object({
    action: z.string().min(1).max(80),
    value: jsonValueSchema.optional(),
    patch: componentStateSchema.optional(),
  })
  .strict();
export type ComponentAction = z.infer<typeof componentActionSchema>;
export interface ComponentProps {
  theme: PluginTheme;
  state: ComponentState;
  onAction: (action: ComponentAction) => void;
}

export type ComponentNode =
  | { type: "text"; text: string; tone?: "normal" | "muted" | "accent"; size?: number }
  | { type: "stack" | "row"; children: ComponentNode[]; gap?: number }
  | { type: "stat"; label: string; value: string; stateKey?: string }
  | { type: "list"; title: string; items: string[] }
  | { type: "progress"; label: string; value: number; stateKey?: string }
  | { type: "button"; label: string; action: string; value?: JsonValue; patch?: ComponentState }
  | { type: "input"; label: string; stateKey: string; placeholder?: string; action: string }
  | { type: "select"; label: string; stateKey: string; options: { label: string; value: string }[]; action: string }
  | { type: "toggle"; label: string; stateKey: string; action: string };
const label = z.string().max(160);
const stateKey = z.string().min(1).max(80);
const action = z.string().min(1).max(80);
export const componentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("text"),
        text: z.string().max(2000),
        tone: z.enum(["normal", "muted", "accent"]).optional(),
        size: z.number().int().min(10).max(32).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("stack"),
        children: z.array(componentNodeSchema).max(20),
        gap: z.number().min(0).max(32).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("row"),
        children: z.array(componentNodeSchema).max(20),
        gap: z.number().min(0).max(32).optional(),
      })
      .strict(),
    z.object({ type: z.literal("stat"), label, value: z.string().max(160), stateKey: stateKey.optional() }).strict(),
    z.object({ type: z.literal("list"), title: label, items: z.array(z.string().max(600)).max(20) }).strict(),
    z
      .object({ type: z.literal("progress"), label, value: z.number().min(0).max(100), stateKey: stateKey.optional() })
      .strict(),
    z
      .object({
        type: z.literal("button"),
        label,
        action,
        value: jsonValueSchema.optional(),
        patch: componentStateSchema.optional(),
      })
      .strict(),
    z.object({ type: z.literal("input"), label, stateKey, placeholder: label.optional(), action }).strict(),
    z
      .object({
        type: z.literal("select"),
        label,
        stateKey,
        options: z
          .array(z.object({ label, value: z.string().max(160) }).strict())
          .min(1)
          .max(20),
        action,
      })
      .strict(),
    z.object({ type: z.literal("toggle"), label, stateKey, action }).strict(),
  ]),
);
export function parseComponentTree(value: unknown): ComponentNode {
  const pending: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  const seen = new Set<unknown>();
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 100 || depth > 6) throw new Error("Composition must have at most 100 nodes and six nested levels.");
    if (node && typeof node === "object") {
      if (seen.has(node)) throw new Error("Composition cannot contain circular or shared node references.");
      seen.add(node);
      if ("children" in node && Array.isArray(node.children))
        for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
    }
  }
  return componentNodeSchema.parse(value);
}

export const componentIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/, "Component IDs must be lowercase slugs.");
const componentTriggerEventSchema = z.enum(["agent_context", "turn_started", "turn_completed", "tool_failed"]);
export const componentTriggerSchema = z
  .object({
    id: componentIdSchema,
    event: componentTriggerEventSchema,
    when: z.string().trim().min(1).max(600),
    enabled: z.boolean().default(true),
  })
  .strict();
export type ComponentTrigger = z.infer<typeof componentTriggerSchema>;
export const componentTriggersSchema = z
  .array(componentTriggerSchema)
  .max(10)
  .refine(
    triggers => new Set(triggers.map(trigger => trigger.id)).size === triggers.length,
    "Component trigger IDs must be unique.",
  );
const definitionBase = {
  id: componentIdSchema,
  name: z.string().trim().min(1).max(60),
  version: z.number().int().positive(),
  createdAt: z.string(),
  triggers: componentTriggersSchema.default([]),
};
export const componentDefinitionSchema = z.discriminatedUnion("mode", [
  z.object({ ...definitionBase, mode: z.literal("composition"), tree: componentNodeSchema }).strict(),
  z.object({ ...definitionBase, mode: z.literal("code"), code: z.string().min(1).max(40000) }).strict(),
]);
export type ComponentDefinition = z.infer<typeof componentDefinitionSchema>;
export const componentEventSchema = z
  .object({
    id: z.string(),
    at: z.string(),
    action: componentActionSchema,
    state: componentStateSchema,
    dispatchedAt: z.string().nullable().default(null),
  })
  .strict();
export type ComponentEvent = z.infer<typeof componentEventSchema>;
export const componentInstanceTriggerSchema = z
  .object({
    id: componentIdSchema,
    event: componentTriggerEventSchema,
    turnId: z.string().trim().min(1).max(200),
    turnStartedAt: z.string().min(1).max(80).nullable().optional(),
    occurrenceKey: z.string().trim().min(1).max(200).default("default"),
  })
  .strict();
/* Live frame limits live here: components.ts is copied alone into code-component builds and cannot import local modules. */
export const liveLimits = {
  /** Agent HTML per frame. The kit is added at render time and does not count. */
  htmlChars: 120000,
  titleChars: 80,
  summaryChars: 400,
  /** One bridge message, serialized. */
  messageChars: 16000,
  minHeight: 80,
  maxHeight: 720,
  defaultHeight: 320,
  /** Frames running at once; older ones pause to a placeholder. */
  activeFrames: 6,
} as const;
/** Live frames are stored as instances of this reserved id, without a library definition. */
export const liveComponentId = "live-frame";

/** What an agent published with show_live: untrusted HTML that only runs in a sandboxed frame. */
export const componentLiveSchema = z
  .object({
    title: z.string().trim().min(1).max(liveLimits.titleChars),
    html: z.string().min(1).max(liveLimits.htmlChars),
    height: z.number().int().min(liveLimits.minHeight).max(liveLimits.maxHeight).optional(),
    /** Shown on phones, which cannot run the frame. */
    summary: z.string().trim().max(liveLimits.summaryChars).optional(),
  })
  .strict();
export const componentInstanceSchema = z
  .object({
    id: z.string(),
    componentId: componentIdSchema,
    componentVersion: z.number().int().positive(),
    agentId: z.string().min(1),
    state: componentStateSchema,
    revision: z.number().int().nonnegative(),
    events: z.array(componentEventSchema).max(200),
    createdAt: z.string(),
    trigger: componentInstanceTriggerSchema.optional(),
    live: componentLiveSchema.optional(),
  })
  .strict();
export type ComponentLive = z.infer<typeof componentLiveSchema>;
export type ComponentInstance = z.infer<typeof componentInstanceSchema>;
export const componentBuildSchema = z
  .object({
    id: z.string(),
    directory: z.string(),
    libraryRevision: z.number().int().nonnegative(),
    keys: z.array(z.string().max(64)),
    typecheck: z.literal(true),
    createdAt: z.string(),
  })
  .strict();
export type ComponentBuild = z.infer<typeof componentBuildSchema>;
/**
 * The component catalog. Storage is unbounded: instances live in one file per owning
 * conversation, so `instances` here is whatever slice the reader asked for and
 * `instanceCounts` carries the per-component totals on wire views.
 */
export const componentLibrarySchema = z
  .object({
    format: z.literal(1),
    revision: z.number().int().nonnegative(),
    definitions: z.array(componentDefinitionSchema),
    instances: z.array(componentInstanceSchema),
    favorites: z.array(componentIdSchema),
    builds: z.array(componentBuildSchema).max(100),
    activeKeys: z.array(z.string().max(64)).default([]),
    instanceCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  })
  .strict();
export type ComponentLibrary = z.infer<typeof componentLibrarySchema>;
export const componentTimelineSchema = z
  .object({ instanceId: z.string(), componentId: componentIdSchema, componentVersion: z.number().int().positive() })
  .strict();
export const componentInstanceFileSchema = z
  .object({ format: z.literal(1), agentId: z.string().min(1), instances: z.array(componentInstanceSchema) })
  .strict();
export const componentStorageSchema = z
  .object({
    directory: z.string(),
    totalBytes: z.number().nonnegative(),
    parts: z.array(z.object({ id: z.string(), label: z.string(), bytes: z.number().nonnegative() }).strict()),
    instances: z.number().int().nonnegative(),
    conversations: z.number().int().nonnegative(),
    oldestInstanceAt: z.string().nullable(),
    components: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          versions: z.number().int().nonnegative(),
          instances: z.number().int().nonnegative(),
          bytes: z.number().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export type ComponentStorage = z.infer<typeof componentStorageSchema>;
export type ComponentTimelineData = z.infer<typeof componentTimelineSchema>;
