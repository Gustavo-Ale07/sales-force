import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Page, PageRequest } from "../data/ports";
import { usePagedList } from "../data/use-paged-list";
import { colors, spacing } from "../theme";

const SEARCH_DEBOUNCE_MS = 400;

export interface PagedListViewProps<T, R extends PageRequest = PageRequest> {
  readonly load: (request: R) => Promise<Page<T>>;
  /** Extra request fields (filters, jump offset); a change restarts the list. */
  readonly extra?: Omit<R, keyof PageRequest>;
  /** Called with the applied (debounced) search text. */
  readonly onSearchChange?: (search: string) => void;
  /** Rendered between the search box and the list (filter button, chips). */
  readonly header?: ReactNode;
  /** Empty-state title while filters are active (and no search text). */
  readonly filteredEmptyText?: string;
  readonly keyOf: (item: T) => string;
  readonly renderItem: (item: T) => ReactElement;
  readonly searchLabel: string;
  /** Visible hint inside the empty search box; defaults to the label. */
  readonly searchPlaceholder?: string;
  /** Shown when the list is empty and there is no search text. */
  readonly emptyText: string;
  /** Second line of the empty state without a search (what to do about it). */
  readonly emptyHint?: string;
  /** Shown when a search text matched nothing. */
  readonly noResultText?: (search: string) => string;
  /** Second line under the no-result title; defaults to the customer wording. */
  readonly noResultHint?: string;
  /** When set, a compact header (title + count line) replaces the plain "N resultado(s)" line above the list. */
  readonly title?: string;
  /** Count line under the title; `searching` is true while a search text is applied. */
  readonly describeCount?: (total: number, searching: boolean) => string;
  readonly loadingText?: string;
  /** Number of columns (grid mode); the list is remounted when it changes, the loaded items are kept. */
  readonly columns?: number;
  readonly onUnauthenticated: () => void;
}

/** Search box + paged list with loading, empty and error states. Shared by the customers and product screens. */
export function PagedListView<T, R extends PageRequest = PageRequest>({
  load,
  extra,
  onSearchChange,
  header,
  filteredEmptyText,
  keyOf,
  renderItem,
  searchLabel,
  searchPlaceholder,
  emptyText,
  emptyHint,
  noResultText,
  noResultHint = "Confira o nome, o código ou o documento.",
  title,
  describeCount,
  loadingText,
  columns = 1,
  onUnauthenticated,
}: PagedListViewProps<T, R>) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    onSearchChange?.(search);
  }, [search, onSearchChange]);

  const list = usePagedList<T, R>(load, search, onUnauthenticated, extra);
  const searching = search !== "";

  return (
    <View style={styles.container}>
      {title !== undefined && (
        <View>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          {describeCount !== undefined && list.status === "ready" && <Text style={styles.subtitle}>{describeCount(list.total, searching)}</Text>}
        </View>
      )}
      <TextInput
        style={styles.search}
        value={text}
        onChangeText={setText}
        placeholder={searchPlaceholder ?? searchLabel}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={searchLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        onSubmitEditing={() => Keyboard.dismiss()}
      />

      {header}

      {list.status === "loading" && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.navy} />
          {loadingText !== undefined && <Text style={styles.centeredText}>{loadingText}</Text>}
        </View>
      )}

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
          key={`columns-${columns}`}
          numColumns={columns}
          data={list.items}
          keyExtractor={keyOf}
          renderItem={({ item }) => renderItem(item)}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          onRefresh={list.reload}
          refreshing={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>{searching && noResultText !== undefined ? noResultText(search) : filteredEmptyText !== undefined ? filteredEmptyText : emptyText}</Text>
              {!searching && filteredEmptyText === undefined && emptyHint !== undefined && <Text style={styles.centeredText}>{emptyHint}</Text>}
              {searching && noResultText !== undefined && <Text style={styles.centeredText}>{noResultHint}</Text>}
            </View>
          }
          ListHeaderComponent={
            title === undefined && list.total > 0 ? <Text style={styles.count}>{`${list.total} resultado(s)`}</Text> : null
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
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.navy },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    fontSize: 16,
    color: colors.text,
  },
  listContent: { paddingBottom: spacing.lg },
  spinner: { marginVertical: spacing.lg },
  centered: { alignItems: "center", gap: spacing.xs, marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  centeredText: { textAlign: "center", color: colors.textMuted, fontSize: 14 },
  emptyTitle: { textAlign: "center", color: colors.text, fontSize: 16, fontWeight: "700" },
  notice: { backgroundColor: colors.errorBackground, borderRadius: 8, padding: spacing.lg, gap: spacing.sm },
  noticeText: { color: colors.text, fontSize: 14 },
  retry: { color: colors.red, fontWeight: "700", fontSize: 14 },
  count: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },
  footerError: { color: colors.red, fontSize: 13, paddingVertical: spacing.sm },
});
