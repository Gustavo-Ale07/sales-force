import { Controller } from '@nestjs/common';
import { API_BASE_PATH, routes } from '@salesforce/contracts';
import { ApiRoute } from '../http/route.js';

/**
 * `GET /server-code/check`: the global `ServerCodeGuard` already ran, so reaching the handler means the code is right (204).
 * There is no route to read, generate or rotate the code: that is a command-line operation on the server (`server-code-cli.ts`).
 */
@Controller(API_BASE_PATH)
export class ServerCodeController {
  @ApiRoute(routes.checkServerCode)
  check(): void {}
}
