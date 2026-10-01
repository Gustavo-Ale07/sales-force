import { Inject, Injectable } from '@nestjs/common';
import { API_BASE_PATH, type ProductImage, type ProductImageVariant } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';
import { errorLogFields, type Logger } from '../observability/logger.js';
import { LOGGER, PRODUCT_IMAGE_SETTINGS, PRODUCT_IMAGE_SOURCE } from '../platform/tokens.js';
import {
  imageEtag,
  imagePaths,
  inspectImage,
  isValidImageVersion,
  matchesIfNoneMatch,
  type ImageContentType,
  type ProductImageSettings,
  type ProductImageSource,
} from './product-image.js';

export type ServedImage =
  | { readonly kind: 'not_modified'; readonly etag: string }
  | {
      readonly kind: 'image';
      readonly etag: string;
      readonly contentType: ImageContentType;
      readonly bytes: Uint8Array;
    };

/**
 * Product images over the `ProductImageSource` port. Authorization is the caller's job (the catalog decides
 * whether the actor may see the product); this service only talks to the source and polices what comes back.
 * Source failures never leak: a timeout or error is `service_unavailable` (503), the cause is only logged.
 */
@Injectable()
export class ProductImageService {
  constructor(
    @Inject(PRODUCT_IMAGE_SOURCE) private readonly source: ProductImageSource,
    @Inject(PRODUCT_IMAGE_SETTINGS) private readonly settings: ProductImageSettings,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  get maxAgeSeconds(): number {
    return this.settings.maxAgeSeconds;
  }

  /** Runs one source call with a deadline; the signal is aborted on timeout so a cooperative source stops. */
  private async callSource<T>(operation: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`product image source timed out after ${this.settings.sourceTimeoutMs} ms`));
      }, this.settings.sourceTimeoutMs);
    });
    try {
      return await Promise.race([run(controller.signal), deadline]);
    } catch (error) {
      this.logger.error({ ...errorLogFields(error), operation }, 'product image source failed');
      throw new AppError('service_unavailable', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Image metadata for catalog rows. Best effort: a source failure degrades to "no image" for the page (logged)
   * instead of failing the catalog, which works without photos.
   */
  async metadataFor(codes: readonly number[]): Promise<ReadonlyMap<number, ProductImage>> {
    const result = new Map<number, ProductImage>();
    if (codes.length === 0) return result;
    let versions: ReadonlyMap<number, string>;
    try {
      versions = await this.callSource('versions', (signal) => this.source.versions(codes, signal));
    } catch {
      return result;
    }
    for (const code of codes) {
      const version = versions.get(code);
      if (version === undefined) continue;
      if (!isValidImageVersion(version)) {
        this.logger.error({ productCode: code }, 'product image source returned an invalid version');
        continue;
      }
      result.set(code, { version, ...imagePaths(API_BASE_PATH, code) });
    }
    return result;
  }

  /** `null` = the product has no usable image (the route answers 404). */
  async serve(code: number, variant: ProductImageVariant, ifNoneMatch: string | undefined): Promise<ServedImage | null> {
    const versions = await this.callSource('versions', (signal) => this.source.versions([code], signal));
    const knownVersion = versions.get(code);
    if (knownVersion === undefined) return null;
    if (!isValidImageVersion(knownVersion)) return this.defect(code, 'invalid_version');
    const knownEtag = imageEtag(variant, knownVersion);
    if (matchesIfNoneMatch(ifNoneMatch, knownEtag)) return { kind: 'not_modified', etag: knownEtag };

    const image = await this.callSource('getImage', (signal) => this.source.getImage(code, variant, signal));
    if (image === null) return null;
    if (!isValidImageVersion(image.version)) return this.defect(code, 'invalid_version');
    const inspected = inspectImage(image.bytes, this.settings.maxBytes[variant]);
    if (!inspected.ok) return this.defect(code, inspected.reason);
    return {
      kind: 'image',
      etag: imageEtag(variant, image.version),
      contentType: inspected.contentType,
      bytes: image.bytes,
    };
  }

  /** The source produced something we will not serve: no usable image, with the reason kept in the logs only. */
  private defect(code: number, reason: string): null {
    this.logger.error({ productCode: code, reason }, 'product image rejected');
    return null;
  }
}
