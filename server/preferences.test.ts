import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PreferencesStore } from "./preferences";

test("preferences default to a closed designer, persist changes, and survive corrupt files", async t => {
  const directory = await mkdtemp(join(tmpdir(), "theme-preferences-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new PreferencesStore(directory);
  assert.deepEqual(await store.read(), { designerOpen: false });
  assert.deepEqual(await store.change({ designerOpen: true }), { designerOpen: true });
  assert.deepEqual(await new PreferencesStore(directory).read(), { designerOpen: true });
  await writeFile(store.file, "{not json");
  assert.deepEqual(await store.read(), { designerOpen: false });
});
