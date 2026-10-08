import { z } from "zod";
import { colorKeys, hexSchema, paletteSchema, packUiSchema } from "../shared/theme";
import { presetCredits, presets } from "../shared/presets";
import {
  componentCreateSchema,
  componentCodeSchema,
  componentPublishSchema,
  componentUpdateSchema,
  componentTriggerPublishSchema,
} from "../shared/component-rpc";
import { componentIdSchema, componentNodeSchema } from "../shared/components";
import { componentTriggerInstructions } from "../shared/component-trigger-policy";
import { liveInputSchema } from "../shared/live";

export const revisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
const componentToolNames = [
  "list_components",
  "list_component_triggers",
  "trigger_component",
  "read_component_instance",
  "create_code_component",
  "build_components",
  "publish_component",
  "update_component_state",
  "favorite_component",
  "show_live",
] as const;
export const patchSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    colors: paletteSchema.partial().default({}),
    ui: packUiSchema.partial().optional(),
    name: z.string().min(1).max(60).optional(),
    appearance: z.enum(["dark", "light"]).optional(),
    label: z.string().max(200).optional(),
    component: z
      .object({ tool: z.enum(componentToolNames), arguments: z.record(z.string(), z.unknown()) })
      .strict()
      .optional(),
  })
  .strict();
export const variantSchema = patchSchema
  .extend({ name: z.string().min(1).max(60) })
  .omit({ label: true, component: true });
const contrastInputSchema = z.object({ foreground: hexSchema.optional(), background: hexSchema.optional() }).strict();
export const contrastSchema = contrastInputSchema.refine(
  value => Boolean(value.foreground) === Boolean(value.background),
  "Supply foreground and background together.",
);
export const saveSchema = revisionSchema.extend({ name: z.string().min(1).max(60).optional() });
export const presetSchema = revisionSchema.extend({ id: z.string() });
export const lockSchema = revisionSchema.extend({ key: z.enum(colorKeys) });
const emptySchema = z.object({}).strict();

function tool(name: string, description: string, schema: z.ZodType) {
  return { name, description, inputSchema: z.toJSONSchema(schema, { io: "input" }) };
}
export const toolDefinitions = [
  tool(
    "list_component_triggers",
    "Discover enabled trigger rules on the latest component versions, activation readiness, and the installer automaticTriggers setting. Read at the start of a request and check each rule at its declared moment. Conditions are specific to each component, not a default decision workflow.",
    emptySchema,
  ),
  tool(
    "trigger_component",
    "Publish a component whose own declared trigger condition matches the current task. Requires componentId and triggerId; the backend verifies the declaration and deduplicates by real owner/turn/occurrence. Semantic matching belongs to you. Does not start a model turn. Existing callback updates must update their original instance instead of triggering again.",
    componentTriggerPublishSchema,
  ),
  tool(
    "read_theme",
    "Read the current draft pack, active pack, revision, locks, history, saved packs, and current capabilities. Read before edits AND before answering capability questions. Current capabilities supersede earlier scope descriptions in conversation history. Interactive native chat components are supported. Draft changes do not activate a pack.",
    emptySchema,
  ),
  tool(
    "patch_theme",
    "Update draft colors or UI atomically, or invoke a component operation via component:{tool,arguments} using existing tool permissions. Never combine component with pack edits. Top expectedRevision is STUDIO revision; component.arguments carries its own LIBRARY/INSTANCE revision. Does not activate.",
    patchSchema,
  ),
  tool(
    "check_contrast",
    "Check WCAG contrast for the draft palette. Optionally supply both foreground and background hex colors to check a proposed pair.",
    contrastInputSchema,
  ),
  tool(
    "create_variant",
    "Apply and save a named draft variant atomically. Honors locks and revision. Changes the preview, never the active pack.",
    variantSchema,
  ),
  tool(
    "undo",
    "Undo a draft edit. Requires current revision and refuses to change locked colors. Does not affect the active pack.",
    revisionSchema,
  ),
  tool(
    "read_capabilities",
    "Read exact Theme Studio pack scope, supported UI schema, tool contracts, examples, presets, and activation policy.",
    emptySchema,
  ),
  tool(
    "patch_pack",
    "Edit the draft palette, layout, typography, card style, activity UI, or custom panel using validated data. No code execution. Honors locks and revision. Only the user can activate it.",
    patchSchema,
  ),
  tool(
    "save_pack",
    "Save the current draft pack under an optional name. Requires revision. Does not activate it.",
    saveSchema,
  ),
  tool(
    "load_preset",
    "Load a preset into the draft, preserving locked colors. Requires revision. Does not activate it.",
    presetSchema,
  ),
  tool(
    "redo",
    "Redo a draft edit. Requires revision and honors locks. Does not affect the active pack.",
    revisionSchema,
  ),
  tool(
    "lock_color",
    "Lock a draft color at the user's request. The agent cannot unlock colors; only the user can unlock them in Theme Studio.",
    lockSchema,
  ),
  tool("list_saved_packs", "List saved packs with favorite flags and current STUDIO revision.", emptySchema),
  tool(
    "favorite_pack",
    "Star or unstar a saved pack without changing draft or active.",
    revisionSchema.extend({ id: z.string(), favorite: z.boolean() }),
  ),
  tool(
    "load_saved_pack",
    "Reuse a saved theme as draft; preserve locked colors and active pack.",
    revisionSchema.extend({ id: z.string() }),
  ),
  tool(
    "list_components",
    "Read the custom component library, LIBRARY revision, versions, activated code keys, your own most recent instances, and per-component instance totals.",
    emptySchema,
  ),
  tool(
    "read_component_instance",
    "Read an instance and definition before handling an interaction. Its revision is an INSTANCE revision.",
    z.object({ instanceId: z.string() }).strict(),
  ),
  tool(
    "create_code_component",
    "Save a new React Native TSX component version. Default export receives ComponentProps {theme,state,onAction}. Import ComponentProps as type from ../../shared/components; use only supported host modules. Optional triggers store component-specific conditions and check moments; omit to inherit previous version rules or use [] for manual-only. No shell or application source edits. Build before user activation.",
    componentCodeSchema,
  ),
  tool(
    "build_components",
    "Compile and typecheck the persisted code registry for review. Requires LIBRARY revision. Does not activate or execute generated code.",
    revisionSchema,
  ),
  tool(
    "publish_component",
    "Add an interactive component row to the native chat. The component must be custom code whose build the user activated. Requires LIBRARY revision. agentId defaults to this connected agent when a verified session owner is available. Otherwise specify the target agentId explicitly; do not guess or publish in an unrelated designer chat.",
    componentPublishSchema,
  ),
  tool(
    "update_component_state",
    "Return the agent's decision to a component instance. Requires INSTANCE revision and complete next state. Creates no event or agent turn. Never activates a theme.",
    componentUpdateSchema,
  ),
  tool(
    "show_live",
    "Show a live, interactive piece of HTML in this chat right now: no library entry, build, or activation. Use it whenever something visual or interactive explains better than text: charts, comparisons, timelines, simulators, calculators, small editors or tools, color or layout explorations. It runs on Paseo web and desktop in a sandboxed frame with no network (no fetch, no remote scripts, images, or fonts; inline everything, data: URLs only). The frame already has the active theme as CSS variables (--surface0/1/2, --foreground, --foreground-muted, --border, --accent, --accent-foreground, --status-success/warning/danger, --ring, --radius, --font, --font-size), a base stylesheet that styles plain HTML (button, button.primary, input, select, range sliders, table, .tabs, .card, .row, .stack, .grid, .stat, .badge, .muted, .eyebrow), Preact with htm (globals html, render, useState, useEffect, useMemo, useRef), and a `live` object: live.state, live.setState(patch) to persist, live.action(name, value?, patch?) to send you an event, live.on('state'|'theme', fn), live.useLive() hook returning [state, setState], live.chart.bar(target, [{label,value}], opts) and live.chart.line(...). The frame sizes itself to its content up to 720 px. Write a body fragment, not a full page. Actions reach you as widget events; answer with update_component_state on the returned instanceId. Provide summary for phones, which cannot run frames. HTML is limited to 120,000 characters.",
    liveInputSchema,
  ),
  tool(
    "favorite_component",
    "Star or unstar a reusable component definition. Requires LIBRARY revision.",
    revisionSchema.extend({ componentId: componentIdSchema, favorite: z.boolean() }),
  ),
];
export const packInstructions =
  "Theme Studio supports UI packs, favorites, and custom React Native components that you write for the task. Before answering what you can create, call read_theme and use its current capabilities rather than outdated conversation claims. You CAN create real interactive rows INSIDE the native chat. Every component is custom: write it with create_code_component, build it with build_components, and publish it after the user activates the build. There are no pre-made blocks or templates to assemble, and the retired create_composition tool is refused. A component is drawn in the chat exactly as written, with no frame, title, or padding added around it, so design its whole surface yourself: its own background, border, spacing, type, and motion, in the visual language the user asked for. Never claim chat widgets are unsupported. For a quick visual or interactive answer (a chart, comparison, simulator, calculator, or small tool), call show_live with self-contained HTML: it appears in the chat at once on web and desktop, needs no build or activation, and follows the active theme. Read read_theme for the draft and full capabilities, then patch_theme or patch_pack for pack edits. Use list_components and component tools for reusable UI and structured interactions. Existing sessions can invoke component tools through patch_theme.component using the compatibility contract returned by read_theme. Studio, library, and instance revisions are separate: read the matching resource before mutation. The user alone activates themes and generated-code builds. Never claim activation before the user does it.";

export function capabilities() {
  return {
    version: 3,
    instructions: packInstructions + "\n" + componentTriggerInstructions,
    scope: {
      palette: colorKeys,
      globalPalette: "An activated pack supplies Paseo appearance colors.",
      pluginUi:
        "Density, radius, and font family/size style plugin-owned components. Completed shell tool cards, pack notes, workspace activity panel, and a declarative custom workspace panel use this plugin's registered UI contributions.",
      components:
        "Compose native trees or generate versioned React Native code through MCP, compile for review, and publish rows to the native chat. Code executes only after the user activates a validated build. Components emit structured events; the owning native agent decides domain behavior and returns persisted state. Inputs use __state__ for state-only updates without a model turn. Action names are data, never backend command names.",
      triggers:
        "Each immutable component version can declare up to ten enabled/disabled trigger rules {id,event,when,enabled}. Events describe agent-observed moments: context, before task work, after a failed tool, or before the final answer. The owning agent matches natural-language conditions inside its current turn, discovers rules through list_component_triggers, and publishes through trigger_component. Backend verifies enabled declarations and real active turn, deduplicates publication, and prevents callback loops. No extra classifier turn or default component. Installer automaticTriggers switch controls automatic publication; no rules means manual publication only.",
      existingAgentCompatibility:
        "Existing designers may have only read_theme/patch_theme preapproved. Read read_theme, then use patch_theme({expectedRevision:STUDIO_REVISION,component:{tool:'read_component_instance',arguments:{instanceId}}}) and the same wrapper for other component tools. The nested arguments use the resource's LIBRARY or INSTANCE revision. No activation operation is available through this wrapper. Prefer this route for component events to avoid new permission prompts on existing agents.",
      codeContract:
        "Default-export a React Native component accepting ComponentProps {theme,state,onAction}. Import type {ComponentProps} from '../../shared/components'. Use supported host modules. onAction({action:'your-action',value,patch}) routes an explicit interaction to the agent; onAction({action:'__state__',patch}) only persists input. All persistent state comes from props.state. No eval, DOM, external modules, or Paseo core edits.",
      unsupported:
        "No Paseo core changes, global native layout rewrites, arbitrary CSS/HTML/DOM or runtime code evaluation. Generated code uses compiled React Native modules inside this trusted plugin. Native message text remains owned by Paseo.",
      activation:
        "Only manual studio.change activate/revert-active/disable-pack actions affect active. No MCP activation tool exists.",
      locks:
        "Locked colors cannot be patched or changed by undo/redo. Presets preserve locked colors. Agents may add a color lock but cannot remove one.",
      revision:
        "Pack mutations require STUDIO expectedRevision from read_theme; definition/manual publication mutations require LIBRARY revision from list_components; state updates require INSTANCE revision from read_component_instance. trigger_component uses the verified active turn and deduplication key instead of a caller revision. On conflict, reread and preserve the latest manual edits.",
    },
    uiSchema: z.toJSONSchema(packUiSchema),
    componentTreeSchema: z.toJSONSchema(componentNodeSchema),
    tools: toolDefinitions,
    presets: presets.map(({ id, name, appearance }) => ({
      id,
      name,
      appearance,
      ...(presetCredits[id] ? { author: presetCredits[id].author } : {}),
    })),
    examples: [
      {
        tool: "patch_pack",
        arguments: {
          expectedRevision: 12,
          ui: {
            density: "compact",
            radius: 8,
            fontFamily: "mono",
            fontSize: 13,
            toolCards: "bordered",
            messageStyle: "card",
            activityPanel: true,
          },
          label: "Compact developer pack",
        },
      },
      {
        tool: "patch_pack",
        arguments: {
          expectedRevision: 13,
          ui: {
            panel: {
              enabled: true,
              title: "Project notes",
              icon: "BookOpen",
              blocks: [
                { type: "text", text: "Keep this panel focused on today's work." },
                { type: "stat", label: "Tasks", value: "3" },
                { type: "list", title: "Next", items: ["Review changes", "Run checks"] },
                { type: "progress", label: "Ready", value: 75 },
              ],
            },
          },
        },
      },
    ],
  };
}

/** Tools that write generated source and run the compiler. Only the designer has them preapproved. */
export const codeGenerationTools: readonly string[] = ["create_code_component", "build_components"];
