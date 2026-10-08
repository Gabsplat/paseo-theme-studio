// Browser-only APIs. Everything here is inert unless Platform.OS === "web", which
// covers Paseo web and desktop (Electron); native clients render a fallback instead.
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import type { ComponentState } from "../shared/components";
import {
  createRateLimiter,
  frameRateRules,
  liveLimits,
  liveSandbox,
  parseFrameMessage,
  themeCss,
  themeVariables,
  withLiveCsp,
  type LiveTheme,
} from "../shared/live";
import { liveKitCss, liveKitScript } from "./live-kit";

// The project compiles without the DOM library, so the few browser types used here are declared locally.
type FrameWindow = { postMessage(message: unknown, targetOrigin: string): void };
type HTMLIFrameElement = { contentWindow: FrameWindow | null };
type MessageEvent = { source: unknown; data: unknown };
type BrowserWindow = {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};
const browser = globalThis as { window?: BrowserWindow; document?: unknown };
const window = browser.window as BrowserWindow;

export const canRunLiveFrames = Platform.OS === "web" && Boolean(browser.window) && Boolean(browser.document);

/** JSON inside an inline script must not be able to close it. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** The complete frame document: policy first, then the kit, then the agent's HTML verbatim. */
export function liveDocument(html: string, boot: { state: ComponentState; theme: LiveTheme }): string {
  const theme = { appearance: boot.theme.appearance, variables: themeVariables(boot.theme) };
  return withLiveCsp(
    `<style>${themeCss(boot.theme)}${liveKitCss}</style>` +
      `<script>window.__liveBoot=${scriptJson({ state: boot.state, theme })}</script>` +
      `<script>${liveKitScript}</script>` +
      html,
  );
}

// Frames running at once. When a new one starts past the limit, the least recently
// started pauses to a placeholder until it is shown again.
const running: { id: string; pause: () => void }[] = [];
function claimSlot(id: string, pause: () => void) {
  const index = running.findIndex(item => item.id === id);
  if (index >= 0) running.splice(index, 1);
  running.push({ id, pause });
  while (running.length > liveLimits.activeFrames) running.shift()!.pause();
  return () => {
    const at = running.findIndex(item => item.id === id);
    if (at >= 0) running.splice(at, 1);
  };
}

export type LiveFrameEvents = {
  onState: (state: ComponentState) => void;
  onAction: (action: { action: string; value?: unknown; patch?: ComponentState }) => void;
  onRejected?: (reason: string) => void;
};

/**
 * The sandboxed frame. `html` alone decides the document, so theme and state changes
 * reach the running frame as messages instead of reloading it.
 */
export function LiveFrameView({
  id,
  title,
  html,
  theme,
  state,
  height,
  events,
}: {
  id: string;
  title: string;
  html: string;
  theme: LiveTheme;
  state: ComponentState;
  height?: number;
  events: LiveFrameEvents;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const latest = useRef({ theme, state, events });
  latest.current = { theme, state, events };
  // Captured once per document, so later changes go through postMessage.
  const source = useMemo(() => liveDocument(html, { state, theme }), [html, paused]);
  const allow = useMemo(() => createRateLimiter(frameRateRules), [html]);

  useEffect(() => {
    if (paused) return;
    return claimSlot(id, () => setPaused(true));
  }, [id, paused]);

  useEffect(() => {
    if (!canRunLiveFrames || paused) return;
    const send = (message: object) =>
      // An opaque-origin frame can only be addressed with "*"; it receives no secrets.
      frame.current?.contentWindow?.postMessage({ jsonrpc: "2.0", ...message }, "*");
    const hostContext = () => ({
      theme: { appearance: latest.current.theme.appearance, variables: themeVariables(latest.current.theme) },
    });
    function onMessage(event: MessageEvent) {
      // Only this frame's own window counts; any other sender is ignored outright.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const parsed = parseFrameMessage(event.data);
      if (!parsed.ok) return latest.current.events.onRejected?.(parsed.reason);
      const message = parsed.message;
      if (message.method === "ui/initialize") {
        if (!allow("initialize")) return;
        send({ id: message.id, result: { protocolVersion: "2025-06-18", hostContext: hostContext() } });
        send({ method: "paseo/state", params: { state: latest.current.state } });
      } else if (message.method === "ui/notifications/size-changed") {
        if (allow("resize"))
          setMeasured(Math.max(liveLimits.minHeight, Math.min(liveLimits.maxHeight, Math.ceil(message.params.height))));
      } else if (message.method === "paseo/state") {
        if (allow("state")) latest.current.events.onState(message.params.state);
        else latest.current.events.onRejected?.("state rate limit");
      } else if (message.method === "ui/message") {
        if (allow("action")) latest.current.events.onAction(message.params);
        else latest.current.events.onRejected?.("action rate limit");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [source, paused]);

  // Live theme: repaint the running frame without reloading it.
  const themeKey = JSON.stringify(theme);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/host-context-changed",
        params: { theme: { appearance: theme.appearance, variables: themeVariables(theme) } },
      },
      "*",
    );
  }, [themeKey]);
  const stateKey = JSON.stringify(state);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ jsonrpc: "2.0", method: "paseo/state", params: { state } }, "*");
  }, [stateKey]);

  const shown = measured ?? height ?? liveLimits.defaultHeight;
  if (!canRunLiveFrames) return null;
  if (paused)
    return createElement(
      "button",
      {
        type: "button",
        onClick: () => setPaused(false),
        style: {
          height: Math.min(shown, 120),
          width: "100%",
          border: `1px dashed ${theme.colors.border}`,
          borderRadius: 10,
          background: "transparent",
          color: theme.colors.foregroundMuted,
          font: "inherit",
          cursor: "pointer",
        },
      },
      `Paused to save resources · Show ${title}`,
    );
  return createElement("iframe", {
    ref: frame,
    title,
    srcDoc: source,
    sandbox: liveSandbox,
    referrerPolicy: "no-referrer",
    loading: "lazy",
    style: { width: "100%", height: shown, border: "none", display: "block", background: "transparent" },
  });
}
