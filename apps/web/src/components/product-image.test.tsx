import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductImage, productImageSrc } from "./product-image";

const image = { version: "v1", thumbnailUrl: "/api/v1/products/7/image?variant=thumb", url: "/api/v1/products/7/image?variant=full" };

describe("ProductImage", () => {
  it("renders the thumbnail lazily with fixed dimensions, alt text and the version as cache buster", () => {
    render(<ProductImage image={image} description="Balão Metalizado" name="Balão Metalizado" />);
    const img = screen.getByRole("img", { name: "Balão Metalizado" });
    expect(img).toHaveAttribute("src", "/api/v1/products/7/image?variant=thumb&v=v1");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("width");
    expect(img).toHaveAttribute("height");
  });

  it("uses the full URL for the full variant", () => {
    render(<ProductImage image={image} description="Balão" variant="full" />);
    expect(screen.getByRole("img", { name: "Balão" })).toHaveAttribute("src", "/api/v1/products/7/image?variant=full&v=v1");
  });

  it("shows a neutral placeholder with initials when there is no image", () => {
    const { container } = render(<ProductImage image={null} description="Balão Metalizado" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("BM")).toBeInTheDocument();
  });

  it("treats an absent image as no image", () => {
    const { container } = render(<ProductImage description="Vela" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("V")).toBeInTheDocument();
  });

  it("shows the placeholder directly when the thumbnail fails, without requesting the full image", () => {
    const { container } = render(<ProductImage image={image} description="Balão Metalizado" />);
    fireEvent.error(screen.getByRole("img"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("variant=full");
    expect(screen.getByText("BM")).toBeInTheDocument();
  });

  it("falls back to the placeholder when the full image fails to load (404 or transient 503)", () => {
    const { container } = render(<ProductImage image={image} description="Balão Metalizado" variant="full" />);
    fireEvent.error(screen.getByRole("img"));
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("BM")).toBeInTheDocument();
  });

  it("tries again when the image version changes", () => {
    const { container, rerender } = render(<ProductImage image={image} description="Balão Metalizado" />);
    fireEvent.error(screen.getByRole("img"));
    expect(container.querySelector("img")).toBeNull();
    rerender(<ProductImage image={{ ...image, version: "v2" }} description="Balão Metalizado" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/v1/products/7/image?variant=thumb&v=v2");
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
