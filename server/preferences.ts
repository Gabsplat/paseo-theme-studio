import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { studioPreferencesSchema, type StudioPreferences } from "../shared/preferences";
import { writeFileAtomic } from "./storage";

export class PreferencesStore {
  readonly file: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {
    this.file = join(directory, "preferences.json");
  }
  async read(): Promise<StudioPreferences> {
    try {
      return studioPreferencesSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch {
      // Missing or unreadable preferences fall back to defaults; they are not worth failing over.
      return studioPreferencesSchema.parse({});
    }
  }
  change(patch: Partial<StudioPreferences>): Promise<StudioPreferences> {
    const operation = this.pending
      .catch(() => {})
      .then(async () => {
        const next = studioPreferencesSchema.parse({ ...(await this.read()), ...patch });
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await writeFileAtomic(this.directory, this.file, JSON.stringify(next) + "\n");
        return next;
      });
    this.pending = operation;
    return operation;
  }
  async close() {
    await this.pending.catch(() => {});
  }
}
