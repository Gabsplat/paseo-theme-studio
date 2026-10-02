import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentConnectionSchema, type AgentConnection } from "../shared/agent-connection";
export class AgentConnectionStore {
  private pending: Promise<unknown> = Promise.resolve();
  readonly file: string;
  constructor(private readonly directory: string) {
    this.file = join(directory, "agent-connection.json");
  }
  async read(): Promise<AgentConnection> {
    try {
      return agentConnectionSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { revision: 0, enabled: false, automaticTriggers: true };
      throw error;
    }
  }
  change(expectedRevision: number, enabled?: boolean, automaticTriggers?: boolean): Promise<AgentConnection> {
    const operation = this.pending
      .catch(() => {})
      .then(async () => {
        const current = await this.read();
        if (current.revision !== expectedRevision) throw new Error("Connection settings changed. Refresh and retry.");
        const settings = {
          enabled: enabled ?? current.enabled,
          automaticTriggers: automaticTriggers ?? current.automaticTriggers,
        };
        if (current.enabled === settings.enabled && current.automaticTriggers === settings.automaticTriggers)
          return current;
        const next = { revision: current.revision + 1, ...settings };
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = this.file + `.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, this.file);
        return next;
      });
    this.pending = operation;
    return operation;
  }
  async close() {
    await this.pending.catch(() => {});
  }
}
