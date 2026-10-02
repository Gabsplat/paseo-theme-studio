import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/**
 * Finds the Paseo CLI for plugin reloads. Services often run with a minimal PATH,
 * so PASEO_BIN and the default user install location are also checked.
 */
export function resolvePaseoCli(environment: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    environment.PASEO_BIN,
    ...(environment.PATH ?? "").split(delimiter).map(directory => directory && join(directory, "paseo")),
    join(homedir(), ".local", "bin", "paseo"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next location. */
    }
  }
  throw new Error(
    "The Paseo CLI was not found, so Theme Studio could not reload after activation. Set PASEO_BIN for the Paseo daemon.",
  );
}

/** PATH for the CLI child, including this Node runtime for `#!/usr/bin/env node` launchers. */
export function cliPath(environment: NodeJS.ProcessEnv = process.env): string {
  return [dirname(process.execPath), environment.PATH].filter(Boolean).join(delimiter);
}
