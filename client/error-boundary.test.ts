import assert from "node:assert/strict";
import { test } from "node:test";
import { Component } from "react";
import { ErrorBoundary } from "./error-boundary";

test("the ES5 error boundary is a React class component that renders a fallback after an error", () => {
  const boundary = new ErrorBoundary({ children: "content", fallback: error => `failed: ${error}` });
  assert.ok(boundary instanceof Component);
  assert.ok((ErrorBoundary.prototype as { isReactComponent?: object }).isReactComponent);
  assert.equal(boundary.render(), "content");
  const derive = (ErrorBoundary as unknown as { getDerivedStateFromError(error: unknown): { error: string } })
    .getDerivedStateFromError;
  boundary.state = derive(new Error("boom"));
  assert.equal(boundary.render(), "failed: boom");
});
