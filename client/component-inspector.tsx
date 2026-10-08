import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { deleteComponent, favoriteComponent, publishComponent, readComponentLibrary } from "../shared/component-rpc";
import type { ComponentDefinition, ComponentLibrary } from "../shared/components";
import { ComponentCard } from "./component-runtime";
import { ErrorBoundary } from "./error-boundary";
import { Eyebrow, StudioButton, StudioLabel } from "./studio-ui";

export const componentLibraryQueryKey = ["theme-studio-component-library"] as const;
export const definitionKey = (definition: ComponentDefinition) => `${definition.id}@${definition.version}`;

const errorMessage = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** The live component library, shared by the inspector and the full library view. */
export function useComponentLibrary(enabled = true) {
  const read = useRpc(readComponentLibrary);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: componentLibraryQueryKey,
    enabled,
    queryFn: async () => {
      const library = await read({});
      const cached = queryClient.getQueryData<ComponentLibrary>(componentLibraryQueryKey);
      return cached && cached.revision > library.revision ? cached : library;
    },
    refetchInterval: 1500,
    retry: 1,
  });
  function accept(next: ComponentLibrary) {
    const cached = queryClient.getQueryData<ComponentLibrary>(componentLibraryQueryKey);
    if (!cached || next.revision >= cached.revision) queryClient.setQueryData(componentLibraryQueryKey, next);
  }
  return { query, library: query.data, accept };
}

/** Latest version of each component, favorites first, then newest. */
export function latestDefinitions(library: ComponentLibrary | undefined, search = "", favoritesOnly = false) {
  const latest = new Map<string, ComponentDefinition>();
  for (const definition of library?.definitions ?? [])
    if ((latest.get(definition.id)?.version ?? 0) < definition.version) latest.set(definition.id, definition);
  const needle = search.trim().toLowerCase();
  return [...latest.values()]
    .filter(
      definition =>
        (!favoritesOnly || library?.favorites.includes(definition.id)) &&
        (!needle || `${definition.name} ${definition.id}`.toLowerCase().includes(needle)),
    )
    .sort(
      (a, b) =>
        Number(library?.favorites.includes(b.id)) - Number(library?.favorites.includes(a.id)) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

function isReady(library: ComponentLibrary | undefined, definition: ComponentDefinition) {
  // Only custom components are usable; retired block compositions can be previewed and deleted.
  return definition.mode === "code" && Boolean(library?.activeKeys.includes(definitionKey(definition)));
}

/** Confirms and deletes every version of a component. */
export function DeleteComponentDialog({
  theme,
  definition,
  library,
  onClose,
  onDeleted,
}: {
  theme: PluginTheme;
  definition: ComponentDefinition | null;
  library: ComponentLibrary | undefined;
  onClose: () => void;
  onDeleted: (result: { library: ComponentLibrary; removedInstances: number }) => void;
}) {
  const remove = useRpc(deleteComponent);
  const deleting = useMutation({ mutationFn: remove, onSuccess: onDeleted });
  const versions = definition ? (library?.definitions.filter(item => item.id === definition.id).length ?? 0) : 0;
  const published = definition ? (library?.instanceCounts?.[definition.id] ?? 0) : 0;
  return (
    <Modal
      title="Delete component"
      icon={<Icon name="Trash2" size={18} color={theme.colors.statusDanger} />}
      open={definition !== null}
      onOpenChange={open => {
        if (!open && !deleting.isPending) {
          deleting.reset();
          onClose();
        }
      }}
    >
      <Modal.Content>
        {definition ? (
          <>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 20 }}>
              Delete <Text style={{ fontWeight: "600" }}>{definition.name}</Text>? This removes{" "}
              {versions === 1 ? "its only version" : `all ${versions} versions`}
              {published
                ? ` and ${published} published ${published === 1 ? "card" : "cards"}. Those chat rows will show that the component was deleted`
                : ""}
              .
            </Text>
            <StudioLabel theme={theme} subdued>
              This cannot be undone. Agents can no longer publish or trigger it.
            </StudioLabel>
            <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
              <StudioButton theme={theme} title="Cancel" disabled={deleting.isPending} onPress={onClose} />
              <StudioButton
                theme={theme}
                title={deleting.isPending ? "Deleting…" : "Delete component"}
                icon="Trash2"
                danger
                disabled={deleting.isPending || !library}
                onPress={() =>
                  library && deleting.mutate({ expectedRevision: library.revision, componentId: definition.id })
                }
              />
            </View>
            {deleting.error ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
                {errorMessage(deleting.error)}
              </Text>
            ) : null}
          </>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

/** A live, half-scale render of the component: what you get, not a name in a list. */
function ComponentThumbnail({ theme, definition }: { theme: PluginTheme; definition: ComponentDefinition }) {
  const c = theme.colors;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 104, overflow: "hidden", backgroundColor: c.surface0 }}
    >
      <View style={{ width: "200%", padding: 16, transform: [{ scale: 0.5 }], transformOrigin: "top left" }}>
        <ErrorBoundary
          fallback={() => (
            <View style={{ height: 160, alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Icon name="TriangleAlert" size={28} color={c.statusWarning} />
              <Text style={{ color: c.foregroundMuted, fontSize: 22 }}>This version does not render</Text>
            </View>
          )}
        >
          <ComponentCard theme={theme} definition={definition} state={{}} onAction={() => {}} />
        </ErrorBoundary>
      </View>
    </View>
  );
}

function ComponentTile({
  theme,
  definition,
  selected,
  favorite,
  ready,
  count,
  adding,
  onPress,
  onAdd,
}: {
  theme: PluginTheme;
  definition: ComponentDefinition;
  selected: boolean;
  favorite: boolean;
  ready: boolean;
  /** Cards of this component published in chats. */
  count: number;
  adding: boolean;
  onPress: () => void;
  onAdd: () => void;
}) {
  const c = theme.colors;
  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? c.accent : c.border,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Preview ${definition.name}`}
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <ComponentThumbnail theme={theme} definition={definition} />
      </Pressable>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 10,
          paddingRight: 6,
          paddingVertical: 6,
          borderTopWidth: 1,
          borderColor: c.border,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "500", flexShrink: 1 }}>
              {definition.name}
            </Text>
            {favorite ? <Icon name="Star" size={11} color={c.accent} /> : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              accessibilityLabel={ready ? "Ready" : "Needs activation"}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: ready ? c.statusSuccess : c.statusWarning,
              }}
            />
            <Eyebrow theme={theme}>
              {definition.mode === "composition" ? "Retired blocks" : "Custom"} · v{definition.version} ·{" "}
              {ready ? `${count} in chats` : definition.mode === "composition" ? "not usable" : "needs activation"}
            </Eyebrow>
          </View>
        </View>
        <StudioButton
          theme={theme}
          title={adding ? "Adding…" : `Add ${definition.name} to the designer chat`}
          icon="Plus"
          small
          iconOnly
          disabled={!ready || adding}
          onPress={onAdd}
        />
      </View>
    </View>
  );
}

/**
 * Sidebar view of the component library. Selecting a component shows it inside the
 * preview conversation, as it would appear in a real Paseo chat.
 */
export function ComponentInspector({
  theme,
  selectedId,
  onSelect,
  onOpenLibrary,
  onResetPreview,
}: {
  theme: PluginTheme;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenLibrary: () => void;
  onResetPreview: () => void;
}) {
  const { query, library, accept } = useComponentLibrary();
  const favorite = useRpc(favoriteComponent);
  const starring = useMutation({ mutationFn: favorite, onSuccess: accept });
  const publish = useRpc(publishComponent);
  const [added, setAdded] = useState<string | null>(null);
  const adding = useMutation({
    mutationFn: publish,
    onSuccess: (_, input) => {
      setAdded(input.componentId);
      void query.refetch();
    },
  });
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<ComponentDefinition | null>(null);
  const definitions = latestDefinitions(library, search);
  const selected = definitions.find(definition => definition.id === selectedId) ?? null;
  const c = theme.colors;
  return (
    <View style={{ gap: 12, paddingVertical: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Eyebrow theme={theme}>Cards for agent chats</Eyebrow>
          <StudioLabel theme={theme} subdued>
            Tap one to try it in the preview. Plus adds it to the designer chat.
          </StudioLabel>
        </View>
        <StudioButton theme={theme} title="Library" icon="LayoutGrid" small onPress={onOpenLibrary} />
      </View>
      <TextInput
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="Search components"
        placeholder="Search components…"
        placeholderTextColor={c.foregroundMuted}
        style={{
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          color: c.foreground,
          fontSize: 12,
          backgroundColor: c.surface0,
        }}
      />
      {!library ? (
        <StudioLabel theme={theme} subdued>
          {query.isPending ? "Loading components…" : "The component library is unavailable."}
        </StudioLabel>
      ) : definitions.length ? (
        <View style={{ gap: 10 }}>
          {definitions.map(definition => (
            <ComponentTile
              key={definition.id}
              theme={theme}
              definition={definition}
              selected={definition.id === selectedId}
              favorite={library.favorites.includes(definition.id)}
              ready={isReady(library, definition)}
              count={library.instanceCounts?.[definition.id] ?? 0}
              adding={adding.isPending && adding.variables?.componentId === definition.id}
              onPress={() => onSelect(definition.id === selectedId ? null : definition.id)}
              onAdd={() => {
                setAdded(null);
                adding.mutate({ expectedRevision: library.revision, componentId: definition.id });
              }}
            />
          ))}
          {adding.error ? (
            <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12, lineHeight: 18 }}>
              {errorMessage(adding.error)}
            </Text>
          ) : added ? (
            <StudioLabel theme={theme} subdued>
              Added to the designer chat as a live card.
            </StudioLabel>
          ) : null}
        </View>
      ) : (
        <StudioLabel theme={theme} subdued>
          {search ? "No components match." : "No components yet. Ask the designer to design one for you."}
        </StudioLabel>
      )}
      {selected && library ? (
        <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: c.border }}>
          <View style={{ gap: 3 }}>
            <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{selected.name}</Text>
            <StudioLabel theme={theme} subdued>
              {selected.mode === "composition" ? "Retired block composition" : "Custom component"} · v{selected.version}{" "}
              ·{" "}
              {isReady(library, selected)
                ? "Ready to use"
                : selected.mode === "composition"
                  ? "Pre-made blocks are no longer used. Ask the designer for a custom version, then delete this one"
                  : "Build and activate it in the library to render"}
            </StudioLabel>
            <StudioLabel theme={theme} subdued>
              Interactions in the preview stay local and never reach an agent.
            </StudioLabel>
          </View>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <StudioButton
              theme={theme}
              title={library.favorites.includes(selected.id) ? "Favorited" : "Favorite"}
              icon="Star"
              small
              active={library.favorites.includes(selected.id)}
              disabled={starring.isPending}
              onPress={() =>
                starring.mutate({
                  expectedRevision: library.revision,
                  componentId: selected.id,
                  favorite: !library.favorites.includes(selected.id),
                })
              }
            />
            <StudioButton theme={theme} title="Reset" icon="RotateCcw" small onPress={onResetPreview} />
            <StudioButton
              theme={theme}
              title="Delete"
              icon="Trash2"
              small
              danger
              onPress={() => setDeleting(selected)}
            />
          </View>
        </View>
      ) : null}
      <DeleteComponentDialog
        theme={theme}
        definition={deleting}
        library={library}
        onClose={() => setDeleting(null)}
        onDeleted={result => {
          accept(result.library);
          if (deleting?.id === selectedId) onSelect(null);
          setDeleting(null);
        }}
      />
    </View>
  );
}
