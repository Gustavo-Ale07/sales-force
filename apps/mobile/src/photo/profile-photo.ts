import { ApiRequestError, callApi, type ApiClient } from "../data/api";
import type { ImageFetchOutcome } from "../images/image-store";
import type { ProfilePhotoStore } from "./profile-photo-store";

/** Server limit of an upload (5 MiB decoded), mirrored from the contract. */
const PHOTO_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export type PhotoSource ="camera" | "gallery";

export interface PickedPhoto {
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
  /** Standard base64 of the file, no `data:` prefix. */
  readonly dataBase64: string;
  /** Pixels after the orientation was applied; absent = the server crops the centre square. */
  readonly crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/** The camera / gallery chooser. The concrete adapter exists only in a build that contains the native picker module. */
export interface PhotoPicker {
  /** `null` = the user cancelled (or denied the permission). */
  pick(source: PhotoSource): Promise<PickedPhoto | null>;
}

export interface UploadedPhoto {
  readonly version: string;
}

/** The three profile photo calls, over the generated client. */
export interface ProfilePhotoApi {
  upload(photo: PickedPhoto): Promise<UploadedPhoto>;
  remove(): Promise<void>;
  fetch(signal: AbortSignal): Promise<ImageFetchOutcome>;
}

export function createProfilePhotoApi(api: ApiClient, mediaApi: ApiClient = api): ProfilePhotoApi {
  return {
    async upload(photo) {
      const result = await callApi(() =>
        api.PUT("/me/photo", { body: { contentType: photo.contentType, dataBase64: photo.dataBase64, ...(photo.crop === undefined ? {} : { crop: { ...photo.crop } }) } }),
      );
      return { version: result.version };
    },
    async remove() {
      await callApi(() => api.DELETE("/me/photo"));
    },
    async fetch(signal) {
      try {
        const { data, response } = await mediaApi.GET("/me/photo", { headers: { Accept: "image/webp" }, parseAs: "arrayBuffer", signal });
        if (response.status === 404) return { kind: "absent" };
        if (!response.ok || !(data instanceof ArrayBuffer)) return { kind: "unavailable" };
        return { kind: "ok", bytes: new Uint8Array(data) };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  photo_type_not_allowed: "Formato de imagem não aceito. Use JPEG, PNG ou WebP.",
  photo_content_mismatch: "O arquivo não corresponde ao formato informado. Escolha outra imagem.",
  photo_too_large: "A imagem é maior que 5 MB. Escolha uma menor.",
  photo_unreadable: "Não foi possível ler a imagem. Escolha outra.",
  photo_too_small: "A imagem é pequena demais. Use ao menos 64 × 64 pixels.",
  photo_crop_invalid: "O recorte escolhido é inválido. Tente de novo.",
};

export const PHOTO_OFFLINE_MESSAGE = "Sem internet. Tente de novo conectado.";

/** Short pt-BR text of a failed photo call (server codes of `docs/implementation/profile-photo.md`). */
export function photoErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "Não foi possível salvar a foto. Tente de novo.";
  if (error.status === 0) return PHOTO_OFFLINE_MESSAGE;
  if (error.status === 400) {
    for (const issue of error.issues) {
      const text = ISSUE_MESSAGES[issue.code];
      if (text !== undefined) return text;
    }
    return "A imagem não foi aceita. Escolha outra.";
  }
  if (error.status === 401) return "Sua sessão expirou. Entre de novo.";
  if (error.status === 429) return "Aguarde alguns segundos para tentar de novo.";
  if (error.status === 503) return "O armazenamento de fotos está indisponível agora. Tente mais tarde.";
  return "Não foi possível salvar a foto. Tente de novo.";
}

export type PhotoChangeResult =
  | { readonly ok: true; readonly version: string | null }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled?: false; readonly message: string };

export interface ProfilePhotoService {
  /** False when this build has no picker module: the "Trocar foto" action is hidden. */
  readonly canChange: boolean;
  readonly store: ProfilePhotoStore;
  /** Online only; never queued. */
  change(source: PhotoSource): Promise<PhotoChangeResult>;
  remove(): Promise<PhotoChangeResult>;
}

/** Decoded size of a standard base64 string. */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function createProfilePhotoService(deps: { readonly api: ProfilePhotoApi; readonly store: ProfilePhotoStore; readonly picker: PhotoPicker | null }): ProfilePhotoService {
  const { api, store, picker } = deps;
  return {
    canChange: picker !== null,
    store,
    async change(source) {
      if (picker === null) return { ok: false, message: "Este aplicativo ainda não permite escolher fotos." };
      let picked: PickedPhoto | null;
      try {
        picked = await picker.pick(source);
      } catch {
        return { ok: false, message: ISSUE_MESSAGES.photo_unreadable ?? "Não foi possível ler a imagem." };
      }
      if (picked === null) return { ok: false, cancelled: true };
      if (decodedBytes(picked.dataBase64) > PHOTO_UPLOAD_MAX_BYTES) return { ok: false, message: ISSUE_MESSAGES.photo_too_large ?? "A imagem é grande demais." };
      try {
        const saved = await api.upload(picked);
        return { ok: true, version: saved.version };
      } catch (error) {
        return { ok: false, message: photoErrorMessage(error) };
      }
    },
    async remove() {
      try {
        await api.remove();
        await store.purge().catch(() => undefined);
        return { ok: true, version: null };
      } catch (error) {
        return { ok: false, message: photoErrorMessage(error) };
      }
    },
  };
}
