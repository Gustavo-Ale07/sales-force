import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { account, fakeAuth, fakeDependencies } from "../test-doubles";
import { memoryImageFileSystem, ok, WEBP } from "../images/image-test-doubles";
import { createProfilePhotoService, type ProfilePhotoApi } from "../photo/profile-photo";
import { createProfilePhotoStore } from "../photo/profile-photo-store";
import { Shell } from "./shell";

function photoService(api: Partial<ProfilePhotoApi> = {}, withPicker = true) {
  const full: ProfilePhotoApi = { upload: async () => ({ version: "v2" }), remove: async () => undefined, fetch: async () => ok(WEBP), ...api };
  const store = createProfilePhotoStore({ fs: memoryImageFileSystem().fs, fetchPhoto: (signal) => full.fetch(signal) });
  return createProfilePhotoService({ api: full, store, picker: withPicker ? { pick: async () => ({ contentType: "image/jpeg", dataBase64: "QUJD" }) } : null });
}

const hidden = { includeHiddenElements: true } as const;

describe("Shell - header avatar", () => {
  it("shows the initials in the header when the account has no photo", async () => {
    await render(<Shell dependencies={fakeDependencies({ auth: fakeAuth({ getSession: async () => account }), profilePhoto: photoService() })} />);
    const header = await screen.findByTestId("header-avatar");
    expect(header).toBeTruthy();
    expect(screen.getAllByText("AV", hidden).length).toBeGreaterThan(0);
  });

  it("loads the photo with the session once for its version and shows it in the header and, opened, in the profile", async () => {
    const fetchPhoto = jest.fn(async () => ok(WEBP));
    const withPhoto = { ...account, photoVersion: "v1" };
    await render(<Shell dependencies={fakeDependencies({ auth: fakeAuth({ getSession: async () => withPhoto }), profilePhoto: photoService({ fetch: fetchPhoto }) })} />);
    await waitFor(() => expect(screen.getAllByTestId("avatar-image", hidden).length).toBeGreaterThan(0));
    await act(async () => {
      await fireEvent.press(screen.getByRole("tab", { name: "Perfil" }));
    });
    await waitFor(() => expect(screen.getAllByTestId("avatar-image", hidden).length).toBe(2));
    expect(fetchPhoto).toHaveBeenCalledTimes(1);
  });

  it("the header avatar opens the profile", async () => {
    await render(<Shell dependencies={fakeDependencies({ auth: fakeAuth({ getSession: async () => account }), profilePhoto: photoService() })} />);
    await act(async () => {
      await fireEvent.press(await screen.findByTestId("header-avatar"));
    });
    expect(await screen.findByRole("button", { name: "Trocar foto" })).toBeTruthy();
  });

  it("without a picker module the profile has no 'Trocar foto'", async () => {
    await render(<Shell dependencies={fakeDependencies({ auth: fakeAuth({ getSession: async () => account }), profilePhoto: photoService({}, false) })} />);
    await act(async () => {
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
    });
    expect(screen.queryByRole("button", { name: "Trocar foto" })).toBeNull();
  });

  it("uploading a new photo makes the session carry the new version and the header refetches it", async () => {
    const fetchPhoto = jest.fn(async () => ok(WEBP));
    const upload = jest.fn(async () => ({ version: "v9" }));
    await render(<Shell dependencies={fakeDependencies({ auth: fakeAuth({ getSession: async () => account }), profilePhoto: photoService({ fetch: fetchPhoto, upload }) })} />);
    await act(async () => {
      await fireEvent.press(await screen.findByRole("tab", { name: "Perfil" }));
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Trocar foto" }));
    });
    await act(async () => {
      await fireEvent.press(await screen.findByText("Escolher da galeria"));
    });
    await waitFor(() => expect(upload).toHaveBeenCalled());
    await waitFor(() => expect(fetchPhoto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByTestId("avatar-image", hidden).length).toBe(2));
  });
});
