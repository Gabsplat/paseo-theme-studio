import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findModules, typecheckDirectory } from "./typecheck";

test("an npm installation finds shared modules and explains the missing type toolchain", async t => {
  const root = await mkdtemp(join(tmpdir(), "theme-studio-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Paseo installs the package beside its hoisted production dependencies.
  const plugin = join(root, "node_modules/paseo-theme-studio");
  await mkdir(plugin, { recursive: true });
  await mkdir(join(root, "node_modules/typescript"), { recursive: true });
  await writeFile(join(root, "node_modules/typescript/package.json"), "{}");
  assert.equal(await findModules(plugin), join(root, "node_modules"));
  await assert.rejects(typecheckDirectory(join(root, "candidate"), plugin, "Failed."), /development dependencies/);
});

test("a directory without TypeScript reports how to install it", async t => {
  const root = await mkdtemp(join(tmpdir(), "theme-studio-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(findModules(root), /development dependencies/);
});
