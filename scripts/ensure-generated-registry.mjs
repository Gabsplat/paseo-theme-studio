// Activated component code is local to each installation. The repository ships an empty
// registry; this recreates it if it is missing, and `--check` guards a publish.
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const registry = resolve(new URL("..", import.meta.url).pathname, "client/generated-components.tsx");
const empty =
  'import type { ComponentType } from "react";\nimport type { ComponentProps } from "../shared/components";\nexport const generatedComponents: Record<string, ComponentType<ComponentProps>> = {};\n';
if (process.argv.includes("--check")) {
  // A package must not ship one machine's activated components.
  if ((await readFile(registry, "utf8")) !== empty) {
    console.error("client/generated-components.tsx holds activated components. Publish from a clean checkout.");
    process.exit(1);
  }
} else {
  try {
    await access(registry);
  } catch {
    await writeFile(registry, empty);
    console.log("Created an empty generated component registry.");
  }
}
