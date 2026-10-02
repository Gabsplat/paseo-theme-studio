import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { deleteComponent, favoriteComponent, readComponentLibrary } from "../shared/component-rpc";
import type { ComponentDefinition, ComponentLibrary } from "../shared/components";
import { StudioButton, StudioLabel } from "./studio-ui";

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
  return definition.mode === "composition" || Boolean(library?.activeKeys.includes(definitionKey(definition)));
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
  const published = definition
    ? (library?.instances.filter(instance => instance.componentId === definition.id).length ?? 0)
    : 0;
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

function ComponentRow({
  theme,
  definition,
  selected,
  favorite,
  ready,
  onPress,
}: {
  theme: PluginTheme;
  definition: ComponentDefinition;
  selected: boolean;
  favorite: boolean;
  ready: boolean;
  onPress: () => void;
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Preview ${definition.name}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: selected || pressed ? c.surface2 : "transparent",
      })}
    >
      <Icon name={definition.mode === "composition" ? "Blocks" : "Code2"} size={15} color={c.foregroundMuted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: selected ? "600" : "400" }}>
          {definition.name}
        </Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10, fontFamily: "monospace" }}>
          {definitionKey(definition)}
        </Text>
      </View>
      {favorite ? <Icon name="Star" size={12} color={c.accent} /> : null}
      <View
        accessibilityLabel={ready ? "Ready" : "Needs activation"}
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ready ? c.statusSuccess : c.statusWarning }}
      />
    </Pressable>
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
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<ComponentDefinition | null>(null);
  const definitions = latestDefinitions(library, search);
  const selected = definitions.find(definition => definition.id === selectedId) ?? null;
  const c = theme.colors;
  return (
    <View style={{ gap: 12, paddingVertical: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>Components</Text>
          <StudioLabel theme={theme} subdued>
            Select one to see it in the preview chat.
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
        <View style={{ gap: 2, marginHorizontal: -10 }}>
          {definitions.map(definition => (
            <ComponentRow
              key={definition.id}
              theme={theme}
              definition={definition}
              selected={definition.id === selectedId}
              favorite={library.favorites.includes(definition.id)}
              ready={isReady(library, definition)}
              onPress={() => onSelect(definition.id === selectedId ? null : definition.id)}
            />
          ))}
        </View>
      ) : (
        <StudioLabel theme={theme} subdued>
          {search
            ? "No components match."
            : "No components yet. Ask the designer for one, or create it in the library."}
        </StudioLabel>
      )}
      {selected && library ? (
        <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderColor: c.border }}>
          <View style={{ gap: 3 }}>
            <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{selected.name}</Text>
            <StudioLabel theme={theme} subdued>
              {selected.mode === "composition" ? "Native composition" : "Generated React Native"} · v{selected.version}{" "}
              · {isReady(library, selected) ? "Ready to use" : "Build and activate it in the library to render"}
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
