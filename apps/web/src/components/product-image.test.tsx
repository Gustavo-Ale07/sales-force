import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGuardedImageCache } from "../lib/guarded-image";
import { SERVER_CODE_HEADER } from "../lib/server-code";
import { TEST_SERVER_KEY } from "../test/server-code";
import { ProductImage, productImageSrc } from "./product-image";

const image = { version: "v1", thumbnailUrl: "/api/v1/products/7/image?variant=thumb", url: "/api/v1/products/7/image?variant=full" };

let fetchStub: ReturnType<typeof vi.fn>;
let revoked: string[];

beforeEach(() => {
  clearGuardedImageCache();
  revoked = [];
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:product-${++counter}`);
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  fetchStub = vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchStub);
});
afterEach(() => vi.unstubAllGlobals());

describe("ProductImage", () => {
  it("downloads the thumbnail with the server-code header and shows it from a blob URL, lazily, with alt text", async () => {
    render(<ProductImage image={image} description="Balão Metalizado" name="Balão Metalizado" />);
    const img = await screen.findByRole("img", { name: "Balão Metalizado" });
    expect(img).toHaveAttribute("src", "blob:product-1");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("width");
    expect(img).toHaveAttribute("height");
    const request = fetchStub.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname + new URL(request.url).search).toBe("/api/v1/products/7/image?variant=thumb&v=v1");
    expect(request.headers.get(SERVER_CODE_HEADER)).toBe(TEST_SERVER_KEY);
  });

  it("shows the placeholder while the download is pending", () => {
    fetchStub.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<ProductImage image={image} description="Balão Metalizado" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("BM")).toBeInTheDocument();
  });

  it("uses the full URL for the full variant", async () => {
    render(<ProductImage image={image} description="Balão" variant="full" />);
    await screen.findByRole("img", { name: "Balão" });
    expect(String((fetchStub.mock.calls[0]?.[0] as Request).url)).toContain("variant=full&v=v1");
  });

  it("downloads a URL once and revokes the blob URL on unmount", async () => {
    const first = render(<ProductImage image={image} description="Balão" />);
    await screen.findByRole("img");
    first.unmount();
    expect(revoked).toEqual(["blob:product-1"]);
    render(<ProductImage image={image} description="Balão" />);
    await screen.findByRole("img");
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("shows a neutral placeholder with initials when there is no image", () => {
    const { container } = render(<ProductImage image={null} description="Balão Metalizado" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("BM")).toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("treats an absent image as no image", () => {
    const { container } = render(<ProductImage description="Vela" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("V")).toBeInTheDocument();
  });

  it("keeps the placeholder on a 404 or 503 and on a network failure, without requesting the full image", async () => {
    for (const answer of [
      () => Promise.resolve(new Response(null, { status: 404 })),
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.reject(new TypeError("network")),
    ]) {
      clearGuardedImageCache();
      fetchStub.mockReset();
      fetchStub.mockImplementation(answer);
      const { container, unmount } = render(<ProductImage image={image} description="Balão Metalizado" />);
      await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByText("BM")).toBeInTheDocument();
      expect(String((fetchStub.mock.calls[0]?.[0] as Request).url)).not.toContain("variant=full");
      unmount();
    }
  });

  it("falls back to the placeholder when the blob cannot be decoded", async () => {
    const { container } = render(<ProductImage image={image} description="Balão Metalizado" variant="full" />);
    fireEvent.error(await screen.findByRole("img"));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("BM")).toBeInTheDocument();
  });

  it("tries again when the image version changes", async () => {
    const { container, rerender } = render(<ProductImage image={image} description="Balão Metalizado" />);
    fireEvent.error(await screen.findByRole("img"));
    expect(container.querySelector("img")).toBeNull();
    rerender(<ProductImage image={{ ...image, version: "v2" }} description="Balão Metalizado" />);
    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(String((fetchStub.mock.calls[1]?.[0] as Request).url)).toContain("variant=thumb&v=v2");
  });

  it("refuses non same-origin or inline URLs", () => {
    expect(productImageSrc({ ...image, thumbnailUrl: "https://evil.example/x.png" }, "thumb")).toBeNull();
    expect(productImageSrc({ ...image, thumbnailUrl: "//evil.example/x.png" }, "thumb")).toBeNull();
    expect(productImageSrc({ ...image, thumbnailUrl: "data:image/png;base64,AAAA" }, "thumb")).toBeNull();
  });

  it("encodes the version and handles URLs without a query string", () => {
    expect(productImageSrc({ version: "a b&c", thumbnailUrl: "/x", url: "/y" }, "thumb")).toBe("/x?v=a%20b%26c");
  });
});
