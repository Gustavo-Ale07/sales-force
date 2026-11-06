import { Module } from '@nestjs/common';
import { SyncRefreshController } from './sync-refresh.controller.js';
import { SyncRefreshService } from './sync-refresh.service.js';

@Module({
  controllers: [SyncRefreshController],
  providers: [SyncRefreshService],
})
export class SyncRefreshModule {}
