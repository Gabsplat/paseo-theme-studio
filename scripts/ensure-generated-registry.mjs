// Activated component code is local to each installation and is not versioned.
// Create an empty registry so a fresh checkout compiles before any activation.
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const registry = resolve(new URL("..", import.meta.url).pathname, "client/generated-components.tsx");
try {
  await access(registry);
} catch {
  await writeFile(
    registry,
    'import type { ComponentType } from "react";\nimport type { ComponentProps } from "../shared/components";\nexport const generatedComponents: Record<string, ComponentType<ComponentProps>> = {};\n',
  );
  console.log("Created an empty generated component registry.");
}
