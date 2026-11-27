import { useEffect, useState } from "react";
import { fetchWithServerCode } from "./api";

/**
 * `<img src>` cannot send the X-Server-Code header, so same-origin API images (product photos, own profile photo)
 * are fetched through the guarded client and shown from a blob URL. The downloaded blob is cached per URL (the
 * server-built URLs carry a version, so a changed image is a new key); every consumer makes and revokes its own
 * object URL. A failed download is not cached and the caller keeps its placeholder.
 */
const blobs = new Map<string, Promise<Blob | null>>();

function download(src: string): Promise<Blob | null> {
  const known = blobs.get(src);
  if (known) return known;
  const pending = (async () => {
    try {
      const response = await fetchWithServerCode(new Request(`${window.location.origin}${src}`, { credentials: "same-origin" }));
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  })().then((blob) => {
    if (blob === null) blobs.delete(src);
    return blob;
  });
  blobs.set(src, pending);
  return pending;
}

/** Drops the cached downloads (tests). */
export function clearGuardedImageCache(): void {
  blobs.clear();
}

/** Blob URL of the guarded image at `src` (a same-origin path), or `null` while loading, without a source, or on failure. */
export function useGuardedImageSrc(src: string | null | undefined): string | null {
  const [state, setState] = useState<{ src: string; url: string } | null>(null);

  useEffect(() => {
    if (!src || typeof URL.createObjectURL !== "function") return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void download(src).then((blob) => {
      if (cancelled || blob === null) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ src, url: objectUrl });
    });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return src && state?.src === src ? state.url : null;
}
