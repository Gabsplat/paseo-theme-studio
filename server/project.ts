import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cliPath, resolvePaseoCli } from "./paseo-cli";

const exec = promisify(execFile);
const pluginId = "theme-studio";
let located: Promise<string> | undefined;

async function isThisPlugin(directory: string): Promise<boolean> {
  try {
    return JSON.parse(await readFile(join(directory, "paseo-plugin.json"), "utf8")).id === pluginId;
  } catch {
    return false;
  }
}

/**
 * Finds the directory this plugin is installed in. Paseo evaluates the server bundle
 * from a string and moves managed installations after preparing them, so the location
 * cannot be recorded at build time; the daemon's plugin list is the source of truth.
 */
export function locateProject(
  home: string = process.env.PASEO_HOME || join(homedir(), ".paseo"),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  located ??= (async () => {
    const { stdout } = await exec(resolvePaseoCli(environment), ["plugin", "ls", "--json", "--home", home], {
      env: { ...environment, PATH: cliPath(environment) },
      timeout: 15000,
      maxBuffer: 1000000,
    });
    const plugins = JSON.parse(stdout) as { id?: unknown; path?: unknown }[];
    // The installer may rename the plugin with --id, so the manifest decides.
    const candidates = plugins
      .filter((plugin): plugin is { id: string; path: string } => typeof plugin.path === "string")
      .sort((first, second) => Number(second.id === pluginId) - Number(first.id === pluginId));
    for (const candidate of candidates) if (await isThisPlugin(candidate.path)) return candidate.path;
    throw new Error("Theme Studio could not find its own installation in `paseo plugin ls`.");
  })();
  // A failed lookup, such as a daemon that was still starting, must not be remembered.
  located.catch(() => (located = undefined));
  return located;
}
