import { ApiRequestError } from "../data/api";
import { memoryImageFileSystem, ok, PNG, WEBP, GARBAGE } from "../images/image-test-doubles";
import { base64Bytes, createImagePickerAdapter, detectPhotoPicker, PHOTO_TARGET_MAX_BYTES, type ImageManipulatorModule, type ImagePickerModule } from "./photo-picker";
import { createProfilePhotoService, photoErrorMessage, PHOTO_OFFLINE_MESSAGE, type PhotoPicker, type PickedPhoto, type ProfilePhotoApi } from "./profile-photo";
import { createProfilePhotoStore } from "./profile-photo-store";

const photo: PickedPhoto = { contentType: "image/jpeg", dataBase64: "QUJD" };
const issue = (code: string) => new ApiRequestError({ status: 400, code: "validation_failed", message: "x", issues: [{ path: "dataBase64", code }] });

function fakeApi(overrides: Partial<ProfilePhotoApi> = {}): ProfilePhotoApi {
  return { upload: async () => ({ version: "v2" }), remove: async () => undefined, fetch: async () => ({ kind: "absent" }), ...overrides };
}
const pickerOf = (result: PickedPhoto | null): PhotoPicker => ({ pick: async () => result });
const storeOf = () => createProfilePhotoStore({ fs: memoryImageFileSystem().fs, fetchPhoto: async () => ({ kind: "absent" }) });

describe("photoErrorMessage", () => {
  it.each([
    ["photo_type_not_allowed", "Formato de imagem não aceito. Use JPEG, PNG ou WebP."],
    ["photo_content_mismatch", "O arquivo não corresponde ao formato informado. Escolha outra imagem."],
    ["photo_too_large", "A imagem é maior que 5 MB. Escolha uma menor."],
    ["photo_unreadable", "Não foi possível ler a imagem. Escolha outra."],
    ["photo_too_small", "A imagem é pequena demais. Use ao menos 64 × 64 pixels."],
    ["photo_crop_invalid", "O recorte escolhido é inválido. Tente de novo."],
  ])("400 %s", (code, message) => {
    expect(photoErrorMessage(issue(code))).toBe(message);
  });

  it("429, 503, offline, expired session and anything else", () => {
    expect(photoErrorMessage(new ApiRequestError({ status: 429, message: "x" }))).toBe("Aguarde alguns segundos para tentar de novo.");
    expect(photoErrorMessage(new ApiRequestError({ status: 503, message: "x" }))).toBe("O armazenamento de fotos está indisponível agora. Tente mais tarde.");
    expect(photoErrorMessage(new ApiRequestError({ status: 0, message: "x" }))).toBe(PHOTO_OFFLINE_MESSAGE);
    expect(photoErrorMessage(new ApiRequestError({ status: 401, message: "x" }))).toBe("Sua sessão expirou. Entre de novo.");
    expect(photoErrorMessage(new ApiRequestError({ status: 500, message: "x" }))).toBe("Não foi possível salvar a foto. Tente de novo.");
    expect(photoErrorMessage(new ApiRequestError({ status: 400, message: "x" }))).toBe("A imagem não foi aceita. Escolha outra.");
    expect(photoErrorMessage(new Error("boom"))).toBe("Não foi possível salvar a foto. Tente de novo.");
  });
});

describe("profile photo service", () => {
  it("uploads what the picker returns and reports the new version", async () => {
    const upload = jest.fn(async () => ({ version: "v9" }));
    const service = createProfilePhotoService({ api: fakeApi({ upload }), store: storeOf(), picker: pickerOf(photo) });
    expect(service.canChange).toBe(true);
    await expect(service.change("gallery")).resolves.toEqual({ ok: true, version: "v9" });
    expect(upload).toHaveBeenCalledWith(photo);
  });

  it("a cancelled pick uploads nothing and is not an error", async () => {
    const upload = jest.fn();
    const service = createProfilePhotoService({ api: fakeApi({ upload }), store: storeOf(), picker: pickerOf(null) });
    await expect(service.change("camera")).resolves.toEqual({ ok: false, cancelled: true });
    expect(upload).not.toHaveBeenCalled();
  });

  it("maps a server refusal to its message and an oversized file is refused before any upload", async () => {
    const refused = createProfilePhotoService({ api: fakeApi({ upload: async () => Promise.reject(issue("photo_too_small")) }), store: storeOf(), picker: pickerOf(photo) });
    await expect(refused.change("gallery")).resolves.toEqual({ ok: false, message: "A imagem é pequena demais. Use ao menos 64 × 64 pixels." });
    const upload = jest.fn();
    const big = createProfilePhotoService({ api: fakeApi({ upload }), store: storeOf(), picker: pickerOf({ contentType: "image/png", dataBase64: "A".repeat(7 * 1024 * 1024) }) });
    await expect(big.change("gallery")).resolves.toEqual({ ok: false, message: "A imagem é maior que 5 MB. Escolha uma menor." });
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the photo and clears the stored file; a failed removal keeps it and explains", async () => {
    const { fs, files } = memoryImageFileSystem();
    const store = createProfilePhotoStore({ fs, fetchPhoto: async () => ok(WEBP) });
    await store.resolve("a1", "v1", { online: true });
    expect(files.size).toBeGreaterThan(0);
    const service = createProfilePhotoService({ api: fakeApi(), store, picker: null });
    expect(service.canChange).toBe(false);
    await expect(service.remove()).resolves.toEqual({ ok: true, version: null });
    expect(files.size).toBe(0);
    const failing = createProfilePhotoService({ api: fakeApi({ remove: async () => Promise.reject(new ApiRequestError({ status: 503, message: "x" })) }), store, picker: null });
    await expect(failing.remove()).resolves.toMatchObject({ ok: false });
  });
});

describe("profile photo store", () => {
  it("downloads once per version and serves the file afterwards; a new version replaces the old file", async () => {
    const { fs, files } = memoryImageFileSystem();
    const fetchPhoto = jest.fn(async () => ok(WEBP));
    const store = createProfilePhotoStore({ fs, fetchPhoto });
    const first = await store.resolve("a1", "v1", { online: true });
    expect(first).toMatch(/^file:\/\/\/images\/photo-/);
    expect(await store.resolve("a1", "v1", { online: true })).toBe(first);
    expect(fetchPhoto).toHaveBeenCalledTimes(1);
    const second = await store.resolve("a1", "v2", { online: true });
    expect(second).not.toBe(first);
    expect(fetchPhoto).toHaveBeenCalledTimes(2);
    expect([...files.keys()].filter((name) => name.startsWith("photo-"))).toHaveLength(1);
  });

  it("offline shows the stored photo; a transient failure keeps it; a non-image answer is never stored", async () => {
    const { fs } = memoryImageFileSystem();
    let outcome: Awaited<ReturnType<ProfilePhotoApi["fetch"]>> = ok(PNG);
    const store = createProfilePhotoStore({ fs, fetchPhoto: async () => outcome });
    const stored = await store.resolve("a1", "v1", { online: true });
    expect(await store.resolve("a1", "v2", { online: false })).toBe(stored);
    outcome = { kind: "unavailable" };
    expect(await store.resolve("a1", "v2", { online: true })).toBe(stored);
    outcome = ok(GARBAGE);
    expect(await store.resolve("a1", "v3", { online: true })).toBe(stored);
  });

  it("another account never sees the stored photo, and an absent photo clears it", async () => {
    const { fs, files } = memoryImageFileSystem();
    let outcome: Awaited<ReturnType<ProfilePhotoApi["fetch"]>> = ok(WEBP);
    const store = createProfilePhotoStore({ fs, fetchPhoto: async () => outcome });
    await store.resolve("a1", "v1", { online: true });
    expect(await store.resolve("a2", "v1", { online: false })).toBeNull();
    expect(files.size).toBe(0);
    await store.resolve("a2", "v1", { online: true });
    outcome = { kind: "absent" };
    expect(await store.resolve("a2", "v2", { online: true })).toBeNull();
    expect(files.size).toBe(0);
  });
});

describe("picker adapter and runtime detection", () => {
  const pickerModule = (launch: jest.Mock, granted = true): ImagePickerModule => ({
    requestCameraPermissionsAsync: async () => ({ granted }),
    launchCameraAsync: launch,
    launchImageLibraryAsync: async () => ({ canceled: true }),
  });
  const manipulatorOf = (encode: (quality: number) => string, calls: string[] = []): ImageManipulatorModule => ({
    SaveFormat: { JPEG: "jpeg" },
    ImageManipulator: {
      manipulate: () => ({
        crop: (rect: unknown) => calls.push(`crop:${JSON.stringify(rect)}`),
        resize: (size: { width: number }) => calls.push(`resize:${size.width}`),
        renderAsync: async () => ({ saveAsync: async (o: { compress: number }) => ({ base64: encode(o.compress) }) }),
      }),
    },
  });

  it("without the native modules there is no picker", () => {
    expect(detectPhotoPicker(() => {
      throw new Error("Cannot find module");
    })).toBeNull();
    expect(detectPhotoPicker(() => ({}))).toBeNull();
  });

  it("square crop, 512 px JPEG, quality lowered until the file is under 400 KB (contract of the reduction)", async () => {
    const launch = jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///p.jpg", width: 3000, height: 4000 }] }));
    const calls: string[] = [];
    const tried: number[] = [];
    const encode = (quality: number) => {
      tried.push(quality);
      return "A".repeat(quality > 0.6 ? 700_000 : quality > 0.5 ? 600_000 : 100_000);
    };
    const picker = createImagePickerAdapter(pickerModule(launch), manipulatorOf(encode, calls));
    const photo = await picker.pick("camera");
    expect(photo?.contentType).toBe("image/jpeg");
    expect(tried).toEqual([0.8, 0.65, 0.5]);
    expect(base64Bytes(photo?.dataBase64 ?? "")).toBeLessThan(PHOTO_TARGET_MAX_BYTES);
    expect(calls).toContain(`crop:${JSON.stringify({ originX: 0, originY: 500, width: 3000, height: 3000 })}`);
    expect(calls).toContain("resize:512");
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [1, 1], base64: false }));
  });

  it("rejects when no quality step fits; cancel and denial give null", async () => {
    const launch = jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///p.jpg", width: 512, height: 512 }] }));
    const huge = createImagePickerAdapter(pickerModule(launch), manipulatorOf(() => "A".repeat(900_000)));
    await expect(huge.pick("camera")).rejects.toThrow("photo_unreadable");
    const cancelled = createImagePickerAdapter(pickerModule(launch), manipulatorOf(() => "QUJD"));
    await expect(cancelled.pick("gallery")).resolves.toBeNull();
    const denied = createImagePickerAdapter(pickerModule(launch, false), manipulatorOf(() => "QUJD"));
    await expect(denied.pick("camera")).resolves.toBeNull();
  });
});
