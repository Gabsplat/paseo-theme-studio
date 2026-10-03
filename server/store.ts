import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { acquireLock, FileSnapshot, writeFileAtomic } from "./storage";
import {
  actionSchema,
  documentSchema,
  initialDocument,
  type StudioAction,
  type StudioDocument,
  type StudioTheme,
} from "../shared/theme";
import { presets } from "../shared/presets";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export class RevisionConflict extends Error {
  constructor(public readonly revision: number) {
    super(`Theme changed elsewhere. Refresh and retry with revision ${revision}.`);
  }
}

function validateDocument(value: unknown): StudioDocument {
  const document = documentSchema.parse(value);
  if (!document.history.length || document.cursor >= document.history.length)
    throw new Error("Theme history has an invalid cursor.");
  if (new Set(document.locks).size !== document.locks.length) throw new Error("Theme locks contain duplicates.");
  if (new Set(document.saved.map(theme => theme.id)).size !== document.saved.length)
    throw new Error("Saved theme IDs must be unique.");
  if (new Set(document.favorites).size !== document.favorites.length)
    throw new Error("Favorite theme IDs must be unique.");
  if (document.favorites.some(id => !document.saved.some(theme => theme.id === id)))
    throw new Error("A favorite theme was not found in the saved library.");
  return document;
}

function migrateDocument(value: unknown): StudioDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return validateDocument(value);
  const raw = value as Record<string, unknown>;
  return validateDocument({
    ...raw,
    active: Object.prototype.hasOwnProperty.call(raw, "active") ? raw.active : raw.current,
    previousActive: Object.prototype.hasOwnProperty.call(raw, "previousActive") ? raw.previousActive : null,
  });
}

function respectLocks(document: StudioDocument, theme: StudioTheme): StudioTheme {
  const next = clone(theme);
  for (const key of document.locks) next.colors[key] = document.current.colors[key];
  return next;
}

function appendHistory(
  document: StudioDocument,
  theme: StudioTheme,
  label: string,
  source: "manual" | "agent" | "preset" | "system",
) {
  document.current = clone(theme);
  document.history = document.history.slice(0, document.cursor + 1);
  document.history.push({ theme: clone(theme), label, source, at: new Date().toISOString() });
  document.history = document.history.slice(-200);
  document.cursor = document.history.length - 1;
}

function applyAction(
  document: StudioDocument,
  action: StudioAction,
  source: "manual" | "agent" = "manual",
): StudioDocument {
  const next = clone(document);
  if (source === "agent" && ["activate", "revert-active", "disable-pack"].includes(action.type))
    throw new Error("Only the user can activate, disable, or revert an active pack.");
  if (source === "agent" && action.type === "lock" && !action.locked)
    throw new Error("Only the user can unlock a color.");
  switch (action.type) {
    case "patch": {
      for (const key of next.locks)
        if (action.colors[key] !== undefined && action.colors[key] !== next.current.colors[key])
          throw new Error(`${key} is locked. Unlock it before editing.`);
      const theme = {
        ...next.current,
        ...(action.name ? { name: action.name } : {}),
        ...(action.appearance ? { appearance: action.appearance } : {}),
        colors: { ...next.current.colors, ...action.colors },
        ui: { ...next.current.ui, ...action.ui },
      };
      appendHistory(next, theme, action.label ?? "Pack updated", source);
      break;
    }
    case "patch-ui": {
      appendHistory(
        next,
        { ...next.current, ui: { ...next.current.ui, ...action.ui } },
        action.label ?? "Layout updated",
        source,
      );
      break;
    }
    case "activate":
      next.previousActive = clone(next.active);
      next.active = clone(next.current);
      break;
    case "revert-active": {
      if (!next.previousActive) throw new Error("No previous active pack is available.");
      const active = next.active;
      next.active = clone(next.previousActive);
      next.previousActive = clone(active);
      break;
    }
    case "disable-pack": {
      if (next.active) next.previousActive = clone(next.active);
      next.active = null;
      break;
    }
    case "lock":
      next.locks = action.locked
        ? [...new Set([...next.locks, action.key])]
        : next.locks.filter(key => key !== action.key);
      break;
    case "preset":
    case "load":
    case "import": {
      const selected =
        action.type === "import"
          ? action.theme
          : (action.type === "preset" ? presets : next.saved).find(theme => theme.id === action.id);
      if (!selected) throw new Error("Theme was not found.");
      const theme = respectLocks(next, selected);
      appendHistory(next, theme, `Loaded ${theme.name}`, action.type === "preset" ? "preset" : source);
      next.baseline = clone(theme);
      break;
    }
    case "undo":
    case "redo": {
      const cursor = next.cursor + (action.type === "undo" ? -1 : 1);
      if (cursor < 0 || cursor >= next.history.length) throw new Error(`Nothing to ${action.type}.`);
      const target = next.history[cursor].theme;
      for (const key of next.locks)
        if (target.colors[key] !== next.current.colors[key])
          throw new Error(`${key} is locked. Unlock it before ${action.type}.`);
      next.cursor = cursor;
      next.current = clone(target);
      break;
    }
    case "save": {
      const theme = { ...clone(next.current), id: randomUUID(), name: action.name ?? next.current.name };
      next.saved.push(theme);
      next.current = clone(theme);
      next.history[next.cursor].theme = clone(theme);
      next.baseline = clone(theme);
      break;
    }
    case "delete": {
      if (!next.saved.some(theme => theme.id === action.id)) throw new Error("Saved theme was not found.");
      next.saved = next.saved.filter(theme => theme.id !== action.id);
      next.favorites = next.favorites.filter(id => id !== action.id);
      break;
    }
    case "favorite":
    case "unfavorite": {
      if (!next.saved.some(theme => theme.id === action.id)) throw new Error("Saved theme was not found.");
      next.favorites =
        action.type === "favorite"
          ? [...new Set([...next.favorites, action.id])]
          : next.favorites.filter(id => id !== action.id);
      break;
    }
  }
  return validateDocument(next);
}

export class StudioStore {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly snapshot: FileSnapshot<StudioDocument>;
  constructor(readonly directory: string) {
    this.file = join(directory, "studio.json");
    this.snapshot = new FileSnapshot(this.file);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private acquire(): Promise<() => Promise<void>> {
    return acquireLock(this.directory, ".transaction", "Theme storage is busy. Retry shortly.");
  }

  private async readDisk(): Promise<StudioDocument> {
    const cached = await this.snapshot.current();
    if (cached) return cached;
    try {
      const { raw, value } = await this.snapshot.load(migrateDocument);
      if (JSON.stringify(raw) !== JSON.stringify(value)) await this.persist(value);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Theme storage is invalid. The existing file has been preserved.", { cause: error });
      const initial = initialDocument();
      await this.persist(initial);
      return initial;
    }
  }

  private async persist(document: StudioDocument): Promise<void> {
    const valid = validateDocument(document);
    await writeFileAtomic(this.directory, this.file, JSON.stringify(valid, null, 2) + "\n");
    await this.snapshot.remember(clone(valid));
  }

  read(): Promise<StudioDocument> {
    return this.serial(async () => {
      // Writers rename complete files into place, so an unchanged file needs no lock.
      const cached = await this.snapshot.current();
      if (cached) return clone(cached);
      const release = await this.acquire();
      try {
        return clone(await this.readDisk());
      } finally {
        await release();
      }
    });
  }

  mutate(expectedRevision: number, transform: (document: StudioDocument) => StudioDocument): Promise<StudioDocument> {
    return this.serial(async () => {
      const release = await this.acquire();
      try {
        const current = await this.readDisk();
        if (current.revision !== expectedRevision) throw new RevisionConflict(current.revision);
        const next = validateDocument(transform(clone(current)));
        next.revision = current.revision + 1;
        await this.persist(next);
        return clone(next);
      } finally {
        await release();
      }
    });
  }

  change(expectedRevision: number, action: unknown, source: "manual" | "agent" = "manual") {
    const parsed = actionSchema.parse(action);
    return this.mutate(expectedRevision, document => applyAction(document, parsed, source));
  }

  variant(expectedRevision: number, patch: Extract<StudioAction, { type: "patch" }>) {
    return this.mutate(expectedRevision, document => {
      const next = applyAction(document, patch, "agent");
      next.current.id = randomUUID();
      next.history[next.cursor].theme = clone(next.current);
      next.saved.push(clone(next.current));
      next.baseline = clone(next.current);
      return next;
    });
  }

  async close() {
    await this.queue;
  }
}
