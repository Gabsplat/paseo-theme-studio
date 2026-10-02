import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { build } from "esbuild";

const root = join(import.meta.dirname, "..");
const hermesc = join(root, "node_modules/react-native/sdks/hermesc/linux64-bin/hermesc");

// Paseo mobile evaluates plugin client bundles with Hermes. Mirror Paseo 0.9.2's client
// build, then compile it with Hermes so unsupported syntax (such as classes) fails here.
test(
  "the client bundle compiles with Hermes",
  { skip: process.platform !== "linux" || !existsSync(hermesc) },
  async t => {
    const result = await build({
      entryPoints: [join(root, "index.client.tsx")],
      bundle: true,
      format: "cjs",
      jsx: "automatic",
      platform: "neutral",
      target: "es2020",
      supported: { "async-await": false },
      external: [
        "@getpaseo/plugin",
        "@getpaseo/plugin/*",
        "@tanstack/react-query",
        "react",
        "react/jsx-runtime",
        "react-native",
        "zod",
      ],
      write: false,
      logLevel: "silent",
    });
    const directory = await mkdtemp(join(tmpdir(), "theme-studio-hermes-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "client.js");
    await writeFile(
      source,
      `var plugin = (function (require) {\nvar module = { exports: {} };\nvar exports = module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;\n});\n`,
    );
    const { stderr } = await promisify(execFile)(hermesc, [
      "-emit-binary",
      "-out",
      join(directory, "client.hbc"),
      source,
    ]).catch(error => error as { stderr: string });
    assert.equal(stderr.trim(), "", "Hermes rejected the client bundle");
  },
);
