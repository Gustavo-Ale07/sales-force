import { Alert, Avatar, Button, Dialog, DialogClose, DialogContent, FieldError, titleCase } from "@salesforce/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { deleteProfilePhoto, putProfilePhoto } from "../lib/api-mutations";
import { useApi } from "../lib/app-context";
import { sessionQueryKey, type AuthUser } from "../lib/auth-client";
import { useGuardedImageSrc } from "../lib/guarded-image";
import {
  PHOTO_ACCEPT,
  photoMessages,
  photoUploadMessage,
  photoUrl,
  prepareSquarePhoto,
  preparationMessage,
  validatePhotoFile,
  type PreparedPhoto,
} from "../lib/profile-photo";

export interface ProfilePhotoControlsProps {
  user: Pick<AuthUser, "id" | "name" | "photoVersion">;
  /** Test seam: replaces the canvas crop (jsdom has no canvas). */
  prepare?: (file: File) => Promise<PreparedPhoto>;
}

/** Avatar with "Trocar foto" / "Remover foto" for the signed-in user's own photo. Server validates everything again. */
export function ProfilePhotoControls({ user, prepare = prepareSquarePhoto }: ProfilePhotoControlsProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    const url = picked?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked]);

  const setVersion = (photoVersion: string | null) =>
    queryClient.setQueryData<AuthUser | null>(sessionQueryKey, (current) => (current ? { ...current, photoVersion } : current));

  const upload = useMutation({
    mutationFn: async (file: File) => {
      let prepared: PreparedPhoto;
      try {
        prepared = await prepare(file);
      } catch (error) {
        throw new PreparationError(preparationMessage(error));
      }
      return putProfilePhoto(api, { contentType: prepared.contentType, dataBase64: prepared.dataBase64 });
    },
    onSuccess: (result) => {
      setVersion(result.version);
      setPicked(null);
      setUploadError(null);
    },
    onError: (error) => setUploadError(error instanceof PreparationError ? error.message : photoUploadMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => deleteProfilePhoto(api),
    onSuccess: () => {
      setVersion(null);
      setRemoveOpen(false);
      setRemoveError(null);
    },
    onError: (error) => setRemoveError(photoUploadMessage(error)),
  });

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = validatePhotoFile(file);
    if (problem) {
      setFieldError(photoMessages[problem] ?? null);
      return;
    }
    setFieldError(null);
    setUploadError(null);
    upload.reset();
    setPicked({ file, previewUrl: URL.createObjectURL(file) });
  };

  const closePreview = () => {
    if (upload.isPending) return;
    setPicked(null);
    setUploadError(null);
    upload.reset();
  };

  const photoSrc = useGuardedImageSrc(photoUrl(user.photoVersion));
  const displayName = titleCase(user.name);
  const hasPhoto = Boolean(user.photoVersion);

  return (
    <div className="flex items-center gap-4">
      <Avatar name={displayName} seed={user.id} size="xl" src={photoSrc} />
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={PHOTO_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-label="Selecionar arquivo da foto"
            aria-describedby={fieldError ? errorId : undefined}
            data-testid="photo-file-input"
            onChange={onPick}
          />
          <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
            <Camera size={14} aria-hidden="true" />
            Trocar foto
          </Button>
          {hasPhoto ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setRemoveError(null);
                remove.reset();
                setRemoveOpen(true);
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remover foto
            </Button>
          ) : null}
        </div>
        
        {fieldError ? <FieldError id={errorId}>{fieldError}</FieldError> : null}
      </div>

      <Dialog open={picked !== null} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent
          title="Nova foto de perfil"
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary" disabled={upload.isPending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button variant="primary" loading={upload.isPending} onClick={() => picked && upload.mutate(picked.file)}>
                {upload.isPending ? "Enviando foto…" : "Usar esta foto"}
              </Button>
            </>
          }
        >
          {picked ? (
            <div className="flex justify-center">
              <img src={picked.previewUrl} alt="Pré-visualização da nova foto" className="size-40 rounded-full border border-line object-cover" />
            </div>
          ) : null}
          {upload.isPending ? (
            <p className="m-0 mt-3 text-center text-sm text-fg-muted" role="status">
              Enviando foto…
            </p>
          ) : null}
          {uploadError ? (
            <Alert tone="danger" title="Foto não alterada" className="mt-3">
              {uploadError}
            </Alert>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeOpen}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoveOpen(false);
        }}
      >
        <DialogContent
          title="Remover foto"
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary" disabled={remove.isPending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                Remover
              </Button>
            </>
          }
        >
          {removeError ? (
            <Alert tone="danger" title="Foto não alterada">
              {removeError}
            </Alert>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

class PreparationError extends Error {}
