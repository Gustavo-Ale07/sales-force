import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { account } from "../test-doubles";
import { memoryImageFileSystem, ok, WEBP } from "../images/image-test-doubles";
import { ApiRequestError } from "../data/api";
import { createProfilePhotoService, type PhotoPicker, type ProfilePhotoApi } from "../photo/profile-photo";
import { createProfilePhotoStore } from "../photo/profile-photo-store";
import { Avatar, useProfilePhotoUri } from "./avatar";
import { ProfileScreen } from "./profile-screen";
import { renderWithModal } from "./test-modal-wrapper";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
const picked = { contentType: "image/jpeg" as const, dataBase64: "QUJD" };

async function setup(options: { picker?: PhotoPicker | null; api?: Partial<ProfilePhotoApi>; photoVersion?: string | null; connectivity?: "online" | "offline"; uri?: string | null } = {}) {
  const api: ProfilePhotoApi = { upload: async () => ({ version: "v2" }), remove: async () => undefined, fetch: async () => ok(WEBP), ...options.api };
  const store = createProfilePhotoStore({ fs: memoryImageFileSystem().fs, fetchPhoto: (signal) => api.fetch(signal) });
  const picker = options.picker === undefined ? { pick: async () => picked } : options.picker;
  const service = createProfilePhotoService({ api, store, picker });
  const onChanged = jest.fn();
  const view = await renderWithModal(
    <ProfileScreen
      account={{ ...account, photoVersion: options.photoVersion ?? null }}
      status={idle}
      connectivity={options.connectivity ?? "online"}
      onSyncNow={() => undefined}
      onSignOut={() => undefined}
      photo={{ service, uri: options.uri ?? null, onChanged }}
    />,
  );
  return { view, onChanged };
}

const settle = () => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 20)); });

describe("Avatar", () => {
  it("shows the initials without a photo and the photo file when there is one", async () => {
    await render(<Avatar name="Ana Vendedora" size={40} />);
    expect(screen.getByText("AV", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("avatar-image", { includeHiddenElements: true })).toBeNull();
    await render(<Avatar name="Ana Vendedora" size={40} uri="file:///images/photo-1.img" />);
    expect(screen.getByTestId("avatar-image", { includeHiddenElements: true }).props.source).toEqual({ uri: "file:///images/photo-1.img" });
  });

  it("falls back to the initials when the file cannot be drawn", async () => {
    await render(<Avatar name="Ana Vendedora" size={40} uri="file:///images/broken.img" />);
    await fireEvent(screen.getByTestId("avatar-image", { includeHiddenElements: true }), "error");
    expect(screen.getByTestId("avatar-initials", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("useProfilePhotoUri", () => {
  function Probe({ store, version, online = true }: { store: ReturnType<typeof createProfilePhotoStore>; version: string | null; online?: boolean }) {
    const uri = useProfilePhotoUri(store, "a1", version, online);
    return <Avatar name="Ana Vendedora" size={24} uri={uri} />;
  }

  it("loads the photo through the authenticated fetch once per version and shows it", async () => {
    const fetchPhoto = jest.fn(async () => ok(WEBP));
    const store = createProfilePhotoStore({ fs: memoryImageFileSystem().fs, fetchPhoto });
    const view = await render(<Probe store={store} version="v1" />);
    await waitFor(() => expect(screen.getByTestId("avatar-image", { includeHiddenElements: true })).toBeTruthy());
    await view.rerender(<Probe store={store} version="v1" />);
    expect(fetchPhoto).toHaveBeenCalledTimes(1);
    await view.rerender(<Probe store={store} version="v2" />);
    await waitFor(() => expect(fetchPhoto).toHaveBeenCalledTimes(2));
  });

  it("no version means no request and the initials", async () => {
    const fetchPhoto = jest.fn(async () => ok(WEBP));
    const store = createProfilePhotoStore({ fs: memoryImageFileSystem().fs, fetchPhoto });
    await render(<Probe store={store} version={null} />);
    expect(fetchPhoto).not.toHaveBeenCalled();
    expect(screen.getByTestId("avatar-initials", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("ProfileScreen photo", () => {
  it("hides 'Trocar foto' when this build has no picker module", async () => {
    await setup({ picker: null });
    expect(screen.queryByRole("button", { name: "Trocar foto" })).toBeNull();
  });

  it("choosing a source uploads and reports the new version", async () => {
    const upload = jest.fn(async () => ({ version: "v7" }));
    const { onChanged } = await setup({ api: { upload } });
    await fireEvent.press(screen.getByRole("button", { name: "Trocar foto" }));
    await fireEvent.press(await screen.findByText("Escolher da galeria"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("v7"));
    expect(upload).toHaveBeenCalledWith(picked);
    await settle();
  });

  it("shows the short message of a server refusal in the app modal", async () => {
    const { onChanged } = await setup({ api: { upload: async () => Promise.reject(new ApiRequestError({ status: 400, message: "x", issues: [{ path: "p", code: "photo_too_large" }] })) } });
    await fireEvent.press(screen.getByRole("button", { name: "Trocar foto" }));
    await fireEvent.press(await screen.findByText("Tirar foto"));
    expect(await screen.findByText("A imagem é maior que 5 MB. Escolha uma menor.")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    await settle();
  });

  it("offline: explains that it needs internet and never calls the server", async () => {
    const upload = jest.fn();
    const remove = jest.fn();
    await setup({ connectivity: "offline", photoVersion: "v1", api: { upload, remove } });
    await fireEvent.press(screen.getByRole("button", { name: "Trocar foto" }));
    expect(await screen.findByText("Sem internet. Tente de novo conectado.")).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("'Remover foto' appears only with a photo, asks to confirm and then removes", async () => {
    const remove = jest.fn(async () => undefined);
    const none = await setup({ api: { remove } });
    expect(screen.queryByRole("button", { name: "Remover foto" })).toBeNull();
    await none.view.unmount();
    const { onChanged } = await setup({ photoVersion: "v1", api: { remove } });
    await fireEvent.press(screen.getByRole("button", { name: "Remover foto" }));
    await fireEvent.press(await screen.findByText("Remover"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null));
    await settle();
    expect(remove).toHaveBeenCalledTimes(1);
    await settle();
  });

  it("shows the photo in the profile header when a file is available", async () => {
    await setup({ photoVersion: "v1", uri: "file:///images/photo-1.img" });
    expect(screen.getByTestId("avatar-image", { includeHiddenElements: true })).toBeTruthy();
  });
});
