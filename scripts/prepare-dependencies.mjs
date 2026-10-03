// Runs as the manifest's build step when Paseo installs the plugin. Paseo does not install
// a Git source's dependencies, and the server needs TypeScript to validate component source.
// An npm installation already has it, so this only installs when it is missing.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const projectDirectory = resolve(new URL("..", import.meta.url).pathname);
try {
  createRequire(resolve(projectDirectory, "package.json")).resolve("typescript");
} catch {
  const child = spawn("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: projectDirectory,
    stdio: "inherit",
  });
  child.once("error", error => {
    console.error("Theme Studio could not run npm to install its dependencies: " + error.message);
    process.exit(1);
  });
  child.once("close", code => process.exit(code ?? 1));
}
