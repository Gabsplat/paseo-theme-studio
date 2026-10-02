# Paseo Theme Studio

Theme Studio 0.5.0 is a trusted local Paseo plugin for designing UI packs and reusable native components with a real agent chat. A pack combines an appearance palette, styles for plugin components, tool cards, and workspace panels. The component library stores compositions and generated React Native code that can appear in agent timelines. It uses public plugin APIs and requires no Paseo core changes.

## Install

Requires Node.js on the daemon host, plugins enabled, and Paseo `>=0.9.2 <0.11.0`. Client API compatibility has been checked against the macOS client at 0.10.2. Browser and daemon integration have been verified on 0.9.2.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
paseo plugin install /absolute/path/to/theme-creator
```

Open **Theme Studio** in the sidebar. Choose **Theme Studio · Live** in **Settings → Appearance** once to use the active pack's palette across Paseo.

## Design and activate a pack

The preview shows your draft. Manual edits and agent tools change that draft without changing the active pack. Saving a named library copy also leaves the active pack unchanged.

1. Open **Colors** to edit the eight appearance colors, change light/dark appearance, or protect colors with locks.
2. Open **Design** to choose density, corner radius, typography, tool-card style, pack-note style, and workspace panels.
3. Review the preview and the changes listed for activation.
4. Press **Activate pack** to copy the draft into the active pack. Its registered extensions update, and its global palette updates when **Theme Studio · Live** is selected.

**Revert pack** restores the previous active pack. **Disable pack** turns off its extensions; **Revert pack** can restore the pack after disabling it. Draft undo and redo navigate draft edits, independently of the active pack.

Presets, named library copies, and JSON import/export retain the pack's palette and UI settings. Presets and imported or loaded packs preserve locked color values. Manual and agent patches cannot change locked colors, and undo/redo refuses a change that would alter one. Revision checks prevent concurrent manual and agent edits from silently overwriting each other.

## Save, favorite, and reuse packs

**Save pack** stores a named copy of the full draft, including its palette and UI settings. In **Presets → Your library**, star a saved pack to mark it as a favorite. **Favorites only** filters the library to those packs. Unstarring changes the favorite list without changing the draft or active pack.

Loading a saved pack reuses it as a draft and preserves locked colors. Review it, make any changes, and press **Activate pack** when ready. Loading or favoriting a pack does not activate it. Removing a saved pack also removes its favorite flag.

## Work with the designer

**Start designer** creates an initially idle agent and opens its real Paseo chat with Theme Studio in the Explorer panel. Drag Paseo's panel divider to enlarge the preview. `/theme` opens the studio panel beside an existing agent.

The default designer uses Codex `gpt-6.1-sol` with high reasoning. Choose a provider and model through **Model** before creating a session; existing sessions retain their configuration. Creating a designer sends no prompt. Sending a native chat message uses the provider configured in Paseo.

For example, ask: "Make a compact pack with mono text, bordered tool cards, and a Notes panel containing a short checklist and a progress bar." The designer edits the same draft as the manual controls. You review the result and activate it yourself.

For reusable UI, ask: "Create a native decision card with a select, a notes input, and a Confirm button. Publish it here, then handle my confirmation and return the result to the card." The designer can create a composition immediately or generate React Native code for you to build and activate. It can favorite saved packs and reusable components, and load a saved pack into the draft.

The pack tools include `read_theme`, `read_capabilities`, `patch_pack`, `save_pack`, `create_variant`, `load_preset`, `check_contrast`, `undo`, `redo`, and `lock_color`. The compatible `patch_theme` tool also accepts UI patches. Library tools include `list_saved_packs`, `favorite_pack`, and `load_saved_pack`. Agents can add locks but cannot remove them. Neither packs nor generated-code builds have an agent activation tool.

After upgrading, reload an idle existing designer to refresh its MCP tools while preserving its native conversation:

```sh
paseo agent reload <designer-agent-id>
```

This public CLI operation restarts the underlying provider session without submitting a model prompt or deleting chat history. `read_theme` and `read_capabilities` provide the current pack scope and instructions; the existing agent's saved provider configuration and tool permissions remain in place.

MCP initialization advertises the current designer instructions, including interactive native chat components. Designers must call `read_theme` before answering capability questions so earlier conversation descriptions do not override the current supported scope.

Existing designers can also use component operations through `patch_theme` with a `component: { tool, arguments }` payload. This preserves their previously approved MCP route. The outer revision refers to the studio document; nested arguments use the component library or instance revision. Component activation remains a manual UI action. General agents connected through the installer opt-in do not have `create_code_component` or `build_components` preapproved, and the `patch_theme` route refuses them for anyone except the designer, so generated code always passes through Paseo's normal permission prompt.

## Component library

Open **Theme Studio → Components**. The library lives inside the same studio UI, including its workspace panel and settings screen. The library shows the latest version of each component, with search, favorites, source inspection, and version history. Agent-created components appear automatically. **New version** saves a separate definition; existing instances keep their original version. Component favorites are separate from saved pack favorites.

There are two creation paths:

- **New composition** stores a validated native tree. Its nodes include text, stacks, rows, stats, lists, progress, buttons, inputs, selects, and toggles. It is available for preview and publication as soon as it is saved.
- **New code component** stores a React Native TSX source file. Saving validates its imports and types. **Build components** compiles and typechecks a versioned registry; **Activate components** explicitly loads the reviewed build and reloads Theme Studio. This rebuilds the plugin, not Paseo core.

Generated source and immutable definitions persist in the component library. Activation writes the versioned sources under `client/generated/` and their static imports in `client/generated-components.tsx`. Historical versions remain registered so earlier published rows can keep rendering their original components. Generated code is compiled, not evaluated from a runtime string.

Generated components are trusted code running inside the plugin. Native import checks and typechecking are compatibility checks, not a security sandbox. Review source in **Preview & source → Source** before activating a build.

The generated-code contract is a default React Native component receiving `{ theme, state, onAction }`. Import its type from `../../shared/components`; the build stores the source in `client/generated/`. Use host colors and native controls:

```tsx
import { Pressable, Text, View } from "react-native";
import type { ComponentProps } from "../../shared/components";

export default function Confirmation({ theme, state, onAction }: ComponentProps) {
  return <View style={{ padding: 12, gap: 8, backgroundColor: theme.colors.surface1 }}>
    <Text style={{ color: theme.colors.foreground }}>
      {state.confirmed === true ? "Confirmed" : "Ready for your decision"}
    </Text>
    <Pressable accessibilityRole="button"
      onPress={() => onAction({ action: "confirm", patch: { confirmed: true } })}>
      <Text style={{ color: theme.colors.accent }}>Confirm</Text>
    </Pressable>
  </View>;
}
```

**Preview & source** runs interactions against local preview state only. It does not contact an agent. **Use in agent** publishes a new instance to an actual native chat, with optional initial state. Leave the target agent blank to use the designer session, or specify an existing owner agent. Publishing opens its chat when client navigation is available.

## Agent-managed component interactions

The installer controls agent connections in **Theme Studio → Components → Connect your agents**. The connection is off by default. **Connect new agents** adds the MCP, component instructions, and its tool permissions to subsequently created Codex, Claude Code, and OpenCode interactive agents on this host. Providers without verified MCP support are preserved. It preserves their task instructions, provider, model, environment, other MCP servers, and other tool permissions. Internal agents and explicit conflicting `theme-studio` servers are preserved. Disconnecting stops future injection; already created agents retain their configuration. The dedicated designer continues to include its own MCP independently.

Paseo 0.9.2 does not expose a public per-agent MCP update for existing conversations. **Set up an existing agent** provides provider-specific copyable configuration for Codex, Claude Code, and OpenCode. The installer must add it to their provider configuration and reload an idle conversation. The plugin does not change provider configuration or reload existing agents automatically. Copying a configuration does not confirm a connection.

New general-agent and designer MCP arguments contain a private owner-binding file. For general agents, the public session-open hook records the real agent ID before its first provider launch. The designer binds its reserved native ID during creation. The binding survives later reloads without depending on inherited MCP environment variables. If no verified owner is available, MCP publication requires an explicit target ID. It never silently falls back to another conversation.

Each MCP request also identifies the calling agent. Through MCP, an agent can publish, trigger, or update components only in its own conversation; the designer session can also target other conversations on the user's behalf. A bridge without a verified caller, such as one started before an upgrade, is refused until the agent is reloaded.

Component state and events persist on the daemon. A component emits `onAction({ action, value, patch })`; the backend records the event and routes it to that instance's owning native agent. Action names are data. The backend has no domain mapping from an action name to a shell command, API call, or business operation.

1. Input changes use `onAction({ action: "__state__", patch: { field: value } })` to persist state without sending a model prompt.
2. An explicit interaction, such as confirmation or submission, records an event. It is sent through the owner's native conversation when the agent is available, or queued while the agent is busy or awaiting permissions.
3. The owning agent reads the current instance and definition, decides what the chosen option means for its task, and calls `update_component_state` with progress and the complete next state. Technical transport messages are hidden from the native chat only when their native message ID and full immutable payload match a uniquely owned persisted event. Canonical agent context stays intact. Normal user messages and pasted event text keep their normal rendering.
4. The native row displays the updated state. An agent state update creates no event and starts no additional turn, so it does not create an automatic interaction loop.

The component MCP tools are `list_components`, `list_component_triggers`, `trigger_component`, `create_composition`, `create_code_component`, `build_components`, `publish_component`, `read_component_instance`, `update_component_state`, and `favorite_component`. Compositions can be published immediately. Generated code must first be manually activated in Components.

Each component version can store up to ten trigger rules. Add them in **Component triggers** when creating a component or a new version, or have the agent include `triggers` in `create_composition` / `create_code_component`. A rule belongs to that component; the plugin does not supply a default decision card. For example:

```json
[{"id":"review-results","event":"turn_completed","when":"Before returning a comparison of database options, show the comparison review panel.","enabled":true}]
```

`event` sets when the owning agent checks the natural-language `when` condition:

| Event | Check moment |
| --- | --- |
| `agent_context` | While reasoning, when relevant task context is available |
| `turn_started` | Before starting task work |
| `tool_failed` | After a tool fails |
| `turn_completed` | Before the final answer, while the turn is still active |

Connected agents receive discovery instructions and an MCP initialization catalog. They call `list_component_triggers` at the start of a request and match individual conditions during their current turn. The user does not need to mention the plugin or component. These are agent-observed moments, not a background semantic classifier or an external event scheduler; matching depends on the agent following its instructions. Generated code is listed with activation readiness and skipped until manually activated.

`trigger_component` verifies the enabled rule on the specified immutable version and the owner's actual active turn. Repeated publication of the same owner/version/rule/turn/start-time/occurrence reuses its persisted instance and native row. An optional `occurrenceKey` distinguishes real repeated events, such as separate failing commands. The public active-turn start time separates distinct turns even if a provider reuses its turn ID after a session reload. Trigger publication starts no model turn. Component interaction callbacks update their existing instance and do not retrigger their own card. Another component can appear if its specific rule matches the next stage of the workflow.

**Automatic component triggers** is an independent installer setting in **Connect your agents**. It defaults on for connected agents; MCP connections still default off. Turning automatic triggers off rejects automatic publication while keeping manual `publish_component` available. Empty rules mean manual placement. Creating a new version without a `triggers` argument inherits the previous version's rules; explicit `[]` clears them on the new version. Existing instances keep their original version and rules.

The current library allows 200 immutable definitions and 500 persisted instances per host. Trigger reuse does not consume another instance. Instances are not automatically pruned, so separate turns and occurrences count toward that limit.

Revision scopes are separate. Read the corresponding resource before a mutation, and reread after a conflict to preserve later user input:

| Read tool | Revision scope | Mutations |
| --- | --- | --- |
| `read_theme` or `list_saved_packs` | Studio | Draft edits, saved pack favorites, loading packs |
| `list_components` | Library | Definitions, component favorites, builds, publication |
| `read_component_instance` | Instance | Component state updates |

## What a pack controls

The global palette exposes `background`, `foreground`, `raised`, `control`, `border`, `accent`, `mutedForeground`, and `ring`. Paseo derives its surfaces and text-on-accent colors. Contrast checks include that derived accent-button text.

Density, corner radius, font family, and font size apply to pack-owned components. Fonts are system, mono, or serif. Pack-note style affects notes inside the pack's panels and preview. These settings do not rewrite native chat messages or the application's global layout.

Tool-card styles affect supported completed shell and plain-text tool rows. The renderer preserves command and output text. Running, failed, canceled, permission-sensitive, unsupported, and oversized rows retain Paseo's native rendering and actions.

The activity panel reads native workspace status and diff counts. A custom workspace panel uses a title, an allowed icon, and strictly validated blocks:

- `text` for a note.
- `stat` for a label and value.
- `list` for a title and text items.
- `progress` for a label and a value between 0 and 100.

The pack panel builder stores declarative data. It accepts no scripts, HTML, CSS, or custom event handlers. Interactive compositions and generated React Native components use the separate Components library. Packs and components do not modify Paseo core files. Native animations, semantic status colors, syntax highlighting, terminal ANSI colors, and global layout remain controlled by Paseo.

The preview uses representative content and the public theme mappings from Paseo 0.9.2. Platform fonts, window sizes, and later Paseo versions can change its visual match.

## Export an independent plugin

Open **Export** and choose **Export plugin** to generate an independent plugin from the current draft. The exporter writes the palette, validated pack data, fixed React Native renderers, manifest, and supporting files, then runs TypeScript typechecking. The result displays the output directory and a command such as:

```sh
paseo plugin install '/absolute/path/to/exported-pack'
```

Export does not install or activate the generated plugin. Run the displayed command when you are ready, then choose the exported pack's own theme in **Settings → Appearance**. Its workspace panels and tool-card extensions run independently of Theme Studio.

Exports contain no designer conversation, credentials, bridge token, or mutable Theme Studio state. Generated sources remain available if typechecking fails, and no install command is presented as a successful export.

Pack export is separate from activating generated components in Theme Studio. The standalone pack contains its palette and pack UI; it does not bundle the component library or its published instances.

## Development and verification

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

## Attribution

The preview adapts Paseo's public visual structure and theme mappings at tag `v0.9.2`. See `NOTICE` and the Apache 2.0 license. The design concept is in `design/paseo-theme-studio-concept.png`.
