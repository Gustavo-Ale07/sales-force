import { Module } from '@nestjs/common';
import { MirrorModule } from '../mirror/mirror.module.js';
import { POSTAL_CODE_SOURCES } from '../platform/tokens.js';
import { CustomerRegistrationQueryService } from './customer-registration-query.service.js';
import { CustomerRegistrationRepository } from './customer-registration.repository.js';
import { CustomerRegistrationService } from './customer-registration.service.js';
import { CustomerUpdateService } from './customer-update.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { BrasilApiSource, ViaCepSource, type PostalCodeSource } from './postal-code.source.js';
import { PostalCodeService } from './postal-code.service.js';

@Module({
  imports: [MirrorModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerRegistrationRepository,
    CustomerRegistrationService,
    CustomerRegistrationQueryService,
    CustomerUpdateService,
    PostalCodeService,
    // ViaCEP first, BrasilAPI as the fallback (owner request). Replaceable in tests through the token.
    { provide: POSTAL_CODE_SOURCES, useFactory: (): readonly PostalCodeSource[] => [new ViaCepSource(), new BrasilApiSource()] },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
