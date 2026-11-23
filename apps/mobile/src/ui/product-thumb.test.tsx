import { act, render, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { ProductListItem } from "../data/ports";
import { ProductImageProvider } from "../images/product-image-context";
import { createProductImageStore, type ImageFetchOutcome } from "../images/image-store";
import { GARBAGE, PNG, memoryImageFileSystem, ok } from "../images/image-test-doubles";
import { fakeProducts, pageOf, product } from "../test-doubles";
import { ProductCard, ProductRow } from "./product-views";
import { ProductsScreen } from "./products-screen";

const noop = () => undefined;

afterEach(async () => {
  // FlatList schedules an internal cell-range timer after each render (see products-screen.test.tsx).
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

const withImage = (code: number, version = "v1"): ProductListItem =>
  product(code, { description: `Tinta ${code}`, image: { version, thumbnailUrl: `/products/${code}/image?variant=thumb`, url: `/products/${code}/image?variant=full` } });

function mount(items: readonly ProductListItem[], fetchThumbnail: (code: number) => Promise<ImageFetchOutcome>) {
  const memory = memoryImageFileSystem();
  const requested: number[] = [];
  const store = createProductImageStore({
    fs: memory.fs,
    fetchThumbnail: (code) => {
      requested.push(code);
      return fetchThumbnail(code);
    },
    scope: async () => "owner|production|ds",
    now: () => Date.now(),
    timeoutMs: 30,
  });
  const ui = (isOnline: boolean, list: readonly ProductListItem[] = items) => (
    <ProductImageProvider store={store} online={isOnline}>
      <ProductsScreen products={fakeProducts({ list: async () => pageOf(list) })} onUnauthenticated={noop} />
    </ProductImageProvider>
  );
  return { ui, requested, memory, store };
}

describe("ProductThumb in the catalog", () => {
  it("shows the stored thumbnail from a file uri (no base64) once downloaded, initials until then", async () => {
    const { ui, requested } = mount([withImage(1)], async () => ok(PNG));
    await render(ui(true));
    expect(await screen.findByTestId("product-thumb-1", { includeHiddenElements: true }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByTestId("product-thumb-1", { includeHiddenElements: true }).props.source.uri).toMatch(/^file:\/\/\/images\/p1-/);
    expect(screen.getByTestId("product-thumb-1", { includeHiddenElements: true }).props.resizeMode).toBe("contain");
    expect(requested).toEqual([1]);
  });

  it("keeps the initials when the server answers 404 (no image)", async () => {
    const { ui, requested } = mount([withImage(1)], async () => ({ kind: "absent" }));
    await render(ui(true));
    await screen.findByText("Tinta 1", {}, { timeout: 5000 });
    await waitFor(() => expect(requested).toEqual([1]));
    expect(screen.queryByTestId("product-thumb-1", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText("TI", { includeHiddenElements: true })).toBeTruthy();
  });

  it.each([
    ["timeout", () => new Promise<ImageFetchOutcome>(() => undefined)],
    ["corrupt bytes", async () => ok(GARBAGE)],
  ])("keeps the initials on %s", async (_name, fetchThumbnail) => {
    const { ui, requested } = mount([withImage(1)], fetchThumbnail);
    await render(ui(true));
    await screen.findByText("Tinta 1", {}, { timeout: 5000 });
    await waitFor(() => expect(requested).toEqual([1]));
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
    });
    expect(screen.queryByTestId("product-thumb-1", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText("TI", { includeHiddenElements: true })).toBeTruthy();
  });

  it("offline with nothing stored: initials and no request; offline with a stored file: the image", async () => {
    const { ui, requested } = mount([withImage(1)], async () => ok(PNG));
    const view = await render(ui(false));
    await screen.findByText("Tinta 1", {}, { timeout: 5000 });
    expect(requested).toEqual([]);
    expect(screen.queryByTestId("product-thumb-1", { includeHiddenElements: true })).toBeNull();
    // back online: it downloads; then offline again it is served from the file
    view.rerender(ui(true));
    expect(await screen.findByTestId("product-thumb-1", { includeHiddenElements: true }, { timeout: 5000 })).toBeTruthy();
    view.rerender(ui(false));
    expect(screen.getByTestId("product-thumb-1", { includeHiddenElements: true })).toBeTruthy();
    expect(requested).toEqual([1]);
  });

  it("a new image version refetches and shows the new file", async () => {
    const { requested, store } = mount([], async () => ok(PNG));
    const row = (item: ProductListItem) => (
      <ProductImageProvider store={store} online>
        <ProductRow product={item} />
      </ProductImageProvider>
    );
    const view = await render(row(withImage(1, "v1")));
    const first = (await screen.findByTestId("product-thumb-1", { includeHiddenElements: true }, { timeout: 5000 })).props.source.uri;
    view.rerender(row(withImage(1, "v2")));
    await waitFor(() => expect(requested).toEqual([1, 1]));
    await waitFor(() => expect(screen.getByTestId("product-thumb-1", { includeHiddenElements: true }).props.source.uri).not.toBe(first));
  });

  it("grid card: a square frame, the image fills it absolutely and keeps its proportions (contain, never cropped)", async () => {
    const { store } = mount([], async () => ok(PNG));
    await render(
      <ProductImageProvider store={store} online>
        <ProductCard product={withImage(1)} />
      </ProductImageProvider>,
    );
    const image = await screen.findByTestId("product-thumb-1", { includeHiddenElements: true }, { timeout: 5000 });
    expect(image.props.resizeMode).toBe("contain");
    expect(StyleSheet.flatten(image.props.style)).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 });
    const frame = StyleSheet.flatten(image.parent?.props.style);
    expect(frame).toMatchObject({ aspectRatio: 1, alignSelf: "stretch", overflow: "hidden" });
    expect(frame.width).toBeUndefined(); // grows with the card column, not a fixed size
  });

  it("list row: a fixed 48 px frame with the same absolute-fill contained image", async () => {
    const { store } = mount([], async () => ok(PNG));
    await render(
      <ProductImageProvider store={store} online>
        <ProductRow product={withImage(2)} />
      </ProductImageProvider>,
    );
    const image = await screen.findByTestId("product-thumb-2", { includeHiddenElements: true }, { timeout: 5000 });
    expect(image.props.resizeMode).toBe("contain");
    expect(StyleSheet.flatten(image.props.style).position).toBe("absolute");
    expect(StyleSheet.flatten(image.parent?.props.style)).toMatchObject({ width: 48, height: 48, overflow: "hidden" });
  });

  it("a product without image metadata never triggers a request", async () => {
    const { ui, requested } = mount([product(2, { description: "Solvente" })], async () => ok(PNG));
    await render(ui(true));
    await screen.findByText("Solvente", {}, { timeout: 5000 });
    expect(requested).toEqual([]);
  });
});
