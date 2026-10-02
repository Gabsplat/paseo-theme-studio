import { execFile } from "node:child_process";
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Compiler options shared by generated component builds and exported packs. */
export function clientTsconfig(include: string[]): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2023"],
        types: ["react"],
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
      },
      include,
    },
    null,
    2,
  );
}

export async function writeFiles(directory: string, files: Record<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [name, contents] of Object.entries(files)) {
    const file = join(directory, name);
    await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
    await writeFile(file, contents, { mode: 0o600 });
  }
}

/**
 * Typechecks `directory` with this project's TypeScript and dependencies.
 * On failure, throws `failure` followed by the compiler output.
 */
export async function typecheckDirectory(directory: string, projectDirectory: string, failure: string): Promise<void> {
  const modules = join(directory, "node_modules");
  await symlink(join(projectDirectory, "node_modules"), modules, "dir");
  try {
    await exec(
      process.execPath,
      [
        join(projectDirectory, "node_modules/typescript/lib/tsc.js"),
        "--project",
        join(directory, "tsconfig.json"),
        "--noEmit",
      ],
      { timeout: 30000, maxBuffer: 1000000 },
    );
  } catch (error) {
    const output = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`${failure} ${(output.stdout || output.stderr || output.message).slice(0, 1600)}`);
  } finally {
    await unlink(modules);
  }
}
