import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioStore } from "./store";
import { PackExporter } from "./export";

test("export produces a typechecked standalone pack without agent state or tooling links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-pack-export-"));
  const store = new StudioStore(directory);
  try {
    const first = await store.read();
    const draft = await store.change(first.revision, { type: "patch", name: "Editor's \"pack\"", ui: { toolCards: "bordered", panel: { enabled: true, title: "Notes", icon: "BookOpen", blocks: [{ type: "text", text: "Literal code: $(touch /tmp/never-run) <script>alert(1)</script>" }] } } });
    const exporter = new PackExporter(store);
    await assert.rejects(exporter.export({ expectedRevision: first.revision }), /changed elsewhere/);
    const result = await exporter.export({ expectedRevision: draft.revision });
    assert.equal(result.validation.typecheck, true);
    const manifest = JSON.parse(await readFile(join(result.directory, "paseo-plugin.json"), "utf8"));
    assert.equal(manifest.id, "theme-pack-editor-s-pack");
    assert.equal(manifest.requirements.paseo, ">=0.9.2 <0.11.0");
    const pack = JSON.parse(await readFile(join(result.directory, "pack.json"), "utf8"));
    assert.deepEqual(pack, draft.current);
    assert.equal("designerAgentId" in pack, false);
    assert.equal(result.files.some(file => /bridge|studio\.json|designer\.json/.test(file)), false);
    await assert.rejects(stat(join(result.directory, "node_modules")), { code: "ENOENT" });
    assert.equal((await store.read()).revision, draft.revision);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
