import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const missingOwnerGraceMs = 30000;
// Transactions hold the lock for milliseconds. A lock this old belongs to a crashed
// process even when its PID was reused after a restart.
const staleLockMs = 60000;

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

async function reclaimIfStale(lock: string): Promise<void> {
  let age: number;
  try {
    age = Date.now() - (await stat(lock)).mtimeMs;
  } catch {
    return; // Another process released or reclaimed it.
  }
  let stale = age > staleLockMs;
  if (!stale) {
    try {
      const pid = Number(await readFile(join(lock, "owner"), "utf8"));
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          stale = errorCode(error) === "ESRCH";
        }
      }
    } catch (error) {
      // A crash between mkdir and writing owner must not leave storage locked forever.
      // Give a live process ample time to publish its owner record before reclamation.
      stale = errorCode(error) === "ENOENT" && age > missingOwnerGraceMs;
    }
  }
  if (stale) await rm(lock, { recursive: true, force: true });
}

/** Cross-process directory lock. Resolves to a release function. */
export async function acquireLock(
  directory: string,
  name: string,
  busyMessage: string,
  attempts = 150,
): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, name);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
      try {
        await writeFile(join(lock, "owner"), String(process.pid), { mode: 0o600 });
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
      }
      return () => rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      await reclaimIfStale(lock);
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error(busyMessage);
}

/** Durably replaces `file` with `contents` through a synced temporary file and rename. */
export async function writeFileAtomic(directory: string, file: string, contents: string): Promise<void> {
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Caches a parsed JSON file by its stat identity. Writers replace files atomically,
 * so an unchanged inode, size, and mtime means the cached value is current.
 */
export class FileSnapshot<T> {
  private cached: { key: string; value: T } | null = null;
  constructor(private readonly file: string) {}
  private static key(info: { ino: number; size: number; mtimeMs: number }) {
    return `${info.ino}:${info.size}:${info.mtimeMs}`;
  }
  /** Returns the cached value, or undefined when the file changed or is missing. */
  async current(): Promise<T | undefined> {
    if (!this.cached) return undefined;
    try {
      return FileSnapshot.key(await stat(this.file)) === this.cached.key ? this.cached.value : undefined;
    } catch {
      return undefined;
    }
  }
  /** Reads, parses, and caches the file. Throws ENOENT and parse errors to the caller. */
  async load(parse: (raw: unknown) => T): Promise<{ raw: unknown; value: T }> {
    const before = await stat(this.file);
    const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
    const value = parse(raw);
    const after = await stat(this.file);
    const key = FileSnapshot.key(after);
    // Only cache a read that no concurrent writer replaced midway.
    this.cached = FileSnapshot.key(before) === key ? { key, value } : null;
    return { raw, value };
  }
  async remember(value: T): Promise<void> {
    try {
      this.cached = { key: FileSnapshot.key(await stat(this.file)), value };
    } catch {
      this.cached = null;
    }
  }
}
