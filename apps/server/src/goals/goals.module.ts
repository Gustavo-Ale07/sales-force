import { Module } from '@nestjs/common';
import { MirrorModule } from '../mirror/mirror.module.js';
import { SalesHistoryModule } from '../sales-history/sales-history.module.js';
import { GoalsController } from './goals.controller.js';
import { GoalsRepository } from './goals.repository.js';
import { GoalsService } from './goals.service.js';

@Module({
  imports: [MirrorModule, SalesHistoryModule],
  controllers: [GoalsController],
  providers: [GoalsRepository, GoalsService],
})
export class GoalsModule {}
