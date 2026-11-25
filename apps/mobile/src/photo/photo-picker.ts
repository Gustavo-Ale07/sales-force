import type { PhotoPicker, PickedPhoto } from "./profile-photo";

/** Side of the stored square, in pixels (the server also caps at 512 px). */
export const PHOTO_TARGET_SIDE = 512;
/** The reduced file stays well below this many bytes (the proxy accepts 1 MB bodies; base64 adds a third). */
export const PHOTO_TARGET_MAX_BYTES = 400 * 1024;
/** JPEG qualities tried in order until the file fits the limit. */
export const PHOTO_QUALITY_STEPS: readonly number[] = [0.8, 0.65, 0.5, 0.35, 0.2];

/** The slice of `expo-image-picker` the adapter uses. */
export interface ImagePickerModule {
  requestCameraPermissionsAsync(): Promise<{ granted: boolean }>;
  launchCameraAsync(options: ImagePickerOptions): Promise<ImagePickerResult>;
  launchImageLibraryAsync(options: ImagePickerOptions): Promise<ImagePickerResult>;
}

interface ImagePickerOptions {
  readonly mediaTypes: readonly string[];
  readonly allowsEditing: boolean;
  readonly aspect: readonly [number, number];
  readonly quality: number;
  readonly base64: boolean;
}

interface ImagePickerResult {
  readonly canceled: boolean;
  readonly assets?: readonly { readonly uri?: string | null; readonly width?: number | null; readonly height?: number | null }[] | null;
}

/** The slice of `expo-image-manipulator` (SDK 57 context API) the adapter uses. */
export interface ImageManipulatorModule {
  ImageManipulator: {
    manipulate(uri: string): {
      crop(rect: { originX: number; originY: number; width: number; height: number }): unknown;
      resize(size: { width: number }): unknown;
      renderAsync(): Promise<{ saveAsync(options: { format: string; compress: number; base64: boolean }): Promise<{ base64?: string | null }> }>;
    };
  };
  SaveFormat: { JPEG: string; PNG?: string };
}

/** Decoded size of a standard base64 string. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** First quality step whose encoded file is below `maxBytes`; `null` when even the lowest step is too big. */
export async function encodeUnderLimit(encode: (quality: number) => Promise<string | null>, maxBytes: number = PHOTO_TARGET_MAX_BYTES): Promise<string | null> {
  for (const quality of PHOTO_QUALITY_STEPS) {
    const base64 = await encode(quality);
    if (base64 !== null && base64.length > 0 && base64Bytes(base64) < maxBytes) return base64;
  }
  return null;
}

/** Largest centred square of a width x height image. */
export function centreSquare(width: number, height: number): { originX: number; originY: number; width: number; height: number } {
  const side = Math.min(width, height);
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
}

/**
 * Square crop (picker editor 1:1, then a centred square again if the editor was skipped), reduction to 512 px JPEG on the
 * device, quality lowered until the file is under 400 KB. The upload is the reduced JPEG, never the original.
 */
export function createImagePickerAdapter(picker: ImagePickerModule, manipulator: ImageManipulatorModule): PhotoPicker {
  const options: ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1, base64: false };
  return {
    async pick(source) {
      if (source === "camera") {
        const permission = await picker.requestCameraPermissionsAsync();
        if (!permission.granted) return null;
      }
      const result = source === "camera" ? await picker.launchCameraAsync(options) : await picker.launchImageLibraryAsync(options);
      const asset = result.canceled ? undefined : result.assets?.[0];
      if (asset === undefined || typeof asset.uri !== "string" || asset.uri.length === 0) return null;
      const uri = asset.uri;
      const width = asset.width ?? 0;
      const height = asset.height ?? 0;
      const { ImageManipulator, SaveFormat } = manipulator;
      const encode = async (quality: number): Promise<string | null> => {
        const context = ImageManipulator.manipulate(uri);
        if (width > 0 && height > 0 && width !== height) context.crop(centreSquare(width, height));
        if (Math.min(width, height) === 0 || Math.min(width, height) > PHOTO_TARGET_SIDE) context.resize({ width: PHOTO_TARGET_SIDE });
        const image = await context.renderAsync();
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
        return saved.base64 ?? null;
      };
      // PNG first: the Android JPEG encoder paints transparent pixels black; the server flattens on white and re-encodes.
      const encodePng = async (): Promise<string | null> => {
        const context = ImageManipulator.manipulate(uri);
        if (width > 0 && height > 0 && width !== height) context.crop(centreSquare(width, height));
        if (Math.min(width, height) === 0 || Math.min(width, height) > PHOTO_TARGET_SIDE) context.resize({ width: PHOTO_TARGET_SIDE });
        const image = await context.renderAsync();
        const saved = await image.saveAsync({ format: SaveFormat.PNG as string, compress: 1, base64: true });
        return saved.base64 ?? null;
      };
      try {
        const png = SaveFormat.PNG === undefined ? null : await encodePng();
        if (png !== null && png.length > 0 && base64Bytes(png) < PHOTO_TARGET_MAX_BYTES) return { contentType: "image/png", dataBase64: png } satisfies PickedPhoto;
      } catch {
        // falls back to JPEG below
      }
      const dataBase64 = await encodeUnderLimit(encode);
      if (dataBase64 === null) throw new Error("photo_unreadable");
      return { contentType: "image/jpeg", dataBase64 } satisfies PickedPhoto;
    },
  };
}

declare const require: (id: string) => unknown;

/** Loads the native modules if this build has them; any failure (module absent from the binary) means no picker. */
export function detectPhotoPicker(load?: (id: string) => unknown): PhotoPicker | null {
  try {
    // Literal requires sit inside the try so Metro treats the modules as optional dependencies.
    const picker = (load !== undefined ? load("expo-image-picker") : require("expo-image-picker")) as Partial<ImagePickerModule> | null;
    const manipulator = (load !== undefined ? load("expo-image-manipulator") : require("expo-image-manipulator")) as Partial<ImageManipulatorModule> | null;
    if (picker === null || typeof picker !== "object" || typeof picker.launchImageLibraryAsync !== "function" || typeof picker.launchCameraAsync !== "function" || typeof picker.requestCameraPermissionsAsync !== "function") return null;
    if (manipulator === null || typeof manipulator !== "object" || manipulator.ImageManipulator === undefined || manipulator.SaveFormat === undefined) return null;
    return createImagePickerAdapter(picker as ImagePickerModule, manipulator as ImageManipulatorModule);
  } catch {
    return null;
  }
}
