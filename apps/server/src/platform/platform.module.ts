import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { IntegrationSummaryService } from './integration-summary.js';
import { ReadinessService } from './readiness.service.js';

/** Platform endpoints (`/health`, `/ready`) and the integration summary they report. */
@Module({
  controllers: [HealthController],
  providers: [ReadinessService, IntegrationSummaryService],
  exports: [IntegrationSummaryService],
})
export class PlatformModule {}
