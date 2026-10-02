import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolvePaseoCli } from "./paseo-cli";

test("the Paseo CLI resolves from PASEO_BIN before PATH", async t => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const explicit = join(directory, "custom-paseo");
  await writeFile(explicit, "#!/bin/sh\n");
  await chmod(explicit, 0o755);
  assert.equal(resolvePaseoCli({ PASEO_BIN: explicit, PATH: "" }), explicit);
  const onPath = join(directory, "paseo");
  await writeFile(onPath, "#!/bin/sh\n");
  await chmod(onPath, 0o755);
  assert.equal(resolvePaseoCli({ PATH: directory }), onPath);
});
