import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { account } from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers } from "../test/harness";

vi.setConfig({ testTimeout: 20_000 });

const sessionWith = (photoVersion: string | null) => ({
  body: { authenticated: true, authMode: "dev", account: { ...account, photoVersion }, expiresAt: "2026-09-21T20:00:00.000Z" },
});

const saved = { version: "v2", contentType: "image/webp", sizePx: 512, updatedAt: "2026-11-23T10:00:00.000Z" };

const open = (handlers: Handlers = {}, photoVersion: string | null = null, role: "seller" | "operations" = "seller") =>
  renderApp("/perfil", { role, handlers: { "GET /auth/session": sessionWith(photoVersion), ...handlers } });

const file = (name = "foto.png", type = "image/png", size = 1000) => {
  const picked = new File(["x"], name, { type });
  Object.defineProperty(picked, "size", { value: size });
  return picked;
};

/** Picks a file straight on the input (bypasses the `accept` filter, which the browser applies but the server never trusts). */
const pick = async (picked: File) => {
  const input = await screen.findByTestId("photo-file-input");
  fireEvent.change(input, { target: { files: [picked] } });
};

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static width = 400;
  naturalWidth = FakeImage.width;
  naturalHeight = 300;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  FakeImage.width = 400;
  vi.stubGlobal("Image", FakeImage);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "" } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,QUJD");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Foto de perfil", () => {
  it("shows the initials without a photo and the versioned photo URL with one", async () => {
    const { unmount } = open();
    await screen.findByRole("button", { name: "Trocar foto" });
    expect(screen.queryByTestId("avatar-photo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover foto" })).not.toBeInTheDocument();
    unmount();
    open({}, "v1");
    const photos = await screen.findAllByTestId("avatar-photo");
    expect(photos.length).toBeGreaterThanOrEqual(2);
    for (const photo of photos) expect(photo).toHaveAttribute("src", "/api/v1/me/photo?v=v1");
  });

  it("falls back to the initial when the photo fails to load", async () => {
    open({}, "v1");
    const photos = await screen.findAllByTestId("avatar-photo");
    for (const photo of photos) fireEvent.error(photo);
    await waitFor(() => expect(screen.queryByTestId("avatar-photo")).not.toBeInTheDocument());
    expect(screen.getAllByRole("img", { name: "Ana Souza" }).length).toBeGreaterThan(0);
  });

  it("uploads the cropped image and the avatar switches to the new version", async () => {
    const { calls } = open({ "PUT /me/photo": { body: saved } });
    await pick(file());
    const dialog = await screen.findByRole("dialog", { name: "Nova foto de perfil" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar esta foto" }));
    await waitFor(() => expect(callsTo(calls, "PUT", "/me/photo")).toHaveLength(1));
    expect(callsTo(calls, "PUT", "/me/photo")[0]?.body).toEqual({ contentType: "image/jpeg", dataBase64: "QUJD" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nova foto de perfil" })).not.toBeInTheDocument());
    const photos = await screen.findAllByTestId("avatar-photo");
    for (const photo of photos) expect(photo).toHaveAttribute("src", "/api/v1/me/photo?v=v2");
    expect(await screen.findByText("Foto atualizada")).toBeInTheDocument();
  });

  it.each([
    ["photo_type_not_allowed", "Use uma imagem JPEG, PNG ou WebP."],
    ["photo_content_mismatch", "O arquivo não é uma imagem válida do tipo informado."],
    ["photo_too_large", "A foto passa de 5 MB. Escolha uma imagem menor."],
    ["photo_unreadable", "Não foi possível ler esta imagem. Tente outro arquivo."],
    ["photo_too_small", "A foto é pequena demais: use pelo menos 64 x 64 pixels."],
    ["photo_crop_invalid", "O recorte escolhido é inválido. Tente de novo."],
  ])("maps the server code %s to a short message and keeps the old photo", async (code, message) => {
    open({ "PUT /me/photo": apiError(400, "validation_failed", "Foto inválida", { issues: [{ path: "dataBase64", code }] }) }, "v1");
    await pick(file());
    const dialog = await screen.findByRole("dialog", { name: "Nova foto de perfil" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar esta foto" }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    for (const photo of screen.getAllByTestId("avatar-photo")) expect(photo).toHaveAttribute("src", "/api/v1/me/photo?v=v1");
  });

  it.each([
    [429, "rate_limited", "Aguarde alguns segundos antes de trocar a foto de novo."],
    [503, "unavailable", "O armazenamento de fotos não está disponível nesta instalação."],
  ])("maps HTTP %i to a short message", async (status, code, message) => {
    open({ "PUT /me/photo": apiError(status, code, "x") });
    await pick(file());
    const dialog = await screen.findByRole("dialog", { name: "Nova foto de perfil" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar esta foto" }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });

  it("refuses a wrong type or a file over 5 MiB before any request", async () => {
    const { calls } = open();
    await pick(file("a.gif", "image/gif"));
    expect(await screen.findByText("Use uma imagem JPEG, PNG ou WebP.")).toBeInTheDocument();
    await pick(file("grande.jpg", "image/jpeg", 5 * 1024 * 1024 + 1));
    expect(await screen.findByText("A foto passa de 5 MB. Escolha uma imagem menor.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(callsTo(calls, "PUT", "/me/photo")).toHaveLength(0);
  });

  it("refuses an image under 64 px on the client", async () => {
    FakeImage.width = 40;
    const { calls } = open();
    await pick(file());
    const dialog = await screen.findByRole("dialog", { name: "Nova foto de perfil" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar esta foto" }));
    expect(await within(dialog).findByText("A foto é pequena demais: use pelo menos 64 x 64 pixels.")).toBeInTheDocument();
    expect(callsTo(calls, "PUT", "/me/photo")).toHaveLength(0);
  });

  it("removes the photo after confirming and goes back to the initial", async () => {
    const { calls } = open({ "DELETE /me/photo": { status: 204 } }, "v1");
    fireEvent.click(await screen.findByRole("button", { name: "Remover foto" }));
    const dialog = await screen.findByRole("dialog", { name: "Remover a foto de perfil?" });
    expect(callsTo(calls, "DELETE", "/me/photo")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover foto" }));
    await waitFor(() => expect(callsTo(calls, "DELETE", "/me/photo")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("avatar-photo")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Remover foto" })).not.toBeInTheDocument();
  });

  it("uses neither localStorage nor sessionStorage", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    open({ "PUT /me/photo": { body: saved } });
    await pick(file());
    const dialog = await screen.findByRole("dialog", { name: "Nova foto de perfil" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar esta foto" }));
    await screen.findByText("Foto atualizada");
    expect(local).not.toHaveBeenCalled();
  });
});
