import { Controller, Headers, Inject, Res } from '@nestjs/common';
import { API_BASE_PATH, routes, type ProfilePhoto } from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { AppError } from '../http/app-error.js';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { AccountPhotoService } from './account-photo.service.js';
import { CurrentUserParam, type CurrentUser } from './current-user.js';

/**
 * `/me/photo`: the caller's OWN profile photo. No route names an account, so there is nothing to forge: the account is
 * always the one of the session. Thin: parse, call the service, map to the contract.
 */
@Controller(API_BASE_PATH)
export class AccountPhotoController {
  constructor(@Inject(AccountPhotoService) private readonly photos: AccountPhotoService) {}

  @ApiRoute(routes.putProfilePhoto)
  put(@CurrentUserParam() user: CurrentUser, @Contract() contract: RequestContract<typeof routes.putProfilePhoto>): Promise<ProfilePhoto> {
    return this.photos.put(user, contract.body);
  }

  @ApiRoute(routes.deleteProfilePhoto)
  remove(@CurrentUserParam() user: CurrentUser): Promise<void> {
    return this.photos.remove(user);
  }

  /** Binary route: the handler writes the reply itself, like the product image. */
  @ApiRoute(routes.getProfilePhoto)
  async get(
    @CurrentUserParam() user: CurrentUser,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const served = await this.photos.serve(user, ifNoneMatch);
    if (served === null) throw new AppError('not_found');
    // Personal data behind a cookie: always revalidate by ETag (the `?v=` URL stays usable), never shared-cache.
    const cacheControl = 'private, no-cache';
    if (served.kind === 'not_modified') {
      void reply.status(304).header('etag', served.etag).header('cache-control', cacheControl).header('vary', 'Cookie').send();
      return;
    }
    void reply
      .status(200)
      // Every stored rendition is WebP produced by the server; never echo a stored value.
      .header('content-type', 'image/webp')
      .header('content-length', served.bytes.length)
      .header('content-disposition', 'inline')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cross-origin-resource-policy', 'same-site')
      .header('etag', served.etag)
      .header('cache-control', cacheControl)
      .header('vary', 'Cookie')
      .send(Buffer.from(served.bytes.buffer, served.bytes.byteOffset, served.bytes.byteLength));
  }
}
