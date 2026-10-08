import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  componentActionSchema,
  componentDefinitionSchema,
  componentInstanceFileSchema,
  componentLiveSchema,
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
  type ComponentStorage,
  type ComponentLive,
} from "../shared/components";
import { locateProject } from "./project";
import { liveComponentId } from "../shared/components";
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

const instanceDirectoryName = "component-instances";
const safeAgentFile = /^[A-Za-z0-9_-]{1,100}$/;
/** One file per owning conversation keeps every write proportional to that conversation. */
const shardName = (agentId: string) =>
  (safeAgentFile.test(agentId) ? agentId : "h-" + createHash("sha256").update(agentId).digest("hex")) + ".json";
const hasUserEvent = (instance: ComponentInstance) =>
  instance.events.some(event => event.action.action !== "__state__");
const hasPendingEvent = (instance: ComponentInstance) =>
  instance.events.some(event => !event.dispatchedAt && event.action.action !== "__state__");
const byCreation = (a: ComponentInstance, b: ComponentInstance) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

type Shard = { agentId: string; instances: ComponentInstance[] };
type ShardSummary = {
  key: string;
  agentId: string;
  bytes: number;
  ids: Set<string>;
  counts: Record<string, number>;
  componentBytes: Record<string, number>;
  pending: boolean;
  eventful: ComponentInstance[];
  oldest: string | null;
};
type Transaction = {
  library(): Promise<ComponentLibrary>;
  /** The mutable instances of one conversation; saved when the transaction commits. */
  shard(agentId: string): Promise<Shard>;
  /** Every conversation that currently stores instances. */
  agents(): Promise<string[]>;
  ownerOf(instanceId: string): Promise<string>;
};

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return 0;
  }
  for (const name of names) {
    try {
      const info = await stat(join(directory, name));
      total += info.isDirectory() ? await directorySize(join(directory, name)) : info.size;
    } catch {
      /* Removed concurrently. */
    }
  }
  return total;
}

export class ComponentService {
  readonly file: string;
  private readonly instanceDirectory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly snapshot: FileSnapshot<ComponentLibrary>;
  private readonly summaries = new Map<string, ShardSummary>();
  constructor(
    readonly directory: string,
    /** The plugin's install directory; found through the daemon when omitted. */
    private readonly project: () => Promise<string> = locateProject,
  ) {
    this.file = join(directory, "components.json");
    this.instanceDirectory = join(directory, instanceDirectoryName);
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
  /** Reads the catalog. Callers hold the transaction lock, because a legacy file is migrated here. */
  private async readDisk(): Promise<ComponentLibrary> {
    const cached = await this.snapshot.current();
    if (cached) return clone(cached);
    try {
      const library = clone((await this.snapshot.load(validateLibrary)).value);
      if (library.instances.length) await this.migrateInstances(library);
      return library;
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
  /** Earlier versions kept every instance inside components.json, capped at 500. */
  private async migrateInstances(library: ComponentLibrary) {
    const grouped = new Map<string, ComponentInstance[]>();
    for (const instance of library.instances)
      grouped.set(instance.agentId, [...(grouped.get(instance.agentId) ?? []), instance]);
    for (const [agentId, instances] of grouped) {
      const existing = (await this.loadShard(shardName(agentId)))?.instances ?? [];
      const known = new Set(existing.map(instance => instance.id));
      await this.writeShard({ agentId, instances: [...existing, ...instances.filter(item => !known.has(item.id))] });
    }
    library.instances = [];
    await this.persist(library);
  }
  private async persist(library: ComponentLibrary) {
    const { instanceCounts: _view, ...stored } = library;
    const valid = validateLibrary({ ...stored, instances: [] });
    await writeFileAtomic(this.directory, this.file, JSON.stringify(valid, null, 2) + "\n");
    await this.snapshot.remember(clone(valid));
  }
  private async loadShard(name: string): Promise<Shard | null> {
    try {
      const file = componentInstanceFileSchema.parse(
        JSON.parse(await readFile(join(this.instanceDirectory, name), "utf8")),
      );
      return { agentId: file.agentId, instances: file.instances };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`Component instance storage is invalid (${name}). The existing file has been preserved.`, {
        cause: error,
      });
    }
  }
  private async writeShard(shard: Shard) {
    const file = join(this.instanceDirectory, shardName(shard.agentId));
    if (!shard.instances.length) {
      await rm(file, { force: true });
      return;
    }
    const valid = componentInstanceFileSchema.parse({ format: 1, ...shard });
    if (new Set(valid.instances.map(instance => instance.id)).size !== valid.instances.length)
      throw new Error("Component instance IDs must be unique.");
    await mkdir(this.instanceDirectory, { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.instanceDirectory, file, JSON.stringify(valid) + "\n");
  }
  /**
   * Summaries of every conversation's file, refreshed by stat identity. Writers rename
   * complete files into place, so an unchanged file needs neither a lock nor a reread.
   */
  private async index(): Promise<ShardSummary[]> {
    let names: string[];
    try {
      names = (await readdir(this.instanceDirectory)).filter(name => name.endsWith(".json") && !name.startsWith("."));
    } catch {
      names = [];
    }
    const present = new Set(names);
    for (const name of this.summaries.keys()) if (!present.has(name)) this.summaries.delete(name);
    await Promise.all(
      names.map(async name => {
        try {
          const info = await stat(join(this.instanceDirectory, name));
          const key = `${info.ino}:${info.size}:${info.mtimeMs}`;
          if (this.summaries.get(name)?.key === key) return;
          const shard = await this.loadShard(name);
          if (!shard) {
            this.summaries.delete(name);
            return;
          }
          const summary: ShardSummary = {
            key,
            agentId: shard.agentId,
            bytes: info.size,
            ids: new Set(shard.instances.map(instance => instance.id)),
            counts: {},
            componentBytes: {},
            pending: shard.instances.some(hasPendingEvent),
            eventful: shard.instances.filter(hasUserEvent),
            oldest: shard.instances.reduce<string | null>(
              (oldest, instance) => (!oldest || instance.createdAt < oldest ? instance.createdAt : oldest),
              null,
            ),
          };
          for (const instance of shard.instances) {
            summary.counts[instance.componentId] = (summary.counts[instance.componentId] ?? 0) + 1;
            summary.componentBytes[instance.componentId] =
              (summary.componentBytes[instance.componentId] ?? 0) + JSON.stringify(instance).length;
          }
          this.summaries.set(name, summary);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          this.summaries.delete(name);
        }
      }),
    );
    return [...this.summaries.values()];
  }
  /** The catalog without instances: definitions, favorites, builds, and active code keys. */
  catalog(): Promise<ComponentLibrary> {
    return this.serial(async () => {
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
  /** The catalog with every stored instance. Proportional to all storage; hot paths use the narrower readers. */
  async read(): Promise<ComponentLibrary> {
    const library = await this.catalog();
    const shards = await Promise.all((await this.index()).map(summary => this.loadShard(shardName(summary.agentId))));
    library.instances = shards.flatMap(shard => shard?.instances ?? []).sort(byCreation);
    return library;
  }
  list() {
    return this.read();
  }
  /** Instances published in one conversation, oldest first. */
  async agentInstances(agentId: string): Promise<ComponentInstance[]> {
    return ((await this.loadShard(shardName(agentId)))?.instances ?? []).sort(byCreation);
  }
  /** Conversations that store at least one instance. */
  async instanceAgents(): Promise<string[]> {
    return (await this.index()).map(summary => summary.agentId);
  }
  /** Conversations with an interaction that has not reached its agent yet. */
  async pendingOwners(): Promise<string[]> {
    return (await this.index()).filter(summary => summary.pending).map(summary => summary.agentId);
  }
  /** Instances the user interacted with; the client needs them to recognise its own technical messages. */
  async interactedInstances(): Promise<ComponentInstance[]> {
    return clone((await this.index()).flatMap(summary => summary.eventful));
  }
  private async counts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const summary of await this.index())
      for (const [id, count] of Object.entries(summary.counts)) counts[id] = (counts[id] ?? 0) + count;
    return counts;
  }
  /** What clients and agents receive: the catalog, per-component totals, and a chosen slice of instances. */
  async view(library: ComponentLibrary, instances: ComponentInstance[] = []): Promise<ComponentLibrary> {
    return { ...library, instances, instanceCounts: await this.counts() };
  }
  /** Where Theme Studio's disk space goes. */
  async storage(): Promise<ComponentStorage> {
    const library = await this.catalog();
    const index = await this.index();
    const size = async (name: string) => {
      try {
        return (await stat(join(this.directory, name))).size;
      } catch {
        return 0;
      }
    };
    const parts = [
      { id: "instances", label: "Cards published in chats", bytes: index.reduce((sum, item) => sum + item.bytes, 0) },
      { id: "library", label: "Component definitions", bytes: await size("components.json") },
      { id: "packs", label: "Packs and draft history", bytes: await size("studio.json") },
      {
        id: "builds",
        label: "Code builds",
        bytes:
          (await directorySize(join(this.directory, "component-builds"))) +
          (await directorySize(join(this.directory, "component-validation"))),
      },
    ];
    const known = parts.reduce((sum, part) => sum + part.bytes, 0);
    const totalBytes = Math.max(known, await directorySize(this.directory));
    parts.push({ id: "other", label: "Settings and agent links", bytes: totalBytes - known });
    // Live frames have no definition but take space like any card, so they get a row too.
    const ids = [...new Set([...library.definitions.map(definition => definition.id), liveComponentId])];
    return {
      directory: this.directory,
      totalBytes,
      parts,
      instances: index.reduce((sum, item) => sum + item.ids.size, 0),
      conversations: index.length,
      oldestInstanceAt: index.reduce<string | null>(
        (oldest, item) => (item.oldest && (!oldest || item.oldest < oldest) ? item.oldest : oldest),
        null,
      ),
      components: ids
        .map(id => ({
          id,
          name: library.definitions.findLast(definition => definition.id === id)?.name ?? "Live frames",
          versions: library.definitions.filter(definition => definition.id === id).length,
          instances: index.reduce((sum, item) => sum + (item.counts[id] ?? 0), 0),
          bytes: index.reduce((sum, item) => sum + (item.componentBytes[id] ?? 0), 0),
        }))
        .filter(item => item.id !== liveComponentId || item.instances)
        .sort((a, b) => b.bytes - a.bytes),
    };
  }
  /**
   * Runs one locked transaction over the catalog and any conversations it touches.
   * Changed conversations are written first; the catalog revision advances only when the catalog changed.
   */
  private transact<T>(
    expectedRevision: number | null,
    operation: (transaction: Transaction) => T | Promise<T>,
  ): Promise<{ library: ComponentLibrary; result: T }> {
    return this.serial(async () => {
      const release = await this.acquire();
      try {
        const library = await this.readDisk();
        if (expectedRevision !== null && library.revision !== expectedRevision)
          throw new ComponentRevisionConflict(library.revision);
        const before = JSON.stringify(library);
        const shards = new Map<string, { shard: Shard; before: string }>();
        const transaction: Transaction = {
          library: async () => library,
          shard: async agentId => {
            const loaded = shards.get(agentId);
            if (loaded) return loaded.shard;
            const shard = (await this.loadShard(shardName(agentId))) ?? { agentId, instances: [] };
            shards.set(agentId, { shard, before: JSON.stringify(shard.instances) });
            return shard;
          },
          agents: async () => (await this.index()).map(summary => summary.agentId),
          ownerOf: async instanceId => {
            for (const [agentId, { shard }] of shards)
              if (shard.instances.some(instance => instance.id === instanceId)) return agentId;
            const owner = (await this.index()).find(summary => summary.ids.has(instanceId));
            if (!owner) throw new Error("Component instance was not found.");
            return owner.agentId;
          },
        };
        const result = await operation(transaction);
        const known = new Set(library.definitions.map(definition => `${definition.id}@${definition.version}`));
        for (const { shard, before: previous } of shards.values()) {
          if (JSON.stringify(shard.instances) === previous) continue;
          for (const instance of shard.instances)
            if (!instance.live && !known.has(`${instance.componentId}@${instance.componentVersion}`))
              throw new Error("A component instance references an unknown version.");
          await this.writeShard(shard);
        }
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
  private mutate<T>(
    expectedRevision: number | null,
    transform: (library: ComponentLibrary) => T | Promise<T>,
  ): Promise<{ library: ComponentLibrary; result: T }> {
    return this.transact(expectedRevision, async transaction => transform(await transaction.library()));
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
    const snapshot = await this.catalog();
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
    const { library, result } = await this.transact(input.expectedRevision, async transaction => {
      const library = await transaction.library();
      if (!library.definitions.some(item => item.id === input.id)) throw new Error("Component was not found.");
      const removedKeys = new Set(
        library.definitions.filter(item => item.id === input.id).map(item => `${item.id}@${item.version}`),
      );
      let removedInstances = 0;
      for (const agentId of await transaction.agents()) {
        const shard = await transaction.shard(agentId);
        const kept = shard.instances.filter(instance => instance.componentId !== input.id);
        removedInstances += shard.instances.length - kept.length;
        shard.instances = kept;
      }
      library.definitions = library.definitions.filter(item => item.id !== input.id);
      library.favorites = library.favorites.filter(id => id !== input.id);
      library.activeKeys = library.activeKeys.filter(key => !removedKeys.has(key));
      // Builds that include a deleted version can no longer be activated.
      const stale = library.builds.filter(build => build.keys.some(key => removedKeys.has(key)));
      library.builds = library.builds.filter(build => !stale.includes(build));
      return { removedInstances, staleBuilds: stale.map(build => build.id) };
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
    const { library, result } = await this.transact(null, async transaction => {
      const library = await transaction.library();
      const shard = await transaction.shard(input.agentId);
      const versions = library.definitions.filter(item => item.id === input.componentId);
      const definition = input.version ? versions.find(item => item.version === input.version) : versions.at(-1);
      if (!definition) throw new Error("Component version was not found.");
      if (trigger) {
        const declared = definition.triggers.find(item => item.id === trigger.id);
        if (!declared || !declared.enabled || declared.event !== trigger.event)
          throw new Error("This version does not declare an enabled trigger for that event.");
        const existing = shard.instances.find(
          instance =>
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
      shard.instances.push(instance);
      return { instance, ...(trigger ? { reused: false } : {}) };
    });
    return { library, ...result };
  }
  /** Stores a live frame in its conversation. It has no library definition and needs no activation. */
  async createLiveInstance(input: { agentId: string; live: ComponentLive; state?: ComponentState }) {
    const live = componentLiveSchema.parse(input.live);
    return (
      await this.transact(null, async transaction => {
        const shard = await transaction.shard(input.agentId);
        const instance: ComponentInstance = {
          id: randomUUID(),
          componentId: liveComponentId,
          componentVersion: 1,
          agentId: input.agentId,
          state: componentStateSchema.parse(input.state ?? {}),
          revision: 0,
          events: [],
          createdAt: new Date().toISOString(),
          live,
        };
        shard.instances.push(instance);
        return instance;
      })
    ).result;
  }
  /** Removes one unpublished instance. Used when its chat row could not be appended. */
  async removeInstance(instanceId: string) {
    await this.transact(null, async transaction => {
      let agentId: string;
      try {
        agentId = await transaction.ownerOf(instanceId);
      } catch {
        return null;
      }
      const shard = await transaction.shard(agentId);
      shard.instances = shard.instances.filter(instance => instance.id !== instanceId);
      return null;
    });
  }
  /** Removes instances owned by agents that no longer exist; their conversations are gone. */
  async removeAgentInstances(agentIds: readonly string[]) {
    if (!agentIds.length) return 0;
    const { result } = await this.transact(null, async transaction => {
      let removed = 0;
      for (const agentId of agentIds) {
        const shard = await transaction.shard(agentId);
        removed += shard.instances.length;
        shard.instances = [];
      }
      return removed;
    });
    return result;
  }
  /**
   * Frees space on request. Removed cards render as deleted in their chats, so nothing
   * calls this automatically: storage has no limit and old conversations keep their cards.
   */
  async clearInstances(input: { componentId?: string; before?: string }) {
    const { result } = await this.transact(null, async transaction => {
      let removed = 0;
      for (const agentId of await transaction.agents()) {
        const shard = await transaction.shard(agentId);
        const kept = shard.instances.filter(
          instance =>
            (input.componentId !== undefined && instance.componentId !== input.componentId) ||
            (input.before !== undefined && instance.createdAt >= input.before) ||
            // An interaction the agent has not received yet is never discarded.
            hasPendingEvent(instance),
        );
        removed += shard.instances.length - kept.length;
        shard.instances = kept;
      }
      return removed;
    });
    return result;
  }
  async readInstance(instanceId: string) {
    const owner = (await this.index()).find(summary => summary.ids.has(instanceId));
    const instance = owner && (await this.agentInstances(owner.agentId)).find(item => item.id === instanceId);
    if (!instance) throw new Error("Component instance was not found.");
    return instance;
  }
  /** Runs `change` on one stored instance inside a transaction. */
  private async changeInstance<T>(instanceId: string, change: (instance: ComponentInstance) => T): Promise<T> {
    return (
      await this.transact(null, async transaction => {
        const shard = await transaction.shard(await transaction.ownerOf(instanceId));
        const instance = shard.instances.find(item => item.id === instanceId);
        if (!instance) throw new Error("Component instance was not found.");
        return change(instance);
      })
    ).result;
  }
  async interact(input: { instanceId: string; expectedRevision: number; action: unknown }) {
    const action = componentActionSchema.parse(input.action);
    return this.changeInstance(input.instanceId, instance => {
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
      // Delivered events are history; keep the most recent ones so each card stays small.
      const delivered = instance.events.filter(item => item.dispatchedAt !== null);
      if (delivered.length > keptDeliveredEvents) {
        const dropped = new Set(delivered.slice(0, delivered.length - keptDeliveredEvents).map(item => item.id));
        instance.events = instance.events.filter(item => !dropped.has(item.id));
      }
      instance.revision++;
      return { instance, event };
    });
  }
  async updateInstance(input: { instanceId: string; expectedRevision: number; state: ComponentState }) {
    return this.changeInstance(input.instanceId, instance => {
      if (instance.revision !== input.expectedRevision) throw new ComponentRevisionConflict(instance.revision);
      instance.state = componentStateSchema.parse(input.state);
      instance.revision++;
      return instance;
    });
  }
  async markDispatched(input: { instanceId: string; eventId: string }) {
    return this.changeInstance(input.instanceId, instance => {
      const event = instance.events.find(item => item.id === input.eventId);
      if (!event) throw new Error("Component event was not found.");
      if (!event.dispatchedAt) event.dispatchedAt = new Date().toISOString();
      return instance;
    });
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
    const snapshot = await this.catalog();
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
