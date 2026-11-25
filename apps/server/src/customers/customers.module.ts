import { Module } from '@nestjs/common';
import { MirrorModule } from '../mirror/mirror.module.js';
import { CustomerRegistrationRepository } from './customer-registration.repository.js';
import { CustomerRegistrationService } from './customer-registration.service.js';
import { CustomerUpdateService } from './customer-update.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({
  imports: [MirrorModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerRegistrationRepository, CustomerRegistrationService, CustomerUpdateService],
  exports: [CustomersService],
})
export class CustomersModule {}
