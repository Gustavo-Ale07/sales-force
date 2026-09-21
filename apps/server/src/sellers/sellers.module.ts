import { Module } from '@nestjs/common';
import { MirrorModule } from '../mirror/mirror.module.js';
import { SellersController } from './sellers.controller.js';
import { SellersService } from './sellers.service.js';

@Module({ imports: [MirrorModule], controllers: [SellersController], providers: [SellersService] })
export class SellersModule {}
