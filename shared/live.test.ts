import assert from "node:assert/strict";
import test from "node:test";
import {
  createRateLimiter,
  liveCspPolicy,
  liveInputSchema,
  liveLimits,
  parseFrameMessage,
  themeCss,
  withLiveCsp,
} from "./live";

test("the policy matches Paseo's HTML preview and always leads the document", () => {
  assert.equal(
    liveCspPolicy,
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'",
  );
  for (const html of [
    "<p>hi</p>",
    "<!DOCTYPE html><html><head><meta http-equiv='Content-Security-Policy' content=\"default-src *\"></head></html>",
    "﻿<!-- --!> <body>x",
    "  <?xml version='1.0'?><svg/>",
  ]) {
    const wrapped = withLiveCsp(html);
    assert.ok(
      wrapped.startsWith(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${liveCspPolicy}">`),
    );
    assert.ok(wrapped.endsWith(html.replace(/^﻿/, "")));
  }
  assert.equal(withLiveCsp("﻿x").includes("﻿"), false);
});

test("bridge messages are validated, capped, and limited to the allowed methods", () => {
  const ok = (data: unknown) => parseFrameMessage(data).ok;
  assert.ok(ok({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 240, width: 600 } }));
  assert.ok(ok({ jsonrpc: "2.0", method: "paseo/state", params: { state: { count: 3 } } }));
  assert.ok(ok({ jsonrpc: "2.0", method: "ui/message", params: { action: "pick", value: { id: 2 } } }));
  assert.ok(ok(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ui/initialize" })));
  assert.equal(ok({ jsonrpc: "2.0", method: "tools/call", params: { name: "x" } }), false);
  assert.equal(ok({ jsonrpc: "2.0", method: "ui/open-link", params: { url: "https://x" } }), false);
  assert.equal(ok({ method: "ui/message", params: { action: "pick" } }), false);
  assert.equal(ok({ jsonrpc: "2.0", method: "ui/message", params: { action: "rm -rf /" } }), false);
  assert.equal(ok({ jsonrpc: "2.0", method: "ui/message", params: { action: "a", extra: 1 } }), false);
  assert.equal(ok({ jsonrpc: "2.0", method: "paseo/state", params: { state: { blob: "x".repeat(13000) } } }), false);
  assert.equal(parseFrameMessage("x".repeat(liveLimits.messageChars + 1)).ok, false);
  assert.equal(parseFrameMessage("{not json").ok, false);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(parseFrameMessage(cyclic).ok, false);
});

test("the rate limiter allows a burst, then refills over time, per kind", () => {
  let now = 0;
  const allow = createRateLimiter({ action: { burst: 2, perSecond: 1 } }, () => now);
  assert.deepEqual([allow("action"), allow("action"), allow("action")], [true, true, false]);
  now = 1000;
  assert.equal(allow("action"), true);
  assert.equal(allow("action"), false);
  assert.equal(allow("unknown"), false);
});

test("tool input enforces the HTML and height limits, and themes emit only safe values", () => {
  assert.ok(liveInputSchema.safeParse({ title: "Chart", html: "<p>x</p>", height: 300 }).success);
  assert.equal(
    liveInputSchema.safeParse({ title: "Chart", html: "x".repeat(liveLimits.htmlChars + 1) }).success,
    false,
  );
  assert.equal(liveInputSchema.safeParse({ title: "Chart", html: "x", height: 5000 }).success, false);
  const css = themeCss({
    appearance: "dark",
    colors: { surface0: "#101010", accent: "red;}body{display:none" },
    radius: 99,
    fontFamily: "mono",
    fontSize: 13,
  });
  assert.match(css, /--surface0:#101010/);
  assert.match(css, /--radius:24px/);
  assert.doesNotMatch(css, /display:none/);
});
