import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  componentActionSchema,
  componentDefinitionSchema,
  componentInstanceTriggerSchema,
  componentLibrarySchema,
  componentStateSchema,
  componentTriggersSchema,
  parseComponentTree,
  type ComponentBuild,
  type ComponentDefinition,
  type ComponentInstance,
  type ComponentLibrary,
  type ComponentState,
} from "../shared/components";
import { locateProject } from "./project";
import { acquireLock, FileSnapshot, writeFileAtomic } from "./storage";
import { clientTsconfig, findModules, typecheckDirectory, writeFiles } from "./typecheck";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const compilerConfiguration = clientTsconfig(["client/**/*.tsx", "shared/**/*.ts"]);
export class ComponentRevisionConflict extends Error {
  constructor(public readonly revision: number) {
    super(`Component changed elsewhere. Refresh and retry with revision ${revision}.`);
  }
}

function validateLibrary(value: unknown): ComponentLibrary {
  const library = componentLibrarySchema.parse(value);
  const keys = library.definitions.map(definition => `${definition.id}@${definition.version}`);
  if (new Set(keys).size !== keys.length) throw new Error("Component versions must be unique.");
  if (new Set(library.instances.map(instance => instance.id)).size !== library.instances.length)
    throw new Error("Component instance IDs must be unique.");
  for (const definition of library.definitions)
    if (definition.mode === "composition") parseComponentTree(definition.tree);
  const byKey = new Map(library.definitions.map(definition => [`${definition.id}@${definition.version}`, definition]));
  const triggerOccurrences = new Set<string>();
  for (const instance of library.instances) {
    const definition = byKey.get(`${instance.componentId}@${instance.componentVersion}`);
    if (!definition) throw new Error("A component instance references an unknown version.");
    if (instance.trigger) {
      if (
        !definition.triggers.some(
          trigger =>
            trigger.id === instance.trigger!.id && trigger.enabled && trigger.event === instance.trigger!.event,
        )
      )
        throw new Error("A component instance references an undeclared or disabled trigger.");
      const occurrence = JSON.stringify([
        instance.agentId,
        instance.componentId,
        instance.componentVersion,
        instance.trigger.id,
        instance.trigger.turnId,
        instance.trigger.turnStartedAt ?? null,
        instance.trigger.occurrenceKey,
      ]);
      if (triggerOccurrences.has(occurrence))
        throw new Error("A component trigger occurrence must have only one instance.");
      triggerOccurrences.add(occurrence);
    }
  }
  for (const key of library.activeKeys)
    if (byKey.get(key)?.mode !== "code") throw new Error("An active code component version does not exist.");
  return library;
}

const allowedImports = new Set([
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
  "@getpaseo/plugin",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/react-native",
  "@getpaseo/plugin/client/ui",
]);
const keptBuilds = 5;
const maxPendingEvents = 200;
const keptDeliveredEvents = 50;
const failedCandidateRetentionMs = 7 * 24 * 60 * 60 * 1000;

/** Deletes entries of `directory` last modified before the retention window. */
export async function removeOlderThan(
  directory: string,
  retentionMs: number,
  shouldRemove: (path: string) => Promise<boolean> = async () => true,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  const cutoff = Date.now() - retentionMs;
  for (const name of names) {
    const path = join(directory, name);
    try {
      if ((await stat(path)).mtimeMs < cutoff && (await shouldRemove(path)))
        await rm(path, { recursive: true, force: true });
    } catch {
      /* Removed concurrently. */
    }
  }
}

// Native escape hatches: device APIs, URL handlers, and runtime settings.
const restrictedNativeImports = new Set([
  "NativeModules",
  "TurboModuleRegistry",
  "NativeEventEmitter",
  "DeviceEventEmitter",
  "Linking",
  "DevSettings",
  "requireNativeComponent",
  "PermissionsAndroid",
  "Share",
  "Clipboard",
]);
/**
 * Rejects obvious capability use in generated source. This is a best-effort filter,
 * not a sandbox: activation requires the user to review the full source.
 */
export function validateComponentCode(code: string, modules: string): void {
  if (!code.trim() || code.length > 40000) throw new Error("Component source must contain 1–40,000 characters.");
  // Untyped on purpose: Paseo resolves every type import when it compiles the plugin, and
  // TypeScript is a development dependency that a published installation does not have.
  const ts: any = createRequire(join(modules, "typescript/package.json"))(
    join(modules, "typescript/lib/typescript.js"),
  );
  const file = ts.createSourceFile("component.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = file.parseDiagnostics ?? [];
  if (diagnostics.length)
    throw new Error(
      "Component TSX could not be parsed: " + ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " "),
    );
  let hasDefault = false;
  function visit(node: any) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const module = node.moduleSpecifier;
      if (module && ts.isStringLiteral(module)) {
        const relativeType =
          ts.isImportDeclaration(node) && node.importClause?.isTypeOnly && module.text === "../../shared/components";
        if (!allowedImports.has(module.text) && !relativeType)
          throw new Error(
            `Unsupported component import ${module.text}. Use public Paseo, React, and React Native modules only.`,
          );
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (node.moduleSpecifier.text === "react-native" && bindings) {
        if (ts.isNamespaceImport(bindings))
          throw new Error("Import React Native members by name so their capabilities can be checked.");
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (restrictedNativeImports.has(imported))
            throw new Error(`Unsupported component capability ${imported}. Components use native UI only.`);
        }
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      ["constructor", "__proto__", "prototype"].includes(node.argumentExpression.text)
    )
      throw new Error(`Unsupported component capability ${node.argumentExpression.text}.`);
    if (ts.isImportEqualsDeclaration(node)) throw new Error("Component import assignments are not supported.");
    if (ts.isExportAssignment(node) && !node.isExportEquals) hasDefault = true;
    if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier: { kind: number }) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      hasDefault = true;
    if (
      ts.isIdentifier(node) &&
      [
        "eval",
        "Function",
        "require",
        "process",
        "global",
        "globalThis",
        "document",
        "window",
        "localStorage",
        "sessionStorage",
        "navigator",
        "XMLHttpRequest",
        "WebSocket",
        "fetch",
        "dangerouslySetInnerHTML",
        "Reflect",
        "self",
        "constructor",
        "__proto__",
        "Proxy",
      ].includes(node.text)
    )
      throw new Error(
        `Unsupported component capability ${node.text}. Components use native UI and the provided onAction callback.`,
      );
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      throw new Error("Unsupported class syntax. Use function components; Paseo mobile cannot run classes.");
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      throw new Error("Dynamic imports are not supported in generated components.");
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      /^[a-z]/.test(node.tagName.text)
    )
      throw new Error("Generated components must use React Native elements, not HTML.");
    if (ts.isJsxAttribute(node) && ["className", "onClick"].includes(node.name.getText(file)))
      throw new Error("Generated components must use native style and onPress props.");
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!hasDefault)
    throw new Error("Component source must default-export a React Native component accepting ComponentProps.");
}

function generatedFiles(definitions: ComponentDefinition[]): Record<string, string> {
  const codes = definitions.filter(
    (definition): definition is Extract<ComponentDefinition, { mode: "code" }> => definition.mode === "code",
  );
  const files: Record<string, string> = {};
  const imports: string[] = [
    'import type { ComponentType } from "react";',
    'import type { ComponentProps } from "../shared/components";',
  ];
  const entries: string[] = [];
  codes.forEach((definition, index) => {
    const filename = `${definition.id}-v${definition.version}`;
    imports.push(`import Component${index} from "./generated/${filename}";`);
    entries.push(`  ${JSON.stringify(`${definition.id}@${definition.version}`)}: Component${index},`);
    files[`client/generated/${filename}.tsx`] = definition.code;
  });
  files["client/generated-components.tsx"] =
    imports.join("\n") +
    "\nexport const generatedComponents: Record<string, ComponentType<ComponentProps>> = {\n" +
    entries.join("\n") +
    "\n};\n";
  return files;
}

export class ComponentService {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly snapshot: FileSnapshot<ComponentLibrary>;
  constructor(
    readonly directory: string,
    /** The plugin's install directory; found through the daemon when omitted. */
    private readonly project: () => Promise<string> = locateProject,
  ) {
    this.file = join(directory, "components.json");
    this.snapshot = new FileSnapshot(this.file);
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private acquire() {
    return acquireLock(this.directory, ".components-transaction", "Component storage is busy. Retry shortly.", 300);
  }
  private async readDisk(): Promise<ComponentLibrary> {
    const cached = await this.snapshot.current();
    if (cached) return clone(cached);
    try {
      return clone((await this.snapshot.load(validateLibrary)).value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Component storage is invalid. The existing file has been preserved.", { cause: error });
      const initial: ComponentLibrary = {
        format: 1,
        revision: 0,
        definitions: [],
        instances: [],
        favorites: [],
        builds: [],
        activeKeys: [],
      };
      await this.persist(initial);
      return initial;
    }
  }
  private async persist(library: ComponentLibrary) {
    const valid = validateLibrary(library);
    await writeFileAtomic(this.directory, this.file, JSON.stringify(valid, null, 2) + "\n");
    await this.snapshot.remember(clone(valid));
  }
  read(): Promise<ComponentLibrary> {
    return this.serial(async () => {
      // Writers rename complete files into place, so an unchanged file needs no lock.
      const cached = await this.snapshot.current();
      if (cached) return clone(cached);
      const release = await this.acquire();
      try {
        return await this.readDisk();
      } finally {
        await release();
      }
    });
  }
  list() {
    return this.read();
  }
  private mutate<T>(
    expectedRevision: number | null,
    transform: (library: ComponentLibrary) => T | Promise<T>,
  ): Promise<{ library: ComponentLibrary; result: T }> {
    return this.serial(async () => {
      const release = await this.acquire();
      try {
        const library = await this.readDisk();
        if (expectedRevision !== null && library.revision !== expectedRevision)
          throw new ComponentRevisionConflict(library.revision);
        const before = JSON.stringify(library);
        const result = await transform(library);
        if (JSON.stringify(library) !== before) {
          library.revision++;
          await this.persist(library);
        }
        return { library: clone(library), result: clone(result) };
      } finally {
        await release();
      }
    });
  }
  async createComposition(input: {
    expectedRevision: number;
    id: string;
    name: string;
    tree: unknown;
    triggers?: unknown;
  }) {
    const tree = parseComponentTree(input.tree);
    const triggers = input.triggers === undefined ? undefined : componentTriggersSchema.parse(input.triggers);
    const { library, result: definition } = await this.mutate(input.expectedRevision, library => {
      const version =
        Math.max(0, ...library.definitions.filter(item => item.id === input.id).map(item => item.version)) + 1;
      const latest = library.definitions.find(item => item.id === input.id && item.version === version - 1);
      const definition = componentDefinitionSchema.parse({
        id: input.id,
        name: input.name,
        version,
        mode: "composition",
        tree,
        triggers: triggers ?? latest?.triggers ?? [],
        createdAt: new Date().toISOString(),
      });
      library.definitions.push(definition);
      return definition;
    });
    return { library, definition };
  }
  async createCode(input: { expectedRevision: number; id: string; name: string; code: string; triggers?: unknown }) {
    const triggers = input.triggers === undefined ? undefined : componentTriggersSchema.parse(input.triggers);
    validateComponentCode(input.code, await findModules(await this.project()));
    const snapshot = await this.read();
    if (snapshot.revision !== input.expectedRevision) throw new ComponentRevisionConflict(snapshot.revision);
    const version =
      Math.max(0, ...snapshot.definitions.filter(item => item.id === input.id).map(item => item.version)) + 1;
    const latest = snapshot.definitions.find(item => item.id === input.id && item.version === version - 1);
    const candidate = componentDefinitionSchema.parse({
      id: input.id,
      name: input.name,
      version,
      mode: "code",
      code: input.code,
      triggers: triggers ?? latest?.triggers ?? [],
      createdAt: new Date().toISOString(),
    });
    // Saved versions are immutable, so reject a failed candidate before it can block future historical builds.
    await removeOlderThan(join(this.directory, "component-validation"), failedCandidateRetentionMs);
    const directory = join(this.directory, "component-validation", randomUUID());
    await this.checkSources([...snapshot.definitions, candidate], directory);
    await rm(directory, { recursive: true, force: true });
    const { library, result: definition } = await this.mutate(input.expectedRevision, library => {
      library.definitions.push(candidate);
      return candidate;
    });
    return { library, definition };
  }
  /**
   * Deletes every version of a component, its favorite flag, and its published instances.
   * Chat rows that pointed at those instances render as deleted.
   */
  async deleteComponent(input: { expectedRevision: number; id: string }) {
    const { library, result } = await this.mutate(input.expectedRevision, library => {
      if (!library.definitions.some(item => item.id === input.id)) throw new Error("Component was not found.");
      const removedKeys = new Set(
        library.definitions.filter(item => item.id === input.id).map(item => `${item.id}@${item.version}`),
      );
      const before = library.instances.length;
      library.definitions = library.definitions.filter(item => item.id !== input.id);
      library.instances = library.instances.filter(instance => instance.componentId !== input.id);
      library.favorites = library.favorites.filter(id => id !== input.id);
      library.activeKeys = library.activeKeys.filter(key => !removedKeys.has(key));
      // Builds that include a deleted version can no longer be activated.
      const stale = library.builds.filter(build => build.keys.some(key => removedKeys.has(key)));
      library.builds = library.builds.filter(build => !stale.includes(build));
      return { removedInstances: before - library.instances.length, staleBuilds: stale.map(build => build.id) };
    });
    for (const id of result.staleBuilds)
      await rm(join(this.directory, "component-builds", id), { recursive: true, force: true });
    return { library, removedInstances: result.removedInstances };
  }
  async setFavorite(input: { expectedRevision: number; id: string; favorite: boolean }) {
    return (
      await this.mutate(input.expectedRevision, library => {
        if (!library.definitions.some(item => item.id === input.id)) throw new Error("Component was not found.");
        library.favorites = input.favorite
          ? [...new Set([...library.favorites, input.id])]
          : library.favorites.filter(id => id !== input.id);
        return null;
      })
    ).library;
  }
  async createInstance(input: {
    expectedRevision: number;
    componentId: string;
    version?: number;
    agentId: string;
    state?: ComponentState;
    trigger?: unknown;
  }): Promise<{ library: ComponentLibrary; instance: ComponentInstance; reused?: boolean }> {
    const trigger = input.trigger === undefined ? undefined : componentInstanceTriggerSchema.parse(input.trigger);
    if (trigger && input.version === undefined)
      throw new Error("Triggered components require an explicit immutable version.");
    const { library, result } = await this.mutate(null, library => {
      const versions = library.definitions.filter(item => item.id === input.componentId);
      const definition = input.version ? versions.find(item => item.version === input.version) : versions.at(-1);
      if (!definition) throw new Error("Component version was not found.");
      if (trigger) {
        const declared = definition.triggers.find(item => item.id === trigger.id);
        if (!declared || !declared.enabled || declared.event !== trigger.event)
          throw new Error("This version does not declare an enabled trigger for that event.");
        const existing = library.instances.find(
          instance =>
            instance.agentId === input.agentId &&
            instance.componentId === definition.id &&
            instance.componentVersion === definition.version &&
            instance.trigger?.id === trigger.id &&
            instance.trigger.event === trigger.event &&
            instance.trigger.turnId === trigger.turnId &&
            (instance.trigger.turnStartedAt ?? null) === (trigger.turnStartedAt ?? null) &&
            instance.trigger.occurrenceKey === trigger.occurrenceKey,
        );
        // Retry identity takes precedence over a stale library revision; no new write or state replacement occurs.
        if (existing) return { instance: existing, reused: true };
      }
      if (library.revision !== input.expectedRevision) throw new ComponentRevisionConflict(library.revision);
      if (definition.mode === "code" && !library.activeKeys.includes(`${definition.id}@${definition.version}`))
        throw new Error("Build and activate this code version before publishing it in chat.");
      const instance: ComponentInstance = {
        id: randomUUID(),
        componentId: definition.id,
        componentVersion: definition.version,
        agentId: input.agentId,
        state: componentStateSchema.parse(input.state ?? {}),
        revision: 0,
        events: [],
        createdAt: new Date().toISOString(),
        ...(trigger ? { trigger } : {}),
      };
      library.instances.push(instance);
      return { instance, ...(trigger ? { reused: false } : {}) };
    });
    return { library, ...result };
  }
  /** Removes one unpublished instance. Used when its chat row could not be appended. */
  async removeInstance(instanceId: string) {
    await this.mutate(null, library => {
      library.instances = library.instances.filter(instance => instance.id !== instanceId);
      return null;
    });
  }
  /** Removes instances owned by agents that no longer exist; their conversations are gone. */
  async removeAgentInstances(agentIds: readonly string[]) {
    if (!agentIds.length) return 0;
    const { result } = await this.mutate(null, library => {
      const before = library.instances.length;
      library.instances = library.instances.filter(instance => !agentIds.includes(instance.agentId));
      return before - library.instances.length;
    });
    return result;
  }
  async readInstance(instanceId: string) {
    const instance = (await this.read()).instances.find(item => item.id === instanceId);
    if (!instance) throw new Error("Component instance was not found.");
    return instance;
  }
  async interact(input: { instanceId: string; expectedRevision: number; action: unknown }) {
    const action = componentActionSchema.parse(input.action);
    const { result } = await this.mutate(null, library => {
      const instance = library.instances.find(item => item.id === input.instanceId);
      if (!instance) throw new Error("Component instance was not found.");
      if (instance.revision !== input.expectedRevision) throw new ComponentRevisionConflict(instance.revision);
      instance.state = componentStateSchema.parse({ ...instance.state, ...action.patch });
      const event = {
        id: randomUUID(),
        at: new Date().toISOString(),
        action,
        state: clone(instance.state),
        dispatchedAt: null,
      };
      if (instance.events.filter(item => item.dispatchedAt === null).length >= maxPendingEvents)
        throw new Error("Component event queue is full. Wait for the agent to catch up.");
      instance.events.push(event);
      // Delivered events are history; keep the most recent ones so the library stays small.
      const delivered = instance.events.filter(item => item.dispatchedAt !== null);
      if (delivered.length > keptDeliveredEvents) {
        const dropped = new Set(delivered.slice(0, delivered.length - keptDeliveredEvents).map(item => item.id));
        instance.events = instance.events.filter(item => !dropped.has(item.id));
      }
      instance.revision++;
      return { instance, event };
    });
    return result;
  }
  async updateInstance(input: { instanceId: string; expectedRevision: number; state: ComponentState }) {
    return (
      await this.mutate(null, library => {
        const instance = library.instances.find(item => item.id === input.instanceId);
        if (!instance) throw new Error("Component instance was not found.");
        if (instance.revision !== input.expectedRevision) throw new ComponentRevisionConflict(instance.revision);
        instance.state = componentStateSchema.parse(input.state);
        instance.revision++;
        return instance;
      })
    ).result;
  }
  async markDispatched(input: { instanceId: string; eventId: string }) {
    return (
      await this.mutate(null, library => {
        const instance = library.instances.find(item => item.id === input.instanceId);
        if (!instance) throw new Error("Component instance was not found.");
        const event = instance.events.find(item => item.id === input.eventId);
        if (!event) throw new Error("Component event was not found.");
        if (!event.dispatchedAt) event.dispatchedAt = new Date().toISOString();
        return instance;
      })
    ).result;
  }
  private async checkSources(definitions: ComponentDefinition[], directory: string) {
    const files = generatedFiles(definitions);
    const projectDirectory = await this.project();
    files["shared/components.ts"] = await readFile(join(projectDirectory, "shared/components.ts"), "utf8");
    files["tsconfig.json"] = compilerConfiguration;
    await writeFiles(directory, files);
    await typecheckDirectory(
      directory,
      projectDirectory,
      `Component build failed typechecking. Existing registered code remains unchanged. Candidate source is preserved at ${directory}.`,
    );
    return files;
  }
  async build(input: { expectedRevision: number }) {
    const snapshot = await this.read();
    if (snapshot.revision !== input.expectedRevision) throw new ComponentRevisionConflict(snapshot.revision);
    const definitions = snapshot.definitions.filter(item => item.mode === "code");
    if (!definitions.length) throw new Error("Create a code component before building.");
    const modules = await findModules(await this.project());
    for (const definition of definitions)
      if (definition.mode === "code") validateComponentCode(definition.code, modules);
    const id = randomUUID();
    const directory = join(this.directory, "component-builds", id);
    const files = await this.checkSources(definitions, directory);
    const build: ComponentBuild = {
      id,
      directory,
      libraryRevision: snapshot.revision,
      keys: definitions.map(item => `${item.id}@${item.version}`),
      typecheck: true,
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(directory, "validation.json"), JSON.stringify(build, null, 2) + "\n", { mode: 0o600 });
    const { library, result: dropped } = await this.mutate(snapshot.revision, library => {
      library.builds.push(build);
      const dropped = library.builds.slice(0, Math.max(0, library.builds.length - keptBuilds));
      library.builds = library.builds.slice(-keptBuilds);
      return dropped.map(item => item.id);
    });
    // Activation copies sources into the plugin, so older build directories are no longer needed.
    for (const old of dropped)
      await rm(join(this.directory, "component-builds", old), { recursive: true, force: true });
    return {
      library,
      build,
      files: [...Object.keys(files), "validation.json"],
      validation: { typecheck: true as const },
    };
  }
  async activateBuild(input: { expectedRevision: number; buildId: string; reviewedKeys: readonly string[] }) {
    const projectDirectory = await this.project();
    const { library } = await this.mutate(input.expectedRevision, async library => {
      const build = library.builds.find(item => item.id === input.buildId);
      if (!build) throw new Error("Validated component build was not found.");
      if (library.activeKeys.some(key => !build.keys.includes(key)))
        throw new Error(
          "This build omits a previously active component version. Build the full library again to preserve existing chat components.",
        );
      // The typecheck and import filter are not a sandbox; the user must see new source before it runs.
      if (build.keys.some(key => !library.activeKeys.includes(key) && !input.reviewedKeys.includes(key)))
        throw new Error("Review the source of each new component version before activating it.");
      const definitions = library.definitions.filter(item => build.keys.includes(`${item.id}@${item.version}`));
      const expected = generatedFiles(definitions);
      expected["shared/components.ts"] = await readFile(join(projectDirectory, "shared/components.ts"), "utf8");
      expected["tsconfig.json"] = compilerConfiguration;
      for (const [name, source] of Object.entries(expected))
        if ((await readFile(join(build.directory, name), "utf8")) !== source)
          throw new Error("Generated component build was changed after validation. Build it again before activating.");
      try {
        // Modules are immutable. Write them first, then atomically replace the registry.
        for (const [name, source] of Object.entries(expected).filter(([name]) =>
          name.startsWith("client/generated/"),
        )) {
          const target = join(projectDirectory, name);
          await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
          await writeFile(target, source, { mode: 0o600 });
        }
        const registry = join(projectDirectory, "client/generated-components.tsx");
        const temporary = registry + "." + randomUUID() + ".tmp";
        try {
          await writeFile(temporary, expected["client/generated-components.tsx"], { mode: 0o600 });
          await rename(temporary, registry);
        } finally {
          await rm(temporary, { force: true });
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM" || code === "EROFS")
          throw new Error(
            `Theme Studio cannot write activated components into its plugin directory (${projectDirectory}). Install the plugin from a writable directory.`,
            { cause: error },
          );
        throw error;
      }
      library.activeKeys = [...build.keys];
      return null;
    });
    return { library, reloadRequired: true as const };
  }
  async close() {
    await this.queue;
  }
}
