import { Module } from '@nestjs/common';
import { MirrorModule } from '../mirror/mirror.module.js';
import { SellerDiscountLimitsController } from './seller-discount-limits.controller.js';
import { SellerDiscountLimitsService } from './seller-discount-limits.service.js';

/** Per-seller discount limits (W-39). API process only. */
@Module({
  imports: [MirrorModule],
  controllers: [SellerDiscountLimitsController],
  providers: [SellerDiscountLimitsService],
  exports: [SellerDiscountLimitsService],
})
export class SellerDiscountLimitsModule {}
