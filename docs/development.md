# Development and verification

How to work on Theme Studio and run its end-to-end checks. The QA scripts assume the maintainer's machine layout; adjust the paths for yours.

```sh
pnpm install --frozen-lockfile
```

```sh
pnpm typecheck
pnpm test
paseo plugin reload theme-studio
paseo plugin logs theme-studio
```

`typecheck` invokes `node scripts/build-export-assets.mjs` directly, then TypeScript. It refreshes the fixed renderer assets used by the exporter without running a nested package-manager script. `index.client.tsx` registers native contributions, component timeline renderers, and the live appearance theme; `index.server.ts` registers RPC handlers. `client/` contains React Native UI and activated generated source, `server/` contains persistence, MCP, and build/export code, and `shared/` contains validated contracts.

State lives at `$PASEO_HOME/theme-studio`, defaulting to `~/.paseo/theme-studio`. `studio.json` stores packs and their favorite IDs; `components.json` stores versioned definitions, source, instances, events, favorites, and build metadata. Persistence uses private files, atomic writes, and revision checks. Existing palette-only documents migrate with their current palette preserved as the active pack. The MCP bridge uses authenticated loopback requests and reconnects after plugin reload.

`scripts/qa-components.mjs` exercises favorites, both component modes, and real model interactions in an isolated Labs daemon. Prepare this setup before running it:

1. Copy the plugin project to `/home/gabsplat/Labs/theme-studio-components-qa/plugin`.
2. Install its dependencies and run `typecheck` in that copy. This regenerates export metadata with the copied project directory, which the generated-component service uses for source writes.
3. Prepare a separate daemon on port `7789`, with home `/home/gabsplat/Labs/theme-studio-components-qa/home` and plugins enabled. Install the copied plugin there.

```sh
pnpm --dir /home/gabsplat/Labs/theme-studio-components-qa/plugin install --frozen-lockfile
pnpm --dir /home/gabsplat/Labs/theme-studio-components-qa/plugin typecheck
paseo --host 127.0.0.1:7789 plugin install /home/gabsplat/Labs/theme-studio-components-qa/plugin
```

Run the script only after that daemon and copied plugin are ready:

```sh
PASEO_QA_ORIGIN=http://127.0.0.1:7789 \
PASEO_QA_HOME=/home/gabsplat/Labs/theme-studio-components-qa/home \
PASEO_QA_CHROMIUM=/absolute/path/to/chromium \
pnpm exec node scripts/qa-components.mjs
```

`PASEO_QA_CHROMIUM` is optional when Playwright's Chromium browser is installed.

`scripts/qa-component-triggers.mjs` uses the same isolated component QA setup. It saves two component-specific rules through the native UI, creates a normal general agent after installer opt-in, and submits a business task that never mentions the plugin or UI. It checks automatic discovery, matching-only publication, real owner/turn provenance, browser persistence, and the installer off switch without changing the main daemon. Evidence is saved in `output/component-triggers-qa.json` and its native-chat screenshot.

The script refuses a different origin or home. It sends real requests through an isolated Codex designer, checks saved pack favorites, creates a composition and generated counter, builds and manually activates code through the UI, publishes native rows, and verifies that explicit clicks reach the agent and return persisted state. Input-only updates must not send a model prompt. It checks that the active pack, palette, main daemon state, and working project's generated registry remain unchanged. Activation writes only into the copied plugin. Evidence is saved under `output/`, including `components-qa.json` and native-chat screenshots. This check uses the configured model.

The earlier `scripts/qa-packs.mjs` checks draft editing, pack activation, exports, and compact layout. Its separate setup uses port `7789` with home `/tmp/theme-studio-pack-qa` and a workspace named **Pack QA workspace**; do not mix that home with the component QA setup:

```sh
mkdir -p output
PASEO_QA_ORIGIN=http://127.0.0.1:7789 \
PASEO_QA_HOME=/tmp/theme-studio-pack-qa \
PASEO_QA_CHROMIUM=/absolute/path/to/chromium \
pnpm exec node scripts/qa-packs.mjs
```

The script edits the isolated draft, checks explicit activation and global palette updates, builds a native panel, exports a typechecked plugin, and verifies rollback, disable/restore, and compact layout. It writes screenshots and export metadata under `output/`. The origin and home must refer to the same isolated daemon.

`pnpm exec node scripts/qa-pack-agent.mjs` starts a fresh native designer in the earlier pack QA daemon and sends one real model prompt. It verifies that `read_theme` and the compatible `patch_theme` edit radius and all four panel block types, while the active pack, palette, and main instance remain unchanged. This check uses your configured model and requires a fresh isolated designer session.
