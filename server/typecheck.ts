import { execFile } from "node:child_process";
import { access, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the `node_modules` that holds this plugin's TypeScript. Only a development checkout
 * has one: Paseo installs published plugins without development dependencies.
 */
export async function findModules(projectDirectory: string): Promise<string> {
  for (let directory = projectDirectory; ; directory = dirname(directory)) {
    const modules = join(directory, "node_modules");
    if (await exists(join(modules, "typescript", "package.json"))) return modules;
    if (dirname(directory) === directory)
      throw new Error(
        "Code components and pack export need Theme Studio's development dependencies, which this installation does not include. Clone the repository, run `pnpm install`, and install the plugin from that directory.",
      );
  }
}

/**
 * Typechecks `directory` with this project's TypeScript and dependencies.
 * On failure, throws `failure` followed by the compiler output.
 */
export async function typecheckDirectory(directory: string, projectDirectory: string, failure: string): Promise<void> {
  const dependencies = await findModules(projectDirectory);
  // Paseo installs published plugins without development dependencies, so the React Native
  // and plugin SDK types that generated code is checked against are only present in a checkout.
  for (const name of ["@types/react", "react-native", "@getpaseo/plugin"])
    if (!(await exists(join(dependencies, name, "package.json"))))
      throw new Error(
        "Typechecking generated code needs Theme Studio's development dependencies, which this installation does not include. Clone the repository, run `pnpm install`, and install the plugin from that directory.",
      );
  const modules = join(directory, "node_modules");
  await symlink(dependencies, modules, "dir");
  try {
    await exec(
      process.execPath,
      [join(dependencies, "typescript/lib/tsc.js"), "--project", join(directory, "tsconfig.json"), "--noEmit"],
      { timeout: 30000, maxBuffer: 1000000 },
    );
  } catch (error) {
    const output = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`${failure} ${(output.stdout || output.stderr || output.message).slice(0, 1600)}`);
  } finally {
    await unlink(modules);
  }
}
