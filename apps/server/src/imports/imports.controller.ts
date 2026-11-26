import { Controller, Inject, Res } from '@nestjs/common';
import { API_BASE_PATH, EXPORT_CONTENT_TYPES, routes, type ImportPreview, type ImportResult } from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { ExportsService, type ExportFile } from './exports.service.js';
import { ImportsService } from './imports.service.js';

function send(reply: FastifyReply, file: ExportFile): void {
  void reply
    .status(200)
    .header('content-type', EXPORT_CONTENT_TYPES[file.format])
    .header('content-disposition', `attachment; filename="${file.fileName}"`)
    // Personal and commercial data behind a cookie: never stored by a cache.
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .send(file.body);
}

/** Thin: the import/export rules live in the services; authorization is the central route policy. */
@Controller(API_BASE_PATH)
export class ImportsController {
  constructor(
    @Inject(ImportsService) private readonly imports: ImportsService,
    @Inject(ExportsService) private readonly exports: ExportsService,
  ) {}

  @ApiRoute(routes.getOrderImportTemplate)
  async template(@CurrentUserParam() user: CurrentUser, @Res() reply: FastifyReply): Promise<void> {
    send(reply, await this.exports.orderTemplate(user));
  }

  @ApiRoute(routes.previewImport)
  preview(@CurrentUserParam() user: CurrentUser, @Contract() contract: RequestContract<typeof routes.previewImport>): Promise<ImportPreview> {
    return this.imports.preview(user, contract.body);
  }

  @ApiRoute(routes.confirmImport)
  confirm(@CurrentUserParam() user: CurrentUser, @Contract() contract: RequestContract<typeof routes.confirmImport>): Promise<ImportResult> {
    return this.imports.confirm(user, contract.body);
  }

  @ApiRoute(routes.exportCustomers)
  async customers(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.exportCustomers>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    send(reply, await this.exports.customersFile(user, contract.query));
  }

  @ApiRoute(routes.exportOrders)
  async orders(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.exportOrders>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    send(reply, await this.exports.ordersFile(user, contract.query));
  }

  @ApiRoute(routes.exportProducts)
  async products(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.exportProducts>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    send(reply, await this.exports.productsFile(user, contract.query));
  }
}
