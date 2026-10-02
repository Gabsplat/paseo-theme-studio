import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { makeBridgeSource } from "./bridge-source";
import { contrastReport } from "./contrast";
import { StudioStore } from "./store";
import {
  capabilities,
  codeGenerationTools,
  contrastSchema,
  lockSchema,
  patchSchema,
  presetSchema,
  revisionSchema,
  saveSchema,
  toolDefinitions,
  variantSchema,
} from "./capabilities";

/** `caller` is the Paseo agent ID that the MCP bridge process is bound to, when known. */
export type ComponentCall = (name: string, input: unknown, caller: string | undefined) => Promise<unknown>;
export const callerHeader = "x-theme-studio-caller";
const agentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ThemeBridge {
  readonly script: string;
  readonly endpoint: string;
  private server: Server | null = null;
  private ready: Promise<void> | null = null;
  private readonly token = randomBytes(32).toString("hex");
  constructor(
    private readonly store: StudioStore,
    private readonly componentCall?: ComponentCall,
  ) {
    this.script = join(store.directory, "theme-mcp.cjs");
    this.endpoint = join(store.directory, "bridge.json");
  }
  ensure(): Promise<void> {
    return (this.ready ??= this.start().catch(error => {
      this.ready = null;
      throw error;
    }));
  }
  private async start(): Promise<void> {
    await mkdir(this.store.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.script, makeBridgeSource(), { mode: 0o600 });
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.requestTimeout = 70000;
    this.server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Could not start the designer bridge.");
    const temporary = this.endpoint + `.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ port: address.port, token: this.token }), { mode: 0o600 });
    await rename(temporary, this.endpoint);
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(data));
    };
    const provided = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      send(401, { error: "Unauthorized" });
      request.resume();
      return;
    }
    if (request.method !== "POST" || request.url !== "/tool") {
      send(404, { error: "Not found" });
      request.resume();
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 1000000) throw new Error("Theme request exceeded its limit.");
      }
      const input = z.object({ name: z.string(), arguments: z.unknown() }).strict().parse(JSON.parse(body));
      const header = request.headers[callerHeader];
      const caller = typeof header === "string" && agentIdPattern.test(header) ? header : undefined;
      send(200, await this.call(input.name, input.arguments, caller));
    } catch (error) {
      if (!response.destroyed && !response.headersSent)
        send(400, { error: error instanceof Error ? error.message : "Theme tool failed." });
    }
  }
  async call(name: string, input: unknown, caller?: string): Promise<unknown> {
    switch (name) {
      case "read_theme":
        z.object({}).strict().parse(input);
        return { ...(await this.store.read()), capabilities: capabilities() };
      case "read_capabilities":
        z.object({}).strict().parse(input);
        return capabilities();
      case "list_tools":
        z.object({}).strict().parse(input);
        return toolDefinitions;
      case "check_contrast": {
        const colors = contrastSchema.parse(input);
        const document = await this.store.read();
        const palette =
          colors.foreground && colors.background
            ? { ...document.current.colors, foreground: colors.foreground, background: colors.background }
            : document.current.colors;
        const report = contrastReport(palette, document.current.appearance);
        return {
          revision: document.revision,
          ...(colors.foreground
            ? {
                requestedPair: {
                  foregroundColor: colors.foreground,
                  backgroundColor: colors.background,
                  ...report.checks[0],
                },
              }
            : {}),
          ...report,
        };
      }
      case "patch_theme":
      case "patch_pack": {
        const { expectedRevision, component, ...patch } = patchSchema.parse(input);
        if (component) {
          if (Object.keys(patch.colors).length || patch.ui || patch.name || patch.appearance || patch.label)
            throw new Error("Use a separate call for component operations and pack edits.");
          if ((await this.store.read()).revision !== expectedRevision)
            throw new Error("Studio changed elsewhere. Read read_theme and retry.");
          if (!this.componentCall) throw new Error("Component service is unavailable.");
          // The compatibility route inherits patch_theme's approval, so it must not bypass
          // the permission prompt that general agents get for code generation.
          if (codeGenerationTools.includes(component.tool)) {
            const designerAgentId = (await this.store.read()).designerAgentId;
            if (!caller || caller !== designerAgentId)
              throw new Error(`Call ${component.tool} directly so the user can approve generated code.`);
          }
          return this.componentCall(component.tool, component.arguments, caller);
        }
        return this.store.change(expectedRevision, { type: "patch", ...patch }, "agent");
      }
      case "create_variant": {
        const { expectedRevision, ...patch } = variantSchema.parse(input);
        return this.store.variant(expectedRevision, { type: "patch", label: `Variant: ${patch.name}`, ...patch });
      }
      case "undo":
        return this.store.change(revisionSchema.parse(input).expectedRevision, { type: "undo" }, "agent");
      case "redo":
        return this.store.change(revisionSchema.parse(input).expectedRevision, { type: "redo" }, "agent");
      case "save_pack": {
        const { expectedRevision, name: packName } = saveSchema.parse(input);
        return this.store.change(expectedRevision, { type: "save", name: packName }, "agent");
      }
      case "load_preset": {
        const { expectedRevision, id } = presetSchema.parse(input);
        return this.store.change(expectedRevision, { type: "preset", id }, "agent");
      }
      case "lock_color": {
        const { expectedRevision, key } = lockSchema.parse(input);
        return this.store.change(expectedRevision, { type: "lock", key, locked: true }, "agent");
      }
      case "list_saved_packs": {
        z.object({}).strict().parse(input);
        const document = await this.store.read();
        return {
          revision: document.revision,
          packs: document.saved.map(pack => ({ ...pack, favorite: document.favorites.includes(pack.id) })),
        };
      }
      case "favorite_pack": {
        const args = z
          .object({ expectedRevision: z.number().int(), id: z.string(), favorite: z.boolean() })
          .strict()
          .parse(input);
        return this.store.change(
          args.expectedRevision,
          { type: args.favorite ? "favorite" : "unfavorite", id: args.id },
          "agent",
        );
      }
      case "load_saved_pack": {
        const args = z.object({ expectedRevision: z.number().int(), id: z.string() }).strict().parse(input);
        return this.store.change(args.expectedRevision, { type: "load", id: args.id }, "agent");
      }
      default:
        if (
          this.componentCall &&
          [
            "list_component_triggers",
            "trigger_component",
            "list_components",
            "read_component_instance",
            "create_composition",
            "create_code_component",
            "build_components",
            "publish_component",
            "update_component_state",
            "favorite_component",
          ].includes(name)
        )
          return this.componentCall(name, input, caller);
        throw new Error("Unknown theme tool.");
    }
  }
  async close(): Promise<void> {
    if (this.ready) await this.ready.catch(() => {});
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>(resolve => this.server!.close(() => resolve()));
      this.server = null;
    }
    try {
      if (JSON.parse(await readFile(this.endpoint, "utf8")).token === this.token)
        await rm(this.endpoint, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.ready = null;
  }
}
