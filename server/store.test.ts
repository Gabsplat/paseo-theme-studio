import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { forestTheme } from "../shared/theme";
import { presets } from "../shared/presets";
import { RevisionConflict, StudioStore } from "./store";

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "theme-studio-test-"));
  const store = new StudioStore(directory);
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return store;
}

test("concurrent manual and agent edits share a revision and persist the winner", async t => {
  const store = await fixture(t);
  const first = await store.read();
  const second = new StudioStore(store.directory);
  const results = await Promise.allSettled([
    store.change(first.revision, { type: "patch", colors: { accent: "#112233" } }),
    second.change(first.revision, { type: "patch", colors: { foreground: "#FFFFFF" } }, "agent"),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failed = results.find(result => result.status === "rejected");
  assert.ok(failed?.status === "rejected" && failed.reason instanceof RevisionConflict);
  const restored = await new StudioStore(store.directory).read();
  assert.equal(restored.revision, first.revision + 1);
  assert.equal(restored.history.length, 2);
  assert.deepEqual(restored.current, restored.history[restored.cursor].theme);
  assert.equal((await stat(store.file)).mode & 0o777, 0o600);
});

test("locks protect manual and agent edits, replacement themes, and undo", async t => {
  const store = await fixture(t);
  let document = await store.read();
  document = await store.change(document.revision, { type: "patch", colors: { accent: "#112233" } });
  document = await store.change(document.revision, { type: "lock", key: "accent", locked: true });
  const revision = document.revision;
  for (const source of ["manual", "agent"] as const)
    await assert.rejects(
      store.change(revision, { type: "patch", colors: { accent: "#FFFFFF", border: "#FFFFFF" } }, source),
      /accent is locked/,
    );
  await assert.rejects(store.change(revision, { type: "undo" }), /accent is locked/);
  assert.equal((await store.read()).revision, revision);
  document = await store.change(revision, { type: "preset", id: "paper" });
  assert.equal(document.current.colors.accent, "#112233");
  assert.equal(document.current.colors.background, presets.find(theme => theme.id === "paper")!.colors.background);
  document = await store.change(document.revision, { type: "import", theme: forestTheme });
  assert.equal(document.current.colors.accent, "#112233");
  document = await store.change(document.revision, { type: "save", name: "Locked saved" });
  const savedId = document.saved[0].id;
  document = await store.change(document.revision, { type: "lock", key: "accent", locked: false });
  document = await store.change(document.revision, { type: "patch", colors: { accent: "#ABCDEF" } });
  document = await store.change(document.revision, { type: "lock", key: "accent", locked: true });
  document = await store.change(document.revision, { type: "load", id: savedId });
  assert.equal(document.current.colors.accent, "#ABCDEF");
});

test("undo survives restart and new edits discard the redo branch", async t => {
  const store = await fixture(t);
  let document = await store.read();
  document = await store.change(
    document.revision,
    { type: "patch", colors: { accent: "#111111" }, label: "first" },
    "agent",
  );
  document = await store.change(document.revision, { type: "patch", colors: { accent: "#222222" }, label: "second" });
  document = await store.change(document.revision, { type: "undo" });
  const restored = new StudioStore(store.directory);
  document = await restored.read();
  assert.equal(document.current.colors.accent, "#111111");
  document = await restored.change(document.revision, { type: "redo" });
  assert.equal(document.current.colors.accent, "#222222");
  document = await restored.change(document.revision, { type: "undo" });
  document = await restored.change(document.revision, { type: "patch", colors: { accent: "#333333" } });
  await assert.rejects(restored.change(document.revision, { type: "redo" }), /Nothing to redo/);
  assert.ok(!document.history.some(entry => entry.theme.colors.accent === "#222222"));
  assert.equal(document.history[1].source, "agent");
});

test("saved variants commit once, remain independent, and survive restart", async t => {
  const store = await fixture(t);
  const initial = await store.read();
  const variant = await store.variant(initial.revision, {
    type: "patch",
    name: "Variant",
    colors: { accent: "#123456" },
  });
  assert.equal(variant.revision, initial.revision + 1);
  assert.equal(variant.saved.length, 1);
  assert.deepEqual(variant.baseline, variant.current);
  const updated = await store.change(variant.revision, { type: "patch", colors: { accent: "#FEDCBA" } });
  assert.equal(updated.saved[0].colors.accent, "#123456");
  assert.equal(updated.baseline.colors.accent, "#123456");
  assert.deepEqual((await new StudioStore(store.directory).read()).saved, updated.saved);
});

test("invalid persisted documents are preserved rather than reset", async t => {
  const store = await fixture(t);
  const document = await store.read();
  const invalid = JSON.stringify({ ...document, cursor: 999 });
  await writeFile(store.file, invalid);
  await assert.rejects(store.read(), /existing file has been preserved/);
  assert.equal(await readFile(store.file, "utf8"), invalid);
});

test("a crashed transaction without an owner record can be reclaimed", async t => {
  const store = await fixture(t);
  const document = await store.read();
  const lock = join(store.directory, ".transaction");
  await mkdir(lock);
  const old = new Date(Date.now() - 60000);
  await utimes(lock, old, old);
  const changed = await store.change(document.revision, { type: "patch", name: "After crash" });
  assert.equal(changed.revision, document.revision + 1);
});

test("an old transaction is reclaimed even when its owner PID was reused by a live process", async t => {
  const store = await fixture(t);
  const document = await store.read();
  const lock = join(store.directory, ".transaction");
  await mkdir(lock);
  // The parent process is alive, as a reused PID would be after a restart.
  await writeFile(join(lock, "owner"), String(process.ppid));
  const old = new Date(Date.now() - 120000);
  await utimes(lock, old, old);
  const changed = await store.change(document.revision, { type: "patch", name: "After reuse" });
  assert.equal(changed.revision, document.revision + 1);
});

test("cached reads observe documents replaced by another process", async t => {
  const store = await fixture(t);
  const document = await store.read();
  const other = new StudioStore(store.directory);
  await other.change(document.revision, { type: "patch", name: "Elsewhere" });
  const seen = await store.read();
  assert.equal(seen.revision, document.revision + 1);
  assert.equal(seen.current.name, "Elsewhere");
  seen.current.name = "Mutated copy";
  assert.equal((await store.read()).current.name, "Elsewhere");
});

test("legacy palette storage migrates into a pack without changing the active palette or revision", async t => {
  const store = await fixture(t);
  let document = await store.read();
  document = await store.change(document.revision, {
    type: "patch",
    name: "Legacy custom",
    colors: { accent: "#123456" },
  });
  document = await store.change(document.revision, { type: "save", name: "Legacy saved" });
  const legacy = JSON.stringify(document, (key, value) =>
    ["ui", "active", "previousActive"].includes(key) ? undefined : value,
  );
  await writeFile(store.file, legacy);
  const restored = await new StudioStore(store.directory).read();
  assert.equal(restored.revision, document.revision);
  assert.equal(restored.active?.colors.accent, "#123456");
  assert.equal(restored.active?.name, "Legacy saved");
  assert.deepEqual(restored.current.ui, forestTheme.ui);
  assert.deepEqual(restored.saved[0].ui, forestTheme.ui);
  assert.deepEqual(restored.history.at(-1)?.theme.ui, forestTheme.ui);
  assert.equal(JSON.parse(await readFile(store.file, "utf8")).active.colors.accent, "#123456");
});

test("draft pack edits and saves stay inactive until manual activation, with reversible activation", async t => {
  const store = await fixture(t);
  let document = await store.read();
  const originalActive = document.active;
  document = await store.change(
    document.revision,
    { type: "patch", colors: { accent: "#123456" }, ui: { radius: 24, fontFamily: "mono", toolCards: "bordered" } },
    "agent",
  );
  assert.deepEqual(document.active, originalActive);
  document = await store.change(document.revision, { type: "save", name: "Agent pack" }, "agent");
  assert.deepEqual(document.active, originalActive);
  for (const type of ["activate", "revert-active", "disable-pack"])
    await assert.rejects(store.change(document.revision, { type }, "agent"), /Only the user/);
  const draftRevision = document.revision;
  document = await store.change(draftRevision, { type: "activate" });
  assert.deepEqual(document.active, document.current);
  assert.deepEqual(document.previousActive, originalActive);
  await assert.rejects(store.change(draftRevision, { type: "disable-pack" }), RevisionConflict);
  const newActive = document.active;
  document = await store.change(document.revision, { type: "patch-ui", ui: { radius: 3, density: "spacious" } });
  assert.deepEqual(document.active, newActive);
  document = await store.change(document.revision, { type: "undo" });
  assert.deepEqual(document.active, newActive);
  document = await store.change(document.revision, { type: "revert-active" });
  assert.deepEqual(document.active, originalActive);
  assert.deepEqual(document.previousActive, newActive);
  document = await store.change(document.revision, { type: "disable-pack" });
  assert.equal(document.active, null);
  document = await store.change(document.revision, { type: "disable-pack" });
  assert.deepEqual(document.previousActive, originalActive);
  document = await store.change(document.revision, { type: "revert-active" });
  assert.deepEqual(document.active, originalActive);
  assert.deepEqual((await new StudioStore(store.directory).read()).active, originalActive);
});

test("invalid UI or executable panel data fails before any storage mutation", async t => {
  const store = await fixture(t);
  const document = await store.read();
  const original = await readFile(store.file, "utf8");
  const invalidUi = [
    { radius: 25 },
    { fontFamily: "javascript" },
    { fontSize: 10 },
    { panel: { enabled: true, title: "Bad", icon: "BookOpen", blocks: [{ type: "script", code: "alert(1)" }] } },
    {
      panel: {
        enabled: true,
        title: "Bad",
        icon: "BookOpen",
        blocks: [{ type: "progress", label: "Bad", value: 101 }],
      },
    },
    {
      panel: {
        enabled: true,
        title: "Bad",
        icon: "BookOpen",
        blocks: [{ type: "text", text: "Safe", onClick: "exec()" }],
      },
    },
  ];
  for (const ui of invalidUi)
    await assert.rejects(async () => store.change(document.revision, { type: "patch-ui", ui }, "agent"));
  assert.equal(await readFile(store.file, "utf8"), original);
  const locked = await store.change(document.revision, { type: "lock", key: "accent", locked: true });
  await assert.rejects(
    store.change(locked.revision, { type: "lock", key: "accent", locked: false }, "agent"),
    /Only the user can unlock/,
  );
});

test("favorites persist without changing the draft, active pack, history, or saved snapshots", async t => {
  const store = await fixture(t);
  let document = await store.read();
  document = await store.change(document.revision, { type: "save", name: "Favorite pack" });
  const savedId = document.saved[0].id;
  const before = document;
  document = await store.change(document.revision, { type: "favorite", id: savedId }, "agent");
  document = await store.change(document.revision, { type: "favorite", id: savedId });
  assert.deepEqual(document.favorites, [savedId]);
  assert.equal(document.revision, before.revision + 2);
  assert.deepEqual(document.current, before.current);
  assert.deepEqual(document.active, before.active);
  assert.deepEqual(document.saved, before.saved);
  assert.deepEqual(document.history, before.history);
  assert.deepEqual((await new StudioStore(store.directory).read()).favorites, [savedId]);
  document = await store.change(document.revision, { type: "unfavorite", id: savedId });
  assert.deepEqual((await new StudioStore(store.directory).read()).favorites, []);
  assert.deepEqual(document.saved, before.saved);
});

test("favorite saved packs load into the draft for manual and agent callers while preserving color locks", async t => {
  const store = await fixture(t);
  let document = await store.read();
  document = await store.change(document.revision, {
    type: "patch",
    colors: { accent: "#123456", foreground: "#FEDCBA" },
    ui: { density: "compact", radius: 24 },
  });
  document = await store.change(document.revision, { type: "save", name: "Loadable favorite" });
  const saved = document.saved[0];
  document = await store.change(document.revision, { type: "favorite", id: saved.id });
  const active = document.active;
  for (const source of ["manual", "agent"] as const) {
    document = await store.change(document.revision, {
      type: "patch",
      colors: { accent: "#ABCDEF", foreground: "#000000" },
      ui: { density: "spacious", radius: 3 },
    });
    document = await store.change(document.revision, { type: "lock", key: "accent", locked: true });
    document = await store.change(document.revision, { type: "load", id: saved.id }, source);
    assert.equal(document.current.colors.accent, "#ABCDEF");
    assert.equal(document.current.colors.foreground, saved.colors.foreground);
    assert.deepEqual(document.current.ui, saved.ui);
    assert.deepEqual(document.active, active);
    assert.deepEqual(document.saved[0], saved);
    assert.deepEqual(document.favorites, [saved.id]);
    assert.equal(document.history[document.cursor].source, source);
    document = await store.change(document.revision, { type: "lock", key: "accent", locked: false });
  }
});

test("favorites respect revision conflicts, reject unknown IDs, and prune deleted saved packs atomically", async t => {
  const store = await fixture(t);
  let document = await store.read();
  document = await store.change(document.revision, { type: "save", name: "Delete favorite" });
  const id = document.saved[0].id;
  const originalFile = await readFile(store.file, "utf8");
  for (const type of ["favorite", "unfavorite"])
    await assert.rejects(store.change(document.revision, { type, id: "missing" }), /Saved theme was not found/);
  assert.equal(await readFile(store.file, "utf8"), originalFile);
  const oldRevision = document.revision;
  document = await store.change(document.revision, { type: "favorite", id });
  await assert.rejects(store.change(oldRevision, { type: "unfavorite", id }, "agent"), RevisionConflict);
  document = await store.change(document.revision, { type: "delete", id });
  assert.deepEqual(document.favorites, []);
  assert.deepEqual(document.saved, []);
  const restored = await new StudioStore(store.directory).read();
  assert.deepEqual(restored.favorites, []);
  assert.deepEqual(restored.saved, []);
  await assert.rejects(store.change(document.revision, { type: "favorite", id }), /Saved theme was not found/);
});

test("existing pack documents default favorites to empty without changing palette, revision, or designer linkage", async t => {
  const store = await fixture(t);
  const document = {
    ...(await store.read()),
    revision: 45,
    designerAgentId: "existing-designer",
    designerWorkspaceId: "existing-workspace",
  };
  const legacy = { ...document } as Partial<typeof document>;
  delete legacy.favorites;
  await writeFile(store.file, JSON.stringify(legacy));
  const restored = await new StudioStore(store.directory).read();
  assert.deepEqual(restored, { ...legacy, favorites: [] });
  assert.equal(restored.revision, document.revision);
  assert.deepEqual(JSON.parse(await readFile(store.file, "utf8")).favorites, []);
});

test("every preset is a valid pack with a unique id, and community palettes carry a credit", async () => {
  const { themeSchema } = await import("../shared/theme");
  const { presetCredits } = await import("../shared/presets");
  const { communityPresets } = await import("../shared/community-presets");
  assert.equal(new Set(presets.map(theme => theme.id)).size, presets.length);
  for (const theme of presets) themeSchema.parse(theme);
  assert.ok(communityPresets.length > 40);
  for (const preset of communityPresets) {
    assert.match(preset.id, /^t3-/);
    assert.equal(presetCredits[preset.id].author, preset.author);
    assert.ok(preset.author.length > 0);
  }
});
