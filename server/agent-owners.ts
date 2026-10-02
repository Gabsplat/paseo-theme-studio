import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export const ownerTokenEnvironment = "PASEO_THEME_STUDIO_OWNER_TOKEN";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class AgentOwners {
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = join(directory, "agent-owners");
  }
  allocate() {
    const token = randomUUID();
    return { token, path: join(this.directory, token + ".json") };
  }
  async bind(token: string | undefined, agentId: string) {
    if (!token) return;
    if (!uuid.test(token) || !uuid.test(agentId)) throw new Error("Invalid Theme Studio owner binding.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, token + ".json");
    try {
      await writeFile(file, JSON.stringify({ agentId }), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const saved = JSON.parse(await readFile(file, "utf8"));
      if (saved.agentId !== agentId) throw new Error("Theme Studio owner binding belongs to another agent.");
    }
  }
}
