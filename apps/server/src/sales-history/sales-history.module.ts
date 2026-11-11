import { Module } from '@nestjs/common';
import { MirrorModule } from '../mirror/mirror.module.js';
import { SalesHistoryRepository } from './sales-history.repository.js';
import { SalesHistoryService } from './sales-history.service.js';

/** Scoped read side of the sales-history mirror (stage D). No HTTP endpoint yet; consumers inject the service. */
@Module({
  imports: [MirrorModule],
  providers: [SalesHistoryRepository, SalesHistoryService],
  exports: [SalesHistoryService],
})
export class SalesHistoryModule {}
