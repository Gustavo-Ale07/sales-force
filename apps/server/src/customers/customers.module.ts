import { Module } from '@nestjs/common';
import { MirrorModule } from '../mirror/mirror.module.js';
import { CNPJ_SOURCES, POSTAL_CODE_SOURCES } from '../platform/tokens.js';
import { BrasilApiCnpjSource, CnpjWsSource, type CnpjSource } from './cnpj.source.js';
import { CNPJ_CACHE_STORE, CnpjService, DbCnpjCacheStore } from './cnpj.service.js';
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
    CnpjService,
    { provide: CNPJ_CACHE_STORE, useClass: DbCnpjCacheStore },
    // BrasilAPI first, publica.cnpj.ws as the alternative. Replaceable in tests through the token.
    { provide: CNPJ_SOURCES, useFactory: (): readonly CnpjSource[] => [new BrasilApiCnpjSource(), new CnpjWsSource()] },
    // ViaCEP first, BrasilAPI as the fallback (owner request). Replaceable in tests through the token.
    { provide: POSTAL_CODE_SOURCES, useFactory: (): readonly PostalCodeSource[] => [new ViaCepSource(), new BrasilApiSource()] },
  ],
  exports: [CustomersService, CustomerRegistrationService, CustomerRegistrationRepository, PostalCodeService],
})
export class CustomersModule {}
