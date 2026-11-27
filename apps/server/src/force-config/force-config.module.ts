import { Module } from '@nestjs/common';
import { ForceConfigController } from './force-config.controller.js';
import { ForceConfigRepository } from './force-config.repository.js';
import { ForceConfigService } from './force-config.service.js';

/** The Force own configuration (settings and per-seller discount rules). API process only. */
@Module({
  controllers: [ForceConfigController],
  providers: [ForceConfigRepository, ForceConfigService],
  exports: [ForceConfigRepository, ForceConfigService],
})
export class ForceConfigModule {}
