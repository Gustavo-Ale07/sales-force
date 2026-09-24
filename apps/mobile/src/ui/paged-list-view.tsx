import { useEffect, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Page, PageRequest } from "../data/ports";
import { usePagedList } from "../data/use-paged-list";
import { colors, spacing } from "../theme";

const SEARCH_DEBOUNCE_MS = 400;

export interface PagedListViewProps<T> {
  readonly load: (request: PageRequest) => Promise<Page<T>>;
  readonly keyOf: (item: T) => string;
  readonly renderItem: (item: T) => ReactElement;
  readonly searchLabel: string;
  readonly emptyText: string;
  readonly onUnauthenticated: () => void;
}

/** Search box + paged list with loading, empty and error states. Shared by the customers and product screens. */
export function PagedListView<T>({
  load,
  keyOf,
  renderItem,
  searchLabel,
  emptyText,
  onUnauthenticated,
}: PagedListViewProps<T>) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const list = usePagedList(load, search, onUnauthenticated);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        value={text}
        onChangeText={setText}
        placeholder={searchLabel}
        accessibilityLabel={searchLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {list.status === "loading" && <ActivityIndicator style={styles.spinner} color={colors.navy} />}

      {list.status === "error" && list.error !== null && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{list.error.message}</Text>
          <Pressable onPress={list.reload} accessibilityRole="button" accessibilityLabel="Tentar novamente">
            <Text style={styles.retry}>Tentar novamente</Text>
          </Pressable>
        </View>
      )}

      {list.status === "ready" && (
        <FlatList
          data={list.items}
          keyExtractor={keyOf}
          renderItem={({ item }) => renderItem(item)}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          onRefresh={list.reload}
          refreshing={false}
          ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
          ListHeaderComponent={
            list.total > 0 ? <Text style={styles.count}>{`${list.total} resultado(s)`}</Text> : null
          }
          ListFooterComponent={
            <View>
              {list.error !== null && <Text style={styles.footerError}>{list.error.message}</Text>}
              {list.loadingMore && <ActivityIndicator style={styles.spinner} color={colors.navy} />}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  spinner: { marginVertical: spacing.lg },
  notice: { backgroundColor: colors.errorBackground, borderRadius: 8, padding: spacing.lg, gap: spacing.sm },
  noticeText: { color: colors.text, fontSize: 14 },
  retry: { color: colors.red, fontWeight: "700", fontSize: 14 },
  empty: { textAlign: "center", color: colors.textMuted, marginTop: spacing.xl },
  count: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },
  footerError: { color: colors.red, fontSize: 13, paddingVertical: spacing.sm },
});
