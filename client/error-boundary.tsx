import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallback: (error: string) => ReactNode };
type State = { error: string | null };
type Boundary = Component<Props, State>;

/**
 * React error boundary built with ES5 prototypes. React only supports boundaries as
 * class components, but Paseo mobile evaluates plugin bundles with Hermes, which
 * rejects class syntax.
 */
export const ErrorBoundary = function ErrorBoundary(this: Boundary, props: Props) {
  (Component as unknown as (this: Boundary, props: Props) => void).call(this, props);
  this.state = { error: null };
} as unknown as new (props: Props) => Boundary;
ErrorBoundary.prototype = Object.create(Component.prototype);
ErrorBoundary.prototype.constructor = ErrorBoundary;
(ErrorBoundary as unknown as { getDerivedStateFromError: (error: unknown) => State }).getDerivedStateFromError =
  error => ({ error: error instanceof Error ? error.message : String(error) });
ErrorBoundary.prototype.render = function (this: Boundary) {
  return this.state.error !== null ? this.props.fallback(this.state.error) : this.props.children;
};
