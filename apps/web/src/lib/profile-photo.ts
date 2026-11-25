import { ApiRequestError } from "./api";
import type { AuthUser } from "./auth-client";

/** Own profile photo (`/me/photo`). Same-origin, cookie session; the version is only a cache key. */

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
export const PHOTO_MAX_SIDE_PX = 1024;
export const PHOTO_MIN_SIDE_PX = 64;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoContentType = (typeof PHOTO_TYPES)[number];

export function photoUrl(photoVersion: string | null | undefined): string | null {
  return photoVersion ? `/api/v1/me/photo?v=${encodeURIComponent(photoVersion)}` : null;
}

export function userPhotoSrc(user: Pick<AuthUser, "photoVersion"> | null): string | null {
  return photoUrl(user?.photoVersion);
}

export type PhotoProblem = "photo_type_not_allowed" | "photo_too_large" | "photo_too_small" | "photo_unreadable";

export const photoMessages: Record<string, string> = {
  photo_type_not_allowed: "Formato de imagem não aceito. Use JPEG, PNG ou WebP.",
  photo_content_mismatch: "O arquivo não corresponde ao formato informado. Escolha outra imagem.",
  photo_too_large: "A imagem é maior que 5 MB. Escolha uma menor.",
  photo_unreadable: "Não foi possível ler a imagem. Escolha outra.",
  photo_too_small: "A imagem é pequena demais. Use ao menos 64 × 64 pixels.",
  photo_crop_invalid: "O recorte escolhido é inválido. Tente de novo.",
};

/** Field-level validation of the picked file (type and size) before anything is read or sent. */
export function validatePhotoFile(file: Pick<File, "type" | "size">): PhotoProblem | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return "photo_type_not_allowed";
  if (file.size > PHOTO_MAX_BYTES) return "photo_too_large";
  if (file.size === 0) return "photo_unreadable";
  return null;
}

/** Short pt-BR message of a failed upload: the server's issue code first, then the status. */
export function photoUploadMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 400) {
      const code = error.issues[0]?.code;
      return (code ? photoMessages[code] : undefined) ?? "A imagem não foi aceita. Escolha outra.";
    }
    if (error.status === 429) return "Aguarde alguns segundos para tentar de novo.";
    if (error.status === 503) return "O armazenamento de fotos está indisponível agora. Tente mais tarde.";
    if (error.status === 0) return "Sem internet. Tente de novo conectado.";
    if (error.status === 401) return "Sua sessão expirou. Entre de novo.";
    if (error.status === 403) return "Seu perfil não pode alterar a foto.";
  }
  return "Não foi possível salvar a foto. Tente de novo.";
}

export interface PreparedPhoto {
  contentType: PhotoContentType;
  dataBase64: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("photo_unreadable"));
    image.src = url;
  });
}

/**
 * Centre square crop on a canvas, downscaled to at most 1024 px, encoded as JPEG (white behind transparency).
 * Throws an Error whose message is a `PhotoProblem` code when the image cannot be used.
 */
export async function prepareSquarePhoto(file: Blob): Promise<PreparedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side < PHOTO_MIN_SIDE_PX) throw new Error("photo_too_small");
    const output = Math.min(side, PHOTO_MAX_SIDE_PX);
    const canvas = document.createElement("canvas");
    canvas.width = output;
    canvas.height = output;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("photo_unreadable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output, output);
    const sx = Math.floor((image.naturalWidth - side) / 2);
    const sy = Math.floor((image.naturalHeight - side) / 2);
    context.drawImage(image, sx, sy, side, side, 0, 0, output, output);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (dataBase64 === "") throw new Error("photo_unreadable");
    return { contentType: "image/jpeg", dataBase64 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Message for an error thrown by `prepareSquarePhoto`. */
export function preparationMessage(error: unknown): string {
  return (error instanceof Error ? photoMessages[error.message] : undefined) ?? photoMessages["photo_unreadable"]!;
}
