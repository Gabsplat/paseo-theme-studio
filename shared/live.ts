import { z } from "zod";
import { componentLiveSchema, componentStateSchema } from "./components";
import { liveLimits } from "./components";
export { liveComponentId, liveLimits } from "./components";

/**
 * Live frames: agent-written HTML shown inside a chat on Paseo web and desktop. The
 * HTML is untrusted. It runs in an `allow-scripts`-only iframe (opaque origin) under
 * the same Content-Security-Policy Paseo uses for its own HTML file preview
 * (packages/app/src/file-pane/html-preview-csp.ts), and talks to the host only
 * through validated postMessage calls.
 */

export const liveSandbox = "allow-scripts";
export const liveCspPolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");
const prologue = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${liveCspPolicy}">`;
const bom = "﻿";

/**
 * Prepends the policy exactly as Paseo does: our own doctype, then the policy as the
 * first element, then everything else verbatim. Nothing in `html` is parsed to place
 * it, so no markup the agent writes can move the policy out of the head.
 */
export function withLiveCsp(html: string): string {
  return prologue + (html.startsWith(bom) ? html.slice(bom.length) : html);
}

export const liveInputSchema = componentLiveSchema
  .extend({
    state: componentStateSchema.optional(),
    /** The conversation to publish into; defaults to the calling agent. */
    agentId: z.string().uuid().optional(),
  })
  .strict();
export type LiveInput = z.infer<typeof liveInputSchema>;
export type LiveFrame = z.infer<typeof componentLiveSchema>;
export const liveTimelineSchema = z.object({ instanceId: z.string() }).strict();

const rpc = z.literal("2.0");
const id = z.union([z.string().max(80), z.number().int()]);
const actionName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_.:-]+$/);

/**
 * Everything a frame may send. The envelopes follow the MCP Apps (`ui/`) JSON-RPC
 * shapes where one exists; state persistence has no MCP Apps equivalent and is
 * namespaced under `paseo/`.
 */
export const frameMessageSchema = z.discriminatedUnion("method", [
  z.object({ jsonrpc: rpc, id, method: z.literal("ui/initialize"), params: z.unknown().optional() }).strict(),
  z
    .object({
      jsonrpc: rpc,
      method: z.literal("ui/notifications/size-changed"),
      params: z.object({ height: z.number().finite().nonnegative(), width: z.number().optional() }).strip(),
    })
    .strict(),
  z
    .object({
      jsonrpc: rpc,
      method: z.literal("paseo/state"),
      params: z.object({ state: componentStateSchema }).strict(),
    })
    .strict(),
  z
    .object({
      jsonrpc: rpc,
      id: id.optional(),
      method: z.literal("ui/message"),
      params: z
        .object({ action: actionName, value: z.unknown().optional(), patch: componentStateSchema.optional() })
        .strict(),
    })
    .strict(),
]);
export type FrameMessage = z.infer<typeof frameMessageSchema>;

/** Parses one message from a frame, or explains why it was dropped. */
export function parseFrameMessage(data: unknown): { ok: true; message: FrameMessage } | { ok: false; reason: string } {
  let size: number;
  try {
    size = typeof data === "string" ? data.length : (JSON.stringify(data)?.length ?? 0);
  } catch {
    return { ok: false, reason: "unserializable" };
  }
  if (size > liveLimits.messageChars) return { ok: false, reason: "too large" };
  let value = data;
  if (typeof data === "string")
    try {
      value = JSON.parse(data);
    } catch {
      return { ok: false, reason: "not JSON" };
    }
  const parsed = frameMessageSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid" };
  if (parsed.data.method === "ui/message" && parsed.data.params.value !== undefined) {
    // The value travels to the agent, so it must be plain JSON within the cap.
    const valid = componentStateSchema.safeParse({ value: parsed.data.params.value });
    if (!valid.success) return { ok: false, reason: "invalid value" };
  }
  return { ok: true, message: parsed.data };
}

/**
 * Token bucket per frame and kind. A frame that loops on postMessage cannot flood the
 * agent with turns or the daemon with writes.
 */
export function createRateLimiter(rules: Record<string, { burst: number; perSecond: number }>, now = () => Date.now()) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (kind: string): boolean => {
    const rule = rules[kind];
    if (!rule) return false;
    const time = now();
    const bucket = buckets.get(kind) ?? { tokens: rule.burst, at: time };
    bucket.tokens = Math.min(rule.burst, bucket.tokens + ((time - bucket.at) / 1000) * rule.perSecond);
    bucket.at = time;
    buckets.set(kind, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
}
export const frameRateRules = {
  action: { burst: 3, perSecond: 0.5 },
  state: { burst: 10, perSecond: 4 },
  resize: { burst: 20, perSecond: 10 },
  initialize: { burst: 2, perSecond: 0.2 },
};

/** The active pack as CSS custom properties, the frame's only view of the host. */
export type LiveTheme = {
  appearance: "light" | "dark";
  colors: Record<string, string>;
  radius: number;
  fontFamily: "system" | "mono" | "serif";
  fontSize: number;
};
const fonts = {
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
};
const cssName = (key: string) => "--" + key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());
const safeColor = /^#[0-9a-fA-F]{3,8}$/;
export function themeVariables(theme: LiveTheme): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) if (safeColor.test(value)) variables[cssName(key)] = value;
  variables["--radius"] = `${Math.max(0, Math.min(24, Math.round(theme.radius)))}px`;
  variables["--font"] = fonts[theme.fontFamily];
  variables["--font-mono"] = fonts.mono;
  variables["--font-size"] = `${Math.max(11, Math.min(18, Math.round(theme.fontSize)))}px`;
  return variables;
}
export function themeCss(theme: LiveTheme): string {
  const body = Object.entries(themeVariables(theme))
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
  // color-scheme stays unset: a frame whose scheme differs from the page paints an opaque canvas.
  return `:root{${body}}`;
}
