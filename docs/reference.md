# Theme Studio reference

Detailed behavior of packs, the designer, components, triggers, and exports. Start with the [README](../README.md) for an overview.

## Design and activate a pack

The studio keeps a live, interactive replica of Paseo in the center: its sidebar, workspace header, tabs, chat with tool rows, terminal, changes, and composer, painted with your draft. Its own tabs switch between the agent chat, terminal, and changes; a pack panel appears in the replica's right explorer, as in Paseo. The inspector on the right changes what you edit, so the preview stays visible. Beside a chat or on narrow screens, the inspector moves below the preview.

Manual edits and agent tools change the draft without changing the active pack. Saving a named library copy also leaves the active pack unchanged.

1. In **Colors**, edit the eight appearance colors or protect colors with locks. The sun/moon button switches light and dark.
2. In **Design**, choose density, corner radius, typography, tool-card style, pack-note style, and workspace panels.
3. Review the preview. The status next to the pack name shows whether the draft is active.
4. Press **Activate** to copy the draft into the active pack. Its registered extensions update, and its global palette updates when **Theme Studio · Live** is selected.

In **Packs**, **Revert** restores the previous active pack and **Disable** turns off its extensions; **Revert** can restore the pack after disabling it. **Packs** also holds presets, your saved library, and JSON import and export. Draft undo and redo navigate draft edits, independently of the active pack.

Presets, named library copies, and JSON import/export retain the pack's palette and UI settings. Presets and imported or loaded packs preserve locked color values. Manual and agent patches cannot change locked colors, and undo/redo refuses a change that would alter one. Revision checks prevent concurrent manual and agent edits from silently overwriting each other.

## Save, favorite, and reuse packs

**Save pack** stores a named copy of the full draft, including its palette and UI settings. In **Packs → Your library**, star a saved pack to mark it as a favorite. **Favorites only** filters the library to those packs. Unstarring changes the favorite list without changing the draft or active pack.

Loading a saved pack reuses it as a draft and preserves locked colors. Review it, make any changes, and press **Activate** when ready. Loading or favoriting a pack does not activate it. Removing a saved pack also removes its favorite flag.

## On phones

On Paseo mobile, and in narrow windows, Theme Studio opens on a home screen: the pack with its colors, contrast, and Activate, a phone preview, and a list of sections (Colors, Design, Components, Packs, Designer, History). Each section opens full screen with a short preview window at the top, which you can hide. The preview replicates Paseo mobile. On desktop, **Desktop / Mobile** under the preview switches between both replicas.

## First run and help

The first time Theme Studio opens on a host, a short visual tour explains the workspace, the draft and activation flow, the designer and its MCP tools, components, and good prompts. Skip it or finish it once and it stays closed; the **?** button in the top bar reopens it any time. **History** next to it shows draft history in the inspector.

## Work with the designer

**Designer** (or **Start designer** the first time) creates an initially idle agent and opens its real Paseo chat with Theme Studio in the Explorer panel. Drag Paseo's panel divider to enlarge the preview. `/theme` opens the studio panel beside an existing agent.

Theme Studio remembers whether you left the designer open. On desktop, the first time you open Theme Studio in an app session it returns to the designer chat with the studio beside it; later visits stay in the studio. Phones never redirect, because the chat fills the screen. **Close designer** in the studio panel, or **Studio** in the designer chat's header, goes back to the full studio and keeps it there next time. The preference is stored in `preferences.json`, separately from your packs.

The **Designer** inspector tab shows the current session's provider, model, reasoning level, and status. A session keeps its model for its whole life. To use another one, choose a provider (Codex, Claude Code, or OpenCode) and optionally a model, then press **Start new session**: Theme Studio creates a new designer in the same workspace and opens it, and the previous chat stays there. Your choice is saved in `preferences.json` for the next session. Without a choice, the designer uses Codex `gpt-6.1-sol` with high reasoning. Creating a designer sends no prompt.

The same tab lists example prompts you can copy and holds **Connect your agents**, which gives other new agents the Theme Studio tools.

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

In the studio's **Components** inspector, select a component to see it inside the preview conversation, rendered with your draft's colors exactly as it would appear in a real chat. Interactions there stay local. From the inspector you can favorite, reset, or delete it.

**Library** opens the full component view, which replaces the preview until **Back to studio**. It shows the latest version of each component, with search, favorites, source inspection, and version history. Agent-created components appear automatically. **New version** saves a separate definition; existing instances keep their original version. Component favorites are separate from saved pack favorites.

**Delete** asks for confirmation, then removes every version of the component, its favorite flag, and its published instances; their chat rows say the component was deleted. Deletion is a manual UI action; agents have no delete tool.

There are two creation paths:

- **New composition** stores a validated native tree. Its nodes include text, stacks, rows, stats, lists, progress, buttons, inputs, selects, and toggles. It is available for preview and publication as soon as it is saved.
- **New code component** stores a React Native TSX source file. Saving validates its imports and types. **Build components** typechecks a versioned registry, which needs a development installation (see the README's limitations); **Activate components** explicitly loads the reviewed build and reloads Theme Studio. This rebuilds the plugin, not Paseo core.

Generated source and immutable definitions persist in the component library. Activation writes the versioned sources under `client/generated/` and their static imports in `client/generated-components.tsx`. Paseo bundles the plugin from its install directory, so that directory must be writable. The repository ships an empty registry, and each installation fills its own. Historical versions remain registered so earlier published rows can keep rendering their original components. Generated code is compiled, not evaluated from a runtime string.

Generated components are trusted code running inside the plugin. Native import checks and typechecking are compatibility checks, not a security sandbox. **Activate components** first shows the full source of every version that the build would newly activate; activation proceeds only after you confirm **I reviewed this code · Activate**, and the server refuses builds whose new versions were not reviewed. The checks also reject `react-native` escape hatches such as `NativeModules` and `Linking`, namespace imports, and `constructor`/`Reflect` access, but they remain a filter, not a sandbox.

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
