import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { studioPreferencesPatchSchema } from "../shared/preferences";
import { PreferencesStore } from "./preferences";

test("preferences default to a closed designer, persist changes, and survive corrupt files", async t => {
  const directory = await mkdtemp(join(tmpdir(), "theme-preferences-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new PreferencesStore(directory);
  assert.deepEqual(await store.read(), { designerOpen: false, onboardingDone: false, sparkLive: true });
  assert.deepEqual(await store.change({ designerOpen: true, designerModel: "opus" }), {
    designerOpen: true,
    designerModel: "opus",
    onboardingDone: false,
    sparkLive: true,
  });
  assert.equal((await new PreferencesStore(directory).read()).designerModel, "opus");
  await writeFile(store.file, "{not json");
  assert.deepEqual(await store.read(), { designerOpen: false, onboardingDone: false, sparkLive: true });
});

test("a preference patch only changes the fields it names", async t => {
  const directory = await mkdtemp(join(tmpdir(), "theme-preferences-patch-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new PreferencesStore(directory);
  await store.change(studioPreferencesPatchSchema.parse({ onboardingDone: true }));
  const next = await store.change(studioPreferencesPatchSchema.parse({ designerOpen: true }));
  assert.equal(next.onboardingDone, true);
  assert.equal(next.designerOpen, true);
});
